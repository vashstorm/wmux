use crate::state::IpcState;
use tauri::State;
use wmux_core::http::ErrorLogsResponse;

#[tauri::command]
pub async fn get_error_logs(state: State<'_, IpcState>) -> Result<ErrorLogsResponse, String> {
    let max_log_lines = 1000usize;
    match &state.app_state.logging_handle.error_log {
        Some(handle) => {
            let (lines, truncated) = handle.read_lines(max_log_lines);
            Ok(ErrorLogsResponse {
                enabled: true,
                path: Some(handle.path().to_string_lossy().into_owned()),
                lines,
                truncated,
                max_lines: max_log_lines,
            })
        }
        None => Ok(ErrorLogsResponse {
            enabled: false,
            path: None,
            lines: Vec::new(),
            truncated: false,
            max_lines: max_log_lines,
        }),
    }
}

#[tauri::command]
pub async fn clear_error_logs(state: State<'_, IpcState>) -> Result<(), String> {
    match &state.app_state.logging_handle.error_log {
        Some(handle) => handle
            .clear()
            .map_err(|e| format!("internal_error: failed to clear error logs: {}", e)),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_logs_response_serialization() {
        let response = ErrorLogsResponse {
            enabled: true,
            path: Some("/tmp/test.log".to_string()),
            lines: vec!["error 1".to_string(), "error 2".to_string()],
            truncated: false,
            max_lines: 1000,
        };
        let json = serde_json::to_string(&response).expect("serialize");
        assert!(json.contains("error 1"));
        assert!(json.contains("enabled"));
    }
}
