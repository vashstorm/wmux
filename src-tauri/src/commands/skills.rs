use tauri::State;
use wmux_core::ipc_error::IpcError;
use wmux_core::services;
use wmux_core::skills::OmniSkillDef;
use crate::state::IpcState;

fn map_error(e: IpcError) -> String {
    format!("{}: {}", e.code(), e.message())
}

#[tauri::command]
pub async fn list_skills(state: State<'_, IpcState>) -> Result<Vec<OmniSkillDef>, String> {
    Ok(services::skills::list_skills(&state.app_state))
}

#[tauri::command]
pub async fn create_skill(
    state: State<'_, IpcState>,
    skill: OmniSkillDef,
) -> Result<OmniSkillDef, String> {
    services::skills::create_skill(&state.app_state, skill)
        .map_err(map_error)
}

#[tauri::command]
pub async fn get_skill(
    state: State<'_, IpcState>,
    id: String,
) -> Result<OmniSkillDef, String> {
    services::skills::get_skill(&state.app_state, &id)
        .map_err(map_error)
}

#[tauri::command]
pub async fn update_skill(
    state: State<'_, IpcState>,
    id: String,
    skill: OmniSkillDef,
) -> Result<OmniSkillDef, String> {
    services::skills::update_skill(&state.app_state, id, skill)
        .map_err(map_error)
}

#[tauri::command]
pub async fn delete_skill(
    state: State<'_, IpcState>,
    id: String,
) -> Result<(), String> {
    services::skills::delete_skill(&state.app_state, &id)
        .map_err(map_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_skills_error_mapping() {
        let error = IpcError::not_found("skill not found: foo");
        let mapped = map_error(error);
        assert!(mapped.contains("not_found"));
        assert!(mapped.contains("skill not found"));
    }

    #[tokio::test]
    async fn test_skills_error_conflict() {
        let error = IpcError::conflict("skill already exists: bar");
        let mapped = map_error(error);
        assert!(mapped.contains("conflict"));
        assert!(mapped.contains("skill already exists"));
    }
}