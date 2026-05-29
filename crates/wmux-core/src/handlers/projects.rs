use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use crate::http::{ApiError, ApiResult};
use crate::project_ai::generate_sanitized_html;
use crate::project_runtime::{launch_or_sync_project, snapshot_from_tmux};
use crate::state::AppState;
use crate::storage::ProjectRepository;
use crate::storage::models::{NewProject, Project, ProjectLayout, UpdateProject};
use crate::tmux::Adapter;

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

pub async fn list(State(state): State<AppState>) -> ApiResult<ProjectListResponse> {
    let pool = storage(&state)?;
    let repo = ProjectRepository::new(pool.clone());
    let projects = repo.list().await.map_err(map_project_error)?;
    Ok(Json(ProjectListResponse { data: projects }))
}

pub async fn create(
    State(state): State<AppState>,
    Json(mut payload): Json<NewProject>,
) -> Result<(StatusCode, Json<Project>), ApiError> {
    if payload.name.trim().is_empty() {
        return Err(ApiError::bad_request("project name cannot be empty"));
    }

    let pool = storage(&state)?;
    let session_to_check = payload
        .session_name
        .as_deref()
        .unwrap_or(payload.name.as_str());

    let config = state
        .store
        .snapshot()
        .map_err(|e| ApiError::internal(format!("failed to read config: {}", e)))?;
    let tmux_path = if config.tmux.path.is_empty() {
        "tmux"
    } else {
        &config.tmux.path
    };
    let adapter = Adapter::new(tmux_path);

    if let Ok(true) = adapter.has_session(session_to_check).await {
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
            .update_snapshot(&project.id, &project.layout_json, "running", &now_str)
            .await
        {
            project = updated;
        }
    }

    tracing::info!(project_id = %project.id, name = %project.name, "project created");

    Ok((StatusCode::CREATED, Json(project)))
}

pub async fn get(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Project> {
    let pool = storage(&state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo.get_by_id(&id).await.map_err(map_project_error)?;
    Ok(Json(project))
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateProject>,
) -> ApiResult<Project> {
    let pool = storage(&state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo
        .update(&id, &payload)
        .await
        .map_err(map_project_error)?;

    tracing::info!(project_id = %project.id, name = %project.name, "project updated");

    Ok(Json(project))
}

#[derive(serde::Deserialize)]
pub struct DeleteParams {
    #[serde(default)]
    pub kill_session: bool,
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<DeleteParams>,
) -> Result<Response, ApiError> {
    let pool = storage(&state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo.get_by_id(&id).await.map_err(map_project_error)?;

    repo.delete(&id).await.map_err(map_project_error)?;

    if params.kill_session {
        let session_name = if project.session_name.is_empty() {
            &project.name
        } else {
            &project.session_name
        };

        let config = state
            .store
            .snapshot()
            .map_err(|e| ApiError::internal(format!("failed to read config: {}", e)))?;
        let tmux_path = if config.tmux.path.is_empty() {
            "tmux"
        } else {
            &config.tmux.path
        };
        let adapter = Adapter::new(tmux_path);

        if let Ok(true) = adapter.has_session(session_name).await {
            let _ = adapter.kill_session(session_name).await;
        }
    }

    tracing::info!(project_id = %id, "project deleted");

    Ok(StatusCode::NO_CONTENT.into_response())
}

fn storage(state: &AppState) -> Result<sqlx::SqlitePool, ApiError> {
    state
        .storage
        .clone()
        .ok_or_else(|| ApiError::internal("storage not initialized"))
}

fn map_project_error(err: crate::storage::ProjectRepoError) -> ApiError {
    match err {
        crate::storage::ProjectRepoError::NotFound(msg) => ApiError::not_found(msg),
        crate::storage::ProjectRepoError::NameConflict(msg) => ApiError::conflict(msg),
        crate::storage::ProjectRepoError::ValidationError(msg) => ApiError::bad_request(msg),
        crate::storage::ProjectRepoError::Database(sqlx_err) => {
            tracing::error!(raw_error = %sqlx_err, "database error in projects handler");
            ApiError::internal("database error")
        }
    }
}

fn map_tmux_error(err: crate::tmux::TmuxError) -> ApiError {
    use crate::tmux::ErrorKind;
    match err.kind() {
        ErrorKind::NotFound => ApiError::not_found(err.to_string()),
        ErrorKind::BadRequest => ApiError::bad_request(err.to_string()),
    }
}

pub async fn launch(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<ProjectActionResponse> {
    let pool = storage(&state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo.get_by_id(&id).await.map_err(map_project_error)?;

    let config = state
        .store
        .snapshot()
        .map_err(|e| ApiError::internal(format!("failed to read config: {}", e)))?;
    let tmux_path = if config.tmux.path.is_empty() {
        "tmux"
    } else {
        &config.tmux.path
    };
    let adapter = Adapter::new(tmux_path);

    let layout: ProjectLayout = serde_json::from_str(&project.layout_json)
        .map_err(|e| ApiError::bad_request(format!("invalid layout JSON: {}", e)))?;

    let session_name = if project.session_name.is_empty() {
        &project.name
    } else {
        &project.session_name
    };

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

    Ok(Json(ProjectActionResponse {
        project: updated,
        operation: snapshot.operation,
    }))
}

pub async fn sync_from_tmux(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<ProjectActionResponse> {
    let pool = storage(&state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo.get_by_id(&id).await.map_err(map_project_error)?;

    let config = state
        .store
        .snapshot()
        .map_err(|e| ApiError::internal(format!("failed to read config: {}", e)))?;
    let tmux_path = if config.tmux.path.is_empty() {
        "tmux"
    } else {
        &config.tmux.path
    };
    let adapter = Adapter::new(tmux_path);

    let session_name = if project.session_name.is_empty() {
        &project.name
    } else {
        &project.session_name
    };

    let exists = adapter
        .has_session(session_name)
        .await
        .map_err(map_tmux_error)?;
    if !exists {
        return Err(ApiError::not_found(format!(
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

    Ok(Json(ProjectActionResponse {
        project: updated,
        operation: snapshot.operation,
    }))
}

pub async fn generate_ai_html(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Project> {
    let pool = storage(&state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo.get_by_id(&id).await.map_err(map_project_error)?;

    let config = state
        .store
        .snapshot()
        .map_err(|e| ApiError::internal(format!("failed to read config: {}", e)))?;

    match generate_sanitized_html(&config, &project).await {
        Ok(ai_html) => {
            let updated = repo
                .update_ai_result(&id, &ai_html, "completed", "")
                .await
                .map_err(map_project_error)?;

            tracing::info!(
                project_id = %updated.id,
                ai_html_len = ai_html.len(),
                "project AI HTML generated"
            );

            Ok(Json(updated))
        }
        Err(err) => {
            let api_err: ApiError = err.into();
            let error_msg = api_err.message().to_string();
            let _ = repo.update_ai_result(&id, "", "error", &error_msg).await;

            tracing::error!(
                project_id = %id,
                error = %error_msg,
                "project AI HTML generation failed"
            );

            Err(api_err)
        }
    }
}
