use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::config::{Config, IntelligenceProviderConfig};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionIntelligence {
    pub app: String,
    pub status: String,
    pub summary: String,
    pub source: String,
    pub confidence: f32,
    pub stale: bool,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_counts: Option<HashMap<String, usize>>,
}

#[derive(Debug, Clone)]
pub struct ActiveProvider {
    pub name: String,
    pub provider: String,
    pub model: String,
    pub api_key: String,
    pub base_url: String,
}

#[derive(Debug, Clone, Default)]
pub struct IntelligenceStore {
    inner: Arc<Mutex<IntelligenceState>>,
}

#[derive(Debug, Default)]
struct IntelligenceState {
    cache: HashMap<SessionKey, CacheEntry>,
    in_flight: HashSet<SessionKey>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SessionKey {
    connection_id: String,
    session: String,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    result: SessionIntelligence,
    analyzed_at: Instant,
}

impl IntelligenceStore {
    pub fn get(
        &self,
        connection_id: &str,
        session: &str,
        cache_ttl: Duration,
    ) -> Option<SessionIntelligence> {
        let key = SessionKey::new(connection_id, session);
        let state = self.inner.lock().ok()?;
        let entry = state.cache.get(&key)?;
        let mut result = entry.result.clone();
        if entry.analyzed_at.elapsed() > cache_ttl {
            result.stale = true;
        }
        Some(result)
    }

    pub fn should_analyze(
        &self,
        connection_id: &str,
        session: &str,
        min_interval: Duration,
    ) -> bool {
        let key = SessionKey::new(connection_id, session);
        self.inner
            .lock()
            .map(|state| {
                state
                    .cache
                    .get(&key)
                    .map_or(true, |entry| entry.analyzed_at.elapsed() >= min_interval)
            })
            .unwrap_or(true)
    }

    pub fn begin_analyze(
        &self,
        connection_id: &str,
        session: &str,
        min_interval: Duration,
        max_concurrency: usize,
    ) -> bool {
        let key = SessionKey::new(connection_id, session);
        let Ok(mut state) = self.inner.lock() else {
            return false;
        };

        if state.in_flight.contains(&key) || state.in_flight.len() >= max_concurrency.max(1) {
            return false;
        }

        if state
            .cache
            .get(&key)
            .is_some_and(|entry| entry.analyzed_at.elapsed() < min_interval)
        {
            return false;
        }

        state.in_flight.insert(key);
        true
    }

    pub fn set(&self, connection_id: &str, session: &str, mut result: SessionIntelligence) {
        result.stale = false;
        let key = SessionKey::new(connection_id, session);
        if let Ok(mut state) = self.inner.lock() {
            state.in_flight.remove(&key);
            state.cache.insert(
                key,
                CacheEntry {
                    result,
                    analyzed_at: Instant::now(),
                },
            );
        }
    }
}

impl SessionKey {
    fn new(connection_id: &str, session: &str) -> Self {
        Self {
            connection_id: connection_id.to_string(),
            session: session.to_string(),
        }
    }
}

pub fn active_provider(config: &Config) -> Option<ActiveProvider> {
    if !config.intelligence.enabled {
        return None;
    }

    let provider = config
        .intelligence
        .providers
        .iter()
        .find(|provider| provider.name == config.intelligence.active_provider)
        .or_else(|| config.intelligence.providers.first())
        .cloned()
        .or_else(|| legacy_provider(config))?;

    let base_url = if provider.base_url.trim().is_empty() {
        default_base_url(provider.provider.as_str()).to_string()
    } else {
        provider.base_url.trim().to_string()
    };

    Some(ActiveProvider {
        name: provider.name,
        provider: provider.provider,
        model: provider.model,
        api_key: provider.api_key,
        base_url,
    })
}

pub async fn analyze_text(
    provider: &ActiveProvider,
    text: &str,
    timeout: Duration,
) -> Result<SessionIntelligence, String> {
    if provider.model.trim().is_empty() {
        return Err("AI provider model is empty".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|err| format!("create AI client: {err}"))?;
    let response = client
        .post(chat_completions_url(provider.base_url.as_str()))
        .bearer_auth(provider.api_key.as_str())
        .json(&json!({
            "model": provider.model,
            "temperature": 0,
            "response_format": { "type": "json_object" },
            "messages": [
                {
                    "role": "system",
                    "content": "Analyze a tmux session transcript. Return only JSON with application, status, summary, confidence. application must be one of claude,codex,opencode,zsh,unknown. status must be one of none,waiting,dead_loop,blocked,waiting_confirm,waiting_idle,running. 使用中文回复。"
                },
                {
                    "role": "user",
                    "content": text
                }
            ]
        }))
        .send()
        .await
        .map_err(|err| format!("call AI provider: {err}"))?;

    if !response.status().is_success() {
        return Err(format!("AI provider returned HTTP {}", response.status()));
    }

    let completion: ChatCompletionResponse = response
        .json()
        .await
        .map_err(|err| format!("decode AI provider response: {err}"))?;
    let content = completion
        .choices
        .first()
        .map(|choice| choice.message.content.trim())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "AI provider response did not include content".to_string())?;

    let parsed: ModelIntelligence = serde_json::from_str(strip_json_fence(content))
        .map_err(|err| format!("decode AI intelligence JSON: {err}"))?;
    parsed.into_intelligence(provider)
}

pub fn error_result(
    provider: Option<&ActiveProvider>,
    message: impl Into<String>,
) -> SessionIntelligence {
    SessionIntelligence {
        app: "unknown".to_string(),
        status: "none".to_string(),
        summary: "Analysis failed".to_string(),
        source: provider
            .map(|provider| provider.source())
            .unwrap_or_else(|| "not configured".to_string()),
        confidence: 0.0,
        stale: false,
        updated_at: now_rfc3339(),
        error: Some(message.into()),
        app_counts: None,
    }
}

fn legacy_provider(config: &Config) -> Option<IntelligenceProviderConfig> {
    let provider = config.intelligence.provider.trim();
    if provider.is_empty() {
        return None;
    }
    Some(IntelligenceProviderConfig {
        name: provider.to_string(),
        provider: provider.to_string(),
        model: config.intelligence.model.trim().to_string(),
        api_key: config.intelligence.api_key.trim().to_string(),
        base_url: config.intelligence.base_url.trim().to_string(),
    })
}

fn default_base_url(provider: &str) -> &'static str {
    match provider.trim().to_ascii_lowercase().as_str() {
        "openai" => "https://api.openai.com/v1",
        _ => "https://api.openai.com/v1",
    }
}

fn chat_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn strip_json_fence(content: &str) -> &str {
    let trimmed = content.trim();
    if let Some(rest) = trimmed.strip_prefix("```json") {
        return rest.trim_end_matches("```").trim();
    }
    if let Some(rest) = trimmed.strip_prefix("```") {
        return rest.trim_end_matches("```").trim();
    }
    trimmed
}

impl ActiveProvider {
    fn source(&self) -> String {
        if self.name.trim().is_empty() {
            format!("{}/{}", self.provider, self.model)
        } else {
            format!("{}/{}", self.name, self.model)
        }
    }
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ModelIntelligence {
    #[serde(default, alias = "app")]
    application: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    confidence: Option<f32>,
}

impl ModelIntelligence {
    fn into_intelligence(self, provider: &ActiveProvider) -> Result<SessionIntelligence, String> {
        let app = normalize_enum(self.application.as_str());
        let status = normalize_enum(self.status.as_str());
        if !is_valid_app(app.as_str()) {
            return Err(format!(
                "AI provider returned unsupported application {app:?}"
            ));
        }
        if !is_valid_status(status.as_str()) {
            return Err(format!(
                "AI provider returned unsupported status {status:?}"
            ));
        }
        let summary = self.summary.trim();
        if summary.is_empty() {
            return Err("AI provider returned an empty summary".to_string());
        }

        let mut app_counts = HashMap::new();
        app_counts.insert(app.clone(), 1);

        Ok(SessionIntelligence {
            app,
            status,
            summary: summary.to_string(),
            source: provider.source(),
            confidence: self.confidence.unwrap_or(0.0).clamp(0.0, 1.0),
            stale: false,
            updated_at: now_rfc3339(),
            error: None,
            app_counts: Some(app_counts),
        })
    }
}

fn normalize_enum(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace('-', "_")
}

fn is_valid_app(value: &str) -> bool {
    matches!(value, "claude" | "codex" | "opencode" | "zsh" | "unknown")
}

fn is_valid_status(value: &str) -> bool {
    matches!(
        value,
        "none"
            | "waiting"
            | "dead_loop"
            | "blocked"
            | "waiting_confirm"
            | "waiting_idle"
            | "running"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_intelligence(summary: &str) -> SessionIntelligence {
        SessionIntelligence {
            app: "codex".to_string(),
            status: "running".to_string(),
            summary: summary.to_string(),
            source: "test/model".to_string(),
            confidence: 0.8,
            stale: false,
            updated_at: now_rfc3339(),
            error: None,
            app_counts: None,
        }
    }

    #[test]
    fn begin_analyze_deduplicates_in_flight_session_and_respects_interval() {
        let store = IntelligenceStore::default();
        let min_interval = Duration::from_secs(60);

        assert!(store.begin_analyze("conn", "dev", min_interval, 3));
        assert!(!store.begin_analyze("conn", "dev", min_interval, 3));

        store.set("conn", "dev", sample_intelligence("ready"));

        assert!(!store.begin_analyze("conn", "dev", min_interval, 3));
        assert_eq!(
            store
                .get("conn", "dev", Duration::from_secs(300))
                .expect("cached intelligence")
                .summary,
            "ready"
        );
    }

    #[test]
    fn begin_analyze_limits_global_concurrency() {
        let store = IntelligenceStore::default();
        let min_interval = Duration::from_secs(0);

        assert!(store.begin_analyze("conn", "one", min_interval, 1));
        assert!(!store.begin_analyze("conn", "two", min_interval, 1));

        store.set("conn", "one", sample_intelligence("one done"));

        assert!(store.begin_analyze("conn", "two", min_interval, 1));
    }
}
