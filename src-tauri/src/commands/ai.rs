use crate::state::IpcState;
use serde::{Deserialize, Serialize};
use tauri::State;
use wmux_core::ipc_error::IpcError;
use wmux_core::storage::{
    AiLogRepository, AiUsageRepository,
    models::{AiLogListResponse, AiUsageEvent, AiUsageSummary},
};

fn map_error(e: IpcError) -> String {
    format!("{}: {}", e.code(), e.message())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatsResponse {
    pub data: Vec<AiUsageEvent>,
    pub summary: AiUsageSummary,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatsCleanupResponse {
    pub deleted: u64,
}

fn storage(state: &IpcState) -> Result<sqlx::SqlitePool, String> {
    state
        .app_state
        .storage
        .clone()
        .ok_or_else(|| map_error(IpcError::internal("storage not initialized")))
}

#[tauri::command]
pub async fn list_ai_logs(
    state: State<'_, IpcState>,
    limit: Option<u32>,
    before: Option<String>,
) -> Result<AiLogListResponse, String> {
    let pool = storage(&state)?;
    let repo = AiLogRepository::new(pool.clone());
    let limit = limit.unwrap_or(50);
    let before_cursor = before.as_deref();
    repo.list(limit, before_cursor)
        .await
        .map_err(|e| map_error(IpcError::internal(format!("database error: {}", e))))
}

#[tauri::command]
pub async fn clear_ai_logs(state: State<'_, IpcState>) -> Result<(), String> {
    let pool = storage(&state)?;
    let repo = AiLogRepository::new(pool.clone());
    repo.clear()
        .await
        .map_err(|e| map_error(IpcError::internal(format!("database error: {}", e))))
}

#[tauri::command]
pub async fn get_ai_stats(
    state: State<'_, IpcState>,
    limit: Option<i64>,
    project_id: Option<String>,
    status: Option<String>,
) -> Result<AiStatsResponse, String> {
    let pool = storage(&state)?;
    let repo = AiUsageRepository::new(pool.clone());
    let limit = limit.unwrap_or(50).min(200).max(1);
    let data = repo
        .list(limit, project_id.as_deref(), status.as_deref())
        .await
        .map_err(|e| map_error(IpcError::internal(format!("database error: {}", e))))?;
    let summary = repo
        .summary(project_id.as_deref())
        .await
        .map_err(|e| map_error(IpcError::internal(format!("database error: {}", e))))?;
    Ok(AiStatsResponse { data, summary })
}

#[tauri::command]
pub async fn cleanup_stale_window_events(
    state: State<'_, IpcState>,
    project_id: Option<String>,
) -> Result<AiStatsCleanupResponse, String> {
    let pool = storage(&state)?;
    let repo = AiUsageRepository::new(pool.clone());
    let deleted = repo
        .delete_stale_window_events(project_id.as_deref())
        .await
        .map_err(|e| map_error(IpcError::internal(format!("database error: {}", e))))?;
    Ok(AiStatsCleanupResponse { deleted })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ai_stats_response_serialization() {
        let response = AiStatsResponse {
            data: vec![],
            summary: AiUsageSummary {
                total_events: 0,
                total_success: 0,
                total_error: 0,
                total_duration_ms: 0,
                total_prompt_tokens: 0,
                total_completion_tokens: 0,
                total_tokens: 0,
                total_estimated_cost: 0.0,
            },
        };
        let json = serde_json::to_string(&response).expect("serialize");
        assert!(json.contains("data"));
    }
}
