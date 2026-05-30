use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::Serialize;
use wmux_core::skills::OmniSkillDef;

use crate::http::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillListResponse {
    data: Vec<OmniSkillDef>,
}

pub async fn list(State(state): State<AppState>) -> ApiResult<SkillListResponse> {
    Ok(Json(SkillListResponse {
        data: state.skills.list(),
    }))
}

pub async fn get(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<OmniSkillDef> {
    let skill = state
        .skills
        .get(&id)
        .ok_or_else(|| ApiError::not_found(format!("skill not found: {id}")))?;
    Ok(Json(skill))
}

pub async fn create(
    State(state): State<AppState>,
    Json(payload): Json<OmniSkillDef>,
) -> Result<impl IntoResponse, ApiError> {
    if state.skills.get(&payload.id).is_some() {
        return Err(ApiError::conflict(format!(
            "skill already exists: {}",
            payload.id
        )));
    }
    let saved = state
        .skills
        .upsert(&payload)
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    Ok((StatusCode::CREATED, Json(saved)))
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(mut payload): Json<OmniSkillDef>,
) -> ApiResult<OmniSkillDef> {
    if payload.id != id {
        payload.id = id;
    }
    let saved = state
        .skills
        .upsert(&payload)
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    Ok(Json(saved))
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let removed = state
        .skills
        .delete(&id)
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    if removed {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::not_found(format!("skill not found: {id}")))
    }
}
