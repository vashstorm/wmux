use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::Serialize;
use wmux_core::skills::OmniSkillDef;

use crate::http::{api_error_from_ipc_error, ApiError, ApiResult};
use crate::services::skills as svc;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillListResponse {
    pub data: Vec<OmniSkillDef>,
}

pub async fn list(State(state): State<AppState>) -> ApiResult<SkillListResponse> {
    let data = svc::list_skills(&state);
    Ok(Json(SkillListResponse { data }))
}

pub async fn get(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<OmniSkillDef> {
    match svc::get_skill(&state, &id) {
        Ok(skill) => Ok(Json(skill)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn create(
    State(state): State<AppState>,
    Json(payload): Json<OmniSkillDef>,
) -> Result<impl IntoResponse, ApiError> {
    match svc::create_skill(&state, payload) {
        Ok(saved) => Ok((StatusCode::CREATED, Json(saved))),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(mut payload): Json<OmniSkillDef>,
) -> ApiResult<OmniSkillDef> {
    if payload.id != id {
        payload.id = id.clone();
    }
    match svc::update_skill(&state, id, payload) {
        Ok(saved) => Ok(Json(saved)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    match svc::delete_skill(&state, &id) {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}