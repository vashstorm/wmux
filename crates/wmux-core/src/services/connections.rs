use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use wmux_core::config::{Config, ConnectionConfig};
use wmux_core::ipc_error::{IpcError, IpcResult};
use wmux_core::tmux::Adapter;

use crate::state::{AppState, RuntimeConnections};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConnection {
    #[serde(default)]
    pub target_name: String,
    #[serde(default, rename = "type")]
    pub connection_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub host: String,
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    pub port: u16,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub user: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub private_key_path: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub known_hosts_path: String,
}

impl RuntimeConnection {
    pub fn into_config(self) -> ConnectionConfig {
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

fn normalize_connection_payload(connection: &mut ConnectionConfig) {
    connection.connection_type = connection.connection_type.trim().to_lowercase();
}

pub fn validate_local_connection(connection: &ConnectionConfig) -> IpcResult<()> {
    match connection.connection_type.as_str() {
        "local" => Ok(()),
        "ssh" => Err(IpcError::not_found("ssh connections are not implemented")),
        _ => Err(IpcError::bad_request(
            "connection type must be local or ssh",
        )),
    }
}

pub fn require_local_connection(connection: &ConnectionConfig) -> IpcResult<()> {
    match connection.connection_type.as_str() {
        "local" => Ok(()),
        "ssh" => Err(IpcError::not_found("ssh connections are not implemented")),
        other => Err(IpcError::bad_request(format!(
            "unsupported connection type {other:?}"
        ))),
    }
}

pub fn list_connections(state: &AppState) -> Vec<RuntimeConnection> {
    let mut connections: Vec<RuntimeConnection> = state
        .connections
        .list()
        .into_iter()
        .map(RuntimeConnection::from)
        .collect();

    if connections.is_empty() {
        connections.push(RuntimeConnection {
            target_name: "local".to_string(),
            connection_type: "local".to_string(),
            ..Default::default()
        });
    }

    connections
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionHealthResponse {
    pub target_name: String,
    pub status: String,
    pub checked_at: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error_code: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub message: String,
}

pub async fn list_connections_health(
    state: &AppState,
    tmux_path: &str,
) -> Vec<ConnectionHealthResponse> {
    let connections = state.connections.list();
    let mut data = Vec::with_capacity(connections.len());
    for connection in &connections {
        data.push(check_connection_health(connection, tmux_path).await);
    }
    data
}

pub fn find_connection(state: &AppState, id: &str) -> IpcResult<ConnectionConfig> {
    let connections = state.connections.list();
    let available_names = connections
        .iter()
        .map(|connection| connection.id.clone())
        .collect::<Vec<_>>();
    connections
        .into_iter()
        .find(|connection| connection.id == id)
        .ok_or_else(|| {
            IpcError::not_found(format!(
                "connection not found: target_name={id:?}, available_target_names={available_names:?}"
            ))
        })
}

pub fn create_connection(
    state: &AppState,
    payload: RuntimeConnection,
) -> IpcResult<RuntimeConnection> {
    let mut connection = payload.into_config();
    normalize_connection_payload(&mut connection);
    validate_local_connection(&connection)?;

    let mut connection = runtime_connection(connection);
    state.connections.create(connection.clone());

    persist_connections(state)?;

    tracing::info!(target_name = %connection.id, connection_type = %connection.connection_type, "runtime connection created");
    Ok(RuntimeConnection::from(connection))
}

pub fn get_connection(state: &AppState, id: &str) -> IpcResult<RuntimeConnection> {
    Ok(RuntimeConnection::from(find_connection(state, id)?))
}

pub fn update_connection(
    state: &AppState,
    id: &str,
    payload: RuntimeConnection,
) -> IpcResult<RuntimeConnection> {
    let mut connection = payload.into_config();
    normalize_connection_payload(&mut connection);
    validate_local_connection(&connection)?;

    let mut next = runtime_connection(connection);
    next.id = id.to_string();
    let Some(updated) = state.connections.replace(&id, next) else {
        return Err(IpcError::not_found(format!("connection not found: {id}")));
    };
    persist_connections(state)?;

    tracing::info!(target_name = %id, "runtime connection updated");
    Ok(RuntimeConnection::from(updated))
}

pub fn delete_connection(state: &AppState, id: &str) -> IpcResult<()> {
    if state.connections.delete(&id).is_none() {
        return Err(IpcError::not_found(format!("connection not found: {id}")));
    }
    persist_connections(state)?;

    tracing::info!(target_name = %id, "runtime connection deleted");
    Ok(())
}

pub async fn get_connection_health(
    state: &AppState,
    id: &str,
    tmux_path: &str,
) -> IpcResult<ConnectionHealthResponse> {
    let connection = find_connection(state, id)?;
    Ok(check_connection_health(&connection, tmux_path).await)
}

fn runtime_connection(mut connection: ConnectionConfig) -> ConnectionConfig {
    if connection.id.trim().is_empty() {
        connection.id = target_name_for_connection(&connection);
    }
    connection
}

fn persist_connections(state: &AppState) -> IpcResult<()> {
    use wmux_core::config::ConfigError;

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
            return Err(IpcError::conflict(error.to_string()));
        }
        return Err(IpcError::internal("failed to persist connections"));
    }
    Ok(())
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

pub fn current_config(state: &AppState) -> IpcResult<Config> {
    state
        .store
        .snapshot()
        .map_err(|_| IpcError::internal("failed to read configuration"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_connection_from_config() {
        let config = ConnectionConfig {
            id: "local".to_string(),
            connection_type: "local".to_string(),
            host: "localhost".to_string(),
            port: 22,
            user: "user".to_string(),
            private_key_path: "/path/to/key".to_string(),
            known_hosts_path: "/path/to/known_hosts".to_string(),
        };

        let runtime: RuntimeConnection = config.clone().into();
        assert_eq!(runtime.target_name, "local");
        assert_eq!(runtime.connection_type, "local");
        assert_eq!(runtime.host, "localhost");
    }

    #[test]
    fn runtime_connection_into_config() {
        let runtime = RuntimeConnection {
            target_name: "local".to_string(),
            connection_type: "local".to_string(),
            host: "localhost".to_string(),
            port: 22,
            user: "user".to_string(),
            private_key_path: "/path/to/key".to_string(),
            known_hosts_path: "/path/to/known_hosts".to_string(),
        };

        let config = runtime.into_config();
        assert_eq!(config.id, "local");
        assert_eq!(config.connection_type, "local");
    }

    #[test]
    fn validate_local_connection_allows_local() {
        let config = ConnectionConfig {
            id: "test".to_string(),
            connection_type: "local".to_string(),
            host: "".to_string(),
            port: 0,
            user: "".to_string(),
            private_key_path: "".to_string(),
            known_hosts_path: "".to_string(),
        };

        assert!(validate_local_connection(&config).is_ok());
    }

    #[test]
    fn validate_local_connection_rejects_ssh() {
        let config = ConnectionConfig {
            id: "test".to_string(),
            connection_type: "ssh".to_string(),
            host: "host".to_string(),
            port: 22,
            user: "user".to_string(),
            private_key_path: "".to_string(),
            known_hosts_path: "".to_string(),
        };

        let result = validate_local_connection(&config);
        assert!(result.is_err());
    }
}
