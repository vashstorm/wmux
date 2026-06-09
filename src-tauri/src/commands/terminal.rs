use std::sync::Arc;

use serde_json;
use tauri::{ipc::Channel, AppHandle, Emitter, State};
use tokio::sync::RwLock;
use wmux_core::session::WindowSize;
use wmux_core::services::terminal as svc;

use crate::state::{IpcState, TerminalSessionHandle, TerminalSessions};

#[tauri::command]
pub async fn terminal_open(
    state: State<'_, IpcState>,
    app: AppHandle,
    target_name: String,
    session: String,
    window: Option<String>,
    pane: Option<String>,
    cols: u16,
    rows: u16,
    on_output: Channel<String>,
) -> Result<(), String> {
    let target_name = target_name.trim();
    let session_name = session.trim();

    if target_name.is_empty() {
        return Err("target_name is required".to_string());
    }
    if session_name.is_empty() {
        return Err("session is required".to_string());
    }

    svc::require_terminal_target(&state.app_state, target_name).map_err(|e| e.message().to_string())?;

    let mut query = svc::TerminalQuery {
        target_name: Some(target_name.to_string()),
        session: Some(session_name.to_string()),
        window: window.clone(),
        pane: pane.clone(),
        rows: Some(rows.to_string()),
        cols: Some(cols.to_string()),
    };

    let target = svc::build_terminal_target(&query).map_err(|e| e.to_string())?;
    let size = svc::parse_initial_size(&query).map_err(|e| e.to_string())?;

    let tmux_path = wmux_core::services::connections::current_config(&state.app_state)
        .map(|c| c.tmux.path)
        .unwrap_or_else(|_| "tmux".to_string());

    let target_struct = svc::TerminalSessionTarget { target };
    let session = svc::attach_terminal_session(
        &state.app_state,
        target_name,
        tmux_path,
        target_struct,
        size,
    )
    .await
    .map_err(|e| {
        let code = svc::session_error_code(&e);
        format!("[{}] {}", code, e)
    })?;

    let key = TerminalSessions::make_key(target_name, session_name, pane.as_deref());

    let session_arc = Arc::new(RwLock::new(Some(TerminalSessionHandle {
        session,
        target_name: target_name.to_string(),
        session_name: session_name.to_string(),
    })));

    {
        let mut handles = state.terminal_sessions.handles.write().await;
        handles.insert(key.clone(), session_arc.clone());
    }

    let app_clone = app.clone();
    let key_clone = key.clone();

    tauri::async_runtime::spawn(async move {
        let mut events = {
            let guard = session_arc.read().await;
            match guard.as_ref() {
                Some(h) => h.session.subscribe(),
                None => return,
            }
        };

        loop {
            tokio::select! {
                event = events.recv() => {
                    match event {
                        Ok(msg) => {
                            let json = serde_json::to_string(&msg).unwrap_or_default();
                            if let Err(e) = on_output.send(json) {
                                tracing::debug!("channel send failed, terminal likely closed: {}", e);
                                break;
                            }
                            if matches!(msg, wmux_core::session::ServerMessage::Close) {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    }
                }
            }
        }

        let _ = app_clone.emit("terminal-closed", &key_clone);
    });

    Ok(())
}

#[tauri::command]
pub async fn terminal_input(
    state: State<'_, IpcState>,
    target_name: String,
    session: String,
    pane: Option<String>,
    data: String,
) -> Result<(), String> {
    let key = TerminalSessions::make_key(&target_name, &session, pane.as_deref());

    let handles = state.terminal_sessions.handles.read().await;
    let session_arc = handles
        .get(&key)
        .ok_or_else(|| "terminal session not found".to_string())?;

    let guard = session_arc.read().await;
    let handle = guard
        .as_ref()
        .ok_or_else(|| "terminal session already closed".to_string())?;

    handle
        .session
        .send_input(data)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, IpcState>,
    target_name: String,
    session: String,
    pane: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let key = TerminalSessions::make_key(&target_name, &session, pane.as_deref());

    let handles = state.terminal_sessions.handles.read().await;
    let session_arc = handles
        .get(&key)
        .ok_or_else(|| "terminal session not found".to_string())?;

    let guard = session_arc.read().await;
    let handle = guard
        .as_ref()
        .ok_or_else(|| "terminal session already closed".to_string())?;

    let size = WindowSize::new(cols, rows).map_err(|e| e.to_string())?;
    handle.session.resize(size).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_close(
    state: State<'_, IpcState>,
    target_name: String,
    session: String,
    pane: Option<String>,
) -> Result<(), String> {
    let key = TerminalSessions::make_key(&target_name, &session, pane.as_deref());

    let session_arc = {
        let mut handles = state.terminal_sessions.handles.write().await;
        handles.remove(&key)
    };

    if let Some(arc) = session_arc {
        let handle = arc.write().await.take();
        if let Some(h) = handle {
            let _ = h.session.close().await;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_sessions_key_format() {
        let key = TerminalSessions::make_key("local", "mysession", None);
        assert_eq!(key, "local:mysession");

        let key_with_pane = TerminalSessions::make_key("local", "mysession", Some("pane0"));
        assert_eq!(key_with_pane, "local:mysession:pane0");
    }
}