use tauri::State;
use wmux_core::ipc_error::IpcError;
use wmux_core::services;
use wmux_core::services::sessions::{
    AnalyzeSessionResponse, PaneOperationResponse, SessionsListResponse,
    SessionOperationResponse, WindowOperationResponse, WindowsListResponse,
    PanesListResponse, OperationResponse,
};
use crate::state::IpcState;

fn map_error(e: IpcError) -> String {
    format!("{}: {}", e.code(), e.message())
}

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, IpcState>,
    target: String,
) -> Result<SessionsListResponse, String> {
    services::sessions::list_sessions(&state.app_state, target)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn create_session(
    state: State<'_, IpcState>,
    target: String,
    name: String,
) -> Result<SessionOperationResponse, String> {
    services::sessions::create_session(&state.app_state, target, name)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn delete_session(
    state: State<'_, IpcState>,
    target: String,
    session: String,
) -> Result<OperationResponse, String> {
    services::sessions::delete_session(&state.app_state, target, session)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn rename_session(
    state: State<'_, IpcState>,
    target: String,
    session: String,
    new_name: String,
) -> Result<OperationResponse, String> {
    services::sessions::rename_session(&state.app_state, target, session, new_name)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn analyze_session(
    state: State<'_, IpcState>,
    target: String,
    session: String,
) -> Result<AnalyzeSessionResponse, String> {
    services::sessions::analyze_session(&state.app_state, target, session)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn list_windows(
    state: State<'_, IpcState>,
    target: String,
    session: String,
) -> Result<WindowsListResponse, String> {
    services::sessions::list_windows(&state.app_state, target, session)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn create_window(
    state: State<'_, IpcState>,
    target: String,
    session: String,
    name: String,
) -> Result<WindowOperationResponse, String> {
    services::sessions::create_window(&state.app_state, target, session, name)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn delete_window(
    state: State<'_, IpcState>,
    target: String,
    session: String,
    window: String,
) -> Result<OperationResponse, String> {
    services::sessions::delete_window(&state.app_state, target, session, window)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn list_panes(
    state: State<'_, IpcState>,
    target: String,
    session: String,
    window: String,
) -> Result<PanesListResponse, String> {
    services::sessions::list_panes(&state.app_state, target, session, window)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn split_pane(
    state: State<'_, IpcState>,
    target: String,
    session: String,
    window: String,
    pane: String,
    horizontal: bool,
) -> Result<PaneOperationResponse, String> {
    services::sessions::split_pane(&state.app_state, target, session, window, pane, horizontal)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn delete_pane(
    state: State<'_, IpcState>,
    target: String,
    session: String,
    window: String,
    pane: String,
) -> Result<OperationResponse, String> {
    services::sessions::delete_pane(&state.app_state, target, session, window, pane)
        .await
        .map_err(map_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_sessions_error_mapping() {
        let error = IpcError::bad_request("invalid session name");
        let mapped = map_error(error);
        assert!(mapped.contains("bad_request"));
        assert!(mapped.contains("invalid session name"));
    }

    #[tokio::test]
    async fn test_sessions_error_not_found() {
        let error = IpcError::not_found("session not found: foo");
        let mapped = map_error(error);
        assert!(mapped.contains("not_found"));
        assert!(mapped.contains("session not found"));
    }
}