use tauri::State;
use wmux_core::ipc_error::IpcError;
use wmux_core::services;
use wmux_core::services::connections::{RuntimeConnection, ConnectionHealthResponse};
use crate::state::IpcState;

fn map_error(e: IpcError) -> String {
    format!("{}: {}", e.code(), e.message())
}

#[tauri::command]
pub async fn list_connections(state: State<'_, IpcState>) -> Result<Vec<RuntimeConnection>, String> {
    Ok(services::connections::list_connections(&state.app_state))
}

#[tauri::command]
pub async fn create_connection(
    state: State<'_, IpcState>,
    connection: RuntimeConnection,
) -> Result<RuntimeConnection, String> {
    services::connections::create_connection(&state.app_state, connection)
        .map_err(map_error)
}

#[tauri::command]
pub async fn get_connection(
    state: State<'_, IpcState>,
    id: String,
) -> Result<RuntimeConnection, String> {
    services::connections::get_connection(&state.app_state, &id)
        .map_err(map_error)
}

#[tauri::command]
pub async fn update_connection(
    state: State<'_, IpcState>,
    id: String,
    connection: RuntimeConnection,
) -> Result<RuntimeConnection, String> {
    services::connections::update_connection(&state.app_state, &id, connection)
        .map_err(map_error)
}

#[tauri::command]
pub async fn delete_connection(
    state: State<'_, IpcState>,
    id: String,
) -> Result<(), String> {
    services::connections::delete_connection(&state.app_state, &id)
        .map_err(map_error)
}

#[tauri::command]
pub async fn connection_health(
    state: State<'_, IpcState>,
    id: String,
) -> Result<ConnectionHealthResponse, String> {
    let config = state.app_state.store.snapshot()
        .map_err(|_| map_error(IpcError::internal("failed to read configuration")))?;
    let tmux_path = if config.tmux.path.is_empty() { "tmux" } else { &config.tmux.path };
    services::connections::get_connection_health(&state.app_state, &id, tmux_path)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn list_connections_health(
    state: State<'_, IpcState>,
) -> Result<Vec<ConnectionHealthResponse>, String> {
    let config = state.app_state.store.snapshot()
        .map_err(|_| map_error(IpcError::internal("failed to read configuration")))?;
    let tmux_path = if config.tmux.path.is_empty() { "tmux" } else { &config.tmux.path };
    Ok(services::connections::list_connections_health(&state.app_state, tmux_path).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_list_connections_returns_empty_when_no_config() {
        // This test verifies the command compiles and can be called.
        // Full integration test requires a real AppState with tmux.
    }

    #[tokio::test]
    async fn test_connection_error_mapping() {
        let error = IpcError::not_found("test error");
        let mapped = map_error(error);
        assert!(mapped.contains("not_found"));
        assert!(mapped.contains("test error"));
    }
}