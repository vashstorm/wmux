use std::time::Duration;
use wmux_core::ipc_error::{IpcError, IpcResult};
use wmux_core::protocol::OmniTarget;
use wmux_core::voice::{OmniSkillExecutor, is_dangerous};

pub use wmux_core::voice::OmniSkillExecution;

use crate::state::AppState;

const TOOL_EXECUTION_TIMEOUT_SECONDS: u64 = 15;

pub async fn execute_voice_action(
    state: &AppState,
    skill: &str,
    params: serde_json::Value,
    confirmed: bool,
) -> IpcResult<OmniSkillExecution> {
    let executor = OmniSkillExecutor::new(state.clone());
    let execution = async {
        if confirmed {
            executor.execute_preconfirmed(skill, params).await
        } else {
            executor.execute(skill, params).await
        }
    };
    tokio::time::timeout(
        Duration::from_secs(TOOL_EXECUTION_TIMEOUT_SECONDS),
        execution,
    )
    .await
    .map_err(|_| {
        IpcError::internal(format!(
            "tool execution timed out after {}s: {}",
            TOOL_EXECUTION_TIMEOUT_SECONDS, skill
        ))
    })?
    .map_err(|e| IpcError::internal(e.to_string()))
}

pub fn check_skill_danger(skill: &str, params: &serde_json::Value) -> bool {
    is_dangerous(skill, params)
}

pub fn skill_uses_tmux_target(skill: &str) -> bool {
    matches!(
        skill,
        "list_sessions"
            | "create_session"
            | "rename_session"
            | "delete_session"
            | "send_to_pane"
            | "read_pane_output"
            | "create_window"
            | "rename_window"
            | "split_pane"
            | "focus_pane"
            | "run_project"
            | "delete_window"
            | "kill_pane"
            | "clear_pane"
            | "analyze_session"
    )
}

pub fn route_uses_tmux_target(route_id: &str) -> bool {
    route_id.starts_with("sessions.")
        || route_id.starts_with("windows.")
        || route_id.starts_with("panes.")
}

pub fn has_string_alias(params: &serde_json::Value, fields: &[&str]) -> bool {
    fields.iter().any(|field| {
        params
            .get(*field)
            .and_then(|value| value.as_str())
            .is_some_and(|value| !value.trim().is_empty())
    })
}

pub fn apply_session_context_defaults(
    skill: &str,
    mut params: serde_json::Value,
    target_name: Option<&str>,
) -> serde_json::Value {
    let Some(target_name) = target_name.filter(|value| !value.trim().is_empty()) else {
        return params;
    };

    if skill == "invoke_backend_route" {
        return apply_context_to_route_params(params, target_name);
    }

    if !skill_uses_tmux_target(skill) {
        return params;
    }

    let Some(mut object) = params.as_object().cloned() else {
        return params;
    };

    if !has_string_alias(
        &serde_json::Value::Object(object.clone()),
        &["target_name", "targetName"],
    ) {
        object.insert(
            "target_name".to_string(),
            serde_json::Value::String(target_name.to_string()),
        );
    }
    serde_json::Value::Object(object)
}

fn apply_context_to_route_params(
    params: serde_json::Value,
    target_name: &str,
) -> serde_json::Value {
    let route_id = params
        .get("route_id")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if !route_uses_tmux_target(route_id) {
        return params;
    }
    let Some(mut object) = params.as_object().cloned() else {
        return params;
    };
    let route_params = object
        .get("params")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let Some(mut route_object) = route_params.as_object().cloned() else {
        return serde_json::Value::Object(object);
    };
    if !has_string_alias(
        &serde_json::Value::Object(route_object.clone()),
        &["target_name", "targetName"],
    ) {
        route_object.insert(
            "target_name".to_string(),
            serde_json::Value::String(target_name.to_string()),
        );
        object.insert(
            "params".to_string(),
            serde_json::Value::Object(route_object),
        );
    }
    serde_json::Value::Object(object)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_uses_tmux_target_identifies_correct_skills() {
        assert!(skill_uses_tmux_target("list_sessions"));
        assert!(skill_uses_tmux_target("create_session"));
        assert!(skill_uses_tmux_target("delete_session"));
        assert!(skill_uses_tmux_target("send_to_pane"));
        assert!(!skill_uses_tmux_target("unknown_skill"));
    }

    #[test]
    fn route_uses_tmux_target_identifies_routes() {
        assert!(route_uses_tmux_target("sessions.list"));
        assert!(route_uses_tmux_target("windows.create"));
        assert!(route_uses_tmux_target("panes.split"));
        assert!(!route_uses_tmux_target("config.get"));
    }

    #[test]
    fn has_string_alias_works() {
        let params = serde_json::json!({
            "target_name": "local"
        });
        assert!(has_string_alias(&params, &["target_name", "targetName"]));

        let params2 = serde_json::json!({
            "other": "value"
        });
        assert!(!has_string_alias(&params2, &["target_name", "targetName"]));
    }

    #[test]
    fn apply_session_context_defaults_adds_target() {
        let params = serde_json::json!({});
        let result = apply_session_context_defaults("list_sessions", params, Some("local"));
        assert_eq!(
            result.get("target_name").and_then(|v| v.as_str()),
            Some("local")
        );
    }

    #[test]
    fn apply_session_context_defaults_skips_non_tmux_skills() {
        let params = serde_json::json!({});
        let result = apply_session_context_defaults("get_time", params, Some("local"));
        assert!(result.get("target_name").is_none());
    }
}
