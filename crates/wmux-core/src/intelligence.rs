use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
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
    window_cache: HashMap<WindowKey, WindowIntelligenceEntry>,
    window_in_flight: HashSet<WindowKey>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SessionKey {
    target_name: String,
    session: String,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    result: SessionIntelligence,
    analyzed_at: Instant,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WindowKey {
    target_name: String,
    session_name: String,
    window_id: String,
}

#[derive(Debug, Clone)]
pub struct WindowIntelligenceEntry {
    result: SessionIntelligence,
    content_hash: String,
    command_class: CommandClass,
    command_basename: String,
    pane_signature: String,
    analyzed_at: Instant,
}

#[derive(Debug, Clone)]
pub enum WindowCacheDecision {
    Proceed,
    SkipUnchanged(SessionIntelligence),
    SkipBlocked(SessionIntelligence),
    InFlight,
}

impl IntelligenceStore {
    pub fn get(
        &self,
        target_name: &str,
        session: &str,
        cache_ttl: Duration,
    ) -> Option<SessionIntelligence> {
        let key = SessionKey::new(target_name, session);
        let state = self.inner.lock().ok()?;
        let entry = state.cache.get(&key)?;
        let mut result = entry.result.clone();
        if entry.analyzed_at.elapsed() > cache_ttl {
            result.stale = true;
        }
        Some(result)
    }

    pub fn should_analyze(&self, target_name: &str, session: &str, min_interval: Duration) -> bool {
        let key = SessionKey::new(target_name, session);
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
        target_name: &str,
        session: &str,
        min_interval: Duration,
        max_concurrency: usize,
    ) -> bool {
        let key = SessionKey::new(target_name, session);
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

    pub fn set(&self, target_name: &str, session: &str, mut result: SessionIntelligence) {
        result.stale = false;
        let key = SessionKey::new(target_name, session);
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

    pub fn get_window(
        &self,
        target_name: &str,
        session_name: &str,
        window_id: &str,
        cache_ttl: Duration,
    ) -> Option<(SessionIntelligence, String, CommandClass, String, String)> {
        let key = WindowKey::new(target_name, session_name, window_id);
        let state = self.inner.lock().ok()?;
        let entry = state.window_cache.get(&key)?;
        let mut result = entry.result.clone();
        if entry.analyzed_at.elapsed() > cache_ttl {
            result.stale = true;
        }
        Some((
            result,
            entry.content_hash.clone(),
            entry.command_class,
            entry.command_basename.clone(),
            entry.pane_signature.clone(),
        ))
    }

    pub fn begin_analyze_window(
        &self,
        target_name: &str,
        session_name: &str,
        window_id: &str,
        content_hash: &str,
        command_class: CommandClass,
        command_basename: &str,
        pane_signature: &str,
        min_interval: Duration,
        max_concurrency: usize,
    ) -> WindowCacheDecision {
        let key = WindowKey::new(target_name, session_name, window_id);

        let Ok(mut state) = self.inner.lock() else {
            return WindowCacheDecision::InFlight;
        };

        if state.window_in_flight.contains(&key) {
            return WindowCacheDecision::InFlight;
        }

        if let Some(entry) = state.window_cache.get(&key) {
            let all_match = entry.content_hash == content_hash
                && entry.command_class == command_class
                && entry.command_basename == command_basename
                && entry.pane_signature == pane_signature;

            if all_match {
                if command_class == CommandClass::AiCli && entry.result.status == "running" {
                    let mut blocked = entry.result.clone();
                    blocked.status = "blocked".to_string();
                    blocked.stale = false;
                    blocked.updated_at = now_rfc3339();
                    return WindowCacheDecision::SkipBlocked(blocked);
                }
                return WindowCacheDecision::SkipUnchanged(entry.result.clone());
            }

            if entry.analyzed_at.elapsed() < min_interval {
                let mut stale_result = entry.result.clone();
                stale_result.stale = true;
                return WindowCacheDecision::SkipUnchanged(stale_result);
            }
        }

        if state.window_in_flight.len() >= max_concurrency.max(1) {
            if let Some(entry) = state.window_cache.get(&key) {
                let mut stale_result = entry.result.clone();
                stale_result.stale = true;
                return WindowCacheDecision::SkipUnchanged(stale_result);
            }
            return WindowCacheDecision::InFlight;
        }

        state.window_in_flight.insert(key);
        WindowCacheDecision::Proceed
    }

    pub fn set_window(
        &self,
        target_name: &str,
        session_name: &str,
        window_id: &str,
        mut result: SessionIntelligence,
        content_hash: &str,
        command_class: CommandClass,
        command_basename: &str,
        pane_signature: &str,
    ) {
        result.stale = false;
        let key = WindowKey::new(target_name, session_name, window_id);
        if let Ok(mut state) = self.inner.lock() {
            state.window_in_flight.remove(&key);
            state.window_cache.insert(
                key,
                WindowIntelligenceEntry {
                    result,
                    content_hash: content_hash.to_string(),
                    command_class,
                    command_basename: command_basename.to_string(),
                    pane_signature: pane_signature.to_string(),
                    analyzed_at: Instant::now(),
                },
            );
        }
    }
}

impl SessionKey {
    fn new(target_name: &str, session: &str) -> Self {
        Self {
            target_name: target_name.to_string(),
            session: session.to_string(),
        }
    }
}

impl WindowKey {
    pub fn new(target_name: &str, session_name: &str, window_id: &str) -> Self {
        Self {
            target_name: target_name.to_string(),
            session_name: session_name.to_string(),
            window_id: window_id.to_string(),
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

pub struct AnalysisResult {
    pub intelligence: SessionIntelligence,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub raw_response: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AiProviderError {
    pub message: String,
    pub raw_response: Option<String>,
}

pub async fn analyze_text(
    provider: &ActiveProvider,
    text: &str,
    timeout: Duration,
) -> Result<AnalysisResult, AiProviderError> {
    if provider.model.trim().is_empty() {
        return Err(AiProviderError {
            message: "AI provider model is empty".to_string(),
            raw_response: None,
        });
    }

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|err| AiProviderError {
            message: format!("create AI client: {err}"),
            raw_response: None,
        })?;
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
                    "content": "Analyze a tmux session transcript. Return only JSON with application, status, summary, confidence. application should be the detected app or CLI name as a lowercase identifier, or unknown if unsure. status must be one of none,waiting,dead_loop,blocked,waiting_confirm,waiting_idle,running. 使用中文回复。"
                },
                {
                    "role": "user",
                    "content": text
                }
            ]
        }))
        .send()
        .await
        .map_err(|err| AiProviderError {
            message: format!("call AI provider: {err}"),
            raw_response: None,
        })?;

    let status = response.status();
    if !status.is_success() {
        let raw_response = response.text().await.ok();
        return Err(AiProviderError {
            message: format!("AI provider returned HTTP {}", status),
            raw_response,
        });
    }

    let body = response.text().await.map_err(|err| AiProviderError {
        message: format!("read AI provider response: {err}"),
        raw_response: None,
    })?;

    let completion: ChatCompletionResponse =
        serde_json::from_str(&body).map_err(|err| AiProviderError {
            message: format!("decode AI provider response: {err}"),
            raw_response: Some(body.clone()),
        })?;
    let content = completion
        .choices
        .first()
        .map(|choice| choice.message.content.trim())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| AiProviderError {
            message: "AI provider response did not include content".to_string(),
            raw_response: Some(body.clone()),
        })?;

    let parsed: ModelIntelligence =
        parse_model_intelligence(content).map_err(|err| AiProviderError {
            message: format!("decode AI intelligence JSON: {err}"),
            raw_response: Some(body.clone()),
        })?;
    let intelligence = parsed
        .into_intelligence(provider)
        .map_err(|message| AiProviderError {
            message,
            raw_response: Some(body.clone()),
        })?;

    let usage = completion.usage.unwrap_or_default();
    Ok(AnalysisResult {
        intelligence,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        raw_response: Some(body),
    })
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

pub fn now_rfc3339() -> String {
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

fn parse_model_intelligence(content: &str) -> Result<ModelIntelligence, serde_json::Error> {
    let stripped = strip_json_fence(content);
    match serde_json::from_str(stripped) {
        Ok(parsed) => Ok(parsed),
        Err(original_err) => {
            let repaired = repair_missing_property_commas(stripped);
            if repaired == stripped {
                return Err(original_err);
            }
            serde_json::from_str(&repaired).map_err(|_| original_err)
        }
    }
}

fn repair_missing_property_commas(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut repaired = String::with_capacity(content.len() + lines.len());

    for (index, line) in lines.iter().enumerate() {
        repaired.push_str(line);
        if should_insert_comma(line, lines.get(index + 1).copied()) {
            repaired.push(',');
        }
        if index + 1 < lines.len() {
            repaired.push('\n');
        }
    }

    repaired
}

fn should_insert_comma(line: &str, next_line: Option<&str>) -> bool {
    let current = line.trim_end();
    let Some(next) = next_line.map(str::trim_start) else {
        return false;
    };

    !current.is_empty()
        && !current.ends_with(',')
        && !current.ends_with('{')
        && !current.ends_with('[')
        && next.starts_with('"')
        && next.contains("\":")
        && line_ends_with_json_value(current)
}

fn line_ends_with_json_value(line: &str) -> bool {
    line.ends_with('"')
        || line.ends_with('}')
        || line.ends_with(']')
        || line.ends_with("true")
        || line.ends_with("false")
        || line.ends_with("null")
        || line
            .as_bytes()
            .last()
            .is_some_and(|byte| byte.is_ascii_digit())
}

impl ActiveProvider {
    pub fn source(&self) -> String {
        if self.name.trim().is_empty() {
            format!("{}/{}", self.provider, self.model)
        } else {
            format!("{}/{}", self.name, self.model)
        }
    }
}

#[derive(Debug, Deserialize, Default)]
struct ChatUsage {
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
    total_tokens: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
    usage: Option<ChatUsage>,
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
    #[serde(default, deserialize_with = "deserialize_confidence")]
    confidence: Option<f32>,
}

fn deserialize_confidence<'de, D>(deserializer: D) -> Result<Option<f32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{Error, Visitor};
    use std::fmt;

    struct ConfidenceVisitor;

    impl<'de> Visitor<'de> for ConfidenceVisitor {
        type Value = Option<f32>;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a float or a string like 'high', 'medium', 'low'")
        }

        fn visit_f64<E: Error>(self, value: f64) -> Result<Self::Value, E> {
            Ok(Some(value as f32))
        }

        fn visit_i64<E: Error>(self, value: i64) -> Result<Self::Value, E> {
            Ok(Some(value as i64 as f32))
        }

        fn visit_u64<E: Error>(self, value: u64) -> Result<Self::Value, E> {
            Ok(Some(value as u64 as f32))
        }

        fn visit_str<E: Error>(self, value: &str) -> Result<Self::Value, E> {
            let v = match value.trim().to_ascii_lowercase().as_str() {
                "high" | "very_high" | "高" | "高置信度" => 1.0,
                "medium" | "med" | "中" | "中等" | "中置信度" => 0.5,
                "low" | "very_low" | "低" | "低置信度" => 0.0,
                s => match s.parse::<f32>() {
                    Ok(value) => value,
                    Err(_) => return Ok(None),
                },
            };
            Ok(Some(v))
        }
    }

    deserializer.deserialize_any(ConfidenceVisitor)
}

impl ModelIntelligence {
    fn into_intelligence(self, provider: &ActiveProvider) -> Result<SessionIntelligence, String> {
        let app = normalize_application(self.application.as_str());
        let status = normalize_enum(self.status.as_str());
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

fn normalize_application(value: &str) -> String {
    let app = normalize_enum(value);
    if app.is_empty() {
        "unknown".to_string()
    } else {
        app
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandClass {
    AiCli,
    NonAi,
    Unknown,
}

pub fn classify_command(command: &str) -> CommandClass {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return CommandClass::Unknown;
    }

    let basename = trimmed
        .rfind('/')
        .map_or(trimmed, |pos| &trimmed[pos + 1..]);
    if basename.is_empty() {
        return CommandClass::Unknown;
    }

    let lower = basename.to_ascii_lowercase();

    match lower.as_str() {
        "opencode" | "claude" | "codex" => CommandClass::AiCli,
        "sh" | "bash" | "zsh" | "fish" | "make" | "python" | "python3" | "ruby" | "node"
        | "npm" | "bun" | "cargo" | "go" | "rustc" | "grep" | "awk" | "sed" | "cat" | "ls"
        | "vim" | "nvim" => CommandClass::NonAi,
        _ => CommandClass::Unknown,
    }
}

pub fn compute_pane_signature(panes: &[(String, usize, String)]) -> String {
    if panes.is_empty() {
        return String::new();
    }

    let mut sorted: Vec<_> = panes.to_vec();
    sorted.sort_by_key(|(_, idx, _)| *idx);

    sorted
        .iter()
        .map(|(pane_id, pane_index, cmd_basename)| format!("{pane_id}:{pane_index}:{cmd_basename}"))
        .collect::<Vec<_>>()
        .join("|")
}

pub fn normalize_window_transcript(text: &str) -> String {
    let mut kept_lines: Vec<String> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim_end();
        if is_status_bar_line(trimmed) {
            continue;
        }
        if !trimmed.is_empty() {
            kept_lines.push(trimmed.to_string());
        }
    }

    kept_lines.join("\n").trim().to_string()
}

fn is_status_bar_line(line: &str) -> bool {
    has_clock_pattern(line) && has_status_keyword(line)
}

fn has_clock_pattern(line: &str) -> bool {
    match_clock_time(line) || match_iso_date(line)
}

fn match_clock_time(line: &str) -> bool {
    let chars: Vec<char> = line.chars().collect();
    let n = chars.len();

    for i in 0..n {
        if chars[i].is_ascii_digit() {
            let mut pos = i;
            let mut hour_digits = 0;
            while pos < n && chars[pos].is_ascii_digit() && hour_digits < 2 {
                hour_digits += 1;
                pos += 1;
            }

            if hour_digits >= 1 && hour_digits <= 2 && pos < n && chars[pos] == ':' {
                pos += 1;
                let mut minute_digits = 0;
                while pos < n && chars[pos].is_ascii_digit() && minute_digits < 2 {
                    minute_digits += 1;
                    pos += 1;
                }

                if minute_digits == 2 {
                    if pos < n && chars[pos] == ':' {
                        pos += 1;
                        let mut second_digits = 0;
                        while pos < n && chars[pos].is_ascii_digit() && second_digits < 2 {
                            second_digits += 1;
                            pos += 1;
                        }
                        if second_digits == 2 {
                            return true;
                        }
                    } else {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn match_iso_date(line: &str) -> bool {
    let chars: Vec<char> = line.chars().collect();
    let n = chars.len();

    for i in 0..n {
        if chars[i].is_ascii_digit() {
            let mut pos = i;
            let mut year_digits = 0;
            while pos < n && chars[pos].is_ascii_digit() && year_digits < 4 {
                year_digits += 1;
                pos += 1;
            }

            if year_digits == 4 && pos < n && chars[pos] == '-' {
                pos += 1;
                let mut month_digits = 0;
                while pos < n && chars[pos].is_ascii_digit() && month_digits < 2 {
                    month_digits += 1;
                    pos += 1;
                }

                if month_digits == 2 && pos < n && chars[pos] == '-' {
                    pos += 1;
                    let mut day_digits = 0;
                    while pos < n && chars[pos].is_ascii_digit() && day_digits < 2 {
                        day_digits += 1;
                        pos += 1;
                    }
                    if day_digits == 2 {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn has_status_keyword(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();

    let keywords = ["battery", "bat", "wifi", "cpu", "mem"];
    for kw in keywords {
        if lower.contains(kw) {
            return true;
        }
    }

    let symbols = ['%', '🔋', '│', '─', '═', '▓', '▌', '▐'];
    for sym in symbols {
        if line.contains(sym) {
            return true;
        }
    }

    false
}

pub fn hash_window_content(normalized: &str) -> String {
    let trimmed = normalized.trim();
    let mut hasher = Sha256::new();
    hasher.update(trimmed.as_bytes());
    let result = hasher.finalize();
    hex_encode(result.as_slice())
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut hex = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        hex.push_str(&format!("{:02x}", byte));
    }
    hex
}

pub fn hash_window_panes(panes: &[(usize, &str)]) -> String {
    if panes.is_empty() {
        return hash_window_content("");
    }

    let mut sorted_panes: Vec<(usize, &str)> = panes.to_vec();
    sorted_panes.sort_by_key(|(idx, _)| *idx);

    let parts: Vec<String> = sorted_panes
        .iter()
        .map(|(_, transcript)| normalize_window_transcript(transcript))
        .collect();

    let combined = parts.join("\n---pane-separator---\n");
    hash_window_content(&combined)
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

    #[test]
    fn deserialize_confidence_accepts_numeric_and_string_values() {
        let parsed: ModelIntelligence = serde_json::from_str(
            r#"{"application":"zsh","status":"waiting","summary":"test","confidence":0.9}"#,
        )
        .expect("numeric confidence should parse");
        assert!((parsed.confidence.unwrap() - 0.9).abs() < f32::EPSILON);

        let parsed: ModelIntelligence = serde_json::from_str(
            r#"{"application":"zsh","status":"waiting","summary":"test","confidence":1}"#,
        )
        .expect("integer confidence should parse");
        assert!((parsed.confidence.unwrap() - 1.0).abs() < f32::EPSILON);

        let parsed: ModelIntelligence =
            serde_json::from_str(r#"{"application":"opencode","status":"waiting_idle","summary":"done","confidence":"high"}"#)
                .expect("string 'high' confidence should parse");
        assert!((parsed.confidence.unwrap() - 1.0).abs() < f32::EPSILON);

        let parsed: ModelIntelligence = serde_json::from_str(
            r#"{"application":"zsh","status":"waiting","summary":"test","confidence":"medium"}"#,
        )
        .expect("string 'medium' confidence should parse");
        assert!((parsed.confidence.unwrap() - 0.5).abs() < f32::EPSILON);

        let parsed: ModelIntelligence = serde_json::from_str(
            r#"{"application":"zsh","status":"waiting","summary":"test","confidence":"low"}"#,
        )
        .expect("string 'low' confidence should parse");
        assert!((parsed.confidence.unwrap() - 0.0).abs() < f32::EPSILON);

        let parsed: ModelIntelligence = serde_json::from_str(
            r#"{"application":"wmux","status":"waiting_idle","summary":"test","confidence":"中"}"#,
        )
        .expect("Chinese confidence should parse");
        assert!((parsed.confidence.unwrap() - 0.5).abs() < f32::EPSILON);

        let parsed: ModelIntelligence = serde_json::from_str(
            r#"{"application":"wmux","status":"waiting_idle","summary":"test","confidence":"unknown"}"#,
        )
        .expect("unknown confidence string should not fail the whole response");
        assert_eq!(parsed.confidence, None);

        let parsed: ModelIntelligence =
            serde_json::from_str(r#"{"application":"zsh","status":"waiting","summary":"test"}"#)
                .expect("missing confidence should parse");
        assert_eq!(parsed.confidence, None);
    }

    #[test]
    fn deserialize_confidence_string_maps_into_intelligence_correctly() {
        let provider = ActiveProvider {
            name: "test".to_string(),
            provider: "openai".to_string(),
            model: "gpt-4".to_string(),
            api_key: "key".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
        };

        let parsed: ModelIntelligence =
            serde_json::from_str(r#"{"application":"opencode","status":"waiting_idle","summary":"修改完成，全部92个测试通过。","confidence":"high"}"#)
                .expect("deepseek response should parse");

        let intelligence = parsed.into_intelligence(&provider).expect("should convert");
        assert_eq!(intelligence.app, "opencode");
        assert_eq!(intelligence.status, "waiting_idle");
        assert_eq!(intelligence.summary, "修改完成，全部92个测试通过。");
        assert!((intelligence.confidence - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn parse_model_intelligence_repairs_missing_property_commas() {
        let parsed = parse_model_intelligence(
            r#"{
  "application": "wmux"
  "status": "waiting_idle"
  "summary": "编译并运行 wmux-tauri 后出现 401 警告。"
  "confidence": "中"
}"#,
        )
        .expect("model JSON with missing property commas should parse");

        assert_eq!(parsed.application, "wmux");
        assert_eq!(parsed.status, "waiting_idle");
        assert_eq!(parsed.summary, "编译并运行 wmux-tauri 后出现 401 警告。");
        assert!((parsed.confidence.unwrap() - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn model_intelligence_accepts_arbitrary_application_name() {
        let provider = ActiveProvider {
            name: "test".to_string(),
            provider: "openai".to_string(),
            model: "gpt-4".to_string(),
            api_key: "key".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
        };

        let parsed: ModelIntelligence = serde_json::from_str(
            r#"{"application":"wmux","status":"running","summary":"wmux 服务正在运行。","confidence":0.9}"#,
        )
        .expect("arbitrary application should parse");

        let intelligence = parsed.into_intelligence(&provider).expect("should convert");
        assert_eq!(intelligence.app, "wmux");
        assert_eq!(intelligence.status, "running");
        assert_eq!(intelligence.app_counts.unwrap().get("wmux"), Some(&1));
    }

    #[test]
    fn classify_command_ai_cli_variants() {
        assert_eq!(classify_command("claude"), CommandClass::AiCli);
        assert_eq!(classify_command("codex"), CommandClass::AiCli);
        assert_eq!(classify_command("opencode"), CommandClass::AiCli);
        assert_eq!(
            classify_command("/opt/homebrew/bin/codex"),
            CommandClass::AiCli
        );
        assert_eq!(
            classify_command("/usr/local/bin/claude"),
            CommandClass::AiCli
        );
    }

    #[test]
    fn classify_command_non_ai_variants() {
        assert_eq!(classify_command("sh"), CommandClass::NonAi);
        assert_eq!(classify_command("bash"), CommandClass::NonAi);
        assert_eq!(classify_command("zsh"), CommandClass::NonAi);
        assert_eq!(classify_command("make"), CommandClass::NonAi);
        assert_eq!(classify_command("python3"), CommandClass::NonAi);
    }

    #[test]
    fn classify_command_unknown_variants() {
        assert_eq!(classify_command(""), CommandClass::Unknown);
        assert_eq!(classify_command("htop"), CommandClass::Unknown);
        assert_eq!(classify_command("tmux"), CommandClass::Unknown);
    }

    #[test]
    fn normalize_removes_status_bar_line_with_clock_and_battery() {
        let input = "14:35 🔋 85% │ cpu 12%\n$ ls -la\nexit code 0\n";
        let normalized = normalize_window_transcript(input);
        assert!(!normalized.contains("14:35"));
        assert!(!normalized.contains("85%"));
        assert!(normalized.contains("$ ls -la"));
        assert!(normalized.contains("exit code 0"));
    }

    #[test]
    fn normalize_preserves_lines_with_numbers_but_no_status_keywords() {
        let input = "exit code 1\n3 tests passed\nerror: line 42\n";
        let normalized = normalize_window_transcript(input);
        assert!(normalized.contains("exit code 1"));
        assert!(normalized.contains("3 tests passed"));
        assert!(normalized.contains("error: line 42"));
    }

    #[test]
    fn normalize_preserves_command_output_with_timestamp_like_text() {
        let input = "log entry: 2024-01-15 started process\nbuild finished at 09:30\n";
        let normalized = normalize_window_transcript(input);
        assert!(normalized.contains("2024-01-15"));
        assert!(normalized.contains("09:30"));
    }

    #[test]
    fn normalize_removes_iso_date_with_battery_indicator() {
        let input = "2024-01-15 🔋 battery low\n$ pwd\n/home/user\n";
        let normalized = normalize_window_transcript(input);
        assert!(!normalized.contains("2024-01-15"));
        assert!(!normalized.contains("battery"));
        assert!(normalized.contains("$ pwd"));
        assert!(normalized.contains("/home/user"));
    }

    #[test]
    fn normalize_trims_trailing_whitespace_from_each_line() {
        let input = "line one   \nline two\t\t\nline three\n";
        let normalized = normalize_window_transcript(input);
        assert_eq!(normalized, "line one\nline two\nline three");
    }

    #[test]
    fn normalize_empty_input_returns_empty_string() {
        let normalized = normalize_window_transcript("");
        assert_eq!(normalized, "");
        let normalized_whitespace = normalize_window_transcript("   \n\t\n  ");
        assert_eq!(normalized_whitespace, "");
    }

    #[test]
    fn hash_empty_content_is_deterministic_sha256() {
        let hash = hash_window_content("");
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn hash_whitespace_only_returns_deterministic_sha256() {
        let hash = hash_window_content("   \n\t\n  ");
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn transcripts_differing_only_by_status_line_have_same_hash() {
        let t1 = "14:35 🔋 85% │ wifi on\n$ npm test\n3 tests passed\n";
        let t2 = "15:42 🔋 72% │ cpu 8%\n$ npm test\n3 tests passed\n";
        let h1 = hash_window_content(&normalize_window_transcript(t1));
        let h2 = hash_window_content(&normalize_window_transcript(t2));
        assert_eq!(h1, h2);
    }

    #[test]
    fn transcripts_with_different_command_output_have_different_hashes() {
        let t1 = "$ npm test\n3 tests passed\n";
        let t2 = "$ npm test\n0 tests passed\n";
        let h1 = hash_window_content(&normalize_window_transcript(t1));
        let h2 = hash_window_content(&normalize_window_transcript(t2));
        assert_ne!(h1, h2);
    }

    #[test]
    fn hash_window_panes_sorts_by_pane_index() {
        let panes: [(usize, &str); 3] = [
            (2, "pane two output"),
            (0, "pane zero output"),
            (1, "pane one output"),
        ];
        let hash = hash_window_panes(&panes);
        let sorted_panes: [(usize, &str); 3] = [
            (0, "pane zero output"),
            (1, "pane one output"),
            (2, "pane two output"),
        ];
        let sorted_hash = hash_window_panes(&sorted_panes);
        assert_eq!(hash, sorted_hash);
    }

    #[test]
    fn hash_window_panes_separator_between_panes() {
        let panes: [(usize, &str); 2] = [(0, "first pane"), (1, "second pane")];
        let normalized = format!(
            "{}\n---pane-separator---\n{}",
            normalize_window_transcript("first pane"),
            normalize_window_transcript("second pane")
        );
        let expected_hash = hash_window_content(&normalized);
        let actual_hash = hash_window_panes(&panes);
        assert_eq!(expected_hash, actual_hash);
    }

    #[test]
    fn hash_window_panes_empty_panes_returns_empty_hash() {
        let panes: [(usize, &str); 0] = [];
        let hash = hash_window_panes(&panes);
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    // ============================================================================
    // Window-level cache tests (Task 3)
    // ============================================================================

    fn sample_window_intelligence(status: &str) -> SessionIntelligence {
        SessionIntelligence {
            app: "claude".to_string(),
            status: status.to_string(),
            summary: "window analysis".to_string(),
            source: "test/model".to_string(),
            confidence: 0.9,
            stale: false,
            updated_at: now_rfc3339(),
            error: None,
            app_counts: None,
        }
    }

    #[test]
    fn window_cache_two_different_windows_in_same_session_have_independent_entries() {
        let store = IntelligenceStore::default();
        let ttl = Duration::from_secs(300);
        let hash1 = "hash-alpha";
        let hash2 = "hash-beta";
        let sig1 = "pane0:0:claude";
        let sig2 = "pane1:0:codex";

        // Set window 0
        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("running"),
            hash1,
            CommandClass::AiCli,
            "claude",
            sig1,
        );

        // Set window 1
        store.set_window(
            "conn",
            "dev",
            "1",
            sample_window_intelligence("waiting"),
            hash2,
            CommandClass::AiCli,
            "codex",
            sig2,
        );

        // Retrieve independently
        let w0 = store
            .get_window("conn", "dev", "0", ttl)
            .expect("window 0 cached");
        assert_eq!(w0.0.status, "running");
        assert_eq!(w0.1, hash1);

        let w1 = store
            .get_window("conn", "dev", "1", ttl)
            .expect("window 1 cached");
        assert_eq!(w1.0.status, "waiting");
        assert_eq!(w1.1, hash2);

        // Window 2 not cached
        assert!(store.get_window("conn", "dev", "2", ttl).is_none());
    }

    #[test]
    fn window_cache_same_window_same_all_params_returns_skip_unchanged() {
        let store = IntelligenceStore::default();
        let hash = "stable-hash";
        let sig = "pane0:0:claude";
        let min_interval = Duration::from_secs(0);
        let max_concurrency = 5;

        // Initial set
        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("waiting_idle"),
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
        );

        // Same params → SkipUnchanged
        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
            min_interval,
            max_concurrency,
        );

        match decision {
            WindowCacheDecision::SkipUnchanged(result) => {
                assert_eq!(result.status, "waiting_idle");
                assert!(!result.stale);
            }
            _ => panic!("expected SkipUnchanged, got {:?}", decision),
        }
    }

    #[test]
    fn window_cache_ai_cli_running_with_same_params_returns_skip_blocked() {
        let store = IntelligenceStore::default();
        let hash = "stable-hash";
        let sig = "pane0:0:claude";
        let min_interval = Duration::from_secs(0);

        // Set with "running" status
        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("running"),
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
        );

        // Same params + AiCli + running → SkipBlocked
        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
            min_interval,
            5,
        );

        match decision {
            WindowCacheDecision::SkipBlocked(result) => {
                assert_eq!(result.status, "blocked");
                assert!(!result.stale);
            }
            _ => panic!("expected SkipBlocked for AiCli+running, got {:?}", decision),
        }
    }

    #[test]
    fn window_cache_non_ai_with_running_still_returns_skip_unchanged() {
        let store = IntelligenceStore::default();
        let hash = "stable-hash";
        let sig = "pane0:0:zsh";
        let min_interval = Duration::from_secs(0);

        // Set with "running" status + NonAi
        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("running"),
            hash,
            CommandClass::NonAi,
            "zsh",
            sig,
        );

        // NonAi + running → SkipUnchanged (NOT SkipBlocked)
        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::NonAi,
            "zsh",
            sig,
            min_interval,
            5,
        );

        match decision {
            WindowCacheDecision::SkipUnchanged(result) => {
                assert_eq!(result.status, "running");
            }
            _ => panic!(
                "expected SkipUnchanged for NonAi+running, got {:?}",
                decision
            ),
        }
    }

    #[test]
    fn window_cache_changed_hash_returns_proceed_when_interval_passed() {
        let store = IntelligenceStore::default();
        let old_hash = "old-hash";
        let new_hash = "new-hash";
        let sig = "pane0:0:claude";
        let min_interval = Duration::from_secs(0);

        // Set with old hash
        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("waiting"),
            old_hash,
            CommandClass::AiCli,
            "claude",
            sig,
        );

        // Changed hash → Proceed
        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            new_hash,
            CommandClass::AiCli,
            "claude",
            sig,
            min_interval,
            5,
        );

        match decision {
            WindowCacheDecision::Proceed => {}
            _ => panic!("expected Proceed for changed hash, got {:?}", decision),
        }

        // Verify in-flight tracking
        let decision2 = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            new_hash,
            CommandClass::AiCli,
            "claude",
            sig,
            min_interval,
            5,
        );
        match decision2 {
            WindowCacheDecision::InFlight => {}
            _ => panic!("expected InFlight for second call, got {:?}", decision2),
        }
    }

    #[test]
    fn window_cache_changed_command_class_returns_proceed() {
        let store = IntelligenceStore::default();
        let hash = "same-hash";
        let sig = "pane0:0:claude";
        let min_interval = Duration::from_secs(0);

        // Set with AiCli
        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("waiting"),
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
        );

        // Changed class → Proceed (even if hash same)
        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::NonAi, // Changed!
            "zsh",
            sig,
            min_interval,
            5,
        );

        match decision {
            WindowCacheDecision::Proceed => {}
            _ => panic!("expected Proceed for changed class, got {:?}", decision),
        }
    }

    #[test]
    fn window_cache_changed_pane_signature_returns_proceed() {
        let store = IntelligenceStore::default();
        let hash = "same-hash";
        let old_sig = "pane0:0:claude";
        let new_sig = "pane1:0:claude";
        let min_interval = Duration::from_secs(0);

        // Set with old sig
        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("waiting"),
            hash,
            CommandClass::AiCli,
            "claude",
            old_sig,
        );

        // Changed sig → Proceed
        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::AiCli,
            "claude",
            new_sig,
            min_interval,
            5,
        );

        match decision {
            WindowCacheDecision::Proceed => {}
            _ => panic!("expected Proceed for changed sig, got {:?}", decision),
        }
    }

    #[test]
    fn window_cache_window_id_reuse_different_sig_no_skip_blocked_from_old() {
        let store = IntelligenceStore::default();
        let hash = "stable-hash";
        let old_sig = "pane0:0:claude";
        let new_sig = "pane99:0:claude"; // Different pane topology
        let min_interval = Duration::from_secs(0);

        // Set window 0 with running + AiCli
        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("running"),
            hash,
            CommandClass::AiCli,
            "claude",
            old_sig,
        );

        // Same hash but different sig → Proceed (NOT SkipBlocked from old entry)
        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::AiCli,
            "claude",
            new_sig,
            min_interval,
            5,
        );

        match decision {
            WindowCacheDecision::Proceed => {}
            WindowCacheDecision::SkipBlocked(_) => {
                panic!("SkipBlocked should NOT happen with different pane_signature");
            }
            _ => panic!("expected Proceed, got {:?}", decision),
        }
    }

    #[test]
    fn window_cache_in_flight_dedup_same_window_twice_second_returns_in_flight() {
        let store = IntelligenceStore::default();
        let hash = "new-hash";
        let sig = "pane0:0:claude";
        let min_interval = Duration::from_secs(0);

        // Window not in cache → first call Proceed
        let decision1 = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
            min_interval,
            5,
        );
        match decision1 {
            WindowCacheDecision::Proceed => {}
            _ => panic!("expected Proceed for first call, got {:?}", decision1),
        }

        // Second call → InFlight
        let decision2 = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
            min_interval,
            5,
        );
        match decision2 {
            WindowCacheDecision::InFlight => {}
            _ => panic!("expected InFlight for second call, got {:?}", decision2),
        }
    }

    #[test]
    fn window_cache_max_concurrency_limit_blocks_proceed() {
        let store = IntelligenceStore::default();
        let hash = "new-hash";
        let min_interval = Duration::from_secs(0);

        // Fill up concurrency limit (max = 2)
        let d1 = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::AiCli,
            "claude",
            "sig0",
            min_interval,
            2,
        );
        assert!(matches!(d1, WindowCacheDecision::Proceed));

        let d2 = store.begin_analyze_window(
            "conn",
            "dev",
            "1",
            hash,
            CommandClass::AiCli,
            "claude",
            "sig1",
            min_interval,
            2,
        );
        assert!(matches!(d2, WindowCacheDecision::Proceed));

        // Third window blocked by concurrency
        let d3 = store.begin_analyze_window(
            "conn",
            "dev",
            "2",
            hash,
            CommandClass::AiCli,
            "claude",
            "sig2",
            min_interval,
            2,
        );
        match d3 {
            WindowCacheDecision::SkipUnchanged(_) => {
                // Expected: no cached entry, but concurrency blocked
                // Returns SkipUnchanged with None result logic (in implementation we return stale cached)
                // Since window 2 not cached, we should NOT get SkipUnchanged
                panic!("window 2 not cached, should not return SkipUnchanged");
            }
            WindowCacheDecision::Proceed => {
                panic!("max concurrency = 2, third window should be blocked");
            }
            _ => {}
        }
    }

    #[test]
    fn window_cache_stale_ttl_marks_result_stale_without_breaking() {
        let store = IntelligenceStore::default();
        let hash = "stable-hash";
        let sig = "pane0:0:claude";

        // Set window
        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("waiting"),
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
        );

        // Very short TTL → stale
        let ttl_zero = Duration::from_secs(0);
        let result = store
            .get_window("conn", "dev", "0", ttl_zero)
            .expect("cached");
        assert!(result.0.stale);
        assert_eq!(result.0.status, "waiting");
    }

    #[test]
    fn compute_pane_signature_sorts_by_pane_index() {
        let panes: [(String, usize, String); 3] = [
            ("pane2".to_string(), 2, "codex".to_string()),
            ("pane0".to_string(), 0, "claude".to_string()),
            ("pane1".to_string(), 1, "zsh".to_string()),
        ];

        let sig = compute_pane_signature(&panes);
        // Sorted by index: 0, 1, 2
        assert_eq!(sig, "pane0:0:claude|pane1:1:zsh|pane2:2:codex");
    }

    #[test]
    fn compute_pane_signature_empty_panes_returns_empty_string() {
        let panes: [(String, usize, String); 0] = [];
        let sig = compute_pane_signature(&panes);
        assert_eq!(sig, "");
    }

    #[test]
    fn window_cache_min_interval_blocks_proceed_when_too_soon() {
        let store = IntelligenceStore::default();
        let old_hash = "old-hash";
        let new_hash = "new-hash";
        let sig = "pane0:0:claude";
        let min_interval = Duration::from_secs(60); // 60 seconds

        // Set window with old hash
        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("waiting"),
            old_hash,
            CommandClass::AiCli,
            "claude",
            sig,
        );

        // Changed hash but min_interval not passed → SkipUnchanged (stale cached result)
        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            new_hash,
            CommandClass::AiCli,
            "claude",
            sig,
            min_interval,
            5,
        );

        match decision {
            WindowCacheDecision::SkipUnchanged(result) => {
                // Returns stale cached result because interval too short
                assert!(result.stale);
                assert_eq!(result.status, "waiting");
            }
            WindowCacheDecision::Proceed => {
                panic!("min_interval not passed, should NOT proceed");
            }
            _ => panic!("expected SkipUnchanged, got {:?}", decision),
        }
    }

    #[test]
    fn test_window_cache_non_ai_unchanged_skip() {
        let store = IntelligenceStore::default();
        let hash = "abc123";
        let sig = "pane0:0:zsh";
        let min_interval = Duration::from_secs(0);

        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("running"),
            hash,
            CommandClass::NonAi,
            "zsh",
            sig,
        );

        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::NonAi,
            "zsh",
            sig,
            min_interval,
            5,
        );

        match decision {
            WindowCacheDecision::SkipUnchanged(result) => {
                assert_eq!(result.status, "running");
            }
            _ => panic!(
                "expected SkipUnchanged for NonAi+unchanged, got {:?}",
                decision
            ),
        }
    }

    #[test]
    fn test_window_cache_aicli_running_unchanged_blocked() {
        let store = IntelligenceStore::default();
        let hash = "abc123";
        let sig = "pane0:0:claude";
        let min_interval = Duration::from_secs(0);

        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("running"),
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
        );

        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
            min_interval,
            5,
        );

        match decision {
            WindowCacheDecision::SkipBlocked(result) => {
                assert_eq!(result.status, "blocked");
                assert!(!result.stale);
            }
            _ => panic!(
                "expected SkipBlocked for AiCli+running+unchanged, got {:?}",
                decision
            ),
        }
    }

    #[test]
    fn test_window_cache_aicli_not_running_unchanged() {
        let store = IntelligenceStore::default();
        let hash = "abc123";
        let sig = "pane0:0:claude";
        let min_interval = Duration::from_secs(0);

        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("waiting"),
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
        );

        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
            min_interval,
            5,
        );

        match decision {
            WindowCacheDecision::SkipUnchanged(result) => {
                assert_eq!(result.status, "waiting");
                assert_ne!(result.status, "blocked");
            }
            _ => panic!(
                "expected SkipUnchanged for AiCli+not-running+unchanged, got {:?}",
                decision
            ),
        }
    }

    #[test]
    fn test_window_cache_unknown_running_unchanged() {
        let store = IntelligenceStore::default();
        let hash = "abc123";
        let sig = "pane0:0:unknown";
        let min_interval = Duration::from_secs(0);

        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("running"),
            hash,
            CommandClass::Unknown,
            "unknown",
            sig,
        );

        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::Unknown,
            "unknown",
            sig,
            min_interval,
            5,
        );

        match decision {
            WindowCacheDecision::SkipUnchanged(result) => {
                assert_eq!(result.status, "running");
            }
            _ => panic!(
                "expected SkipUnchanged for Unknown+running+unchanged, got {:?}",
                decision
            ),
        }
    }

    #[test]
    fn test_window_cache_changed_hash_proceeds() {
        let store = IntelligenceStore::default();
        let old_hash = "hash1";
        let new_hash = "hash2";
        let sig = "pane0:0:claude";
        let min_interval = Duration::from_secs(0);

        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("waiting"),
            old_hash,
            CommandClass::AiCli,
            "claude",
            sig,
        );

        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            new_hash,
            CommandClass::AiCli,
            "claude",
            sig,
            min_interval,
            5,
        );

        match decision {
            WindowCacheDecision::Proceed => {}
            _ => panic!("expected Proceed for changed hash, got {:?}", decision),
        }
    }

    #[test]
    fn test_skip_unchanged_nonai_means_no_provider_call() {
        // Proves that a NonAi window with unchanged content maps to
        // SkipUnchanged, and the sessions.rs pattern for provider_called
        // evaluates to false (no AI provider is invoked).
        let store = IntelligenceStore::default();
        let hash = "nonai-hash";
        let sig = "pane0:0:zsh";
        let min_interval = Duration::from_secs(0);

        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("running"),
            hash,
            CommandClass::NonAi,
            "zsh",
            sig,
        );

        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::NonAi,
            "zsh",
            sig,
            min_interval,
            5,
        );

        assert!(matches!(decision, WindowCacheDecision::SkipUnchanged(_)));

        let provider_called = matches!(decision, WindowCacheDecision::Proceed);
        assert!(
            !provider_called,
            "SkipUnchanged must set provider_called to false"
        );
    }

    #[test]
    fn test_skip_blocked_aicli_running_means_no_provider_call() {
        // Proves that an AiCli window with unchanged content and running status
        // maps to SkipBlocked, the sessions.rs pattern for provider_called
        // evaluates to false, and the cached intelligence status is "blocked".
        let store = IntelligenceStore::default();
        let hash = "running-aicli-hash";
        let sig = "pane0:0:claude";
        let min_interval = Duration::from_secs(0);

        store.set_window(
            "conn",
            "dev",
            "0",
            sample_window_intelligence("running"),
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
        );

        let decision = store.begin_analyze_window(
            "conn",
            "dev",
            "0",
            hash,
            CommandClass::AiCli,
            "claude",
            sig,
            min_interval,
            5,
        );

        let provider_called = matches!(decision, WindowCacheDecision::Proceed);
        assert!(
            !provider_called,
            "SkipBlocked must set provider_called to false"
        );

        match decision {
            WindowCacheDecision::SkipBlocked(cached_intel) => {
                assert_eq!(cached_intel.status, "blocked");
                assert!(!cached_intel.stale);
            }
            _ => panic!("expected SkipBlocked, got {:?}", decision),
        }
    }
}
