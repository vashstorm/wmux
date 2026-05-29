use axum::Json;
use axum::extract::{Query, State};
use serde::Deserialize;

use crate::http::{ApiError, ApiResult};
use crate::state::AppState;
use crate::storage::models::OmniHistoryListResponse;
use crate::storage::{OmniHistoryRepoError, OmniHistoryRepository};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmniHistoryQuery {
    pub conversation_id: Option<String>,
    pub limit: Option<i64>,
    pub before: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    Query(query): Query<OmniHistoryQuery>,
) -> ApiResult<OmniHistoryListResponse> {
    let conversation_id = query
        .conversation_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("conversationId is required"))?;
    let repo = OmniHistoryRepository::new(storage(&state)?);
    let data = repo
        .list(conversation_id, query.limit, query.before.as_deref())
        .await
        .map_err(map_omni_history_error)?;

    Ok(Json(OmniHistoryListResponse { data }))
}

pub async fn clear(State(state): State<AppState>) -> ApiResult<OmniHistoryListResponse> {
    let repo = OmniHistoryRepository::new(storage(&state)?);
    repo.clear().await.map_err(map_omni_history_error)?;

    Ok(Json(OmniHistoryListResponse { data: Vec::new() }))
}

fn storage(state: &AppState) -> Result<sqlx::SqlitePool, ApiError> {
    state
        .storage
        .clone()
        .ok_or_else(|| ApiError::internal("storage not initialized"))
}

fn map_omni_history_error(err: OmniHistoryRepoError) -> ApiError {
    match err {
        OmniHistoryRepoError::Database(sqlx_err) => {
            tracing::error!(raw_error = %sqlx_err, "database error handling voice history");
            ApiError::internal("database error")
        }
    }
}
