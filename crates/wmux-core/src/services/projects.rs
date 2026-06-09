use serde::Serialize;
use std::time::Instant;
use wmux_core::ipc_error::{IpcError, IpcResult};
use wmux_core::project_ai::{generate_sanitized_html, get_active_provider};
use wmux_core::project_runtime::{launch_or_sync_project, snapshot_from_tmux};
use wmux_core::storage::models::{
    NewAiUsageEvent, NewProject, Project, ProjectLayout, UpdateProject,
};
use wmux_core::storage::{AiUsageRepository, ProjectRepository};
use wmux_core::tmux::Adapter;

use crate::state::AppState;

#[derive(Serialize)]
pub struct ProjectListResponse {
    pub data: Vec<Project>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionResponse {
    pub project: Project,
    pub operation: String,
}

pub async fn list_projects(state: &AppState) -> IpcResult<Vec<Project>> {
    let pool = storage(state)?;
    let repo = ProjectRepository::new(pool.clone());
    let projects = repo.list().await.map_err(map_project_error)?;
    Ok(projects)
}

pub async fn get_project(state: &AppState, id: &str) -> IpcResult<Project> {
    let pool = storage(state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo.get_by_id(id).await.map_err(map_project_error)?;
    Ok(project)
}

pub async fn create_project(
    state: &AppState,
    payload: NewProject,
    tmux_path: &str,
) -> IpcResult<Project> {
    let mut payload = payload;
    if payload.name.trim().is_empty() {
        return Err(IpcError::bad_request("project name cannot be empty"));
    }

    let pool = storage(state)?;
    let session_to_check = payload
        .session_name
        .as_deref()
        .unwrap_or(payload.name.as_str());

    let adapter = Adapter::new(tmux_path);

    let has_session = adapter.has_session(session_to_check).await;
    if let Ok(true) = has_session {
        if let Ok(snapshot) = snapshot_from_tmux(&adapter, session_to_check).await {
            payload.layout_json = Some(snapshot.layout_json);
        }
    }

    let repo = ProjectRepository::new(pool.clone());
    let mut project = repo.create(&payload).await.map_err(map_project_error)?;

    if let Ok(true) = adapter.has_session(session_to_check).await {
        let now_str = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .expect("RFC3339 format is infallible");
        if let Ok(updated) = repo
            .update_snapshot(
                &project.id,
                &project.layout_json,
                "running",
                &now_str,
                &project,
            )
            .await
        {
            project = updated;
        }
    }

    tracing::info!(project_id = %project.id, name = %project.name, "project created");
    Ok(project)
}

pub async fn update_project(
    state: &AppState,
    id: &str,
    payload: UpdateProject,
) -> IpcResult<Project> {
    let pool = storage(state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo.update(id, &payload).await.map_err(map_project_error)?;

    tracing::info!(project_id = %project.id, name = %project.name, "project updated");
    Ok(project)
}

pub async fn delete_project(
    state: &AppState,
    id: &str,
    kill_session: bool,
    tmux_path: &str,
) -> IpcResult<()> {
    let pool = storage(state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo.get_by_id(id).await.map_err(map_project_error)?;

    repo.delete(id).await.map_err(map_project_error)?;

    if kill_session {
        let session_name = session_name_for(&project);
        let adapter = Adapter::new(tmux_path);
        if let Ok(true) = adapter.has_session(session_name).await {
            let _ = adapter.kill_session(session_name).await;
        }
    }

    tracing::info!(project_id = %id, "project deleted");
    Ok(())
}

pub async fn launch_project(
    state: &AppState,
    id: &str,
    tmux_path: &str,
) -> IpcResult<ProjectActionResponse> {
    let pool = storage(state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo.get_by_id(id).await.map_err(map_project_error)?;

    let adapter = Adapter::new(tmux_path);

    let layout: ProjectLayout = serde_json::from_str(&project.layout_json)
        .map_err(|e| IpcError::bad_request(format!("invalid layout JSON: {}", e)))?;

    let session_name = session_name_for(&project);

    let snapshot = launch_or_sync_project(&adapter, session_name, &layout)
        .await
        .map_err(map_tmux_error)?;

    let updated = repo
        .update_snapshot(
            &id,
            &snapshot.layout_json,
            &snapshot.status,
            &time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .expect("RFC3339 format is infallible"),
            &project,
        )
        .await
        .map_err(map_project_error)?;

    tracing::info!(
        project_id = %updated.id,
        operation = %snapshot.operation,
        window_count = snapshot.window_count,
        pane_count = snapshot.pane_count,
        "project launched"
    );

    Ok(ProjectActionResponse {
        project: updated,
        operation: snapshot.operation,
    })
}

pub async fn sync_from_tmux(
    state: &AppState,
    id: &str,
    tmux_path: &str,
) -> IpcResult<ProjectActionResponse> {
    let pool = storage(state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo.get_by_id(id).await.map_err(map_project_error)?;

    let adapter = Adapter::new(tmux_path);
    let session_name = session_name_for(&project);

    let exists = adapter
        .has_session(session_name)
        .await
        .map_err(map_tmux_error)?;
    if !exists {
        return Err(IpcError::not_found(format!(
            "tmux session '{}' not found",
            session_name
        )));
    }

    let snapshot = snapshot_from_tmux(&adapter, session_name)
        .await
        .map_err(map_tmux_error)?;

    let updated = repo
        .update_snapshot(
            &id,
            &snapshot.layout_json,
            &snapshot.status,
            &time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .expect("RFC3339 format is infallible"),
            &project,
        )
        .await
        .map_err(map_project_error)?;

    tracing::info!(
        project_id = %updated.id,
        operation = %snapshot.operation,
        window_count = snapshot.window_count,
        pane_count = snapshot.pane_count,
        "project synced from tmux"
    );

    Ok(ProjectActionResponse {
        project: updated,
        operation: snapshot.operation,
    })
}

pub async fn generate_ai_html(
    state: &AppState,
    id: &str,
    config: &wmux_core::config::Config,
) -> IpcResult<Project> {
    let pool = storage(state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo.get_by_id(id).await.map_err(map_project_error)?;

    let provider_for_log = get_active_provider(&config.intelligence).ok();
    let started_at = Instant::now();

    match generate_sanitized_html(config, &project).await {
        Ok(ai_html) => {
            let duration_ms = started_at.elapsed().as_millis() as i64;
            let updated = repo
                .update_ai_result(&id, &ai_html, "completed", "", &project)
                .await
                .map_err(map_project_error)?;
            record_project_ai_usage_event(
                &pool,
                &project,
                provider_for_log.as_ref(),
                "success",
                duration_ms,
                Some(ai_html.len()),
                Some(ai_html.as_str()),
                None,
            )
            .await;
            tracing::info!(
                project_id = %updated.id,
                ai_html_len = ai_html.len(),
                "project AI HTML generated"
            );
            Ok(updated)
        }
        Err(err) => {
            let duration_ms = started_at.elapsed().as_millis() as i64;
            let error_msg = err.to_string();
            let _ = repo
                .update_ai_result(&id, "", "error", &error_msg, &project)
                .await;
            record_project_ai_usage_event(
                &pool,
                &project,
                provider_for_log.as_ref(),
                "error",
                duration_ms,
                None,
                None,
                Some(error_msg.as_str()),
            )
            .await;
            tracing::error!(
                project_id = %id,
                error = %err,
                "project AI HTML generation failed"
            );
            Err(IpcError::from_ai_error(&err))
        }
    }
}

fn storage(state: &AppState) -> IpcResult<sqlx::SqlitePool> {
    state
        .storage
        .clone()
        .ok_or_else(|| IpcError::internal("storage not initialized"))
}

fn session_name_for(project: &Project) -> &str {
    if project.session_name.is_empty() {
        &project.name
    } else {
        &project.session_name
    }
}

fn map_project_error(err: crate::storage::ProjectRepoError) -> IpcError {
    match err {
        crate::storage::ProjectRepoError::NotFound(msg) => IpcError::not_found(msg),
        crate::storage::ProjectRepoError::NameConflict(msg) => IpcError::conflict(msg),
        crate::storage::ProjectRepoError::ValidationError(msg) => IpcError::bad_request(msg),
        crate::storage::ProjectRepoError::Database(_) => IpcError::internal("database error"),
    }
}

fn map_tmux_error(err: crate::tmux::TmuxError) -> IpcError {
    use crate::tmux::ErrorKind;
    match err.kind() {
        ErrorKind::NotFound => IpcError::not_found(err.to_string()),
        ErrorKind::BadRequest => IpcError::bad_request(err.to_string()),
    }
}

async fn record_project_ai_usage_event(
    pool: &sqlx::SqlitePool,
    project: &Project,
    provider: Option<&wmux_core::config::IntelligenceProviderConfig>,
    status: &str,
    duration_ms: i64,
    ai_html_len: Option<usize>,
    ai_html: Option<&str>,
    error_message: Option<&str>,
) {
    let provider_name = provider
        .map(|provider| {
            if provider.provider.trim().is_empty() {
                provider.name.clone()
            } else {
                provider.provider.clone()
            }
        })
        .unwrap_or_default();
    let model = provider
        .map(|provider| provider.model.clone())
        .unwrap_or_default();
    let session_name = if project.session_name.trim().is_empty() {
        project.name.clone()
    } else {
        project.session_name.clone()
    };
    let summary = if status == "success" {
        "Project AI HTML generated"
    } else {
        "Project AI HTML generation failed"
    };
    let response_json = serde_json::json!({
        "operation": "generate_ai_html",
        "summary": summary,
        "projectId": project.id,
        "projectName": project.name,
        "aiHtmlBytes": ai_html_len,
        "aiHtml": ai_html,
    })
    .to_string();

    let repo = AiUsageRepository::new(pool.clone());
    let event = NewAiUsageEvent {
        project_id: Some(project.id.clone()),
        provider: provider_name,
        model,
        target_name: "project".to_string(),
        session_name,
        status: status.to_string(),
        duration_ms,
        prompt_tokens: None,
        completion_tokens: None,
        total_tokens: None,
        estimated_cost: None,
        error_message: error_message.map(ToString::to_string),
        window_number: None,
        response_json: Some(response_json),
    };
    if let Err(err) = repo.insert(&event).await {
        tracing::error!(project_id = %project.id, raw_error = %err, "failed to record project AI usage event");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_name_for_returns_project_name_when_empty() {
        let project = Project {
            id: "1".to_string(),
            name: "myproject".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: "".to_string(),
            status: "running".to_string(),
            workdir: "".to_string(),
            layout_json: "{}".to_string(),
            details_json: "".to_string(),
            progress_json: "".to_string(),
            ai_html: "".to_string(),
            ai_status: "".to_string(),
            ai_error: "".to_string(),
            last_synced_at: None,
            schema_version: 1,
            created_at: "".to_string(),
            updated_at: "".to_string(),
        };
        assert_eq!(session_name_for(&project), "myproject");
    }

    #[test]
    fn session_name_for_returns_session_name_when_set() {
        let project = Project {
            id: "1".to_string(),
            name: "myproject".to_string(),
            path: "".to_string(),
            description: "".to_string(),
            session_name: "tmux-session".to_string(),
            status: "running".to_string(),
            workdir: "".to_string(),
            layout_json: "{}".to_string(),
            details_json: "".to_string(),
            progress_json: "".to_string(),
            ai_html: "".to_string(),
            ai_status: "".to_string(),
            ai_error: "".to_string(),
            last_synced_at: None,
            schema_version: 1,
            created_at: "".to_string(),
            updated_at: "".to_string(),
        };
        assert_eq!(session_name_for(&project), "tmux-session");
    }
}
