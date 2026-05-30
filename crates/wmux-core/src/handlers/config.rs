use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use wmux_core::config::{
    AuthConfig, Config, ConfigError, ConnectionConfig, LogsConfig, ServerConfig, TmuxConfig,
    UIConfig,
};
use wmux_core::skills::OmniSkillDef;

use crate::http::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigResponse {
    schema_version: u32,
    path: String,
    server: ServerConfig,
    auth: ConfigAuthResponse,
    tmux: TmuxConfig,
    connections: Vec<ConnectionConfig>,
    ui: UIConfig,
    intelligence: ConfigIntelligenceResponse,
    logs: LogsConfig,
    omni: ConfigOmniResponse,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigOmniResponse {
    enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    dashscope_api_key: Option<String>,
    dashscope_api_key_configured: bool,
    microphone_disabled: bool,
    voice: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    skill_definitions: Vec<OmniSkillDef>,
    model: String,
    endpoint: String,
    continuous_listening: bool,
    store_raw_audio: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    audit_log_path: Option<String>,
    vad_enabled: bool,
    vad_threshold: f32,
}

pub async fn get(State(state): State<AppState>) -> ApiResult<ConfigResponse> {
    let config = state
        .store
        .snapshot()
        .map_err(|_| ApiError::internal("failed to read configuration"))?;
    Ok(Json(new_config_response(&config, &state.skills.list())))
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
    payload
        .validate_omni()
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
    Ok(Json(new_config_response(&latest, &state.skills.list())))
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
    sanitized.omni.dashscope_api_key = None;
    sanitized
}

fn new_config_response(config: &Config, skill_defs: &[OmniSkillDef]) -> ConfigResponse {
    let sanitized = sanitized_config(config);
    let providers = sanitized
        .intelligence
        .providers
        .iter()
        .zip(config.intelligence.providers.iter())
        .map(
            |(sanitized_provider, original_provider)| ConfigIntelligenceProviderResponse {
                name: sanitized_provider.name.clone(),
                provider: sanitized_provider.provider.clone(),
                model: sanitized_provider.model.clone(),
                base_url: sanitized_provider.base_url.clone(),
                api_key_configured: !original_provider.api_key.trim().is_empty(),
                api_key: if original_provider.api_key.trim().is_empty() {
                    None
                } else {
                    Some(original_provider.api_key.clone())
                },
            },
        )
        .collect();

    ConfigResponse {
        schema_version: sanitized.schema_version,
        path: sanitized.path,
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
        omni: ConfigOmniResponse {
            enabled: sanitized.omni.enabled,
            dashscope_api_key: config.omni.dashscope_api_key.clone(),
            dashscope_api_key_configured: config
                .omni
                .dashscope_api_key
                .as_deref()
                .is_some_and(|key| !key.trim().is_empty()),
            microphone_disabled: sanitized.omni.microphone_disabled,
            voice: sanitized.omni.voice,
            skill_definitions: skill_defs.to_vec(),
            model: sanitized.omni.model,
            endpoint: sanitized.omni.endpoint,
            continuous_listening: sanitized.omni.continuous_listening,
            store_raw_audio: sanitized.omni.store_raw_audio,
            audit_log_path: sanitized.omni.audit_log_path,
            vad_enabled: sanitized.omni.vad_enabled,
            vad_threshold: sanitized.omni.vad_threshold,
        },
    }
}

fn preserve_secret_fields(current: &Config, payload: &mut Config) {
    if payload.auth.token.trim().is_empty() {
        payload.auth.token = current.auth.token.clone();
    }
    if payload.intelligence.api_key.trim().is_empty() {
        payload.intelligence.api_key = current.intelligence.api_key.clone();
    }
    if payload
        .omni
        .dashscope_api_key
        .as_deref()
        .is_none_or(|key| key.trim().is_empty())
    {
        payload.omni.dashscope_api_key = current.omni.dashscope_api_key.clone();
    }

    let payload_names: Vec<String> = payload
        .intelligence
        .providers
        .iter()
        .map(|p| p.name.clone())
        .collect();
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
        if let Some((index, existing)) =
            current
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_api_sanitizes_omni_secret_in_response() {
        let mut config = Config::default();
        config.omni.enabled = true;
        config.omni.dashscope_api_key = Some("sk-secret".to_string());
        config.omni.microphone_disabled = true;
        config.omni.voice = Some("Cherry".to_string());

        let response = new_config_response(&config, &[]);
        let value = serde_json::to_value(response).expect("serialize response");

        assert_eq!(value["omni"]["enabled"], true);
        assert_eq!(value["omni"]["dashscopeApiKeyConfigured"], true);
        assert_eq!(value["omni"]["microphoneDisabled"], true);
        assert_eq!(value["omni"]["voice"], "Cherry");
        assert_eq!(value["omni"]["dashscopeApiKey"], "sk-secret");
    }

    #[test]
    fn config_api_preserves_omni_secret_when_payload_key_empty() {
        let mut current = Config::default();
        current.omni.dashscope_api_key = Some("sk-existing".to_string());

        let mut payload = Config::default();
        payload.omni.enabled = true;
        payload.omni.dashscope_api_key = Some(String::new());

        preserve_secret_fields(&current, &mut payload);

        assert_eq!(
            payload.omni.dashscope_api_key,
            Some("sk-existing".to_string())
        );
    }

    #[test]
    fn config_api_preserves_omni_secret_when_payload_key_absent() {
        let mut current = Config::default();
        current.omni.dashscope_api_key = Some("sk-existing".to_string());

        let mut payload = Config::default();
        payload.omni.enabled = true;
        payload.omni.dashscope_api_key = None;

        preserve_secret_fields(&current, &mut payload);

        assert_eq!(
            payload.omni.dashscope_api_key,
            Some("sk-existing".to_string())
        );
    }
}
