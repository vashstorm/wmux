//! AI HTML generation and sanitization service for project summaries.
//!
//! This module provides functionality to generate sanitized HTML summaries from project
//! metadata using OpenAI-compatible API providers.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use ammonia::Builder;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::config::{Config, IntelligenceConfig, IntelligenceProviderConfig};
use crate::http::ApiError;
use crate::storage::models::{Project, ProjectLayout};

/// Maximum output size in bytes (64 KiB).
const MAX_OUTPUT_SIZE: usize = 65_536;

/// Maximum tokens for AI response.
const MAX_TOKENS: u32 = 1024;

/// Error types for AI operations.
#[derive(Debug, Error)]
pub enum AiError {
    /// Provider configuration is missing or incomplete.
    #[error("AI provider not configured: missing base_url, model, or api_key")]
    ProviderNotConfigured,

    /// HTTP request failed.
    #[error("HTTP error: {0}")]
    HttpError(String),

    /// Failed to parse API response.
    #[error("Parse error: {0}")]
    ParseError(String),

    /// Output exceeds maximum size limit.
    #[error("Output exceeds maximum size of {MAX_OUTPUT_SIZE} bytes")]
    SizeExceeded,
}

impl From<AiError> for ApiError {
    fn from(err: AiError) -> Self {
        match err {
            AiError::ProviderNotConfigured => ApiError::bad_request(err.to_string()),
            AiError::HttpError(_) => ApiError::bad_request(err.to_string()),
            AiError::ParseError(_) => ApiError::internal(err.to_string()),
            AiError::SizeExceeded => ApiError::internal(err.to_string()),
        }
    }
}

/// OpenAI chat completion request.
#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
}

/// Chat message for API request.
#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

/// OpenAI chat completion response.
#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

/// Single choice from API response.
#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
}

/// Message content from API response.
#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: String,
}

/// Gets the active provider configuration from intelligence config.
///
/// Returns the provider config if it exists and has all required fields
/// (base_url, model, api_key), otherwise returns an error.
pub fn get_active_provider(
    config: &IntelligenceConfig,
) -> Result<IntelligenceProviderConfig, AiError> {
    // Find the active provider by name
    let active_name = config.active_provider.trim();
    if active_name.is_empty() {
        return Err(AiError::ProviderNotConfigured);
    }

    let provider = config
        .providers
        .iter()
        .find(|p| p.name == active_name)
        .ok_or(AiError::ProviderNotConfigured)?;

    // Validate required fields
    if provider.base_url.trim().is_empty() {
        return Err(AiError::ProviderNotConfigured);
    }
    if provider.model.trim().is_empty() {
        return Err(AiError::ProviderNotConfigured);
    }
    if provider.api_key.trim().is_empty() {
        return Err(AiError::ProviderNotConfigured);
    }

    Ok(provider.clone())
}

/// Builds a bounded prompt from project metadata.
///
/// The prompt includes project name, description, details, progress, and layout structure
/// (window/pane counts and names), but NEVER includes pane output or terminal content.
pub fn build_prompt(project: &Project) -> String {
    let mut parts = Vec::new();

    // Project name (always included)
    parts.push(format!("Project Name: {}", project.name));

    // Description (if non-empty)
    if !project.description.trim().is_empty() {
        parts.push(format!("Description: {}", project.description));
    }

    // Details JSON (if non-empty)
    if !project.details_json.trim().is_empty() {
        parts.push(format!("Details: {}", project.details_json));
    }

    // Progress JSON (if non-empty)
    if !project.progress_json.trim().is_empty() {
        parts.push(format!("Progress: {}", project.progress_json));
    }

    // Layout summary (window/pane counts, NOT pane output)
    if !project.layout_json.trim().is_empty() {
        if let Ok(layout) = serde_json::from_str::<ProjectLayout>(&project.layout_json) {
            let window_count = layout.windows.len();
            let pane_count = layout.windows.iter().map(|w| w.panes.len()).sum::<usize>();
            let window_names: Vec<&str> = layout.windows.iter().map(|w| w.name.as_str()).collect();
            parts.push(format!(
                "Layout: {} windows, {} panes. Window names: {}",
                window_count,
                pane_count,
                window_names.join(", ")
            ));
        }
    }

    parts.join("\n")
}

/// Sanitizes HTML using ammonia with a strict whitelist.
///
/// Allowed tags: p, br, strong, em, code, pre, ul, ol, li, h2, h3, section,
/// article, div, span, table, thead, tbody, tr, th, td, a
///
/// Allowed attributes:
/// - href on `a` (only http/https/mailto schemes)
/// - class with prefix `wmux-ai-` on any element
pub fn sanitize_html(html: &str) -> String {
    // Define allowed tags
    let allowed_tags: HashSet<&str> = [
        "p", "br", "strong", "em", "code", "pre", "ul", "ol", "li", "h2", "h3", "section",
        "article", "div", "span", "table", "thead", "tbody", "tr", "th", "td", "a",
    ]
    .iter()
    .cloned()
    .collect();

    // Define allowed URL schemes for href
    let allowed_schemes: HashSet<&str> = ["http", "https", "mailto"].iter().cloned().collect();

    // Build tag-specific attributes
    let mut tag_attributes: HashMap<&str, HashSet<&str>> = HashMap::new();

    // Allow href only on 'a' tag
    tag_attributes.insert("a", ["href"].iter().cloned().collect());

    // Build the sanitizer
    let sanitized = Builder::new()
        .tags(allowed_tags)
        .tag_attributes(tag_attributes)
        .url_schemes(allowed_schemes)
        .link_rel(Some("noopener noreferrer"))
        .clean(html);

    sanitized.to_string()
}

/// Truncates a string to a maximum byte size, respecting UTF-8 character boundaries.
fn truncate_to_size(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }

    // Find the largest valid UTF-8 boundary within max_bytes
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Generates sanitized HTML summary from project metadata using AI.
///
/// This function:
/// 1. Loads active provider config from `config.intelligence`
/// 2. Validates provider has non-empty base_url, model, api_key
/// 3. Builds a bounded prompt from project fields (no pane output)
/// 4. Calls OpenAI-compatible `/chat/completions` endpoint
/// 5. Extracts `choices[0].message.content` from response
/// 6. Enforces max output size 64 KiB
/// 7. Sanitizes HTML using ammonia
///
/// Returns the sanitized HTML string.
pub async fn generate_sanitized_html(
    config: &Config,
    project: &Project,
) -> Result<String, AiError> {
    // Get and validate provider config
    let provider = get_active_provider(&config.intelligence)?;

    // Build the prompt (no pane output)
    let user_content = build_prompt(project);

    // System prompt for the AI
    let system_content = "You are a project management assistant. Generate a concise HTML summary of the project. Use only safe HTML tags like p, h2, h3, ul, ol, li, strong, em, code, pre, table elements, and a for links. Keep the summary under 500 words.";

    // Build the request
    let request = ChatRequest {
        model: provider.model.clone(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_content.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_content,
            },
        ],
        max_tokens: MAX_TOKENS,
    };

    // Create HTTP client with timeout
    let timeout_secs = config.intelligence.timeout_sec.max(1);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs as u64))
        .build()
        .map_err(|e| AiError::HttpError(e.to_string()))?;

    // Build the API URL
    let base_url = provider.base_url.trim_end_matches('/');
    let api_url = format!("{}/chat/completions", base_url);

    // Make the API call
    let response = client
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", provider.api_key))
        .json(&request)
        .send()
        .await
        .map_err(|e| AiError::HttpError(e.to_string()))?;

    // Check HTTP status (do not include response body in error to avoid leaking provider internals)
    if !response.status().is_success() {
        let status = response.status().as_u16();
        return Err(AiError::HttpError(format!(
            "AI provider returned HTTP {}",
            status
        )));
    }

    // Parse the response
    let chat_response: ChatResponse = response
        .json()
        .await
        .map_err(|e| AiError::ParseError(e.to_string()))?;

    // Extract content from first choice
    let content = chat_response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| AiError::ParseError("No choices in response".to_string()))?;

    // Enforce max output size (truncate on UTF-8 boundary)
    let truncated = truncate_to_size(&content, MAX_OUTPUT_SIZE);

    // Sanitize HTML before returning
    let sanitized = sanitize_html(truncated);

    Ok(sanitized)
}
