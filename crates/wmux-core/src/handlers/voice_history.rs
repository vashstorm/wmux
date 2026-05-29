use axum::Json;
use axum::extract::{Query, State};
use serde::Deserialize;

use crate::http::{ApiError, ApiResult};
use crate::state::AppState;
use crate::storage::models::VoiceHistoryListResponse;
use crate::storage::{VoiceHistoryRepoError, VoiceHistoryRepository};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceHistoryQuery {
    pub conversation_id: Option<String>,
    pub limit: Option<i64>,
    pub before: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    Query(query): Query<VoiceHistoryQuery>,
) -> ApiResult<VoiceHistoryListResponse> {
    let conversation_id = query
        .conversation_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("conversationId is required"))?;
    let repo = VoiceHistoryRepository::new(storage(&state)?);
    let data = repo
        .list(conversation_id, query.limit, query.before.as_deref())
        .await
        .map_err(map_voice_history_error)?;

    Ok(Json(VoiceHistoryListResponse { data }))
}

pub async fn clear(State(state): State<AppState>) -> ApiResult<VoiceHistoryListResponse> {
    let repo = VoiceHistoryRepository::new(storage(&state)?);
    repo.clear().await.map_err(map_voice_history_error)?;

    Ok(Json(VoiceHistoryListResponse { data: Vec::new() }))
}

fn storage(state: &AppState) -> Result<sqlx::SqlitePool, ApiError> {
    state
        .storage
        .clone()
        .ok_or_else(|| ApiError::internal("storage not initialized"))
}

fn map_voice_history_error(err: VoiceHistoryRepoError) -> ApiError {
    match err {
        VoiceHistoryRepoError::Database(sqlx_err) => {
            tracing::error!(raw_error = %sqlx_err, "database error handling voice history");
            ApiError::internal("database error")
        }
    }
}
