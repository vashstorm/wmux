use axum::Extension;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::http::{api_error_from_ipc_error, ApiError, ApiResult};
use crate::services::connections as svc;
use crate::state::{AppState, CachedConfig};

pub type RuntimeConnection = svc::RuntimeConnection;
pub type ConnectionHealthResponse = svc::ConnectionHealthResponse;

#[derive(serde::Serialize)]
pub struct ConnectionsListResponse {
    pub data: Vec<RuntimeConnection>,
}

#[derive(serde::Serialize)]
pub struct ConnectionHealthListResponse {
    pub data: Vec<ConnectionHealthResponse>,
}

pub async fn list(State(state): State<AppState>) -> ApiResult<ConnectionsListResponse> {
    match Ok(svc::list_connections(&state)) {
        Ok(data) => Ok(Json(ConnectionsListResponse { data })),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn list_health(
    State(state): State<AppState>,
    Extension(cached): Extension<CachedConfig>,
) -> ApiResult<ConnectionHealthListResponse> {
    let data = svc::list_connections_health(&state, &cached.0.tmux.path).await;
    Ok(Json(ConnectionHealthListResponse { data }))
}

pub async fn create(
    State(state): State<AppState>,
    Json(payload): Json<RuntimeConnection>,
) -> Result<(StatusCode, Json<RuntimeConnection>), ApiError> {
    match svc::create_connection(&state, payload) {
        Ok(created) => Ok((StatusCode::CREATED, Json(created))),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<RuntimeConnection> {
    match svc::get_connection(&state, &id) {
        Ok(conn) => Ok(Json(conn)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn health(
    State(state): State<AppState>,
    Extension(cached): Extension<CachedConfig>,
    Path(id): Path<String>,
) -> ApiResult<svc::ConnectionHealthResponse> {
    match svc::get_connection_health(&state, &id, &cached.0.tmux.path).await {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<RuntimeConnection>,
) -> ApiResult<RuntimeConnection> {
    match svc::update_connection(&state, &id, payload) {
        Ok(updated) => Ok(Json(updated)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    match svc::delete_connection(&state, &id) {
        Ok(()) => Ok(StatusCode::NO_CONTENT.into_response()),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub fn find_connection(state: &AppState, id: &str) -> Result<svc::RuntimeConnection, ApiError> {
    svc::get_connection(state, id).map_err(api_error_from_ipc_error)
}

pub fn require_local_connection(connection: &wmux_core::config::ConnectionConfig) -> Result<(), ApiError> {
    svc::require_local_connection(connection).map_err(api_error_from_ipc_error)
}

pub fn current_config(state: &AppState) -> Result<wmux_core::config::Config, ApiError> {
    svc::current_config(state).map_err(api_error_from_ipc_error)
}