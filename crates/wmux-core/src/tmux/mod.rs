mod models;

pub use models::{AttentionState, Pane, Session, Window, derive_attention_state};

use std::io;
use std::process::Output;

use thiserror::Error;
use tokio::process::Command;

const DEFAULT_BINARY_PATH: &str = "tmux";
const FIELD_SEPARATOR: &str = "\x1f";

const SESSION_FORMAT: &str =
    "#{session_id}\x1f#{session_name}\x1f#{session_attached}\x1f#{session_windows}";
const WINDOW_FORMAT: &str = "#{window_id}\x1f#{window_name}\x1f#{window_index}\x1f#{window_active}\x1f#{window_panes}\x1f#{pane_id}\x1f#{pane_title}";
const PANE_FORMAT: &str = "#{pane_id}\x1f#{pane_title}\x1f#{pane_index}\x1f#{pane_active}\x1f#{pane_width}\x1f#{pane_height}\x1f#{pane_left}\x1f#{pane_top}\x1f#{pane_dead}\x1f#{pane_input_off}\x1f#{pane_in_mode}\x1f#{alternate_on}\x1f#{pane_current_command}";

pub type Result<T> = std::result::Result<T, TmuxError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    NotFound,
    BadRequest,
}

impl ErrorKind {
    pub fn code(self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::BadRequest => "bad_request",
        }
    }
}

#[derive(Debug, Error)]
pub enum TmuxError {
    #[error("tmux binary {path:?} not found: {source}")]
    TmuxNotFound { path: String, source: io::Error },
    #[error("tmux has no sessions")]
    NoSessions,
    #[error("tmux target not found: {message}")]
    TargetNotFound { message: String },
    #[error("tmux command failed: {message}")]
    CommandFailed { message: String },
    #[error("{field} cannot be empty")]
    InvalidInput { field: &'static str },
    #[error("{message}")]
    Parse { message: String },
}

impl TmuxError {
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::TmuxNotFound { .. } | Self::NoSessions | Self::TargetNotFound { .. } => {
                ErrorKind::NotFound
            }
            Self::CommandFailed { .. } | Self::InvalidInput { .. } | Self::Parse { .. } => {
                ErrorKind::BadRequest
            }
        }
    }

    pub fn code(&self) -> &'static str {
        self.kind().code()
    }
}

#[allow(async_fn_in_trait)]
pub trait CommandRunner: Send + Sync {
    async fn run(&self, program: &str, args: &[&str]) -> io::Result<Output>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TokioCommandRunner;

impl CommandRunner for TokioCommandRunner {
    async fn run(&self, program: &str, args: &[&str]) -> io::Result<Output> {
        Command::new(program)
            .env("LANG", "en_US.UTF-8")
            .env("LC_ALL", "en_US.UTF-8")
            .args(args)
            .output()
            .await
    }
}

#[derive(Debug, Clone)]
pub struct Adapter<R = TokioCommandRunner> {
    path: String,
    runner: R,
}

impl Adapter<TokioCommandRunner> {
    pub fn new(path: impl Into<String>) -> Self {
        Self::with_runner(path, TokioCommandRunner)
    }
}

impl<R> Adapter<R> {
    pub fn with_runner(path: impl Into<String>, runner: R) -> Self {
        Self {
            path: normalize_binary_path(path.into()),
            runner,
        }
    }

    pub fn path(&self) -> &str {
        self.path.as_str()
    }
}

impl<R: CommandRunner> Adapter<R> {
    pub async fn detect_binary(&self) -> Result<()> {
        self.run_raw(&["-V"]).await.map(|_| ())
    }

    pub async fn list_sessions(&self) -> Result<Vec<Session>> {
        match self.run_raw(&["list-sessions", "-F", SESSION_FORMAT]).await {
            Ok(output) => parse_sessions_output(output.as_str()),
            Err(TmuxError::NoSessions) => Ok(Vec::new()),
            Err(err) => Err(err),
        }
    }

    pub async fn has_session(&self, target: &str) -> Result<bool> {
        require_value("session", target)?;
        match self.run_raw(&["has-session", "-t", target]).await {
            Ok(_) => Ok(true),
            Err(TmuxError::NoSessions | TmuxError::TargetNotFound { .. }) => Ok(false),
            Err(err) => Err(err),
        }
    }

    pub async fn new_session(&self, name: &str) -> Result<Session> {
        let args = build_new_session_args(name)?;
        let output = self.run_args(&args).await?;
        parse_session_row(output.as_str())
    }

    pub async fn rename_session(&self, old_name: &str, new_name: &str) -> Result<()> {
        let args = build_rename_session_args(old_name, new_name)?;
        self.run_args(&args).await.map(|_| ())
    }

    pub async fn kill_session(&self, name: &str) -> Result<()> {
        let args = build_kill_session_args(name)?;
        self.run_args(&args).await.map(|_| ())
    }

    pub async fn list_windows(&self, session: &str) -> Result<Vec<Window>> {
        let args = build_list_windows_args(session)?;
        let output = self.run_args(&args).await?;
        parse_windows_output(output.as_str())
    }

    pub async fn select_window(&self, target: &str) -> Result<()> {
        let args = build_select_window_args(target)?;
        self.run_args(&args).await.map(|_| ())
    }

    pub async fn rename_window(&self, target: &str, name: &str) -> Result<()> {
        let args = build_rename_window_args(target, name)?;
        self.run_args(&args).await.map(|_| ())
    }

    pub async fn new_window(&self, session: &str, name: &str) -> Result<Window> {
        let args = build_new_window_args(session, name)?;
        let output = self.run_args(&args).await?;
        parse_window_row(output.as_str())
    }

    pub async fn kill_window(&self, target: &str) -> Result<()> {
        let args = build_kill_window_args(target)?;
        self.run_args(&args).await.map(|_| ())
    }

    pub async fn list_panes(&self, session: &str, window: &str) -> Result<Vec<Pane>> {
        let args = build_list_panes_args(session, window)?;
        let output = self.run_args(&args).await?;
        parse_panes_output(output.as_str())
    }

    pub async fn select_pane(&self, target: &str) -> Result<()> {
        let args = build_select_pane_args(target)?;
        self.run_args(&args).await.map(|_| ())
    }

    pub async fn split_window(&self, target: &str, horizontal: bool) -> Result<Pane> {
        let args = build_split_window_args(target, horizontal)?;
        let output = self.run_args(&args).await?;
        parse_pane_row(output.as_str())
    }

    pub async fn kill_pane(&self, target: &str) -> Result<()> {
        let args = build_kill_pane_args(target)?;
        self.run_args(&args).await.map(|_| ())
    }

    pub async fn send_keys(&self, target: &str, keys: &[&str]) -> Result<()> {
        require_value("pane target", target)?;
        if keys.is_empty() {
            return Err(TmuxError::InvalidInput { field: "keys" });
        }

        let mut args = vec!["send-keys", "-t", target];
        args.extend_from_slice(keys);
        self.run_raw(args.as_slice()).await.map(|_| ())
    }

    pub async fn display_formatted(&self, target: &str, format: &str) -> Result<String> {
        require_value("target", target)?;
        require_value("format", format)?;
        self.run_raw(&["display-message", "-p", "-t", target, "-F", format])
            .await
    }

    pub async fn capture_pane(&self, target: &str, max_bytes: u32) -> Result<String> {
        require_value("pane target", target)?;
        let output = self
            .run_raw(&["capture-pane", "-p", "-e", "-J", "-t", target])
            .await?;
        Ok(truncate_to_bytes(output, max_bytes as usize))
    }

    pub async fn get_window_layout(&self, target: &str) -> Result<String> {
        require_value("window target", target)?;
        self.display_formatted(target, "#{window_layout}").await
    }

    async fn run_args(&self, args: &[String]) -> Result<String> {
        let args = args.iter().map(String::as_str).collect::<Vec<_>>();
        self.run_raw(args.as_slice()).await
    }

    async fn run_raw(&self, args: &[&str]) -> Result<String> {
        let output = self
            .runner
            .run(self.path.as_str(), args)
            .await
            .map_err(|err| {
                if err.kind() == io::ErrorKind::NotFound {
                    TmuxError::TmuxNotFound {
                        path: self.path.clone(),
                        source: err,
                    }
                } else {
                    TmuxError::CommandFailed {
                        message: err.to_string(),
                    }
                }
            })?;

        if output.status.success() {
            return Ok(String::from_utf8_lossy(output.stdout.as_slice())
                .trim()
                .to_string());
        }

        let stderr = String::from_utf8_lossy(output.stderr.as_slice())
            .trim()
            .to_string();
        if is_no_sessions_error(stderr.as_str()) {
            return Err(TmuxError::NoSessions);
        }
        if is_target_not_found_error(stderr.as_str()) {
            return Err(TmuxError::TargetNotFound { message: stderr });
        }

        Err(TmuxError::CommandFailed {
            message: command_failed_message(args, stderr.as_str()),
        })
    }
}

fn build_list_windows_args(session: &str) -> Result<Vec<String>> {
    require_value("session", session)?;
    Ok(vec![
        "list-windows".to_string(),
        "-t".to_string(),
        session.to_string(),
        "-F".to_string(),
        WINDOW_FORMAT.to_string(),
    ])
}

fn build_list_panes_args(session: &str, window: &str) -> Result<Vec<String>> {
    let target = build_pane_target(session, window)?;
    Ok(vec![
        "list-panes".to_string(),
        "-t".to_string(),
        target,
        "-F".to_string(),
        PANE_FORMAT.to_string(),
    ])
}

fn build_new_session_args(name: &str) -> Result<Vec<String>> {
    require_value("session name", name)?;
    Ok(vec![
        "new-session".to_string(),
        "-d".to_string(),
        "-s".to_string(),
        name.to_string(),
        "-P".to_string(),
        "-F".to_string(),
        SESSION_FORMAT.to_string(),
    ])
}

fn build_rename_session_args(old_name: &str, new_name: &str) -> Result<Vec<String>> {
    require_value("old session name", old_name)?;
    require_value("new session name", new_name)?;
    Ok(vec![
        "rename-session".to_string(),
        "-t".to_string(),
        old_name.to_string(),
        new_name.to_string(),
    ])
}

fn build_kill_session_args(name: &str) -> Result<Vec<String>> {
    require_value("session name", name)?;
    Ok(vec![
        "kill-session".to_string(),
        "-t".to_string(),
        name.to_string(),
    ])
}

fn build_new_window_args(session: &str, name: &str) -> Result<Vec<String>> {
    require_value("session", session)?;
    require_value("window name", name)?;
    Ok(vec![
        "new-window".to_string(),
        "-t".to_string(),
        session.to_string(),
        "-n".to_string(),
        name.to_string(),
        "-P".to_string(),
        "-F".to_string(),
        WINDOW_FORMAT.to_string(),
    ])
}

fn build_rename_window_args(target: &str, name: &str) -> Result<Vec<String>> {
    require_value("window target", target)?;
    require_value("window name", name)?;
    Ok(vec![
        "rename-window".to_string(),
        "-t".to_string(),
        target.to_string(),
        name.to_string(),
    ])
}

fn build_kill_window_args(target: &str) -> Result<Vec<String>> {
    require_value("window target", target)?;
    Ok(vec![
        "kill-window".to_string(),
        "-t".to_string(),
        target.to_string(),
    ])
}

fn build_select_window_args(target: &str) -> Result<Vec<String>> {
    require_value("window target", target)?;
    Ok(vec![
        "select-window".to_string(),
        "-t".to_string(),
        target.to_string(),
    ])
}

fn build_split_window_args(target: &str, horizontal: bool) -> Result<Vec<String>> {
    require_value("pane target", target)?;
    Ok(vec![
        "split-window".to_string(),
        if horizontal { "-h" } else { "-v" }.to_string(),
        "-t".to_string(),
        target.to_string(),
        "-P".to_string(),
        "-F".to_string(),
        PANE_FORMAT.to_string(),
    ])
}

fn build_kill_pane_args(target: &str) -> Result<Vec<String>> {
    require_value("pane target", target)?;
    Ok(vec![
        "kill-pane".to_string(),
        "-t".to_string(),
        target.to_string(),
    ])
}

fn build_select_pane_args(target: &str) -> Result<Vec<String>> {
    require_value("pane target", target)?;
    Ok(vec![
        "select-pane".to_string(),
        "-t".to_string(),
        target.to_string(),
    ])
}

fn parse_sessions_output(output: &str) -> Result<Vec<Session>> {
    parse_rows(output, parse_session_row)
}

fn parse_windows_output(output: &str) -> Result<Vec<Window>> {
    parse_rows(output, parse_window_row)
}

fn parse_panes_output(output: &str) -> Result<Vec<Pane>> {
    parse_rows(output, parse_pane_row)
}

fn parse_rows<T>(output: &str, parse: fn(&str) -> Result<T>) -> Result<Vec<T>> {
    if output.trim().is_empty() {
        return Ok(Vec::new());
    }

    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(parse)
        .collect()
}

fn parse_session_row(row: &str) -> Result<Session> {
    if let Some(fields) = split_formatted_fields(row, 4) {
        let attached = parse_bool_field(fields[2])?;
        let window_count = parse_usize_field(row, "window count", fields[3])?;
        return Ok(Session::new(
            fields[0].to_string(),
            fields[1].to_string(),
            attached,
            window_count,
        ));
    }

    let (first, last) = split_first_last(row)?;
    let attached = parse_bool_field(&row[last + 1..])?;
    Ok(Session::new(
        row[..first].to_string(),
        row[first + 1..last].to_string(),
        attached,
        0,
    ))
}

fn parse_window_row(row: &str) -> Result<Window> {
    if let Some(fields) = split_formatted_fields(row, 7) {
        let index = parse_usize_field(row, "index", fields[2])?;
        let active = parse_bool_field(fields[3])?;
        let pane_count = parse_usize_field(row, "pane count", fields[4])?;
        return Ok(Window::new(
            fields[0].to_string(),
            fields[1].to_string(),
            index,
            active,
            pane_count,
            fields[5].to_string(),
            fields[6].to_string(),
        ));
    }

    let positions = last_colon_positions(row, 5)?;
    let first = row
        .find(':')
        .filter(|idx| *idx > 0)
        .ok_or_else(|| parse_error(format!("parse window row {row:?}: invalid format")))?;
    let fifth_last = positions[4];
    let fourth_last = positions[3];
    let third_last = positions[2];
    let second_last = positions[1];
    let last = positions[0];

    let index = parse_usize_field(row, "index", &row[fifth_last + 1..fourth_last])?;
    let active = parse_bool_field(&row[fourth_last + 1..third_last])?;
    let pane_count = parse_usize_field(row, "pane count", &row[third_last + 1..second_last])?;

    Ok(Window::new(
        row[..first].to_string(),
        row[first + 1..fifth_last].to_string(),
        index,
        active,
        pane_count,
        row[second_last + 1..last].to_string(),
        row[last + 1..].to_string(),
    ))
}

fn parse_pane_row(row: &str) -> Result<Pane> {
    if let Some(fields) = split_formatted_fields(row, 13) {
        return Ok(Pane::new(
            fields[0].to_string(),
            fields[1].to_string(),
            parse_usize_field(row, "index", fields[2])?,
            parse_bool_field(fields[3])?,
            parse_usize_field(row, "width", fields[4])?,
            parse_usize_field(row, "height", fields[5])?,
            parse_usize_field(row, "left", fields[6])?,
            parse_usize_field(row, "top", fields[7])?,
            parse_bool_field(fields[8])?,
            parse_bool_field(fields[9])?,
            parse_bool_field(fields[10])?,
            parse_bool_field(fields[11])?,
            fields[12].to_string(),
        ));
    }

    let positions = last_colon_positions(row, 6)?;
    let first = row
        .find(':')
        .filter(|idx| *idx > 0)
        .ok_or_else(|| parse_error(format!("parse pane row {row:?}: invalid format")))?;
    let sixth_last = positions[5];
    let fifth_last = positions[4];
    let fourth_last = positions[3];
    let third_last = positions[2];
    let second_last = positions[1];
    let last = positions[0];

    Ok(Pane::new(
        row[..first].to_string(),
        row[first + 1..sixth_last].to_string(),
        parse_usize_field(row, "index", &row[sixth_last + 1..fifth_last])?,
        parse_bool_field(&row[fifth_last + 1..fourth_last])?,
        parse_usize_field(row, "width", &row[fourth_last + 1..third_last])?,
        parse_usize_field(row, "height", &row[third_last + 1..second_last])?,
        parse_usize_field(row, "left", &row[second_last + 1..last])?,
        parse_usize_field(row, "top", &row[last + 1..])?,
        false,
        false,
        false,
        false,
        String::new(),
    ))
}

fn parse_bool_field(value: &str) -> Result<bool> {
    let value = value.trim();
    match value {
        "1" | "true" => Ok(true),
        "0" | "false" => Ok(false),
        _ => value
            .parse::<isize>()
            .map(|value| value != 0)
            .map_err(|_| parse_error(format!("invalid boolean value {value:?}"))),
    }
}

fn parse_usize_field(row: &str, field: &str, value: &str) -> Result<usize> {
    value
        .trim()
        .parse::<usize>()
        .map_err(|err| parse_error(format!("parse row {row:?}: invalid {field}: {err}")))
}

fn normalize_binary_path(path: String) -> String {
    if path.trim().is_empty() {
        DEFAULT_BINARY_PATH.to_string()
    } else {
        path
    }
}

fn require_value(field: &'static str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(TmuxError::InvalidInput { field })
    } else {
        Ok(())
    }
}

fn truncate_to_bytes(value: String, max_bytes: usize) -> String {
    if max_bytes == 0 || value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

fn build_pane_target(session: &str, window: &str) -> Result<String> {
    require_value("window target", window)?;
    if window.starts_with('@') || window.starts_with('%') || window.contains(':') {
        return Ok(window.to_string());
    }
    if session.trim().is_empty() {
        Ok(window.to_string())
    } else {
        Ok(format!("{session}:{window}"))
    }
}

fn split_first_last(value: &str) -> Result<(usize, usize)> {
    let first = value.find(':');
    let last = value.rfind(':');
    match (first, last) {
        (Some(first), Some(last)) if first > 0 && last > first => Ok((first, last)),
        _ => Err(parse_error(format!("parse row {value:?}: invalid format"))),
    }
}

fn split_formatted_fields(row: &str, count: usize) -> Option<Vec<&str>> {
    if !row.contains(FIELD_SEPARATOR) {
        return None;
    }
    let fields = row.split(FIELD_SEPARATOR).collect::<Vec<_>>();
    (fields.len() == count).then_some(fields)
}

fn last_colon_positions(row: &str, count: usize) -> Result<Vec<usize>> {
    let positions = row
        .match_indices(':')
        .map(|(idx, _)| idx)
        .rev()
        .take(count)
        .collect::<Vec<_>>();
    if positions.len() == count {
        Ok(positions)
    } else {
        Err(parse_error(format!("parse row {row:?}: invalid format")))
    }
}

fn parse_error(message: String) -> TmuxError {
    TmuxError::Parse { message }
}

fn is_no_sessions_error(stderr: &str) -> bool {
    let text = stderr.trim().to_ascii_lowercase();
    !text.is_empty()
        && (text.contains("no sessions")
            || text.contains("no server running")
            || text.contains("failed to connect to server")
            || text.contains("error connecting to"))
}

fn is_target_not_found_error(stderr: &str) -> bool {
    let text = stderr.trim().to_ascii_lowercase();
    !text.is_empty()
        && (text.contains("can't find session")
            || text.contains("can't find window")
            || text.contains("can't find pane")
            || text.contains("session not found")
            || text.contains("window not found")
            || text.contains("pane not found")
            || text.contains("no such session"))
}

fn command_failed_message(args: &[&str], stderr: &str) -> String {
    if stderr.is_empty() {
        args.join(" ")
    } else {
        stderr.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::VecDeque;
    use std::os::unix::process::ExitStatusExt;
    use std::process::ExitStatus;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct Call {
        program: String,
        args: Vec<String>,
    }

    #[derive(Debug, Clone)]
    enum MockResponse {
        Output {
            stdout: String,
            stderr: String,
            code: i32,
        },
        NotFound,
    }

    #[derive(Debug, Clone, Default)]
    struct MockRunner {
        calls: Arc<Mutex<Vec<Call>>>,
        responses: Arc<Mutex<VecDeque<MockResponse>>>,
    }

    impl MockRunner {
        fn with_response(response: MockResponse) -> Self {
            let runner = Self::default();
            runner.push_response(response);
            runner
        }

        fn push_response(&self, response: MockResponse) {
            self.responses
                .lock()
                .expect("responses lock")
                .push_back(response);
        }

        fn calls(&self) -> Vec<Call> {
            self.calls.lock().expect("calls lock").clone()
        }
    }

    impl CommandRunner for MockRunner {
        async fn run(&self, program: &str, args: &[&str]) -> io::Result<Output> {
            self.calls.lock().expect("calls lock").push(Call {
                program: program.to_string(),
                args: args.iter().map(|arg| (*arg).to_string()).collect(),
            });

            match self.responses.lock().expect("responses lock").pop_front() {
                Some(MockResponse::Output {
                    stdout,
                    stderr,
                    code,
                }) => Ok(output(stdout, stderr, code)),
                Some(MockResponse::NotFound) => Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "tmux mock not found",
                )),
                None => Ok(output(String::new(), String::new(), 0)),
            }
        }
    }

    fn output(stdout: String, stderr: String, code: i32) -> Output {
        Output {
            status: exit_status(code),
            stdout: stdout.into_bytes(),
            stderr: stderr.into_bytes(),
        }
    }

    fn exit_status(code: i32) -> ExitStatus {
        ExitStatus::from_raw(code << 8)
    }

    fn joined(fields: &[&str]) -> String {
        fields.join(FIELD_SEPARATOR)
    }

    #[test]
    fn tmux_adapter_defaults_path() {
        let adapter = Adapter::new("");
        assert_eq!(adapter.path(), DEFAULT_BINARY_PATH);
    }

    #[test]
    fn tmux_parse_session_row_allows_colon_name_and_attached_count() {
        let row = joined(&["$5", "dev:api", "2", "3"]);
        let session = parse_session_row(row.as_str()).expect("session row");
        assert_eq!(
            session,
            Session::new("$5".to_string(), "dev:api".to_string(), true, 3)
        );
    }

    #[test]
    fn tmux_parse_window_row_allows_colon_title() {
        let row = joined(&[
            "@2",
            "editor:main",
            "3",
            "0",
            "1",
            "%5",
            "user@host:/workspace",
        ]);
        let window = parse_window_row(row.as_str()).expect("window row");
        assert_eq!(
            window,
            Window::new(
                "@2".to_string(),
                "editor:main".to_string(),
                3,
                false,
                1,
                "%5".to_string(),
                "user@host:/workspace".to_string(),
            )
        );
    }

    #[test]
    fn tmux_parse_pane_row_derives_attention_fields() {
        let row = joined(&[
            "%4", "editor", "3", "0", "100", "30", "10", "0", "0", "0", "0", "1", "vim",
        ]);
        let pane = parse_pane_row(row.as_str()).expect("pane row");
        assert_eq!(pane.id, "%4");
        assert_eq!(pane.title, "editor");
        assert_eq!(pane.left, 10);
        assert_eq!(pane.current_command, "vim");
        assert_eq!(pane.attention_state, AttentionState::Attention);
    }

    #[test]
    fn tmux_parse_fallback_rows_match_go_adapter() {
        let window = parse_window_row("@2:editor:main:3:0:1:%5:zsh").expect("window row");
        assert_eq!(window.name, "editor:main");
        assert_eq!(window.index, 3);
        assert_eq!(window.active_pane_title, "zsh");

        let pane = parse_pane_row("%5:vim:3:1:80:24:10:5").expect("pane row");
        assert_eq!(pane.title, "vim");
        assert_eq!(pane.index, 3);
        assert_eq!(pane.width, 80);
        assert_eq!(pane.top, 5);
    }

    #[tokio::test]
    async fn tmux_new_session_uses_detached_format_args() {
        let runner = MockRunner::with_response(MockResponse::Output {
            stdout: joined(&["$1", "dev", "0", "1"]),
            stderr: String::new(),
            code: 0,
        });
        let adapter = Adapter::with_runner("", runner.clone());

        let session = adapter.new_session("dev").await.expect("new session");

        assert_eq!(session.name, "dev");
        assert_eq!(
            runner.calls()[0],
            Call {
                program: "tmux".to_string(),
                args: vec![
                    "new-session".to_string(),
                    "-d".to_string(),
                    "-s".to_string(),
                    "dev".to_string(),
                    "-P".to_string(),
                    "-F".to_string(),
                    SESSION_FORMAT.to_string(),
                ],
            }
        );
    }

    #[tokio::test]
    async fn tmux_list_sessions_no_server_returns_empty() {
        let runner = MockRunner::with_response(MockResponse::Output {
            stdout: String::new(),
            stderr: "no server running on /tmp/tmux-1000/default".to_string(),
            code: 1,
        });
        let adapter = Adapter::with_runner("tmux", runner);

        let sessions = adapter.list_sessions().await.expect("list sessions");

        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn tmux_has_session_returns_false_for_missing_session() {
        let runner = MockRunner::with_response(MockResponse::Output {
            stdout: String::new(),
            stderr: "can't find session: missing".to_string(),
            code: 1,
        });
        let adapter = Adapter::with_runner("tmux", runner);

        let exists = adapter.has_session("missing").await.expect("has session");

        assert!(!exists);
    }

    #[tokio::test]
    async fn tmux_command_failure_maps_to_bad_request() {
        let runner = MockRunner::with_response(MockResponse::Output {
            stdout: String::new(),
            stderr: "permission denied".to_string(),
            code: 1,
        });
        let adapter = Adapter::with_runner("tmux", runner);

        let err = adapter
            .list_windows("dev")
            .await
            .expect_err("command failure");

        assert_eq!(err.code(), "bad_request");
        assert!(err.to_string().contains("permission denied"));
    }

    #[tokio::test]
    async fn tmux_not_found_maps_to_not_found() {
        let runner = MockRunner::with_response(MockResponse::NotFound);
        let adapter = Adapter::with_runner("/missing/tmux", runner);

        let err = adapter.detect_binary().await.expect_err("missing tmux");

        assert_eq!(err.code(), "not_found");
    }

    #[tokio::test]
    async fn tmux_parse_failure_maps_to_bad_request() {
        let runner = MockRunner::with_response(MockResponse::Output {
            stdout: joined(&["$1", "dev", "not-bool", "1"]),
            stderr: String::new(),
            code: 0,
        });
        let adapter = Adapter::with_runner("tmux", runner);

        let err = adapter.list_sessions().await.expect_err("parse failure");

        assert_eq!(err.code(), "bad_request");
    }

    #[tokio::test]
    async fn tmux_send_keys_and_display_formatted_use_arg_arrays() {
        let runner = MockRunner::default();
        runner.push_response(MockResponse::Output {
            stdout: String::new(),
            stderr: String::new(),
            code: 0,
        });
        runner.push_response(MockResponse::Output {
            stdout: joined(&["$1", "dev", "0", "1"]),
            stderr: String::new(),
            code: 0,
        });
        let adapter = Adapter::with_runner("tmux", runner.clone());

        adapter
            .send_keys("%1", &["printf 'hello world'", "Enter"])
            .await
            .expect("send keys");
        let formatted = adapter
            .display_formatted("dev", SESSION_FORMAT)
            .await
            .expect("display formatted");

        assert_eq!(formatted, joined(&["$1", "dev", "0", "1"]));
        assert_eq!(
            runner.calls()[0].args,
            vec![
                "send-keys".to_string(),
                "-t".to_string(),
                "%1".to_string(),
                "printf 'hello world'".to_string(),
                "Enter".to_string(),
            ]
        );
        assert_eq!(
            runner.calls()[1].args,
            vec![
                "display-message".to_string(),
                "-p".to_string(),
                "-t".to_string(),
                "dev".to_string(),
                "-F".to_string(),
                SESSION_FORMAT.to_string(),
            ]
        );
    }

    #[tokio::test]
    #[ignore]
    async fn tmux_integration_local_adapter() {
        let adapter = Adapter::new(std::env::var("WMUX_TMUX_PATH").unwrap_or_default());
        if let Err(err) = adapter.detect_binary().await {
            eprintln!("skipping tmux integration because tmux is unavailable: {err}");
            return;
        }

        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let session_name = format!("wmux-rust-test-{nanos}");
        let renamed_session = format!("{session_name}-renamed");
        let window_name = "wmux-window";

        let session = adapter
            .new_session(session_name.as_str())
            .await
            .expect("new session");
        assert_eq!(session.name, session_name);
        assert!(
            adapter
                .has_session(session_name.as_str())
                .await
                .expect("has session")
        );

        adapter
            .rename_session(session_name.as_str(), renamed_session.as_str())
            .await
            .expect("rename session");

        let window = adapter
            .new_window(renamed_session.as_str(), window_name)
            .await
            .expect("new window");
        assert_eq!(window.name, window_name);

        let panes = adapter
            .list_panes(renamed_session.as_str(), window.id.as_str())
            .await
            .expect("list panes");
        assert!(!panes.is_empty());

        let split = adapter
            .split_window(window.id.as_str(), true)
            .await
            .expect("split window");
        adapter
            .select_window(window.id.as_str())
            .await
            .expect("select window");
        adapter
            .select_pane(split.id.as_str())
            .await
            .expect("select pane");
        adapter
            .send_keys(split.id.as_str(), &["echo wmux", "Enter"])
            .await
            .expect("send keys");
        adapter
            .kill_pane(split.id.as_str())
            .await
            .expect("kill pane");
        adapter
            .kill_window(window.id.as_str())
            .await
            .expect("kill window");
        adapter
            .kill_session(renamed_session.as_str())
            .await
            .expect("kill session");
    }
}
