use axum::Json;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use serde::Deserialize;

use crate::http::{ApiError, ApiResult};
use crate::state::AppState;
use crate::storage::models::AiLogListResponse;
use crate::storage::{AiLogRepoError, AiLogRepository};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiLogsQuery {
    pub limit: Option<u32>,
    pub before: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    Query(query): Query<AiLogsQuery>,
) -> ApiResult<AiLogListResponse> {
    let pool = storage(&state)?;
    let repo = AiLogRepository::new(pool.clone());

    let limit = query.limit.unwrap_or(50);

    let before_cursor = if let Some(before) = &query.before {
        chrono::DateTime::parse_from_rfc3339(before)
            .map_err(|_| ApiError::bad_request("invalid before cursor"))?;
        Some(before.as_str())
    } else {
        None
    };

    let data = repo
        .list(limit, before_cursor)
        .await
        .map_err(map_ai_log_error)?;

    Ok(Json(data))
}

pub async fn clear(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    let pool = storage(&state)?;
    let repo = AiLogRepository::new(pool.clone());

    repo.clear().await.map_err(map_ai_log_error)?;

    Ok(StatusCode::NO_CONTENT)
}

fn storage(state: &AppState) -> Result<&sqlx::SqlitePool, ApiError> {
    state
        .storage
        .as_ref()
        .ok_or_else(|| ApiError::internal("storage not initialized"))
}

fn map_ai_log_error(err: AiLogRepoError) -> ApiError {
    match err {
        AiLogRepoError::Database(sqlx_err) => {
            tracing::error!(raw_error = %sqlx_err, "database error handling ai logs");
            ApiError::internal("database error")
        }
    }
}
