use tauri::State;
use wmux_core::config::Config;
use wmux_core::ipc_error::IpcError;
use wmux_core::services;
use wmux_core::services::config::ConfigResponse;
use crate::state::IpcState;

fn map_error(e: IpcError) -> String {
    format!("{}: {}", e.code(), e.message())
}

#[tauri::command]
pub async fn get_config(state: State<'_, IpcState>) -> Result<ConfigResponse, String> {
    services::config::get_config(&state.app_state)
        .map_err(map_error)
}

#[tauri::command]
pub async fn update_config(
    state: State<'_, IpcState>,
    config: Config,
) -> Result<ConfigResponse, String> {
    services::config::update_config(&state.app_state, config)
        .map_err(map_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_config_error_mapping() {
        let error = IpcError::conflict("config file changed on disk");
        let mapped = map_error(error);
        assert!(mapped.contains("conflict"));
        assert!(mapped.contains("config file changed"));
    }

    #[tokio::test]
    async fn test_config_error_bad_request() {
        let error = IpcError::bad_request("invalid auth token");
        let mapped = map_error(error);
        assert!(mapped.contains("bad_request"));
        assert!(mapped.contains("invalid auth token"));
    }
}