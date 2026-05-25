use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::config::{Config, IntelligenceProviderConfig};

const ANALYSIS_SYSTEM_PROMPT: &str = r#"Analyze a tmux session transcript. Return only JSON with application, status, summary, confidence.
application should be the detected app or CLI name as a lowercase identifier, or unknown if unsure.
High-priority application recognition: claude, opencode, and codex are first-class AI CLI identifiers. If pane title, command, or transcript content shows one of these tools, return that exact identifier with high confidence unless the transcript clearly proves a different active application. These identifiers outrank shell/process wrapper names such as zsh, bash, sh, tmux, node, bun, cargo, or make.
status must be one of none,waiting,dead_loop,blocked,waiting_confirm,waiting_idle,running.
使用中文回复。"#;

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
                    "content": ANALYSIS_SYSTEM_PROMPT
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
        let mut summary = self.summary.trim().to_string();
        if summary.is_empty() {
            summary = match status.as_str() {
                "none" | "waiting_idle" => "终端空闲".to_string(),
                "waiting" | "waiting_confirm" => "等待输入/确认".to_string(),
                "dead_loop" => "检测到死循环".to_string(),
                "blocked" => "命令受阻".to_string(),
                "running" => "命令运行中".to_string(),
                _ => "无活动任务".to_string(),
            };
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
