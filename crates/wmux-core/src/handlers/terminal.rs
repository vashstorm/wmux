use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use serde::Deserialize;
use tokio::sync::broadcast;
use wmux_core::config::ConnectionConfig;
use wmux_core::session::{
    ClientMessage, ErrorDetail, ServerMessage, Session, SessionError, WindowSize,
};
use wmux_core::tmux::Adapter;

use crate::handlers::connections::{current_config, find_connection, require_local_connection};
use crate::http::ApiError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalQuery {
    connection_id: Option<String>,
    session: Option<String>,
    window: Option<String>,
    pane: Option<String>,
    rows: Option<String>,
    cols: Option<String>,
}

pub async fn websocket(
    State(state): State<AppState>,
    Query(query): Query<TerminalQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(state, query, socket))
}

async fn handle_socket(state: AppState, query: TerminalQuery, mut socket: WebSocket) {
    let connection_id = query
        .connection_id
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();
    tracing::info!(connection_id = %connection_id, session = ?query.session, "terminal websocket connecting");

    if send_json(
        &mut socket,
        &ServerMessage::Status {
            status: "connected".to_string(),
        },
    )
    .await
    .is_err()
    {
        return;
    }

    let connection = match connection_for_terminal_marker(
        &state,
        &connection_id,
        query.session.as_deref(),
    )
    .await
    .and_then(|connection| {
        require_local_connection(&connection)?;
        Ok(connection)
    }) {
        Ok(connection) => connection,
        Err(error) => {
            tracing::warn!(connection_id = %connection_id, error = %error, "terminal connection lookup failed");
            send_error_and_close(&mut socket, error.code(), error.message().to_string()).await;
            return;
        }
    };
    let resolved_connection_id = connection.id;

    let target = match build_terminal_target(&query) {
        Ok(target) => target,
        Err(message) => {
            tracing::warn!(connection_id = %resolved_connection_id, %message, "terminal bad request");
            send_error_and_close(&mut socket, "bad_request", message).await;
            return;
        }
    };
    let size = match parse_initial_size(&query) {
        Ok(size) => size,
        Err(message) => {
            tracing::warn!(connection_id = %resolved_connection_id, %message, "terminal bad request");
            send_error_and_close(&mut socket, "bad_request", message).await;
            return;
        }
    };
    let tmux_path = match current_config(&state) {
        Ok(config) => config.tmux.path,
        Err(error) => {
            tracing::error!(connection_id = %resolved_connection_id, error = %error, "terminal config read failed");
            send_error_and_close(&mut socket, error.code(), error.message().to_string()).await;
            return;
        }
    };

    let session = match state
        .sessions
        .attach_local(&resolved_connection_id, tmux_path, target, size)
        .await
    {
        Ok(session) => session,
        Err(error) => {
            tracing::error!(connection_id = %resolved_connection_id, error = %error, "terminal attach failed");
            send_error_and_close(&mut socket, session_error_code(&error), error.to_string()).await;
            return;
        }
    };

    bridge_terminal(socket, session, resolved_connection_id).await;
}

async fn bridge_terminal(mut socket: WebSocket, session: Session, connection_id: String) {
    let mut events = session.subscribe();
    if let Some(initial_output) = session.initial_output()
        && send_json(
            &mut socket,
            &ServerMessage::Output {
                data: initial_output.to_string(),
            },
        )
        .await
        .is_err()
    {
        let _ = session.close().await;
        return;
    }

    loop {
        tokio::select! {
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<ClientMessage>(&text) {
                            Ok(ClientMessage::Input { data }) => {
                                if session.send_input(data).await.is_err() {
                                    break;
                                }
                            }
                            Ok(ClientMessage::Resize { cols, rows }) => {
                                if session.resize(WindowSize { cols, rows }).await.is_err() {
                                    break;
                                }
                            }
                            Ok(ClientMessage::Close) => break,
                            Err(error) => {
                                let _ = send_json(&mut socket, &terminal_error("bad_request", error.to_string())).await;
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            event = events.recv() => {
                match event {
                    Ok(message) => {
                        if send_json(&mut socket, &message).await.is_err() {
                            break;
                        }
                        if matches!(message, ServerMessage::Close) {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    let _ = session.close().await;
    tracing::info!(%connection_id, "terminal websocket disconnected");
    let _ = socket.send(Message::Close(None)).await;
}

fn build_terminal_target(query: &TerminalQuery) -> Result<String, String> {
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

fn parse_initial_size(query: &TerminalQuery) -> Result<WindowSize, String> {
    let rows = parse_optional_positive_u16(query.rows.as_deref())
        .map_err(|error| format!("invalid rows query parameter: {error}"))?
        .unwrap_or(24);
    let cols = parse_optional_positive_u16(query.cols.as_deref())
        .map_err(|error| format!("invalid cols query parameter: {error}"))?
        .unwrap_or(80);
    WindowSize::new(cols, rows).map_err(|error| error.to_string())
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

async fn send_json(socket: &mut WebSocket, message: &ServerMessage) -> Result<(), axum::Error> {
    let data = serde_json::to_string(message).map_err(axum::Error::new)?;
    socket.send(Message::Text(data.into())).await
}

async fn send_error_and_close(socket: &mut WebSocket, code: &str, message: String) {
    let _ = send_json(socket, &terminal_error(code, message)).await;
    let _ = socket.send(Message::Close(None)).await;
}

fn terminal_error(code: impl Into<String>, message: impl Into<String>) -> ServerMessage {
    ServerMessage::Error {
        error: ErrorDetail::new(code, message),
    }
}

fn session_error_code(error: &SessionError) -> &'static str {
    match error {
        SessionError::MissingConnectionId
        | SessionError::MissingTarget
        | SessionError::MissingTargetPart(_)
        | SessionError::InvalidWindowSize
        | SessionError::InvalidTarget(_) => "bad_request",
        SessionError::TmuxCommandFailed(_) | SessionError::Pty(_) => "terminal_attach_failed",
        SessionError::SessionClosed | SessionError::Join(_) => "terminal_closed",
    }
}

async fn connection_for_terminal_marker(
    state: &AppState,
    id: &str,
    session_marker: Option<&str>,
) -> Result<ConnectionConfig, ApiError> {
    if let Some(connection) = find_connection_exact(state, id)? {
        return Ok(connection);
    }

    let config = current_config(state)?;
    let adapter = Adapter::new(config.tmux.path);
    if let Some(connection) = single_local_connection(config.connections) {
        for marker in [session_marker, Some(id)].into_iter().flatten() {
            if marker.trim().is_empty() {
                continue;
            }
            if adapter
                .has_session(marker)
                .await
                .map_err(|error| ApiError::not_found(error.to_string()))?
            {
                tracing::info!(
                    session = %marker,
                    resolved_connection_id = %connection.id,
                    "resolved local connection from tmux session name marker"
                );
                return Ok(connection);
            }
        }
    }

    find_connection(state, id)
}

fn find_connection_exact(state: &AppState, id: &str) -> Result<Option<ConnectionConfig>, ApiError> {
    Ok(current_config(state)?
        .connections
        .into_iter()
        .find(|connection| connection.id == id))
}

fn single_local_connection(connections: Vec<ConnectionConfig>) -> Option<ConnectionConfig> {
    let mut local_connections = connections
        .into_iter()
        .filter(|connection| connection.connection_type.eq_ignore_ascii_case("local"));
    let connection = local_connections.next()?;
    local_connections.next().is_none().then_some(connection)
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
