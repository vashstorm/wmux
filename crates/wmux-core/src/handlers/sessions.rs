use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use wmux_core::config::ConnectionConfig;
use wmux_core::tmux::{Adapter, Pane, Session, TmuxError, Window};

use crate::handlers::connections::{current_config, find_connection, require_local_connection};
use crate::http::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsListResponse {
    connection_id: String,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    data: Vec<Session>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsListResponse {
    connection_id: String,
    session: String,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    data: Vec<Window>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanesListResponse {
    connection_id: String,
    session: String,
    window: String,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    data: Vec<Pane>,
}

#[derive(Deserialize)]
pub struct NamedRequest {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPaneRequest {
    horizontal: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOperationResponse {
    connection_id: String,
    operation: &'static str,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    data: Session,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowOperationResponse {
    connection_id: String,
    session: String,
    operation: &'static str,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    data: Window,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneOperationResponse {
    connection_id: String,
    session: String,
    window: String,
    operation: &'static str,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    data: Pane,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResponse {
    connection_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    session: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    window: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pane: String,
    operation: &'static str,
    mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    adapter_path: String,
    status: &'static str,
}

pub async fn list_sessions(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<SessionsListResponse> {
    let (connection, adapter) =
        connection_and_adapter_for_session_marker(&state, &id, None, true).await?;
    let data = adapter.list_sessions().await.map_err(session_error)?;
    Ok(Json(SessionsListResponse {
        connection_id: connection.id,
        mode: connection.connection_type,
        adapter_path: adapter.path().to_string(),
        data,
    }))
}

pub async fn create_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<NamedRequest>,
) -> Result<(StatusCode, Json<SessionOperationResponse>), ApiError> {
    let (connection, adapter) =
        connection_and_adapter_for_session_marker(&state, &id, None, true).await?;
    let data = adapter
        .new_session(payload.name.trim())
        .await
        .map_err(session_error)?;
    tracing::info!(connection_id = %connection.id, session = %payload.name, "session created");
    Ok((
        StatusCode::CREATED,
        Json(SessionOperationResponse {
            connection_id: connection.id,
            operation: "create_session",
            mode: connection.connection_type,
            adapter_path: adapter.path().to_string(),
            data,
        }),
    ))
}

pub async fn analyze_session() -> ApiError {
    ApiError::not_implemented("session analysis is not implemented")
}

pub async fn list_windows(
    State(state): State<AppState>,
    Path((id, session)): Path<(String, String)>,
) -> ApiResult<WindowsListResponse> {
    let (connection, adapter) =
        connection_and_adapter_for_session_marker(&state, &id, Some(&session), false).await?;
    let data = adapter
        .list_windows(&session)
        .await
        .map_err(session_error)?;
    Ok(Json(WindowsListResponse {
        connection_id: connection.id,
        session,
        mode: connection.connection_type,
        adapter_path: adapter.path().to_string(),
        data,
    }))
}

pub async fn create_window(
    State(state): State<AppState>,
    Path((id, session)): Path<(String, String)>,
    Json(payload): Json<NamedRequest>,
) -> Result<(StatusCode, Json<WindowOperationResponse>), ApiError> {
    let (connection, adapter) =
        connection_and_adapter_for_session_marker(&state, &id, Some(&session), false).await?;
    let data = adapter
        .new_window(&session, payload.name.trim())
        .await
        .map_err(session_error)?;
    tracing::info!(connection_id = %connection.id, session = %session, window = %payload.name, "window created");
    Ok((
        StatusCode::CREATED,
        Json(WindowOperationResponse {
            connection_id: connection.id,
            session,
            operation: "create_window",
            mode: connection.connection_type,
            adapter_path: adapter.path().to_string(),
            data,
        }),
    ))
}

pub async fn list_panes(
    State(state): State<AppState>,
    Path((id, session, window)): Path<(String, String, String)>,
) -> ApiResult<PanesListResponse> {
    let (connection, adapter) =
        connection_and_adapter_for_session_marker(&state, &id, Some(&session), false).await?;
    let data = adapter
        .list_panes(&session, &window)
        .await
        .map_err(session_error)?;
    Ok(Json(PanesListResponse {
        connection_id: connection.id,
        session,
        window,
        mode: connection.connection_type,
        adapter_path: adapter.path().to_string(),
        data,
    }))
}

pub async fn delete_session(
    State(state): State<AppState>,
    Path((id, session)): Path<(String, String)>,
) -> ApiResult<OperationResponse> {
    write_session_operation(
        state,
        id,
        session,
        String::new(),
        String::new(),
        "delete_session",
    )
    .await
}

pub async fn rename_session(
    State(state): State<AppState>,
    Path((id, session)): Path<(String, String)>,
    Json(payload): Json<NamedRequest>,
) -> ApiResult<OperationResponse> {
    let (connection, adapter) =
        connection_and_adapter_for_session_marker(&state, &id, Some(&session), false).await?;
    adapter
        .rename_session(&session, payload.name.trim())
        .await
        .map_err(session_error)?;
    tracing::info!(connection_id = %connection.id, session = %session, new_name = %payload.name, "session renamed");
    Ok(Json(OperationResponse {
        connection_id: connection.id,
        session,
        window: String::new(),
        pane: String::new(),
        operation: "rename_session",
        mode: connection.connection_type,
        adapter_path: adapter.path().to_string(),
        status: "accepted",
    }))
}

pub async fn delete_window(
    State(state): State<AppState>,
    Path((id, session, window)): Path<(String, String, String)>,
) -> ApiResult<OperationResponse> {
    write_session_operation(state, id, session, window, String::new(), "delete_window").await
}

pub async fn split_pane(
    State(state): State<AppState>,
    Path((id, session, window, pane)): Path<(String, String, String, String)>,
    Json(payload): Json<SplitPaneRequest>,
) -> Result<(StatusCode, Json<PaneOperationResponse>), ApiError> {
    let (connection, adapter) =
        connection_and_adapter_for_session_marker(&state, &id, Some(&session), false).await?;
    let target = build_pane_target(&session, &window, &pane);
    let data = adapter
        .split_window(&target, payload.horizontal)
        .await
        .map_err(session_error)?;
    tracing::info!(connection_id = %connection.id, session = %session, window = %window, pane = %pane, "pane split");
    Ok((
        StatusCode::CREATED,
        Json(PaneOperationResponse {
            connection_id: connection.id,
            session,
            window,
            operation: "split_pane",
            mode: connection.connection_type,
            adapter_path: adapter.path().to_string(),
            data,
        }),
    ))
}

pub async fn delete_pane(
    State(state): State<AppState>,
    Path((id, session, window, pane)): Path<(String, String, String, String)>,
) -> ApiResult<OperationResponse> {
    write_session_operation(state, id, session, window, pane, "delete_pane").await
}

async fn write_session_operation(
    state: AppState,
    id: String,
    session: String,
    window: String,
    pane: String,
    operation: &'static str,
) -> ApiResult<OperationResponse> {
    let (connection, adapter) =
        connection_and_adapter_for_session_marker(&state, &id, Some(&session), false).await?;

    match operation {
        "delete_session" => adapter.kill_session(&session).await,
        "delete_window" => {
            adapter
                .kill_window(&build_window_target(&session, &window))
                .await
        }
        "delete_pane" => {
            adapter
                .kill_pane(&build_pane_target(&session, &window, &pane))
                .await
        }
        _ => Err(TmuxError::InvalidInput { field: "operation" }),
    }
    .map_err(session_error)?;

    tracing::info!(connection_id = %connection.id, %operation, "session operation accepted");

    Ok(Json(OperationResponse {
        connection_id: connection.id,
        session,
        window,
        pane,
        operation,
        mode: connection.connection_type,
        adapter_path: adapter.path().to_string(),
        status: "accepted",
    }))
}

async fn connection_and_adapter_for_session_marker(
    state: &AppState,
    id: &str,
    session_marker: Option<&str>,
    allow_single_local_without_session_marker: bool,
) -> Result<(ConnectionConfig, Adapter), ApiError> {
    if let Some(connection) = find_connection_exact(state, id)? {
        require_local_connection(&connection)?;
        return Ok((connection, adapter(state)?));
    }

    let adapter = adapter(state)?;
    if let Some(connection) = single_local_connection(state)? {
        if let Some(marker) = session_marker.filter(|value| !value.trim().is_empty()) {
            if adapter.has_session(marker).await.map_err(session_error)? {
                tracing::info!(
                    session = %marker,
                    resolved_connection_id = %connection.id,
                    "resolved local connection from tmux session name marker"
                );
                return Ok((connection, adapter));
            }
        }

        if !id.trim().is_empty() && adapter.has_session(id).await.map_err(session_error)? {
            tracing::info!(
                session = %id,
                resolved_connection_id = %connection.id,
                "resolved local connection from tmux session name marker"
            );
            return Ok((connection, adapter));
        }

        if allow_single_local_without_session_marker {
            tracing::info!(
                connection_marker = %id,
                resolved_connection_id = %connection.id,
                "resolved unique local connection for session listing"
            );
            return Ok((connection, adapter));
        }
    }

    let connection = find_connection(state, id)?;
    require_local_connection(&connection)?;
    Ok((connection, adapter))
}

fn find_connection_exact(state: &AppState, id: &str) -> Result<Option<ConnectionConfig>, ApiError> {
    Ok(current_config(state)?
        .connections
        .into_iter()
        .find(|connection| connection.id == id))
}

fn single_local_connection(state: &AppState) -> Result<Option<ConnectionConfig>, ApiError> {
    let config = current_config(state)?;
    let mut local_connections = config
        .connections
        .into_iter()
        .filter(|connection| connection.connection_type.eq_ignore_ascii_case("local"));
    let Some(connection) = local_connections.next() else {
        return Ok(None);
    };

    Ok(local_connections.next().is_none().then_some(connection))
}

fn adapter(state: &AppState) -> Result<Adapter, ApiError> {
    Ok(Adapter::new(current_config(state)?.tmux.path))
}

fn session_error(error: TmuxError) -> ApiError {
    match error {
        TmuxError::TmuxNotFound { .. }
        | TmuxError::NoSessions
        | TmuxError::TargetNotFound { .. } => ApiError::not_found(error.to_string()),
        TmuxError::CommandFailed { .. }
        | TmuxError::InvalidInput { .. }
        | TmuxError::Parse { .. } => ApiError::bad_request(error.to_string()),
    }
}

fn build_window_target(session: &str, window: &str) -> String {
    format!("{session}:{window}")
}

fn build_pane_target(session: &str, window: &str, pane: &str) -> String {
    format!("{}.{pane}", build_window_target(session, window))
}
