use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::Serialize;

use crate::http::{ApiError, ApiResult};
use crate::state::AppState;

const MAX_LOG_LINES: usize = 1000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorLogsResponse {
    pub enabled: bool,
    pub path: Option<String>,
    pub lines: Vec<String>,
    pub truncated: bool,
    pub max_lines: usize,
}

pub async fn get_error_logs(State(state): State<AppState>) -> ApiResult<ErrorLogsResponse> {
    match &state.logging_handle.error_log {
        Some(handle) => {
            let (lines, truncated) = handle.read_lines(MAX_LOG_LINES);
            Ok(Json(ErrorLogsResponse {
                enabled: true,
                path: Some(handle.path().to_string_lossy().into_owned()),
                lines,
                truncated,
                max_lines: MAX_LOG_LINES,
            }))
        }
        None => Ok(Json(ErrorLogsResponse {
            enabled: false,
            path: None,
            lines: Vec::new(),
            truncated: false,
            max_lines: MAX_LOG_LINES,
        })),
    }
}

pub async fn clear_error_logs(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    match &state.logging_handle.error_log {
        Some(handle) => {
            handle
                .clear()
                .map_err(|e| ApiError::internal(format!("failed to clear error logs: {}", e)))?;
        }
        None => {
            // No-op: no error log configured
        }
    }
    Ok(StatusCode::NO_CONTENT)
}
