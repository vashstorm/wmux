use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use crate::http::{ApiError, ApiResult};
use crate::state::AppState;
use crate::storage::models::{NewProject, Project, UpdateProject};
use crate::storage::ProjectRepository;

#[derive(Serialize)]
pub struct ProjectListResponse {
    pub data: Vec<Project>,
}

pub async fn list(State(state): State<AppState>) -> ApiResult<ProjectListResponse> {
    let pool = storage(&state)?;
    let repo = ProjectRepository::new(pool.clone());
    let projects = repo.list().await.map_err(map_project_error)?;
    Ok(Json(ProjectListResponse { data: projects }))
}

pub async fn create(
    State(state): State<AppState>,
    Json(payload): Json<NewProject>,
) -> Result<(StatusCode, Json<Project>), ApiError> {
    if payload.name.trim().is_empty() {
        return Err(ApiError::bad_request("project name cannot be empty"));
    }

    let pool = storage(&state)?;
    let repo = ProjectRepository::new(pool.clone());
    let project = repo.create(&payload).await.map_err(map_project_error)?;

    tracing::info!(project_id = %project.id, name = %project.name, "project created");

    Ok((StatusCode::CREATED, Json(project)))
}

pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Project> {
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
    let project = repo.update(&id, &payload).await.map_err(map_project_error)?;

    tracing::info!(project_id = %project.id, name = %project.name, "project updated");

    Ok(Json(project))
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let pool = storage(&state)?;
    let repo = ProjectRepository::new(pool.clone());
    repo.delete(&id).await.map_err(map_project_error)?;

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
        crate::storage::ProjectRepoError::Database(sqlx_err) => {
            tracing::error!(raw_error = %sqlx_err, "database error in projects handler");
            ApiError::internal("database error")
        }
    }
}