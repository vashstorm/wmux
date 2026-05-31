use axum::Json;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};

use crate::http::{ApiError, ApiResult};
use crate::state::AppState;
use crate::storage::AiUsageRepository;
use crate::storage::models::{AiUsageEvent, AiUsageSummary};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
    pub project_id: Option<String>,
    pub status: Option<String>,
}

fn default_limit() -> i64 {
    50
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatsResponse {
    pub data: Vec<AiUsageEvent>,
    pub summary: AiUsageSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatsCleanupResponse {
    pub deleted: u64,
}

pub async fn get_stats(
    State(state): State<AppState>,
    Query(query): Query<StatsQuery>,
) -> ApiResult<AiStatsResponse> {
    let pool = storage(&state)?;
    let repo = AiUsageRepository::new(pool.clone());

    let limit = query.limit.min(200).max(1);
    let data = repo
        .list(limit, query.project_id.as_deref(), query.status.as_deref())
        .await
        .map_err(|err| {
            tracing::error!(raw_error = %err, "database error listing AI stats");
            ApiError::internal("database error")
        })?;

    let summary = repo
        .summary(query.project_id.as_deref())
        .await
        .map_err(|err| {
            tracing::error!(raw_error = %err, "database error getting AI stats summary");
            ApiError::internal("database error")
        })?;

    Ok(Json(AiStatsResponse { data, summary }))
}

pub async fn cleanup_stale_window_events(
    State(state): State<AppState>,
    Query(query): Query<StatsQuery>,
) -> ApiResult<AiStatsCleanupResponse> {
    let pool = storage(&state)?;
    let repo = AiUsageRepository::new(pool.clone());

    let deleted = repo
        .delete_stale_window_events(query.project_id.as_deref())
        .await
        .map_err(|err| {
            tracing::error!(raw_error = %err, "database error cleaning AI stats");
            ApiError::internal("database error")
        })?;

    Ok(Json(AiStatsCleanupResponse { deleted }))
}

fn storage(state: &AppState) -> Result<&sqlx::SqlitePool, ApiError> {
    state
        .storage
        .as_ref()
        .ok_or_else(|| ApiError::internal("storage not initialized"))
}
