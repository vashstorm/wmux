use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use serde::Deserialize;
use tokio::sync::broadcast;
use wmux_core::session::{
    ClientMessage, ErrorDetail, ServerMessage, Session, SessionError, WindowSize,
};

use crate::handlers::connections::{current_config, find_connection, require_local_connection};
use crate::http::ApiError;
use crate::services::terminal as svc;
use crate::services::terminal::TerminalQuery;
use crate::state::AppState;

pub use svc::TerminalSessionTarget;

pub async fn websocket(
    State(state): State<AppState>,
    Query(query): Query<TerminalQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(state, query, socket))
}

async fn handle_socket(state: AppState, query: TerminalQuery, mut socket: WebSocket) {
    let target_name = query
        .target_name
        .as_deref()
        .unwrap_or("local")
        .trim()
        .to_string();
    tracing::debug!(target_name = %target_name, session = ?query.session, "terminal websocket connecting");

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

    if let Err(error) = svc::require_terminal_target(&state, target_name.as_str()) {
        tracing::warn!(target_name = %target_name, error = %error, "terminal target lookup failed");
        send_error_and_close(&mut socket, error.code(), error.message().to_string()).await;
        return;
    }

    let target = match svc::build_terminal_target(&query) {
        Ok(target) => target,
        Err(message) => {
            tracing::warn!(target_name = %target_name, %message, "terminal bad request");
            send_error_and_close(&mut socket, "bad_request", message).await;
            return;
        }
    };

    let size = match svc::parse_initial_size(&query) {
        Ok(size) => size,
        Err(message) => {
            tracing::warn!(target_name = %target_name, %message, "terminal bad request");
            send_error_and_close(&mut socket, "bad_request", message).await;
            return;
        }
    };

    let tmux_path = match current_config(&state) {
        Ok(config) => config.tmux.path,
        Err(error) => {
            tracing::error!(target_name = %target_name, error = %error, "terminal config read failed");
            send_error_and_close(&mut socket, error.code(), error.message().to_string()).await;
            return;
        }
    };

    let target_struct = TerminalSessionTarget { target };
    let session = match svc::attach_terminal_session(&state, &target_name, tmux_path, target_struct, size).await {
        Ok(session) => session,
        Err(error) => {
            tracing::error!(target_name = %target_name, error = %error, "terminal attach failed");
            send_error_and_close(&mut socket, svc::session_error_code(&error), error.to_string()).await;
            return;
        }
    };

    bridge_terminal(socket, session, target_name).await;
}

async fn bridge_terminal(mut socket: WebSocket, session: Session, target_name: String) {
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
    tracing::debug!(%target_name, "terminal websocket disconnected");
    let _ = socket.send(Message::Close(None)).await;
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