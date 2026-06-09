use axum::Extension;
use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use wmux_core::config::{
    AuthConfig, Config, ConfigError, ConnectionConfig, LogsConfig, ServerConfig, TmuxConfig,
    UIConfig,
};
use wmux_core::skills::OmniSkillDef;

use crate::http::{api_error_from_ipc_error, ApiError, ApiResult};
use crate::services::config as svc;
use crate::services::config::ConfigResponse;
use crate::state::{AppState, CachedConfig};

pub async fn get(State(state): State<AppState>, Extension(cached): Extension<CachedConfig>) -> ApiResult<ConfigResponse> {
    match svc::get_config(&state) {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub async fn update(
    State(state): State<AppState>,
    Extension(cached): Extension<CachedConfig>,
    Json(mut payload): Json<Config>,
) -> ApiResult<ConfigResponse> {
    let current = cached.0.clone();
    
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
    
    match svc::update_config(&state, payload) {
        Ok(resp) => Ok(Json(resp)),
        Err(e) => Err(api_error_from_ipc_error(e)),
    }
}

pub fn sanitized_config(config: &Config) -> Config {
    svc::sanitized_config(config)
}