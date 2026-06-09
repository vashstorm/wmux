use axum::Json;
use axum::extract::{FromRequestParts, RawPathParams, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use wmux_core::intelligence::{
    self, ActiveProvider, CommandClass, IntelligenceStore, SessionIntelligence, WindowCacheDecision,
};
use wmux_core::tmux::{Adapter, Pane, Session, TmuxError, Window};

use crate::handlers::connections::{current_config, find_connection, require_local_connection};
use crate::http::{api_error_from_ipc_error, ApiError, ApiResult};
use crate::services::sessions as svc;
use crate::state::AppState;

pub use svc::{
    AnalyzeSessionResponse, NamedRequest, PaneOperationResponse, SessionOperationResponse,
    SessionsListResponse, SplitPaneRequest, WindowOperationResponse, WindowsListResponse,
};

struct TargetContext {
    name: String,
    mode: String,
    adapter: Adapter,
}

pub struct SessionPath {
    pub target: String,
    pub session: String,
}

pub struct TargetPath {
    pub target: String,
}

pub struct WindowPath {
    pub target: String,
    pub session: String,
    pub window: String,
}

pub struct PanePath {
    pub target: String,
    pub session: String,
    pub window: String,
    pub pane: String,
}

impl<S> FromRequestParts<S> for SessionPath
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let params = RawPathParams::from_request_parts(parts, state)
            .await
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
        Ok(Self {
            target: target_path_param(&params)?,
            session: path_param(&params, "session")?,
        })
    }
}

impl<S> FromRequestParts<S> for TargetPath
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let params = RawPathParams::from_request_parts(parts, state)
            .await
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
        Ok(Self {
            target: target_path_param(&params)?,
        })
    }
}

impl<S> FromRequestParts<S> for WindowPath
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let params = RawPathParams::from_request_parts(parts, state)
            .await
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
        Ok(Self {
            target: target_path_param(&params)?,
            session: path_param(&params, "session")?,
            window: path_param(&params, "window")?,
        })
    }
}

impl<S> FromRequestParts<S> for PanePath
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let params = RawPathParams::from_request_parts(parts, state)
            .await
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
        Ok(Self {
            target: target_path_param(&params)?,
            session: path_param(&params, "session")?,
            window: path_param(&params, "window")?,
            pane: path_param(&params, "pane")?,
        })
    }
}

fn target_path_param(params: &RawPathParams) -> Result<String, ApiError> {
    path_param(params, "target").or_else(|_| path_param(params, "id"))
}

fn path_param(params: &RawPathParams, name: &'static str) -> Result<String, ApiError> {
    params
        .iter()
        .find_map(|(key, value)| (key == name).then(|| value.trim().to_string()))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request(format!("{name} path parameter is required")))
}

pub async fn list_sessions(
    State(state): State<AppState>,
    target: TargetPath,
) -> ApiResult<SessionsListResponse> {
    match svc::list_sessions(&state, target.target).await {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn create_session(
    State(state): State<AppState>,
    target: TargetPath,
    Json(payload): Json<NamedRequest>,
) -> Result<(StatusCode, Json<SessionOperationResponse>), ApiError> {
    match svc::create_session(&state, target.target, payload.name).await {
        Ok(resp) => Ok((StatusCode::CREATED, Json(resp))),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn analyze_session(
    State(state): State<AppState>,
    path: SessionPath,
) -> ApiResult<AnalyzeSessionResponse> {
    match svc::analyze_session(&state, path.target, path.session).await {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn list_windows(
    State(state): State<AppState>,
    path: SessionPath,
) -> ApiResult<WindowsListResponse> {
    match svc::list_windows(&state, path.target, path.session).await {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn create_window(
    State(state): State<AppState>,
    path: SessionPath,
    Json(payload): Json<NamedRequest>,
) -> Result<(StatusCode, Json<WindowOperationResponse>), ApiError> {
    match svc::create_window(&state, path.target, path.session, payload.name).await {
        Ok(resp) => Ok((StatusCode::CREATED, Json(resp))),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn list_panes(
    State(state): State<AppState>,
    path: WindowPath,
) -> ApiResult<svc::PanesListResponse> {
    match svc::list_panes(&state, path.target, path.session, path.window).await {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn delete_session(
    State(state): State<AppState>,
    path: SessionPath,
) -> ApiResult<svc::OperationResponse> {
    match svc::delete_session(&state, path.target, path.session).await {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn rename_session(
    State(state): State<AppState>,
    path: SessionPath,
    Json(payload): Json<NamedRequest>,
) -> ApiResult<svc::OperationResponse> {
    match svc::rename_session(&state, path.target, path.session, payload.name).await {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn delete_window(
    State(state): State<AppState>,
    path: WindowPath,
) -> ApiResult<svc::OperationResponse> {
    match svc::delete_window(&state, path.target, path.session, path.window).await {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn split_pane(
    State(state): State<AppState>,
    path: PanePath,
    Json(payload): Json<SplitPaneRequest>,
) -> Result<(StatusCode, Json<PaneOperationResponse>), ApiError> {
    match svc::split_pane(&state, path.target, path.session, path.window, path.pane, payload.horizontal).await {
        Ok(resp) => Ok((StatusCode::CREATED, Json(resp))),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn delete_pane(
    State(state): State<AppState>,
    path: PanePath,
) -> ApiResult<svc::OperationResponse> {
    match svc::delete_pane(&state, path.target, path.session, path.window, path.pane).await {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}