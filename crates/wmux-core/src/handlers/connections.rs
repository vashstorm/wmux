use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use wmux_core::config::{Config, ConfigError, ConnectionConfig};
use wmux_core::tmux::Adapter;

use crate::http::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Serialize)]
pub struct ConnectionsListResponse {
    data: Vec<ConnectionConfig>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionHealthResponse {
    connection_id: String,
    status: String,
    checked_at: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    error_code: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    message: String,
}

#[derive(Serialize)]
pub struct ConnectionHealthListResponse {
    data: Vec<ConnectionHealthResponse>,
}

pub async fn list(State(state): State<AppState>) -> ApiResult<ConnectionsListResponse> {
    let config = current_config(&state)?;
    Ok(Json(ConnectionsListResponse {
        data: config.connections,
    }))
}

pub async fn list_health(State(state): State<AppState>) -> ApiResult<ConnectionHealthListResponse> {
    let config = current_config(&state)?;
    let mut data = Vec::with_capacity(config.connections.len());
    for connection in &config.connections {
        data.push(check_connection_health(connection, &config.tmux.path).await);
    }
    Ok(Json(ConnectionHealthListResponse { data }))
}

pub async fn create(
    State(state): State<AppState>,
    Json(mut payload): Json<ConnectionConfig>,
) -> Result<(StatusCode, Json<ConnectionConfig>), ApiError> {
    normalize_connection_payload(&mut payload);
    validate_local_connection_payload(&payload)?;

    let created = payload.clone();
    state
        .store
        .update(|config| {
            if !created.id.is_empty()
                && config
                    .connections
                    .iter()
                    .any(|connection| connection.id == created.id)
            {
                return Err(ConfigError::Io {
                    context: "connection already exists",
                    source: std::io::Error::new(
                        std::io::ErrorKind::AlreadyExists,
                        "connection already exists",
                    ),
                });
            }
            config.connections.push(created.clone());
            Ok(())
        })
        .map_err(store_error)?;

    tracing::info!(connection_id = %created.id, connection_type = %created.connection_type, "connection created");

    let latest = current_config(&state)?;
    latest
        .connections
        .last()
        .cloned()
        .map(|connection| (StatusCode::CREATED, Json(connection)))
        .ok_or_else(|| ApiError::internal("failed to resolve created connection"))
}

pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<ConnectionConfig> {
    Ok(Json(find_connection(&state, &id)?))
}

pub async fn health(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<ConnectionHealthResponse> {
    let connection = find_connection(&state, &id)?;
    let config = current_config(&state)?;
    Ok(Json(check_connection_health(&connection, &config.tmux.path).await))
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(mut payload): Json<ConnectionConfig>,
) -> ApiResult<ConnectionConfig> {
    payload.id = id.clone();
    normalize_connection_payload(&mut payload);
    validate_local_connection_payload(&payload)?;

    let next = payload.clone();
    state
        .store
        .update(|config| {
            let Some(existing) = config
                .connections
                .iter_mut()
                .find(|connection| connection.id == id)
            else {
                return Err(ConfigError::Io {
                    context: "connection not found",
                    source: std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "connection not found",
                    ),
                });
            };
            *existing = next.clone();
            Ok(())
        })
        .map_err(store_error)?;

    tracing::info!(connection_id = %id, "connection updated");

    Ok(Json(payload))
}

pub async fn delete(State(state): State<AppState>, Path(id): Path<String>) -> Result<Response, ApiError> {
    state
        .store
        .update(|config| {
            let Some(index) = config
                .connections
                .iter()
                .position(|connection| connection.id == id)
            else {
                return Err(ConfigError::Io {
                    context: "connection not found",
                    source: std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "connection not found",
                    ),
                });
            };
            config.connections.remove(index);
            Ok(())
        })
        .map_err(store_error)?;

    tracing::info!(connection_id = %id, "connection deleted");

    Ok(StatusCode::NO_CONTENT.into_response())
}

pub fn find_connection(state: &AppState, id: &str) -> Result<ConnectionConfig, ApiError> {
    let config = current_config(state)?;
    let available_ids = config
        .connections
        .iter()
        .map(|connection| connection.id.clone())
        .collect::<Vec<_>>();
    config
        .connections
        .into_iter()
        .find(|connection| connection.id == id)
        .ok_or_else(|| {
            tracing::warn!(
                connection_id = %id,
                available_connection_ids = ?available_ids,
                "connection lookup failed"
            );
            ApiError::not_found(format!(
                "connection not found: id={id:?}, available_connection_ids={available_ids:?}"
            ))
        })
}

pub fn require_local_connection(connection: &ConnectionConfig) -> Result<(), ApiError> {
    match connection.connection_type.as_str() {
        "local" => Ok(()),
        "ssh" => Err(ApiError::not_implemented("ssh connections are not implemented")),
        other => Err(ApiError::bad_request(format!(
            "unsupported connection type {other:?}"
        ))),
    }
}

pub fn current_config(state: &AppState) -> Result<Config, ApiError> {
    state
        .store
        .snapshot()
        .map_err(|_| ApiError::internal("failed to read configuration"))
}

async fn check_connection_health(
    connection: &ConnectionConfig,
    tmux_path: &str,
) -> ConnectionHealthResponse {
    let mut response = ConnectionHealthResponse {
        connection_id: connection.id.clone(),
        status: "offline".to_string(),
        checked_at: OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string()),
        error_code: String::new(),
        message: String::new(),
    };

    match connection.connection_type.as_str() {
        "local" => {
            let adapter = Adapter::new(tmux_path);
            match adapter.detect_binary().await {
                Ok(()) => match adapter.list_sessions().await {
                    Ok(_) => response.status = "online".to_string(),
                    Err(error) => {
                        response.error_code = error.code().to_string();
                        response.message = error.to_string();
                    }
                },
                Err(error) => {
                    response.error_code = error.code().to_string();
                    response.message = error.to_string();
                }
            }
        }
        "ssh" => {
            response.error_code = "not_implemented".to_string();
            response.message = "ssh connections are not implemented".to_string();
        }
        other => {
            response.error_code = "unsupported_connection_type".to_string();
            response.message = format!("unsupported connection type {other:?}");
        }
    }

    response
}

fn normalize_connection_payload(connection: &mut ConnectionConfig) {
    connection.connection_type = connection.connection_type.trim().to_lowercase();
}

fn validate_local_connection_payload(connection: &ConnectionConfig) -> Result<(), ApiError> {
    match connection.connection_type.as_str() {
        "local" => Ok(()),
        "ssh" => Err(ApiError::not_implemented("ssh connections are not implemented")),
        _ => Err(ApiError::bad_request("connection type must be local or ssh")),
    }
}

fn store_error(error: ConfigError) -> ApiError {
    match error {
        ConfigError::ConfigModified => ApiError::conflict(error.to_string()),
        ConfigError::Io { context, source } if source.kind() == std::io::ErrorKind::NotFound => {
            ApiError::not_found(context)
        }
        ConfigError::Io { context, source }
            if source.kind() == std::io::ErrorKind::AlreadyExists =>
        {
            ApiError::conflict(context)
        }
        _ => ApiError::internal("failed to persist configuration"),
    }
}
