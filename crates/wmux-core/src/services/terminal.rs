use serde::Deserialize;
use wmux_core::ipc_error::IpcResult;
use wmux_core::session::{Session, SessionError, WindowSize};

use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalQuery {
    pub target_name: Option<String>,
    pub session: Option<String>,
    pub window: Option<String>,
    pub pane: Option<String>,
    pub rows: Option<String>,
    pub cols: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TerminalSessionTarget {
    pub target: String,
}

pub fn build_terminal_target(query: &TerminalQuery) -> Result<String, String> {
    let session = query.session.as_deref().unwrap_or_default().trim();
    if session.is_empty() {
        return Err("session target is required".to_string());
    }

    let mut parts = vec![format!("session={}", percent_encode_query_value(session))];
    if let Some(window) = trimmed_non_empty(query.window.as_deref()) {
        parts.push(format!("window={}", percent_encode_query_value(window)));
    }
    if let Some(pane) = trimmed_non_empty(query.pane.as_deref()) {
        parts.push(format!("pane={}", percent_encode_query_value(pane)));
    }
    Ok(parts.join("&"))
}

pub fn parse_initial_size(query: &TerminalQuery) -> Result<WindowSize, String> {
    let rows = parse_optional_positive_u16(query.rows.as_deref())
        .map_err(|error| format!("invalid rows query parameter: {error}"))?
        .unwrap_or(24);
    let cols = parse_optional_positive_u16(query.cols.as_deref())
        .map_err(|error| format!("invalid cols query parameter: {error}"))?
        .unwrap_or(80);
    WindowSize::new(cols, rows).map_err(|error| error.to_string())
}

pub async fn attach_terminal_session(
    state: &AppState,
    target_name: &str,
    tmux_path: String,
    target: TerminalSessionTarget,
    size: WindowSize,
) -> Result<Session, SessionError> {
    state
        .sessions
        .attach_local(target_name, &tmux_path, target.target, size)
        .await
}

pub fn require_terminal_target(state: &AppState, target_name: &str) -> IpcResult<()> {
    if target_name == "local" {
        return Ok(());
    }
    let connection = crate::services::connections::find_connection(state, target_name)?;
    crate::services::connections::require_local_connection(&connection)
}

fn parse_optional_positive_u16(raw: Option<&str>) -> Result<Option<u16>, String> {
    let raw = raw.unwrap_or_default().trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let value = raw.parse::<i32>().map_err(|error| error.to_string())?;
    if value <= 0 || value > u16::MAX as i32 {
        return Err("must be positive".to_string());
    }
    Ok(Some(value as u16))
}

fn trimmed_non_empty(value: Option<&str>) -> Option<&str> {
    let value = value?.trim();
    if value.is_empty() { None } else { Some(value) }
}

fn percent_encode_query_value(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            b' ' => encoded.push('+'),
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

pub fn session_error_code(error: &SessionError) -> &'static str {
    match error {
        SessionError::MissingTargetName
        | SessionError::MissingTarget
        | SessionError::MissingTargetPart(_)
        | SessionError::InvalidWindowSize
        | SessionError::InvalidTarget(_) => "bad_request",
        SessionError::TmuxCommandFailed(_) | SessionError::Pty(_) => "terminal_attach_failed",
        SessionError::SessionClosed | SessionError::Join(_) => "terminal_closed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_terminal_target_requires_session() {
        let query = TerminalQuery {
            target_name: Some("local".to_string()),
            session: None,
            window: None,
            pane: None,
            rows: None,
            cols: None,
        };
        let result = build_terminal_target(&query);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("session"));
    }

    #[test]
    fn build_terminal_target_with_session() {
        let query = TerminalQuery {
            target_name: Some("local".to_string()),
            session: Some("mysession".to_string()),
            window: None,
            pane: None,
            rows: None,
            cols: None,
        };
        let result = build_terminal_target(&query).unwrap();
        assert!(result.contains("session=mysession"));
    }

    #[test]
    fn build_terminal_target_with_window_and_pane() {
        let query = TerminalQuery {
            target_name: Some("local".to_string()),
            session: Some("mysession".to_string()),
            window: Some("mywindow".to_string()),
            pane: Some("mypane".to_string()),
            rows: None,
            cols: None,
        };
        let result = build_terminal_target(&query).unwrap();
        assert!(result.contains("session=mysession"));
        assert!(result.contains("window=mywindow"));
        assert!(result.contains("pane=mypane"));
    }

    #[test]
    fn parse_initial_size_with_defaults() {
        let query = TerminalQuery {
            target_name: None,
            session: None,
            window: None,
            pane: None,
            rows: None,
            cols: None,
        };
        let size = parse_initial_size(&query).unwrap();
        assert_eq!(size.cols, 80);
        assert_eq!(size.rows, 24);
    }

    #[test]
    fn parse_initial_size_with_custom_values() {
        let query = TerminalQuery {
            target_name: None,
            session: None,
            window: None,
            pane: None,
            rows: Some("40".to_string()),
            cols: Some("120".to_string()),
        };
        let size = parse_initial_size(&query).unwrap();
        assert_eq!(size.cols, 120);
        assert_eq!(size.rows, 40);
    }

    #[test]
    fn parse_initial_size_rejects_zero() {
        let query = TerminalQuery {
            target_name: None,
            session: None,
            window: None,
            pane: None,
            rows: Some("0".to_string()),
            cols: None,
        };
        let result = parse_initial_size(&query);
        assert!(result.is_err());
    }

    #[test]
    fn percent_encode_works() {
        assert_eq!(percent_encode_query_value("hello"), "hello");
        assert_eq!(percent_encode_query_value("hello world"), "hello+world");
        assert_eq!(percent_encode_query_value("a/b"), "a%2Fb");
    }
}
