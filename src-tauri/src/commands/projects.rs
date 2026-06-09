use crate::state::IpcState;
use tauri::State;
use wmux_core::ipc_error::IpcError;
use wmux_core::services;
use wmux_core::services::projects::{ProjectActionResponse, ProjectListResponse};
use wmux_core::storage::models::{NewProject, Project, UpdateProject};

fn map_error(e: IpcError) -> String {
    format!("{}: {}", e.code(), e.message())
}

fn tmux_path_from_state(state: &IpcState) -> String {
    state
        .app_state
        .store
        .snapshot()
        .map(|c| {
            if c.tmux.path.is_empty() {
                "tmux".to_string()
            } else {
                c.tmux.path.clone()
            }
        })
        .unwrap_or_else(|_| "tmux".to_string())
}

#[tauri::command]
pub async fn list_projects(state: State<'_, IpcState>) -> Result<ProjectListResponse, String> {
    let projects = services::projects::list_projects(&state.app_state)
        .await
        .map_err(map_error)?;
    Ok(ProjectListResponse { data: projects })
}

#[tauri::command]
pub async fn create_project(
    state: State<'_, IpcState>,
    payload: NewProject,
) -> Result<Project, String> {
    let tmux_path = tmux_path_from_state(&state);
    services::projects::create_project(&state.app_state, payload, &tmux_path)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn get_project(state: State<'_, IpcState>, id: String) -> Result<Project, String> {
    services::projects::get_project(&state.app_state, &id)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn update_project(
    state: State<'_, IpcState>,
    id: String,
    payload: UpdateProject,
) -> Result<Project, String> {
    services::projects::update_project(&state.app_state, &id, payload)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn delete_project(
    state: State<'_, IpcState>,
    id: String,
    kill_session: bool,
) -> Result<(), String> {
    let tmux_path = tmux_path_from_state(&state);
    services::projects::delete_project(&state.app_state, &id, kill_session, &tmux_path)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn launch_project(
    state: State<'_, IpcState>,
    id: String,
) -> Result<ProjectActionResponse, String> {
    let tmux_path = tmux_path_from_state(&state);
    services::projects::launch_project(&state.app_state, &id, &tmux_path)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn sync_from_tmux(
    state: State<'_, IpcState>,
    id: String,
) -> Result<ProjectActionResponse, String> {
    let tmux_path = tmux_path_from_state(&state);
    services::projects::sync_from_tmux(&state.app_state, &id, &tmux_path)
        .await
        .map_err(map_error)
}

#[tauri::command]
pub async fn generate_ai_html(state: State<'_, IpcState>, id: String) -> Result<Project, String> {
    let config = state
        .app_state
        .store
        .snapshot()
        .map_err(|_| map_error(IpcError::internal("failed to read configuration")))?;
    services::projects::generate_ai_html(&state.app_state, &id, &config)
        .await
        .map_err(map_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_projects_error_mapping() {
        let error = IpcError::not_found("project not found: foo");
        let mapped = map_error(error);
        assert!(mapped.contains("project not found"));
    }

    #[tokio::test]
    async fn test_projects_error_conflict() {
        let error = IpcError::conflict("project name already exists: bar");
        let mapped = map_error(error);
        assert!(mapped.contains("project name already exists"));
    }
}
