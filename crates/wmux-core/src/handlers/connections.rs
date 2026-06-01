use axum::Extension;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use wmux_core::config::{Config, ConfigError, ConnectionConfig};
use wmux_core::tmux::Adapter;

use crate::http::{ApiError, ApiResult};
use crate::state::{AppState, CachedConfig};

#[derive(Serialize)]
pub struct ConnectionsListResponse {
    data: Vec<RuntimeConnection>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionHealthResponse {
    target_name: String,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConnection {
    #[serde(default)]
    target_name: String,
    #[serde(default, rename = "type")]
    connection_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    host: String,
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    port: u16,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    user: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    private_key_path: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    known_hosts_path: String,
}

pub async fn list(State(state): State<AppState>) -> ApiResult<ConnectionsListResponse> {
    Ok(Json(ConnectionsListResponse {
        data: state
            .connections
            .list()
            .into_iter()
            .map(RuntimeConnection::from)
            .collect(),
    }))
}

pub async fn list_health(State(state): State<AppState>, Extension(cached): Extension<CachedConfig>) -> ApiResult<ConnectionHealthListResponse> {
    let connections = state.connections.list();
    let mut data = Vec::with_capacity(connections.len());
    for connection in &connections {
        data.push(check_connection_health(connection, &cached.0.tmux.path).await);
    }
    Ok(Json(ConnectionHealthListResponse { data }))
}

pub async fn create(
    State(state): State<AppState>,
    Json(payload): Json<RuntimeConnection>,
) -> Result<(StatusCode, Json<RuntimeConnection>), ApiError> {
    let mut payload = payload.into_config();
    normalize_connection_payload(&mut payload);
    validate_local_connection_payload(&payload)?;

    let created = runtime_connection(payload);
    state.connections.create(created.clone());
    persist_connections(&state)?;

    tracing::info!(target_name = %created.id, connection_type = %created.connection_type, "runtime connection created");

    Ok((StatusCode::CREATED, Json(RuntimeConnection::from(created))))
}

pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<RuntimeConnection> {
    Ok(Json(RuntimeConnection::from(find_connection(&state, &id)?)))
}

pub async fn health(
    State(state): State<AppState>,
    Extension(cached): Extension<CachedConfig>,
    Path(id): Path<String>,
) -> ApiResult<ConnectionHealthResponse> {
    let connection = find_connection(&state, &id)?;
    Ok(Json(
        check_connection_health(&connection, &cached.0.tmux.path).await,
    ))
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<RuntimeConnection>,
) -> ApiResult<RuntimeConnection> {
    let mut payload = payload.into_config();
    normalize_connection_payload(&mut payload);
    validate_local_connection_payload(&payload)?;

    let mut next = runtime_connection(payload);
    next.id = id.clone();
    let Some(updated) = state.connections.replace(&id, next) else {
        return Err(ApiError::not_found(format!("connection not found: {id}")));
    };
    persist_connections(&state)?;

    tracing::info!(target_name = %id, "runtime connection updated");

    Ok(Json(RuntimeConnection::from(updated)))
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    if state.connections.delete(&id).is_none() {
        return Err(ApiError::not_found(format!("connection not found: {id}")));
    }
    persist_connections(&state)?;

    tracing::info!(target_name = %id, "runtime connection deleted");

    Ok(StatusCode::NO_CONTENT.into_response())
}

pub fn find_connection(state: &AppState, id: &str) -> Result<ConnectionConfig, ApiError> {
    let connections = state.connections.list();
    let available_names = connections
        .iter()
        .map(|connection| connection.id.clone())
        .collect::<Vec<_>>();
    connections
        .into_iter()
        .find(|connection| connection.id == id)
        .ok_or_else(|| {
            tracing::warn!(
                target_name = %id,
                available_target_names = ?available_names,
                "connection lookup failed"
            );
            ApiError::not_found(format!(
                "connection not found: target_name={id:?}, available_target_names={available_names:?}"
            ))
        })
}

pub fn require_local_connection(connection: &ConnectionConfig) -> Result<(), ApiError> {
    match connection.connection_type.as_str() {
        "local" => Ok(()),
        "ssh" => Err(ApiError::not_implemented(
            "ssh connections are not implemented",
        )),
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
        target_name: connection.id.clone(),
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
        "ssh" => Err(ApiError::not_implemented(
            "ssh connections are not implemented",
        )),
        _ => Err(ApiError::bad_request(
            "connection type must be local or ssh",
        )),
    }
}

fn runtime_connection(mut connection: ConnectionConfig) -> ConnectionConfig {
    if connection.id.trim().is_empty() {
        connection.id = target_name_for_connection(&connection);
    }
    connection
}

impl RuntimeConnection {
    fn into_config(self) -> ConnectionConfig {
        ConnectionConfig {
            id: self.target_name,
            connection_type: self.connection_type,
            host: self.host,
            port: self.port,
            user: self.user,
            private_key_path: self.private_key_path,
            known_hosts_path: self.known_hosts_path,
        }
    }
}

impl From<ConnectionConfig> for RuntimeConnection {
    fn from(connection: ConnectionConfig) -> Self {
        Self {
            target_name: connection.id,
            connection_type: connection.connection_type,
            host: connection.host,
            port: connection.port,
            user: connection.user,
            private_key_path: connection.private_key_path,
            known_hosts_path: connection.known_hosts_path,
        }
    }
}

fn is_zero_u16(value: &u16) -> bool {
    *value == 0
}

fn persist_connections(state: &AppState) -> Result<(), ApiError> {
    let connections = state.connections.list();
    if let Err(error) = state.store.update(|config| {
        config.connections = connections;
        Ok(())
    }) {
        if matches!(error, ConfigError::ConfigModified) {
            let _ = state.store.reload();
            if let Ok(reloaded) = state.store.snapshot() {
                state.connections.replace_all(reloaded.connections);
            }
            return Err(ApiError::conflict(error.to_string()));
        }
        return Err(ApiError::internal("failed to persist connections"));
    }
    Ok(())
}

pub fn target_name_for_connection(connection: &ConnectionConfig) -> String {
    match connection.connection_type.as_str() {
        "ssh" => {
            let host = connection.host.trim();
            let user = connection.user.trim();
            let authority = if user.is_empty() {
                host.to_string()
            } else {
                format!("{user}@{host}")
            };
            if connection.port == 0 || connection.port == 22 {
                authority
            } else {
                format!("{authority}:{}", connection.port)
            }
        }
        _ => "local".to_string(),
    }
}
