use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
use thiserror::Error;
use tokio::process::Command;
use tokio::sync::{broadcast, mpsc, oneshot, watch};
use tokio::task::JoinError;

use portable_pty::{Child, ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};

const DEFAULT_WINDOW_ROWS: u16 = 24;
const DEFAULT_WINDOW_COLS: u16 = 80;
const CHANNEL_CAPACITY: usize = 256;
const TERMINAL_CLOSE_GRACE_MS: u64 = 200;
const TMUX_CLIENT_FLAGS: &str = "active-pane";
const TERMINAL_GROUP_PREFIX: &str = "wmux-terminal-";
static NEXT_TERMINAL_GROUP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("target name is required")]
    MissingTargetName,
    #[error("session target is required")]
    MissingTarget,
    #[error("{0} target is required")]
    MissingTargetPart(&'static str),
    #[error("window size must be positive")]
    InvalidWindowSize,
    #[error("parse terminal target: {0}")]
    InvalidTarget(String),
    #[error("tmux command failed: {0}")]
    TmuxCommandFailed(String),
    #[error("pty error: {0}")]
    Pty(String),
    #[error("session is closed")]
    SessionClosed,
    #[error("background task failed: {0}")]
    Join(String),
}

impl From<io::Error> for SessionError {
    fn from(error: io::Error) -> Self {
        Self::Pty(error.to_string())
    }
}

impl From<anyhow::Error> for SessionError {
    fn from(error: anyhow::Error) -> Self {
        Self::Pty(error.to_string())
    }
}

impl From<JoinError> for SessionError {
    fn from(error: JoinError) -> Self {
        Self::Join(error.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowSize {
    pub cols: u16,
    pub rows: u16,
}

impl Default for WindowSize {
    fn default() -> Self {
        Self {
            cols: DEFAULT_WINDOW_COLS,
            rows: DEFAULT_WINDOW_ROWS,
        }
    }
}

impl WindowSize {
    pub fn new(cols: u16, rows: u16) -> Result<Self, SessionError> {
        let size = Self { cols, rows };
        validate_window_size(size)
    }

    pub fn normalize(self) -> Self {
        Self {
            cols: if self.cols == 0 {
                DEFAULT_WINDOW_COLS
            } else {
                self.cols
            },
            rows: if self.rows == 0 {
                DEFAULT_WINDOW_ROWS
            } else {
                self.rows
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
    Close,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Output { data: String },
    Status { status: String },
    Error { error: ErrorDetail },
    Close,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

impl ErrorDetail {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionManager {
    inner: Arc<Mutex<ManagerState>>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ManagerState::default())),
        }
    }

    pub async fn attach_local(
        &self,
        target_name: impl Into<String>,
        tmux_path: impl Into<String>,
        target: impl Into<String>,
        initial_size: WindowSize,
    ) -> Result<Session, SessionError> {
        let target_name = target_name.into();
        if target_name.trim().is_empty() {
            return Err(SessionError::MissingTargetName);
        }

        let tmux_path = tmux_path.into();
        let parsed_target = AttachTarget::parse(&target.into())?;
        let initial_size = initial_size.normalize();
        let prepared_target = prepare_terminal_target(&tmux_path, &parsed_target).await?;
        let process = match spawn_terminal_process(&tmux_path, &prepared_target, initial_size).await
        {
            Ok(process) => process,
            Err(error) => {
                cleanup_terminal_group(&tmux_path, &prepared_target.temp_session).await;
                return Err(error);
            }
        };

        let session = self.register(
            target_name.clone(),
            prepared_target.display_target.clone(),
            process,
            None,
        )?;
        tracing::debug!(target_name = %target_name, target = %prepared_target.display_target, temp_session = %prepared_target.temp_session, "terminal pty client attached");
        Ok(session)
    }

    pub fn list_active(&self) -> Vec<SessionInfo> {
        let state = self.inner.lock().expect("session manager mutex poisoned");
        let mut active = state
            .sessions
            .values()
            .map(Session::info)
            .collect::<Vec<_>>();
        active.sort_by(|a, b| {
            a.target_name
                .cmp(&b.target_name)
                .then_with(|| a.target.cmp(&b.target))
                .then_with(|| a.id.cmp(&b.id))
        });
        active
    }

    pub async fn detach(&self, target_name: &str) {
        let sessions = {
            let state = self.inner.lock().expect("session manager mutex poisoned");
            state
                .sessions
                .values()
                .filter(|session| session.target_name() == target_name)
                .cloned()
                .collect::<Vec<_>>()
        };

        for session in &sessions {
            let _ = session.close().await;
        }
        for session in sessions {
            let _ = session.wait_closed().await;
        }
    }

    pub async fn shutdown(&self) {
        let sessions = {
            let state = self.inner.lock().expect("session manager mutex poisoned");
            state.sessions.values().cloned().collect::<Vec<_>>()
        };

        for session in &sessions {
            let _ = session.close().await;
        }
        for session in sessions {
            let _ = session.wait_closed().await;
        }
    }

    fn register(
        &self,
        target_name: String,
        target: String,
        process: TerminalProcessParts,
        initial_output: Option<String>,
    ) -> Result<Session, SessionError> {
        let (input_tx, input_rx) = mpsc::channel(CHANNEL_CAPACITY);
        let (terminal_tx, terminal_rx) = mpsc::channel(CHANNEL_CAPACITY);
        let (events_tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        let (closed_tx, closed_rx) = watch::channel(false);
        let close_sent = Arc::new(AtomicBool::new(false));

        let session = {
            let mut state = self.inner.lock().expect("session manager mutex poisoned");
            let id = state.next_session_id(&target_name);
            Session {
                id,
                target_name,
                target,
                input_tx,
                terminal_tx,
                events_tx: events_tx.clone(),
                closed_rx,
                child_pid: process.child_pid,
                initial_output,
            }
        };

        self.inner
            .lock()
            .expect("session manager mutex poisoned")
            .sessions
            .insert(session.id.clone(), session.clone());

        spawn_terminal_tasks(
            Arc::clone(&self.inner),
            session.id.clone(),
            process,
            SessionTaskChannels {
                input_rx,
                terminal_rx,
                events_tx,
                closed_tx,
                close_sent,
            },
        );

        Ok(session)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionInfo {
    pub id: String,
    pub target_name: String,
    pub target: String,
}

#[derive(Debug, Clone)]
pub struct Session {
    id: String,
    target_name: String,
    target: String,
    input_tx: mpsc::Sender<String>,
    terminal_tx: mpsc::Sender<TerminalControl>,
    events_tx: broadcast::Sender<ServerMessage>,
    closed_rx: watch::Receiver<bool>,
    child_pid: Option<u32>,
    initial_output: Option<String>,
}

impl Session {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn target_name(&self) -> &str {
        &self.target_name
    }

    pub fn target(&self) -> &str {
        &self.target
    }

    pub fn child_process_id(&self) -> Option<u32> {
        self.child_pid
    }

    pub fn initial_output(&self) -> Option<&str> {
        self.initial_output.as_deref()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ServerMessage> {
        self.events_tx.subscribe()
    }

    pub async fn send_input(&self, data: impl Into<String>) -> Result<(), SessionError> {
        self.input_tx
            .send(data.into())
            .await
            .map_err(|_| SessionError::SessionClosed)
    }

    pub async fn resize(&self, size: WindowSize) -> Result<(), SessionError> {
        validate_window_size(size)?;
        self.terminal_tx
            .send(TerminalControl::Resize(size))
            .await
            .map_err(|_| SessionError::SessionClosed)
    }

    pub async fn close(&self) -> Result<(), SessionError> {
        self.terminal_tx
            .send(TerminalControl::Close)
            .await
            .map_err(|_| SessionError::SessionClosed)
    }

    pub async fn wait_closed(&self) -> Result<(), SessionError> {
        let mut closed_rx = self.closed_rx.clone();
        loop {
            if *closed_rx.borrow() {
                return Ok(());
            }
            closed_rx
                .changed()
                .await
                .map_err(|_| SessionError::SessionClosed)?;
        }
    }

    pub fn info(&self) -> SessionInfo {
        SessionInfo {
            id: self.id.clone(),
            target_name: self.target_name.clone(),
            target: self.target.clone(),
        }
    }
}

#[derive(Debug)]
enum TerminalControl {
    Resize(WindowSize),
    Close,
}

#[derive(Default, Debug)]
struct ManagerState {
    sessions: HashMap<String, Session>,
    next_id: u64,
}

impl ManagerState {
    fn next_session_id(&mut self, target_name: &str) -> String {
        loop {
            self.next_id += 1;
            let id = format!("{}#{}", target_name, self.next_id);
            if !self.sessions.contains_key(&id) {
                return id;
            }
        }
    }
}

struct SessionTaskChannels {
    input_rx: mpsc::Receiver<String>,
    terminal_rx: mpsc::Receiver<TerminalControl>,
    events_tx: broadcast::Sender<ServerMessage>,
    closed_tx: watch::Sender<bool>,
    close_sent: Arc<AtomicBool>,
}

struct TerminalProcessParts {
    child: Box<dyn Child + Send + Sync>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    child_pid: Option<u32>,
    tmux_path: String,
    temp_session: String,
}

#[derive(Debug, Clone)]
struct PreparedTerminalTarget {
    source_session: String,
    window_id: String,
    pane_id: String,
    display_target: String,
    temp_session: String,
}

fn spawn_terminal_tasks(
    manager: Arc<Mutex<ManagerState>>,
    session_id: String,
    process: TerminalProcessParts,
    channels: SessionTaskChannels,
) {
    spawn_terminal_reader_task(
        process.reader,
        channels.events_tx.clone(),
        Arc::clone(&channels.close_sent),
    );
    spawn_terminal_process_task(
        manager,
        session_id,
        process.child,
        process.killer,
        process.master,
        process.writer,
        process.tmux_path,
        process.temp_session,
        channels.input_rx,
        channels.terminal_rx,
        channels.events_tx,
        channels.closed_tx,
        channels.close_sent,
    );
}

fn spawn_terminal_reader_task(
    mut reader: Box<dyn Read + Send>,
    events_tx: broadcast::Sender<ServerMessage>,
    close_sent: Arc<AtomicBool>,
) {
    tokio::task::spawn_blocking(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    send_close_once(&events_tx, &close_sent);
                    return;
                }
                Ok(bytes_read) => {
                    let data = String::from_utf8_lossy(&buffer[..bytes_read]).into_owned();
                    let _ = events_tx.send(ServerMessage::Output { data });
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => {
                    tracing::error!(%error, "terminal pty read error");
                    let _ = events_tx.send(ServerMessage::Error {
                        error: ErrorDetail::new(
                            "terminal_output_failed",
                            format!("failed to read terminal output: {error}"),
                        ),
                    });
                    send_close_once(&events_tx, &close_sent);
                    return;
                }
            }
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn spawn_terminal_process_task(
    manager: Arc<Mutex<ManagerState>>,
    session_id: String,
    mut child: Box<dyn Child + Send + Sync>,
    mut killer: Box<dyn ChildKiller + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    mut writer: Box<dyn Write + Send>,
    tmux_path: String,
    temp_session: String,
    mut input_rx: mpsc::Receiver<String>,
    mut terminal_rx: mpsc::Receiver<TerminalControl>,
    events_tx: broadcast::Sender<ServerMessage>,
    closed_tx: watch::Sender<bool>,
    close_sent: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        let (wait_tx, mut wait_rx) = oneshot::channel();
        tokio::task::spawn_blocking(move || {
            let result = child.wait();
            let _ = wait_tx.send(result);
        });

        loop {
            tokio::select! {
                wait_result = &mut wait_rx => {
                    match wait_result {
                        Ok(Ok(status)) if status.success() => {}
                        Ok(Ok(status)) => {
                            tracing::debug!(session_id = %session_id, ?status, "terminal pty process exited");
                        }
                        Ok(Err(error)) => {
                            tracing::error!(session_id = %session_id, %error, "terminal pty process exited unexpectedly");
                            let _ = events_tx.send(ServerMessage::Error {
                                error: ErrorDetail::new(
                                    "terminal_closed",
                                    format!("terminal session ended unexpectedly: {error}"),
                                ),
                            });
                        }
                        Err(error) => {
                            tracing::error!(session_id = %session_id, %error, "terminal pty wait task failed");
                            let _ = events_tx.send(ServerMessage::Error {
                                error: ErrorDetail::new(
                                    "terminal_closed",
                                    format!("terminal wait task failed: {error}"),
                                ),
                            });
                        }
                    }
                    cleanup_terminal_group(&tmux_path, &temp_session).await;
                    finish_terminal_session(&manager, &session_id, &events_tx, &closed_tx, &close_sent);
                    return;
                }
                input = input_rx.recv() => {
                    match input {
                        Some(data) if !data.is_empty() => {
                            if let Err(error) = write_terminal_input(&mut writer, &data) {
                                tracing::error!(%error, "terminal pty write error");
                                let _ = events_tx.send(ServerMessage::Error {
                                    error: ErrorDetail::new("terminal_write_failed", format!("failed to forward terminal input: {error}")),
                                });
                                terminate_terminal_process(&mut *killer, &tmux_path, &temp_session).await;
                                finish_terminal_session(&manager, &session_id, &events_tx, &closed_tx, &close_sent);
                                return;
                            }
                        }
                        Some(_) => {}
                        None => {
                            terminate_terminal_process(&mut *killer, &tmux_path, &temp_session).await;
                            finish_terminal_session(&manager, &session_id, &events_tx, &closed_tx, &close_sent);
                            return;
                        }
                    }
                }
                control = terminal_rx.recv() => {
                    match control {
                        Some(TerminalControl::Resize(size)) => {
                            if let Err(error) = master.resize(to_pty_size(size)) {
                                tracing::error!(%error, "terminal pty resize error");
                                let _ = events_tx.send(ServerMessage::Error {
                                    error: ErrorDetail::new("terminal_resize_failed", format!("failed to resize terminal client: {error}")),
                                });
                                terminate_terminal_process(&mut *killer, &tmux_path, &temp_session).await;
                                finish_terminal_session(&manager, &session_id, &events_tx, &closed_tx, &close_sent);
                                return;
                            }
                        }
                        Some(TerminalControl::Close) | None => {
                            terminate_terminal_process(&mut *killer, &tmux_path, &temp_session).await;
                            finish_terminal_session(&manager, &session_id, &events_tx, &closed_tx, &close_sent);
                            return;
                        }
                    }
                }
            }
        }
    });
}

fn finish_terminal_session(
    manager: &Arc<Mutex<ManagerState>>,
    session_id: &str,
    events_tx: &broadcast::Sender<ServerMessage>,
    closed_tx: &watch::Sender<bool>,
    close_sent: &AtomicBool,
) {
    send_close_once(events_tx, close_sent);
    if let Ok(mut state) = manager.lock() {
        state.sessions.remove(session_id);
    }
    let _ = closed_tx.send(true);
}

fn send_close_once(events_tx: &broadcast::Sender<ServerMessage>, close_sent: &AtomicBool) {
    if !close_sent.swap(true, Ordering::SeqCst) {
        let _ = events_tx.send(ServerMessage::Close);
    }
}

async fn terminate_terminal_process(
    killer: &mut dyn ChildKiller,
    tmux_path: &str,
    temp_session: &str,
) {
    cleanup_terminal_group(tmux_path, temp_session).await;
    tokio::time::sleep(std::time::Duration::from_millis(TERMINAL_CLOSE_GRACE_MS)).await;
    let _ = killer.kill();
}

fn write_terminal_input(
    writer: &mut Box<dyn Write + Send>,
    data: &str,
) -> Result<(), SessionError> {
    writer.write_all(data.as_bytes())?;
    writer.flush()?;
    Ok(())
}

async fn spawn_terminal_process(
    tmux_path: &str,
    prepared_target: &PreparedTerminalTarget,
    initial_size: WindowSize,
) -> Result<TerminalProcessParts, SessionError> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(to_pty_size(initial_size))?;
    let reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;

    let mut command = CommandBuilder::new(tmux_path);
    command.args(build_terminal_attach_args(&prepared_target.temp_session));
    command.env("LANG", "en_US.UTF-8");
    command.env("LC_ALL", "en_US.UTF-8");
    command.env("TERM", "xterm-256color");
    command.env_remove("TMUX");

    let child = pair.slave.spawn_command(command)?;
    let child_pid = child.process_id();
    let killer = child.clone_killer();

    Ok(TerminalProcessParts {
        child,
        killer,
        master: pair.master,
        reader,
        writer,
        child_pid,
        tmux_path: tmux_path.to_string(),
        temp_session: prepared_target.temp_session.clone(),
    })
}

fn build_terminal_attach_args(session_target: &str) -> [&str; 5] {
    [
        "attach-session",
        "-f",
        TMUX_CLIENT_FLAGS,
        "-t",
        session_target,
    ]
}

async fn prepare_terminal_target(
    tmux_path: &str,
    target: &AttachTarget,
) -> Result<PreparedTerminalTarget, SessionError> {
    let prepared = resolve_terminal_target(tmux_path, target).await?;
    create_terminal_group(tmux_path, &prepared).await?;
    configure_terminal_group(tmux_path, &prepared).await?;
    select_terminal_group_target(tmux_path, &prepared).await?;
    Ok(prepared)
}

async fn resolve_terminal_target(
    tmux_path: &str,
    target: &AttachTarget,
) -> Result<PreparedTerminalTarget, SessionError> {
    let display_target = target.display();
    let output = run_tmux_output(
        tmux_path,
        vec![
            "display-message".to_string(),
            "-p".to_string(),
            "-t".to_string(),
            display_target.clone(),
            "-F".to_string(),
            "#{session_name}\x1f#{window_id}\x1f#{pane_id}".to_string(),
        ],
    )
    .await?;
    let fields = output.split('\x1f').collect::<Vec<_>>();
    if fields.len() != 3 {
        return Err(SessionError::TmuxCommandFailed(format!(
            "tmux did not resolve target {display_target:?} to a session, window, and pane id"
        )));
    }
    let source_session = fields[0].trim().to_string();
    let window_id = fields[1].trim().to_string();
    let pane_id = fields[2].trim().to_string();
    if source_session.is_empty()
        || window_id.is_empty()
        || !window_id.starts_with('@')
        || pane_id.is_empty()
        || !pane_id.starts_with('%')
    {
        return Err(SessionError::TmuxCommandFailed(format!(
            "tmux did not resolve target {display_target:?} to valid terminal ids"
        )));
    }

    Ok(PreparedTerminalTarget {
        source_session,
        window_id,
        pane_id,
        display_target,
        temp_session: next_terminal_group_name(),
    })
}

async fn create_terminal_group(
    tmux_path: &str,
    prepared: &PreparedTerminalTarget,
) -> Result<(), SessionError> {
    run_tmux_output(
        tmux_path,
        vec![
            "new-session".to_string(),
            "-d".to_string(),
            "-t".to_string(),
            prepared.source_session.clone(),
            "-s".to_string(),
            prepared.temp_session.clone(),
        ],
    )
    .await
    .map(|_| ())
}

async fn configure_terminal_group(
    tmux_path: &str,
    prepared: &PreparedTerminalTarget,
) -> Result<(), SessionError> {
    run_tmux_output(
        tmux_path,
        vec![
            "set-option".to_string(),
            "-t".to_string(),
            prepared.temp_session.clone(),
            "status".to_string(),
            "off".to_string(),
        ],
    )
    .await
    .map(|_| ())
}

async fn select_terminal_group_target(
    tmux_path: &str,
    prepared: &PreparedTerminalTarget,
) -> Result<(), SessionError> {
    run_tmux_output(
        tmux_path,
        vec![
            "select-window".to_string(),
            "-t".to_string(),
            format!("{}:{}", prepared.temp_session, prepared.window_id),
        ],
    )
    .await?;
    run_tmux_output(
        tmux_path,
        vec![
            "select-pane".to_string(),
            "-t".to_string(),
            prepared.pane_id.clone(),
        ],
    )
    .await
    .map(|_| ())
}

async fn cleanup_terminal_group(tmux_path: &str, temp_session: &str) {
    let _ = Command::new(tmux_path)
        .env("LANG", "en_US.UTF-8")
        .env("LC_ALL", "en_US.UTF-8")
        .args(["kill-session", "-t", temp_session])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;
}

async fn run_tmux_output(tmux_path: &str, args: Vec<String>) -> Result<String, SessionError> {
    let output = Command::new(tmux_path)
        .env("LANG", "en_US.UTF-8")
        .env("LC_ALL", "en_US.UTF-8")
        .args(args)
        .stdin(Stdio::null())
        .output()
        .await?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(output.stdout.as_slice())
            .trim_end_matches('\n')
            .to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(SessionError::TmuxCommandFailed(if stderr.is_empty() {
        output.status.to_string()
    } else {
        stderr
    }))
}

fn to_pty_size(size: WindowSize) -> PtySize {
    PtySize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn next_terminal_group_name() -> String {
    let id = NEXT_TERMINAL_GROUP_ID.fetch_add(1, AtomicOrdering::Relaxed);
    format!("{TERMINAL_GROUP_PREFIX}{}-{id}", std::process::id())
}

fn validate_window_size(size: WindowSize) -> Result<WindowSize, SessionError> {
    if size.cols == 0 || size.rows == 0 {
        return Err(SessionError::InvalidWindowSize);
    }
    Ok(size)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AttachTarget {
    session: String,
    window: Option<String>,
    pane: Option<String>,
}

impl AttachTarget {
    fn parse(raw: &str) -> Result<Self, SessionError> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Err(SessionError::MissingTarget);
        }

        if !raw.contains('=') {
            return Ok(Self {
                session: raw.to_string(),
                window: None,
                pane: None,
            });
        }

        let mut session = None;
        let mut window = None;
        let mut pane = None;

        for part in raw.split('&') {
            let mut pieces = part.splitn(2, '=');
            let key = pieces.next().unwrap_or_default();
            let value = pieces.next().unwrap_or_default();
            let decoded = percent_decode(value)?;
            match key {
                "session" => session = non_empty(decoded),
                "window" => window = non_empty(decoded),
                "pane" => pane = non_empty(decoded),
                _ => {}
            }
        }

        let session = session.ok_or(SessionError::MissingTarget)?;
        Ok(Self {
            session,
            window,
            pane,
        })
    }

    fn display(&self) -> String {
        if let Ok(Some(pane)) = self.pane_target() {
            return pane;
        }
        if let Ok(Some(window)) = self.window_target() {
            return window;
        }
        self.session.clone()
    }

    fn window_target(&self) -> Result<Option<String>, SessionError> {
        self.window
            .as_deref()
            .map(|window| build_window_target(&self.session, window))
            .transpose()
    }

    fn pane_target(&self) -> Result<Option<String>, SessionError> {
        self.pane
            .as_deref()
            .map(|pane| build_pane_target(&self.session, self.window.as_deref(), pane))
            .transpose()
    }
}

fn non_empty(value: String) -> Option<String> {
    let value = value.trim().to_string();
    if value.is_empty() { None } else { Some(value) }
}

fn build_window_target(session_name: &str, window_name: &str) -> Result<String, SessionError> {
    let window_name = window_name.trim();
    if window_name.is_empty() {
        return Err(SessionError::MissingTargetPart("window"));
    }
    if window_name.starts_with('@') || window_name.contains(':') {
        return Ok(window_name.to_string());
    }
    if session_name.trim().is_empty() {
        return Ok(window_name.to_string());
    }
    Ok(format!("{session_name}:{window_name}"))
}

fn build_pane_target(
    session_name: &str,
    window_name: Option<&str>,
    pane_name: &str,
) -> Result<String, SessionError> {
    let pane_name = pane_name.trim();
    if pane_name.is_empty() {
        return Err(SessionError::MissingTargetPart("pane"));
    }
    if pane_name.starts_with('%') || pane_name.contains(':') || pane_name.contains('.') {
        return Ok(pane_name.to_string());
    }
    let window_target = build_window_target(session_name, window_name.unwrap_or_default())?;
    Ok(format!("{window_target}.{pane_name}"))
}

fn percent_decode(value: &str) -> Result<String, SessionError> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                decoded.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = &value[i + 1..i + 3];
                let byte = u8::from_str_radix(hex, 16).map_err(|_| {
                    SessionError::InvalidTarget(format!("invalid percent escape %{hex}"))
                })?;
                decoded.push(byte);
                i += 3;
            }
            b'%' => {
                return Err(SessionError::InvalidTarget(
                    "truncated percent escape".to_string(),
                ));
            }
            byte => {
                decoded.push(byte);
                i += 1;
            }
        }
    }

    String::from_utf8(decoded).map_err(|error| SessionError::InvalidTarget(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::process::Command as StdCommand;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tokio::time::timeout;

    #[test]
    fn terminal_protocol_client_messages_serialize_and_deserialize() {
        let input = ClientMessage::Input {
            data: "ls\n".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&input).unwrap(),
            json!({ "type": "input", "data": "ls\n" })
        );
        assert_eq!(
            serde_json::from_value::<ClientMessage>(json!({ "type": "input", "data": "ls\n" }))
                .unwrap(),
            input
        );

        let resize = ClientMessage::Resize { cols: 80, rows: 24 };
        assert_eq!(
            serde_json::to_value(&resize).unwrap(),
            json!({ "type": "resize", "cols": 80, "rows": 24 })
        );
        assert_eq!(
            serde_json::from_value::<ClientMessage>(
                json!({ "type": "resize", "cols": 80, "rows": 24 })
            )
            .unwrap(),
            resize
        );

        let close = ClientMessage::Close;
        assert_eq!(
            serde_json::to_value(&close).unwrap(),
            json!({ "type": "close" })
        );
        assert_eq!(
            serde_json::from_value::<ClientMessage>(json!({ "type": "close" })).unwrap(),
            close
        );
    }

    #[test]
    fn terminal_protocol_server_messages_serialize_and_deserialize() {
        let output = ServerMessage::Output {
            data: "hello".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&output).unwrap(),
            json!({ "type": "output", "data": "hello" })
        );
        assert_eq!(
            serde_json::from_value::<ServerMessage>(json!({ "type": "output", "data": "hello" }))
                .unwrap(),
            output
        );

        let error = ServerMessage::Error {
            error: ErrorDetail::new("terminal_closed", "terminal session ended unexpectedly"),
        };
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            json!({ "type": "error", "error": { "code": "terminal_closed", "message": "terminal session ended unexpectedly" } })
        );
        assert_eq!(
            serde_json::from_value::<ServerMessage>(json!({ "type": "error", "error": { "code": "terminal_closed", "message": "terminal session ended unexpectedly" } })).unwrap(),
            error
        );

        let close = ServerMessage::Close;
        assert_eq!(
            serde_json::to_value(&close).unwrap(),
            json!({ "type": "close" })
        );
        assert_eq!(
            serde_json::from_value::<ServerMessage>(json!({ "type": "close" })).unwrap(),
            close
        );
    }

    #[test]
    fn session_target_parsing_matches_websocket_query_shape() {
        let target = AttachTarget::parse("session=dev+box&window=1&pane=%252").unwrap();

        assert_eq!(target.session, "dev box");
        assert_eq!(
            target.window_target().unwrap(),
            Some("dev box:1".to_string())
        );
        assert_eq!(target.pane_target().unwrap(), Some("%2".to_string()));
        assert_eq!(target.display(), "%2");
    }

    #[test]
    fn session_window_size_rejects_zero_dimensions_and_normalizes_defaults() {
        assert_eq!(WindowSize::default(), WindowSize { cols: 80, rows: 24 });
        assert!(matches!(
            WindowSize::new(0, 24),
            Err(SessionError::InvalidWindowSize)
        ));
        assert!(matches!(
            WindowSize::new(80, 0),
            Err(SessionError::InvalidWindowSize)
        ));
        assert_eq!(
            (WindowSize { cols: 0, rows: 0 }).normalize(),
            WindowSize::default()
        );
    }

    #[test]
    fn terminal_attach_args_use_regular_tmux_client() {
        let args = build_terminal_attach_args("dev");

        assert_eq!(args, ["attach-session", "-f", "active-pane", "-t", "dev"]);
        assert!(!args.contains(&"-C"));
        assert!(!args.contains(&"ignore-size"));
    }

    #[test]
    fn terminal_window_size_maps_to_pty_size() {
        assert_eq!(
            to_pty_size(WindowSize {
                cols: 120,
                rows: 40
            }),
            PtySize {
                cols: 120,
                rows: 40,
                pixel_width: 0,
                pixel_height: 0,
            }
        );
    }

    #[tokio::test]
    #[ignore = "requires tmux"]
    async fn terminal_echo_real_tmux_session() {
        require_tmux();
        let session_name = unique_tmux_session("echo");
        create_tmux_session(&session_name);
        let _guard = TmuxSessionGuard(session_name.clone());

        let manager = SessionManager::new();
        let session = manager
            .attach_local(
                "conn-1",
                "tmux",
                session_name.clone(),
                WindowSize::default(),
            )
            .await
            .unwrap();
        let mut events = session.subscribe();

        session.send_input("echo hello\r\n").await.unwrap();

        let mut output = String::new();
        timeout(Duration::from_secs(5), async {
            while !output.contains("hello") {
                if let ServerMessage::Output { data } = events.recv().await.unwrap() {
                    output.push_str(&data);
                }
            }
        })
        .await
        .unwrap();

        session.close().await.unwrap();
        session.wait_closed().await.unwrap();
        assert!(output.contains("hello"));
    }

    #[tokio::test]
    #[ignore = "requires tmux"]
    async fn terminal_resize_real_tmux_session() {
        require_tmux();
        let session_name = unique_tmux_session("resize");
        create_tmux_session(&session_name);
        let _guard = TmuxSessionGuard(session_name.clone());

        let manager = SessionManager::new();
        let session = manager
            .attach_local("conn-1", "tmux", session_name, WindowSize::default())
            .await
            .unwrap();

        session
            .resize(WindowSize::new(120, 40).unwrap())
            .await
            .unwrap();
        session.close().await.unwrap();
        session.wait_closed().await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires tmux"]
    async fn terminal_resize_updates_tmux_pane_size() {
        require_tmux();
        let session_name = unique_tmux_session("resize-propagates");
        create_tmux_session(&session_name);
        let _guard = TmuxSessionGuard(session_name.clone());

        let manager = SessionManager::new();
        let session = manager
            .attach_local(
                "conn-1",
                "tmux",
                session_name.clone(),
                WindowSize::default(),
            )
            .await
            .unwrap();

        session
            .resize(WindowSize::new(120, 40).unwrap())
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        let resized_size = tmux_display(&session_name, "#{pane_width}x#{pane_height}");

        session.close().await.unwrap();
        session.wait_closed().await.unwrap();
        assert_eq!(resized_size, "120x40");
    }

    #[tokio::test]
    #[ignore = "requires tmux"]
    async fn terminal_target_resolution_preserves_tmux_active_window_and_pane() {
        require_tmux();
        let session_name = unique_tmux_session("preserve-active");
        create_tmux_session(&session_name);
        let first_window = tmux_display(&session_name, "#{window_id}");
        create_tmux_window(&session_name, "second");
        let second_pane = split_tmux_pane(&session_name, "second");
        tmux_select_window(&first_window);
        let original_window = tmux_display(&session_name, "#{window_id}");
        let original_pane = tmux_display(&first_window, "#{pane_id}");
        let _guard = TmuxSessionGuard(session_name.clone());

        let manager = SessionManager::new();
        let target = format!(
            "session={session_name}&window=second&pane={}",
            second_pane.replace('%', "%25")
        );
        let session = manager
            .attach_local("conn-1", "tmux", target, WindowSize::default())
            .await
            .unwrap();

        tokio::time::sleep(Duration::from_millis(100)).await;
        let active_window = tmux_display(&session_name, "#{window_id}");
        let active_pane = tmux_display(&first_window, "#{pane_id}");

        session.close().await.unwrap();
        session.wait_closed().await.unwrap();
        assert_eq!(active_window, original_window);
        assert_eq!(active_pane, original_pane);
    }

    #[tokio::test]
    #[ignore = "requires tmux"]
    async fn terminal_disconnect_cleanup_real_tmux_session() {
        require_tmux();
        let session_name = unique_tmux_session("cleanup");
        create_tmux_session(&session_name);
        let _guard = TmuxSessionGuard(session_name.clone());

        let manager = SessionManager::new();
        let session = manager
            .attach_local("conn-1", "tmux", session_name, WindowSize::default())
            .await
            .unwrap();
        let child_pid = session.child_process_id();

        session.close().await.unwrap();
        session.wait_closed().await.unwrap();

        assert!(manager.list_active().is_empty());
        if let Some(pid) = child_pid {
            timeout(Duration::from_secs(2), async {
                while process_exists(pid) {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    #[ignore = "requires tmux"]
    async fn terminal_repeated_disconnect_preserves_real_tmux_windows() {
        require_tmux();
        let session_name = unique_tmux_session("preserve-windows");
        create_tmux_session(&session_name);
        create_tmux_window(&session_name, "second");
        create_tmux_window(&session_name, "third");
        let _guard = TmuxSessionGuard(session_name.clone());

        assert_eq!(tmux_window_count(&session_name), 3);

        let manager = SessionManager::new();
        for _ in 0..3 {
            let session = manager
                .attach_local(
                    "conn-1",
                    "tmux",
                    session_name.clone(),
                    WindowSize::default(),
                )
                .await
                .unwrap();
            session.close().await.unwrap();
            session.wait_closed().await.unwrap();

            assert_eq!(tmux_window_count(&session_name), 3);
        }
    }

    fn require_tmux() {
        let status = StdCommand::new("tmux")
            .arg("-V")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if !matches!(status, Ok(status) if status.success()) {
            panic!("tmux is required for this ignored integration test");
        }
    }

    fn unique_tmux_session(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("wmux-{prefix}-{nanos}")
    }

    fn create_tmux_session(session_name: &str) {
        let status = StdCommand::new("tmux")
            .args(["new-session", "-d", "-s", session_name])
            .status()
            .unwrap();
        assert!(status.success());
    }

    fn create_tmux_window(session_name: &str, window_name: &str) {
        let status = StdCommand::new("tmux")
            .args(["new-window", "-d", "-t", session_name, "-n", window_name])
            .status()
            .unwrap();
        assert!(status.success());
    }

    fn split_tmux_pane(session_name: &str, window_name: &str) -> String {
        let output = StdCommand::new("tmux")
            .args([
                "split-window",
                "-d",
                "-P",
                "-F",
                "#{pane_id}",
                "-t",
                &format!("{session_name}:{window_name}"),
            ])
            .output()
            .unwrap();
        assert!(output.status.success());
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn tmux_select_window(target: &str) {
        let status = StdCommand::new("tmux")
            .args(["select-window", "-t", target])
            .status()
            .unwrap();
        assert!(status.success());
    }

    fn tmux_display(target: &str, format: &str) -> String {
        let output = StdCommand::new("tmux")
            .args(["display-message", "-p", "-t", target, "-F", format])
            .output()
            .unwrap();
        assert!(output.status.success());
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn tmux_window_count(session_name: &str) -> usize {
        let output = StdCommand::new("tmux")
            .args(["list-windows", "-t", session_name, "-F", "#{window_id}"])
            .output()
            .unwrap();
        assert!(output.status.success());
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|line| !line.trim().is_empty())
            .count()
    }

    fn process_exists(pid: u32) -> bool {
        let status = StdCommand::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        matches!(status, Ok(status) if status.success())
    }

    struct TmuxSessionGuard(String);

    impl Drop for TmuxSessionGuard {
        fn drop(&mut self) {
            let _ = StdCommand::new("tmux")
                .args(["kill-session", "-t", &self.0])
                .status();
        }
    }
}
