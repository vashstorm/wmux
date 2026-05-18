use portable_pty::{Child, ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use thiserror::Error;
use tokio::process::Command;
use tokio::sync::{broadcast, mpsc, watch};
use tokio::task::JoinError;

const DEFAULT_WINDOW_ROWS: u16 = 24;
const DEFAULT_WINDOW_COLS: u16 = 80;
const CHANNEL_CAPACITY: usize = 256;
const PTY_BUFFER_SIZE: usize = 4096;
const DEFAULT_TERMINAL_TYPE: &str = "xterm-256color";

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("connection id is required")]
    MissingConnectionId,
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
        connection_id: impl Into<String>,
        tmux_path: impl Into<String>,
        target: impl Into<String>,
        initial_size: WindowSize,
    ) -> Result<Session, SessionError> {
        let connection_id = connection_id.into();
        if connection_id.trim().is_empty() {
            return Err(SessionError::MissingConnectionId);
        }

        let tmux_path = tmux_path.into();
        let parsed_target = AttachTarget::parse(&target.into())?;
        select_tmux_target(&tmux_path, &parsed_target).await?;

        let size = initial_size.normalize();
        let pty = tokio::task::spawn_blocking({
            let tmux_path = tmux_path.clone();
            let session_target = parsed_target.session.clone();
            move || spawn_local_pty(&tmux_path, &session_target, size)
        })
        .await??;

        let session = self.register(connection_id.clone(), parsed_target.display(), pty)?;
        tracing::info!(connection_id = %connection_id, target = %parsed_target.display(), "terminal session attached");
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
            a.connection_id
                .cmp(&b.connection_id)
                .then_with(|| a.target.cmp(&b.target))
                .then_with(|| a.id.cmp(&b.id))
        });
        active
    }

    pub async fn detach(&self, connection_id: &str) {
        let sessions = {
            let state = self.inner.lock().expect("session manager mutex poisoned");
            state
                .sessions
                .values()
                .filter(|session| session.connection_id() == connection_id)
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

    fn register(
        &self,
        connection_id: String,
        target: String,
        pty: PtyParts,
    ) -> Result<Session, SessionError> {
        let (input_tx, input_rx) = mpsc::channel(CHANNEL_CAPACITY);
        let (control_tx, control_rx) = mpsc::channel(CHANNEL_CAPACITY);
        let (events_tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        let (closed_tx, closed_rx) = watch::channel(false);
        let close_sent = Arc::new(AtomicBool::new(false));
        let killer = Arc::new(Mutex::new(Some(pty.child.clone_killer())));

        let session = {
            let mut state = self.inner.lock().expect("session manager mutex poisoned");
            let id = state.next_session_id(&connection_id);
            Session {
                id,
                connection_id,
                target,
                input_tx,
                control_tx,
                events_tx: events_tx.clone(),
                closed_rx,
                killer: Arc::clone(&killer),
                child_pid: pty.child_pid,
            }
        };

        self.inner
            .lock()
            .expect("session manager mutex poisoned")
            .sessions
            .insert(session.id.clone(), session.clone());

        spawn_session_tasks(
            Arc::clone(&self.inner),
            session.id.clone(),
            pty,
            SessionTaskChannels {
                input_rx,
                control_rx,
                events_tx,
                closed_tx,
                close_sent,
                killer,
            },
        );

        Ok(session)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionInfo {
    pub id: String,
    pub connection_id: String,
    pub target: String,
}

#[derive(Debug, Clone)]
pub struct Session {
    id: String,
    connection_id: String,
    target: String,
    input_tx: mpsc::Sender<String>,
    control_tx: mpsc::Sender<SessionControl>,
    events_tx: broadcast::Sender<ServerMessage>,
    closed_rx: watch::Receiver<bool>,
    killer: Arc<Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>>,
    child_pid: Option<u32>,
}

impl Session {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn connection_id(&self) -> &str {
        &self.connection_id
    }

    pub fn target(&self) -> &str {
        &self.target
    }

    pub fn child_process_id(&self) -> Option<u32> {
        self.child_pid
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
        let size = validate_window_size(size)?;
        self.control_tx
            .send(SessionControl::Resize(size))
            .await
            .map_err(|_| SessionError::SessionClosed)
    }

    pub async fn close(&self) -> Result<(), SessionError> {
        let _ = self.control_tx.send(SessionControl::Close).await;
        kill_child(Arc::clone(&self.killer)).await
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
            connection_id: self.connection_id.clone(),
            target: self.target.clone(),
        }
    }
}

#[derive(Debug)]
enum SessionControl {
    Resize(WindowSize),
    Close,
}

#[derive(Default, Debug)]
struct ManagerState {
    sessions: HashMap<String, Session>,
    next_id: u64,
}

impl ManagerState {
    fn next_session_id(&mut self, connection_id: &str) -> String {
        loop {
            self.next_id += 1;
            let id = format!("{}#{}", connection_id, self.next_id);
            if !self.sessions.contains_key(&id) {
                return id;
            }
        }
    }
}

struct SessionTaskChannels {
    input_rx: mpsc::Receiver<String>,
    control_rx: mpsc::Receiver<SessionControl>,
    events_tx: broadcast::Sender<ServerMessage>,
    closed_tx: watch::Sender<bool>,
    close_sent: Arc<AtomicBool>,
    killer: Arc<Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>>,
}

struct PtyParts {
    master: Box<dyn MasterPty + Send>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    child_pid: Option<u32>,
}

fn spawn_session_tasks(
    manager: Arc<Mutex<ManagerState>>,
    session_id: String,
    pty: PtyParts,
    channels: SessionTaskChannels,
) {
    let master = Arc::new(Mutex::new(pty.master));
    let writer = Arc::new(Mutex::new(pty.writer));
    let pid = pty.child_pid;

    spawn_reader_task(
        pty.reader,
        channels.events_tx.clone(),
        Arc::clone(&channels.close_sent),
    );
    spawn_writer_task(
        Arc::clone(&master),
        writer,
        channels.input_rx,
        channels.control_rx,
        channels.events_tx.clone(),
        Arc::clone(&channels.close_sent),
        Arc::clone(&channels.killer),
    );
    spawn_wait_task(
        manager,
        session_id,
        pty.child,
        channels.events_tx,
        channels.closed_tx,
        channels.close_sent,
        channels.killer,
        pid,
    );
}

fn spawn_reader_task(
    mut reader: Box<dyn Read + Send>,
    events_tx: broadcast::Sender<ServerMessage>,
    close_sent: Arc<AtomicBool>,
) {
    tokio::task::spawn_blocking(move || {
        let mut buffer = [0_u8; PTY_BUFFER_SIZE];
        let mut pending = Vec::with_capacity(4);

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    send_close_once(&events_tx, &close_sent);
                    return;
                }
                Ok(n) => {
                    pending.extend_from_slice(&buffer[..n]);
                    let (complete, rest) = split_complete_utf8(&pending);
                    if !complete.is_empty() {
                        let data = String::from_utf8_lossy(complete).into_owned();
                        let _ = events_tx.send(ServerMessage::Output { data });
                    }
                    pending = rest.to_vec();
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => {
                    tracing::error!(%error, "terminal read error");
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

fn spawn_writer_task(
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    mut input_rx: mpsc::Receiver<String>,
    mut control_rx: mpsc::Receiver<SessionControl>,
    events_tx: broadcast::Sender<ServerMessage>,
    close_sent: Arc<AtomicBool>,
    killer: Arc<Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>>,
) {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                input = input_rx.recv() => {
                    match input {
                        Some(data) if !data.is_empty() => {
                            if let Err(error) = write_pty_input(Arc::clone(&writer), data).await {
                                tracing::error!(%error, "terminal write error");
                                let _ = events_tx.send(ServerMessage::Error {
                                    error: ErrorDetail::new("terminal_write_failed", format!("failed to forward terminal input: {error}")),
                                });
                                let _ = kill_child(Arc::clone(&killer)).await;
                                send_close_once(&events_tx, &close_sent);
                                return;
                            }
                        }
                        Some(_) => {}
                        None => {
                            let _ = kill_child(Arc::clone(&killer)).await;
                            send_close_once(&events_tx, &close_sent);
                            return;
                        }
                    }
                }
                control = control_rx.recv() => {
                    match control {
                        Some(SessionControl::Resize(size)) => {
                            if let Err(error) = resize_pty(Arc::clone(&master), size).await {
                                tracing::error!(%error, "terminal resize error");
                                let _ = events_tx.send(ServerMessage::Error {
                                    error: ErrorDetail::new("terminal_resize_failed", format!("failed to resize terminal: {error}")),
                                });
                                let _ = kill_child(Arc::clone(&killer)).await;
                                send_close_once(&events_tx, &close_sent);
                                return;
                            }
                        }
                        Some(SessionControl::Close) | None => {
                            let _ = kill_child(Arc::clone(&killer)).await;
                            send_close_once(&events_tx, &close_sent);
                            return;
                        }
                    }
                }
            }
        }
    });
}

fn spawn_wait_task(
    manager: Arc<Mutex<ManagerState>>,
    session_id: String,
    mut child: Box<dyn Child + Send + Sync>,
    events_tx: broadcast::Sender<ServerMessage>,
    closed_tx: watch::Sender<bool>,
    close_sent: Arc<AtomicBool>,
    killer: Arc<Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>>,
    _pid: Option<u32>,
) {
    tokio::task::spawn_blocking(move || {
        let wait_result = child.wait();
        if let Err(error) = wait_result {
            tracing::error!(session_id = %session_id, %error, "terminal session process exited unexpectedly");
            let _ = events_tx.send(ServerMessage::Error {
                error: ErrorDetail::new(
                    "terminal_closed",
                    format!("terminal session ended unexpectedly: {error}"),
                ),
            });
        }

        if let Ok(mut guard) = killer.lock() {
            let _ = guard.take();
        }
        send_close_once(&events_tx, &close_sent);
        if let Ok(mut state) = manager.lock() {
            state.sessions.remove(&session_id);
        }
        let _ = closed_tx.send(true);
    });
}

async fn write_pty_input(
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    data: String,
) -> Result<(), SessionError> {
    tokio::task::spawn_blocking(move || {
        let mut writer = writer
            .lock()
            .map_err(|_| SessionError::Pty("pty writer mutex poisoned".to_string()))?;
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        Ok::<(), SessionError>(())
    })
    .await?
}

async fn resize_pty(
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    size: WindowSize,
) -> Result<(), SessionError> {
    tokio::task::spawn_blocking(move || {
        let master = master
            .lock()
            .map_err(|_| SessionError::Pty("pty master mutex poisoned".to_string()))?;
        master.resize(to_pty_size(size)).map_err(SessionError::from)
    })
    .await?
}

async fn kill_child(
    killer: Arc<Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>>,
) -> Result<(), SessionError> {
    tokio::task::spawn_blocking(move || {
        let mut guard = killer
            .lock()
            .map_err(|_| SessionError::Pty("pty killer mutex poisoned".to_string()))?;
        if let Some(killer) = guard.as_mut() {
            match killer.kill() {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::InvalidInput => {}
                Err(error) => return Err(SessionError::from(error)),
            }
        }
        Ok::<(), SessionError>(())
    })
    .await?
}

fn send_close_once(events_tx: &broadcast::Sender<ServerMessage>, close_sent: &AtomicBool) {
    if !close_sent.swap(true, Ordering::SeqCst) {
        let _ = events_tx.send(ServerMessage::Close);
    }
}

fn spawn_local_pty(
    tmux_path: &str,
    session_target: &str,
    size: WindowSize,
) -> Result<PtyParts, SessionError> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(to_pty_size(size))?;
    let reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;

    let mut command = CommandBuilder::new(tmux_path);
    command.args(tmux_attach_args(session_target));
    command.env("TERM", DEFAULT_TERMINAL_TYPE);

    let child = pair.slave.spawn_command(command)?;
    let child_pid = child.process_id();

    Ok(PtyParts {
        master: pair.master,
        reader,
        writer,
        child,
        child_pid,
    })
}

async fn select_tmux_target(tmux_path: &str, target: &AttachTarget) -> Result<(), SessionError> {
    if let Some(window_target) = target.window_target()? {
        run_tmux_command(
            tmux_path,
            ["select-window".to_string(), "-t".to_string(), window_target],
        )
        .await?;
    }
    if let Some(pane_target) = target.pane_target()? {
        run_tmux_command(
            tmux_path,
            ["select-pane".to_string(), "-t".to_string(), pane_target],
        )
        .await?;
    }
    Ok(())
}

async fn run_tmux_command<const N: usize>(
    tmux_path: &str,
    args: [String; N],
) -> Result<(), SessionError> {
    let output = Command::new(tmux_path)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .await?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(SessionError::TmuxCommandFailed(if stderr.is_empty() {
        output.status.to_string()
    } else {
        stderr
    }))
}

fn tmux_attach_args(target: &str) -> [&str; 3] {
    ["attach-session", "-t", target]
}

fn validate_window_size(size: WindowSize) -> Result<WindowSize, SessionError> {
    if size.cols == 0 || size.rows == 0 {
        return Err(SessionError::InvalidWindowSize);
    }
    Ok(size)
}

fn to_pty_size(size: WindowSize) -> PtySize {
    PtySize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: 0,
        pixel_height: 0,
    }
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

fn split_complete_utf8(data: &[u8]) -> (&[u8], &[u8]) {
    if data.is_empty() {
        return (data, &[]);
    }

    let max_check = data.len().min(4);
    for index in (data.len() - max_check..data.len()).rev() {
        let byte = data[index];
        if byte < 0x80 {
            return (data, &[]);
        }
        if !is_utf8_start(byte) {
            continue;
        }
        let Some(expected) = expected_utf8_size(byte) else {
            return (data, &[]);
        };
        if data.len() - index >= expected {
            return (data, &[]);
        }
        if data[index + 1..].iter().all(|byte| byte & 0xc0 == 0x80) {
            return (&data[..index], &data[index..]);
        }
        return (data, &[]);
    }

    (data, &[])
}

fn is_utf8_start(byte: u8) -> bool {
    byte & 0xc0 != 0x80
}

fn expected_utf8_size(byte: u8) -> Option<usize> {
    match byte {
        0xc2..=0xdf => Some(2),
        0xe0..=0xef => Some(3),
        0xf0..=0xf4 => Some(4),
        _ => None,
    }
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
    fn session_utf8_split_preserves_partial_codepoints() {
        let payload = "prefix 中".as_bytes();
        let split_at = payload.len() - 1;
        let (complete, pending) = split_complete_utf8(&payload[..split_at]);

        assert_eq!(String::from_utf8_lossy(complete), "prefix ");
        assert_eq!(pending, &payload[payload.len() - 3..split_at]);
    }

    #[test]
    fn session_window_size_rejects_zero_dimensions_and_normalizes_defaults() {
        assert_eq!(WindowSize::default(), WindowSize { cols: 80, rows: 24 });
        assert!(matches!(WindowSize::new(0, 24), Err(SessionError::InvalidWindowSize)));
        assert!(matches!(WindowSize::new(80, 0), Err(SessionError::InvalidWindowSize)));
        assert_eq!(
            (WindowSize { cols: 0, rows: 0 }).normalize(),
            WindowSize::default()
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
