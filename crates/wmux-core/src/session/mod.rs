use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{broadcast, mpsc, watch};
use tokio::task::JoinError;

const DEFAULT_WINDOW_ROWS: u16 = 24;
const DEFAULT_WINDOW_COLS: u16 = 80;
const CHANNEL_CAPACITY: usize = 256;
const TERMINAL_CLOSE_GRACE_MS: u64 = 200;
const CONTROL_CLIENT_FLAGS: &str = "ignore-size,active-pane";

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
        let _ = initial_size.normalize();
        let resolved_pane = resolve_control_pane(&tmux_path, &parsed_target).await?;
        let initial_output = capture_pane_snapshot(&tmux_path, &resolved_pane.pane_id).await?;
        let process =
            spawn_control_process(&tmux_path, &parsed_target.session, &resolved_pane).await?;

        let session = self.register(
            connection_id.clone(),
            resolved_pane.display_target.clone(),
            process,
            initial_output,
        )?;
        tracing::info!(connection_id = %connection_id, target = %resolved_pane.display_target, pane_id = %resolved_pane.pane_id, "terminal control client attached");
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
        connection_id: String,
        target: String,
        process: ControlProcessParts,
        initial_output: Option<String>,
    ) -> Result<Session, SessionError> {
        let (input_tx, input_rx) = mpsc::channel(CHANNEL_CAPACITY);
        let (control_tx, control_rx) = mpsc::channel(CHANNEL_CAPACITY);
        let (events_tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        let (closed_tx, closed_rx) = watch::channel(false);
        let close_sent = Arc::new(AtomicBool::new(false));

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
                child_pid: process.child_pid,
                initial_output,
            }
        };

        self.inner
            .lock()
            .expect("session manager mutex poisoned")
            .sessions
            .insert(session.id.clone(), session.clone());

        spawn_control_tasks(
            Arc::clone(&self.inner),
            session.id.clone(),
            process,
            SessionTaskChannels {
                input_rx,
                control_rx,
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
    child_pid: Option<u32>,
    initial_output: Option<String>,
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
        if self.control_tx.is_closed() {
            return Err(SessionError::SessionClosed);
        }
        Ok(())
    }

    pub async fn close(&self) -> Result<(), SessionError> {
        self.control_tx
            .send(SessionControl::Close)
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
            connection_id: self.connection_id.clone(),
            target: self.target.clone(),
        }
    }
}

#[derive(Debug)]
enum SessionControl {
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
}

struct ControlProcessParts {
    child: Child,
    stdin: ChildStdin,
    stdout: ChildStdout,
    child_pid: Option<u32>,
    pane_id: String,
}

#[derive(Debug, Clone)]
struct ResolvedControlPane {
    pane_id: String,
    display_target: String,
}

fn spawn_control_tasks(
    manager: Arc<Mutex<ManagerState>>,
    session_id: String,
    process: ControlProcessParts,
    channels: SessionTaskChannels,
) {
    spawn_control_reader_task(
        process.stdout,
        process.pane_id.clone(),
        channels.events_tx.clone(),
        Arc::clone(&channels.close_sent),
    );
    spawn_control_process_task(
        manager,
        session_id,
        process.child,
        process.stdin,
        process.pane_id,
        channels.input_rx,
        channels.control_rx,
        channels.events_tx,
        channels.closed_tx,
        channels.close_sent,
    );
}

fn spawn_control_reader_task(
    stdout: ChildStdout,
    pane_id: String,
    events_tx: broadcast::Sender<ServerMessage>,
    close_sent: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => {
                    send_close_once(&events_tx, &close_sent);
                    return;
                }
                Ok(n) => {
                    let control_line = line[..n].trim_end_matches(['\r', '\n']);
                    match parse_control_output_line(control_line, &pane_id) {
                        Ok(Some(data)) => {
                            let _ = events_tx.send(ServerMessage::Output { data });
                        }
                        Ok(None) => {}
                        Err(error) => {
                            tracing::debug!(%error, line = %control_line, "ignored malformed tmux control output");
                        }
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => {
                    tracing::error!(%error, "terminal control read error");
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

fn spawn_control_process_task(
    manager: Arc<Mutex<ManagerState>>,
    session_id: String,
    mut child: Child,
    mut stdin: ChildStdin,
    pane_id: String,
    mut input_rx: mpsc::Receiver<String>,
    mut control_rx: mpsc::Receiver<SessionControl>,
    events_tx: broadcast::Sender<ServerMessage>,
    closed_tx: watch::Sender<bool>,
    close_sent: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                wait_result = child.wait() => {
                    if let Err(error) = wait_result {
                        tracing::error!(session_id = %session_id, %error, "terminal control process exited unexpectedly");
                        let _ = events_tx.send(ServerMessage::Error {
                            error: ErrorDetail::new(
                                "terminal_closed",
                                format!("terminal session ended unexpectedly: {error}"),
                            ),
                        });
                    }
                    finish_control_session(&manager, &session_id, &events_tx, &closed_tx, &close_sent);
                    return;
                }
                input = input_rx.recv() => {
                    match input {
                        Some(data) if !data.is_empty() => {
                            if let Err(error) = write_control_input(&mut stdin, &pane_id, &data).await {
                                tracing::error!(%error, "terminal control write error");
                                let _ = events_tx.send(ServerMessage::Error {
                                    error: ErrorDetail::new("terminal_write_failed", format!("failed to forward terminal input: {error}")),
                                });
                                terminate_control_process(&mut child, &mut stdin).await;
                                finish_control_session(&manager, &session_id, &events_tx, &closed_tx, &close_sent);
                                return;
                            }
                        }
                        Some(_) => {}
                        None => {
                            terminate_control_process(&mut child, &mut stdin).await;
                            finish_control_session(&manager, &session_id, &events_tx, &closed_tx, &close_sent);
                            return;
                        }
                    }
                }
                control = control_rx.recv() => {
                    match control {
                        Some(SessionControl::Close) | None => {
                            terminate_control_process(&mut child, &mut stdin).await;
                            finish_control_session(&manager, &session_id, &events_tx, &closed_tx, &close_sent);
                            return;
                        }
                    }
                }
            }
        }
    });
}

fn finish_control_session(
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

async fn terminate_control_process(child: &mut Child, stdin: &mut ChildStdin) {
    let _ = write_control_command(stdin, "detach-client\n").await;
    tokio::time::sleep(std::time::Duration::from_millis(TERMINAL_CLOSE_GRACE_MS)).await;
    if matches!(child.try_wait(), Ok(None)) {
        let _ = child.start_kill();
    }
}

async fn write_control_input(
    stdin: &mut ChildStdin,
    pane_id: &str,
    data: &str,
) -> Result<(), SessionError> {
    for command in build_input_commands(pane_id, data) {
        write_control_command(stdin, command.as_str()).await?;
    }
    Ok(())
}

async fn write_control_command(stdin: &mut ChildStdin, command: &str) -> Result<(), SessionError> {
    stdin.write_all(command.as_bytes()).await?;
    stdin.flush().await?;
    Ok(())
}

async fn spawn_control_process(
    tmux_path: &str,
    session_target: &str,
    resolved_pane: &ResolvedControlPane,
) -> Result<ControlProcessParts, SessionError> {
    let mut child = Command::new(tmux_path)
        .args([
            "-C",
            "attach-session",
            "-f",
            CONTROL_CLIENT_FLAGS,
            "-t",
            session_target,
        ])
        .env_remove("TMUX")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let child_pid = child.id();
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| SessionError::Pty("tmux control stdin unavailable".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| SessionError::Pty("tmux control stdout unavailable".to_string()))?;
    Ok(ControlProcessParts {
        child,
        stdin,
        stdout,
        child_pid,
        pane_id: resolved_pane.pane_id.clone(),
    })
}

async fn resolve_control_pane(
    tmux_path: &str,
    target: &AttachTarget,
) -> Result<ResolvedControlPane, SessionError> {
    let display_target = target.display();
    let output = run_tmux_output(
        tmux_path,
        vec![
            "display-message".to_string(),
            "-p".to_string(),
            "-t".to_string(),
            display_target.clone(),
            "-F".to_string(),
            "#{window_id}\x1f#{pane_id}".to_string(),
        ],
    )
    .await?;
    let fields = output.split('\x1f').collect::<Vec<_>>();
    if fields.len() != 2 {
        return Err(SessionError::TmuxCommandFailed(format!(
            "tmux did not resolve target {display_target:?} to a window and pane id"
        )));
    }
    let window_id = fields[0].trim().to_string();
    let pane_id = fields[1].trim().to_string();
    let pane_id = pane_id.trim().to_string();
    if window_id.is_empty()
        || !window_id.starts_with('@')
        || pane_id.is_empty()
        || !pane_id.starts_with('%')
    {
        return Err(SessionError::TmuxCommandFailed(format!(
            "tmux did not resolve target {display_target:?} to valid window and pane ids"
        )));
    }
    Ok(ResolvedControlPane {
        pane_id,
        display_target,
    })
}

async fn capture_pane_snapshot(
    tmux_path: &str,
    pane_id: &str,
) -> Result<Option<String>, SessionError> {
    let output = run_tmux_output(
        tmux_path,
        vec![
            "capture-pane".to_string(),
            "-p".to_string(),
            "-e".to_string(),
            "-S".to_string(),
            "-100".to_string(),
            "-t".to_string(),
            pane_id.to_string(),
        ],
    )
    .await?;
    Ok(terminal_snapshot_output(&output))
}

async fn run_tmux_output(tmux_path: &str, args: Vec<String>) -> Result<String, SessionError> {
    let output = Command::new(tmux_path)
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

fn terminal_snapshot_output(output: &str) -> Option<String> {
    if output.is_empty() {
        return None;
    }
    let mut snapshot = String::from("\x1b[H\x1b[2J");
    snapshot.push_str(&output.replace('\n', "\r\n"));
    Some(snapshot)
}

fn parse_control_output_line(line: &str, pane_id: &str) -> Result<Option<String>, SessionError> {
    if let Some(rest) = line.strip_prefix("%output ") {
        let mut parts = rest.splitn(2, ' ');
        let output_pane = parts.next().unwrap_or_default();
        let value = parts.next().unwrap_or_default();
        if output_pane == pane_id {
            return decode_control_value(value).map(Some);
        }
        return Ok(None);
    }

    if let Some(rest) = line.strip_prefix("%extended-output ") {
        let mut parts = rest.splitn(2, ' ');
        let output_pane = parts.next().unwrap_or_default();
        let remainder = parts.next().unwrap_or_default();
        if output_pane != pane_id {
            return Ok(None);
        }
        if let Some((_, value)) = remainder.split_once(" : ") {
            return decode_control_value(value).map(Some);
        }
    }

    Ok(None)
}

fn decode_control_value(value: &str) -> Result<String, SessionError> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\\' && index + 3 < bytes.len() {
            let octal = &value[index + 1..index + 4];
            if octal
                .as_bytes()
                .iter()
                .all(|byte| matches!(byte, b'0'..=b'7'))
            {
                let byte = u8::from_str_radix(octal, 8).map_err(|error| {
                    SessionError::InvalidTarget(format!("invalid tmux control escape: {error}"))
                })?;
                decoded.push(byte);
                index += 4;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    Ok(String::from_utf8_lossy(&decoded).into_owned())
}

fn build_input_commands(pane_id: &str, data: &str) -> Vec<String> {
    let mut commands = Vec::new();
    let mut literal = String::new();
    let mut index = 0;

    while index < data.len() {
        let remaining = &data[index..];
        if let Some((sequence, key)) = known_escape_key(remaining) {
            flush_literal_command(&mut commands, pane_id, &mut literal);
            commands.push(build_key_command(pane_id, key));
            index += sequence.len();
            continue;
        }

        let ch = remaining
            .chars()
            .next()
            .expect("remaining input is non-empty");
        match ch {
            '\r' | '\n' => {
                flush_literal_command(&mut commands, pane_id, &mut literal);
                commands.push(build_key_command(pane_id, "Enter"));
            }
            '\t' => {
                flush_literal_command(&mut commands, pane_id, &mut literal);
                commands.push(build_key_command(pane_id, "Tab"));
            }
            '\u{7f}' | '\u{8}' => {
                flush_literal_command(&mut commands, pane_id, &mut literal);
                commands.push(build_key_command(pane_id, "BSpace"));
            }
            '\u{1b}' => {
                flush_literal_command(&mut commands, pane_id, &mut literal);
                let fallback = collect_escape_sequence(remaining);
                tracing::debug!(sequence = ?fallback, "forwarding unrecognized terminal escape sequence literally");
                commands.push(build_literal_command(pane_id, fallback));
                index += fallback.len();
                continue;
            }
            '\u{1}'..='\u{1a}' => {
                flush_literal_command(&mut commands, pane_id, &mut literal);
                let key = format!("C-{}", ((ch as u8 - 1) + b'a') as char);
                commands.push(build_key_command(pane_id, &key));
            }
            '\u{0}' => {
                flush_literal_command(&mut commands, pane_id, &mut literal);
                commands.push(build_key_command(pane_id, "C-Space"));
            }
            _ => literal.push(ch),
        }
        index += ch.len_utf8();
    }

    flush_literal_command(&mut commands, pane_id, &mut literal);
    commands
}

fn known_escape_key(input: &str) -> Option<(&'static str, &'static str)> {
    [
        ("\x1b[A", "Up"),
        ("\x1b[B", "Down"),
        ("\x1b[C", "Right"),
        ("\x1b[D", "Left"),
        ("\x1b[H", "Home"),
        ("\x1b[F", "End"),
        ("\x1b[1~", "Home"),
        ("\x1b[4~", "End"),
        ("\x1b[2~", "Insert"),
        ("\x1b[3~", "Delete"),
        ("\x1b[5~", "PageUp"),
        ("\x1b[6~", "PageDown"),
        ("\x1bOH", "Home"),
        ("\x1bOF", "End"),
    ]
    .into_iter()
    .find(|(sequence, _)| input.starts_with(sequence))
}

fn collect_escape_sequence(input: &str) -> &str {
    for (index, ch) in input.char_indices().skip(1) {
        if ch.is_ascii_alphabetic() || ch == '~' {
            return &input[..index + ch.len_utf8()];
        }
    }
    "\x1b"
}

fn flush_literal_command(commands: &mut Vec<String>, pane_id: &str, literal: &mut String) {
    if literal.is_empty() {
        return;
    }
    commands.push(build_literal_command(pane_id, literal.as_str()));
    literal.clear();
}

fn build_literal_command(pane_id: &str, literal: &str) -> String {
    format!(
        "send-keys -l -t {} -- {}\n",
        pane_id,
        shell_quote_arg(literal)
    )
}

fn build_key_command(pane_id: &str, key: &str) -> String {
    format!("send-keys -t {} {}\n", pane_id, key)
}

fn shell_quote_arg(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", value.replace('\'', r#"'\''"#))
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
    fn control_output_decodes_octal_escapes_for_target_pane() {
        let output = parse_control_output_line("%output %1 hello\\015\\012", "%1")
            .unwrap()
            .unwrap();
        assert_eq!(output, "hello\r\n");

        let output = parse_control_output_line("%output %2 ignored\\012", "%1").unwrap();
        assert_eq!(output, None);
    }

    #[test]
    fn control_extended_output_decodes_target_pane_payload() {
        let output = parse_control_output_line("%extended-output %1 25 : hi\\040there", "%1")
            .unwrap()
            .unwrap();
        assert_eq!(output, "hi there");
    }

    #[test]
    fn control_input_commands_encode_common_xterm_keys() {
        let commands = build_input_commands("%1", "echo hi\r\x1b[A\x03");
        assert_eq!(
            commands,
            vec![
                "send-keys -l -t %1 -- 'echo hi'\n",
                "send-keys -t %1 Enter\n",
                "send-keys -t %1 Up\n",
                "send-keys -t %1 C-c\n",
            ]
        );
    }

    #[test]
    fn control_input_commands_quote_literal_text() {
        let commands = build_input_commands("%1", "can't stop");
        assert_eq!(commands, vec!["send-keys -l -t %1 -- 'can'\\''t stop'\n"]);
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
    async fn terminal_resize_does_not_change_tmux_pane_size() {
        require_tmux();
        let session_name = unique_tmux_session("resize-isolated");
        create_tmux_session(&session_name);
        let _guard = TmuxSessionGuard(session_name.clone());
        let original_size = tmux_display(&session_name, "#{pane_width}x#{pane_height}");

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
        assert_eq!(resized_size, original_size);
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
