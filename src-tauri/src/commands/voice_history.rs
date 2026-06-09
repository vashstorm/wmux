use crate::state::IpcState;
use serde::Deserialize;
use tauri::State;
use wmux_core::ipc_error::IpcError;
use wmux_core::storage::OmniHistoryRepository;
use wmux_core::storage::models::OmniHistoryListResponse;

fn map_error(e: IpcError) -> String {
    format!("{}: {}", e.code(), e.message())
}

fn storage(state: &IpcState) -> Result<sqlx::SqlitePool, String> {
    state
        .app_state
        .storage
        .clone()
        .ok_or_else(|| map_error(IpcError::internal("storage not initialized")))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceHistoryQuery {
    pub conversation_id: Option<String>,
    pub limit: Option<i64>,
    pub before: Option<String>,
}

#[tauri::command]
pub async fn list_voice_history(
    state: State<'_, IpcState>,
    conversation_id: String,
    limit: Option<i64>,
    before: Option<String>,
) -> Result<OmniHistoryListResponse, String> {
    if conversation_id.trim().is_empty() {
        return Err(map_error(IpcError::bad_request(
            "conversationId is required",
        )));
    }
    let pool = storage(&state)?;
    let repo = OmniHistoryRepository::new(pool);
    let items = repo
        .list(&conversation_id, limit, before.as_deref())
        .await
        .map_err(|e| map_error(IpcError::internal(format!("database error: {}", e))))?;
    Ok(OmniHistoryListResponse { data: items })
}

#[tauri::command]
pub async fn clear_voice_history(
    state: State<'_, IpcState>,
) -> Result<OmniHistoryListResponse, String> {
    let pool = storage(&state)?;
    let repo = OmniHistoryRepository::new(pool);
    repo.clear()
        .await
        .map_err(|e| map_error(IpcError::internal(format!("database error: {}", e))))?;
    Ok(OmniHistoryListResponse { data: Vec::new() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_voice_history_response_serialization() {
        let response = OmniHistoryListResponse { data: vec![] };
        let json = serde_json::to_string(&response).expect("serialize");
        assert!(json.contains("data"));
    }
}
