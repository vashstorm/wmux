use serde::Serialize;
use wmux_core::ipc_error::{IpcError, IpcResult};
use wmux_core::skills::OmniSkillDef;

use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillListResponse {
    pub data: Vec<OmniSkillDef>,
}

pub fn list_skills(state: &AppState) -> Vec<OmniSkillDef> {
    state.skills.list()
}

pub fn get_skill(state: &AppState, id: &str) -> IpcResult<OmniSkillDef> {
    state
        .skills
        .get(id)
        .ok_or_else(|| IpcError::not_found(format!("skill not found: {id}")))
}

pub fn create_skill(state: &AppState, skill: OmniSkillDef) -> IpcResult<OmniSkillDef> {
    if state.skills.get(&skill.id).is_some() {
        return Err(IpcError::conflict(format!(
            "skill already exists: {}",
            skill.id
        )));
    }

    let saved = state
        .skills
        .upsert(&skill)
        .map_err(|error| IpcError::bad_request(error.to_string()))?;
    Ok(saved)
}

pub fn update_skill(
    state: &AppState,
    id: String,
    mut skill: OmniSkillDef,
) -> IpcResult<OmniSkillDef> {
    if skill.id != id {
        skill.id = id;
    }

    let saved = state
        .skills
        .upsert(&skill)
        .map_err(|error| IpcError::bad_request(error.to_string()))?;
    Ok(saved)
}

pub fn delete_skill(state: &AppState, id: &str) -> IpcResult<()> {
    let removed = state
        .skills
        .delete(id)
        .map_err(|error| IpcError::bad_request(error.to_string()))?;
    if removed {
        Ok(())
    } else {
        Err(IpcError::not_found(format!("skill not found: {id}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_list_response_serialization() {
        let skill = OmniSkillDef {
            id: "test-skill".to_string(),
            name: "Test Skill".to_string(),
            description: "A test skill".to_string(),
            risk_level: crate::protocol::OmniSkillRiskLevel::Safe,
            enabled: true,
            prompt_mode: crate::skills::OmniSkillPromptMode::Description,
            parameters: serde_json::json!({}),
            full_prompt: "".to_string(),
            source_file: None,
            source_order: None,
        };
        let response = SkillListResponse { data: vec![skill] };
        let json = serde_json::to_string(&response).expect("serialize");
        assert!(json.contains("test-skill"));
    }
}
