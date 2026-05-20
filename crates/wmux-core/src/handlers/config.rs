use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use wmux_core::config::{AuthConfig, Config, ConfigError, ConnectionConfig, LogsConfig, ServerConfig, TmuxConfig, UIConfig};

use crate::http::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigResponse {
    schema_version: u32,
    server: ServerConfig,
    auth: ConfigAuthResponse,
    tmux: TmuxConfig,
    connections: Vec<ConnectionConfig>,
    ui: UIConfig,
    intelligence: ConfigIntelligenceResponse,
    logs: LogsConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigAuthResponse {
    token: String,
    token_configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigIntelligenceProviderResponse {
    name: String,
    provider: String,
    model: String,
    #[serde(rename = "baseURL", skip_serializing_if = "String::is_empty")]
    base_url: String,
    api_key_configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigIntelligenceResponse {
    enabled: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    active_provider: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    providers: Vec<ConfigIntelligenceProviderResponse>,
    max_bytes: u32,
    timeout_sec: u32,
    min_session_interval_sec: u32,
    max_concurrency: u32,
    #[serde(rename = "cacheTTLSec")]
    cache_ttl_sec: u32,
}

pub async fn get(State(state): State<AppState>) -> ApiResult<ConfigResponse> {
    let config = state
        .store
        .snapshot()
        .map_err(|_| ApiError::internal("failed to read configuration"))?;
    Ok(Json(new_config_response(&config)))
}

pub async fn update(
    State(state): State<AppState>,
    Json(mut payload): Json<Config>,
) -> ApiResult<ConfigResponse> {
    let current = state
        .store
        .snapshot()
        .map_err(|_| ApiError::internal("failed to read configuration"))?;

    preserve_secret_fields(&current, &mut payload);

    payload
        .validate_auth()
        .map_err(|error| ApiError::bad_request(error.to_string()))?;

    if let Err(error) = state.store.replace(payload) {
        if matches!(error, ConfigError::ConfigModified) {
            let _ = state.store.reload();
        }
        return Err(store_error(error));
    }

    if let Ok(latest) = state.store.snapshot() {
        state.connections.replace_all(latest.connections);
    }

    tracing::info!("config updated");

    let latest = state
        .store
        .snapshot()
        .map_err(|_| ApiError::internal("failed to read configuration"))?;
    Ok(Json(new_config_response(&latest)))
}

pub fn sanitized_config(config: &Config) -> Config {
    let mut sanitized = config.clone();
    sanitized.auth = AuthConfig {
        token: String::new(),
    };
    sanitized.intelligence.api_key.clear();
    for provider in &mut sanitized.intelligence.providers {
        provider.api_key.clear();
    }
    sanitized
}

fn new_config_response(config: &Config) -> ConfigResponse {
    let sanitized = sanitized_config(config);
    let providers = sanitized
        .intelligence
        .providers
        .iter()
        .zip(config.intelligence.providers.iter())
        .map(|(sanitized_provider, original_provider)| ConfigIntelligenceProviderResponse {
            name: sanitized_provider.name.clone(),
            provider: sanitized_provider.provider.clone(),
            model: sanitized_provider.model.clone(),
            base_url: sanitized_provider.base_url.clone(),
            api_key_configured: !original_provider.api_key.trim().is_empty(),
        })
        .collect();

    ConfigResponse {
        schema_version: sanitized.schema_version,
        server: sanitized.server,
        auth: ConfigAuthResponse {
            token: String::new(),
            token_configured: !config.auth.token.trim().is_empty(),
        },
        tmux: sanitized.tmux,
        connections: sanitized.connections,
        ui: sanitized.ui,
        intelligence: ConfigIntelligenceResponse {
            enabled: sanitized.intelligence.enabled,
            active_provider: sanitized.intelligence.active_provider,
            providers,
            max_bytes: sanitized.intelligence.max_bytes,
            timeout_sec: sanitized.intelligence.timeout_sec,
            min_session_interval_sec: sanitized.intelligence.min_session_interval_sec,
            max_concurrency: sanitized.intelligence.max_concurrency,
            cache_ttl_sec: sanitized.intelligence.cache_ttl_sec,
        },
        logs: sanitized.logs,
    }
}

fn preserve_secret_fields(current: &Config, payload: &mut Config) {
    if payload.auth.token.trim().is_empty() {
        payload.auth.token = current.auth.token.clone();
    }
    if payload.intelligence.api_key.trim().is_empty() {
        payload.intelligence.api_key = current.intelligence.api_key.clone();
    }

    let payload_names: Vec<String> = payload.intelligence.providers.iter().map(|p| p.name.clone()).collect();
    let mut matched_existing = Vec::new();
    for provider in &mut payload.intelligence.providers {
        if !provider.api_key.trim().is_empty() {
            continue;
        }
        if let Some((index, existing)) = current
            .intelligence
            .providers
            .iter()
            .enumerate()
            .find(|(_, existing)| existing.name == provider.name)
        {
            provider.api_key = existing.api_key.clone();
            matched_existing.push(index);
            continue;
        }
        if let Some((index, existing)) = current
            .intelligence
            .providers
            .iter()
            .enumerate()
            .find(|(idx, existing)| {
                !matched_existing.contains(idx)
                    && !existing.api_key.trim().is_empty()
                    && !payload_names.contains(&existing.name)
            })
        {
            provider.api_key = existing.api_key.clone();
            matched_existing.push(index);
        }
    }
}

fn store_error(error: ConfigError) -> ApiError {
    match error {
        ConfigError::ConfigModified => ApiError::conflict(error.to_string()),
        _ => ApiError::internal("failed to persist configuration"),
    }
}
