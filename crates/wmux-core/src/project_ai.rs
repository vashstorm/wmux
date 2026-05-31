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
/// (model, api_key). If base_url is omitted, the OpenAI-compatible default is used.
pub fn get_active_provider(
    config: &IntelligenceConfig,
) -> Result<IntelligenceProviderConfig, AiError> {
    let active_name = config.active_provider.trim();
    let provider = config
        .providers
        .iter()
        .find(|p| !active_name.is_empty() && p.name == active_name)
        .or_else(|| config.providers.first())
        .ok_or(AiError::ProviderNotConfigured)?;

    // Validate required fields
    if provider.model.trim().is_empty() {
        return Err(AiError::ProviderNotConfigured);
    }
    if provider.api_key.trim().is_empty() {
        return Err(AiError::ProviderNotConfigured);
    }

    let mut provider = provider.clone();
    if provider.base_url.trim().is_empty() {
        provider.base_url = default_base_url(provider.provider.as_str()).to_string();
    }

    Ok(provider)
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
/// Allowed tags: p, br, strong, em, code, pre, ul, ol, li, h1, h2, h3, h4, h5, h6,
/// hr, section, article, div, span, table, thead, tbody, tr, th, td, a
///
/// Allowed attributes:
/// - href on `a` (only http/https/mailto schemes)
/// - class and style globally on any element (to support rich MUI v9 styling)
pub fn sanitize_html(html: &str) -> String {
    // Define allowed tags (expanded with h1, h4, h5, h6, and hr for premium typography and layout structural styling)
    let allowed_tags: HashSet<&str> = [
        "p", "br", "strong", "em", "code", "pre", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5",
        "h6", "hr", "section", "article", "div", "span", "table", "thead", "tbody", "tr", "th",
        "td", "a",
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

    // Allow class and style attributes globally on all allowed tags
    let generic_attributes: HashSet<&str> = ["class", "style"].iter().cloned().collect();

    // Build the sanitizer
    let sanitized = Builder::new()
        .tags(allowed_tags)
        .tag_attributes(tag_attributes)
        .generic_attributes(generic_attributes)
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

    // System prompt for the AI (optimized for premium MUI 9 styling and a gorgeous, rich structure)
    let system_content = r#"You are an elite, modern project management assistant. Your task is to generate a visually stunning, highly professional, and extremely readable HTML summary of the project.
The frontend integrates Material-UI (MUI) Version 9, and the HTML container will automatically apply MUI's design tokens and styles if you use standard MUI v9 class names.

Structure your response using only safe HTML tags. Use standard MUI v9 class names and inline styles to create a premium dashboard layout:

1. CARDS & CONTAINERS:
   Use `div` elements with `MuiPaper-root MuiPaper-outlined MuiPaper-rounded` to wrap major sections in clean, bordered panels.
   Example:
   <div class="MuiPaper-root MuiPaper-outlined MuiPaper-rounded" style="padding: 16px; margin-bottom: 16px; background-color: var(--color-glass-surface); border-color: var(--color-panel-border);">
      ...content...
   </div>

2. TYPOGRAPHY:
   Use standard MUI typography classes for visual hierarchy:
   - Section Titles: <h2 class="MuiTypography-root MuiTypography-h5" style="margin-top: 0; margin-bottom: 10px; font-weight: bold; color: var(--color-text);">Title</h2>
   - Subsections: <h3 class="MuiTypography-root MuiTypography-h6" style="margin-top: 14px; margin-bottom: 6px; color: var(--color-text);">Subtitle</h3>
   - Details Title: <h4 class="MuiTypography-root MuiTypography-subtitle1" style="margin-top: 10px; margin-bottom: 4px; color: var(--color-text-muted);">Header</h4>
   - Standard Body Text: <p class="MuiTypography-root MuiTypography-body1" style="margin-bottom: 10px; line-height: 1.6; color: var(--color-text-muted);">Body content...</p>
   - Code Snippets: <code style="font-family: monospace; background-color: rgba(0,0,0,0.05); padding: 2px 4px; border-radius: 4px;">code</code>

3. CHIPS & BADGES:
   Use `span` to build beautiful outline chips for tags, technologies, and status indicators:
   - MUI Chip: <span class="MuiChip-root MuiChip-outlined MuiChip-sizeSmall" style="margin: 2px; border-color: var(--color-panel-border);"><span class="MuiChip-label" style="font-size: 11px; padding: 0 8px;">Chip Text</span></span>

4. DIVIDERS & SEPARATORS:
   Use `<hr class="MuiDivider-root" style="margin: 16px 0; border: 0; border-top: 1px solid var(--color-panel-border);" />` for separation.

5. LISTS:
   Use `ul` and `li` with clean spacing:
   - List: <ul class="MuiList-root" style="padding-left: 18px; margin-bottom: 10px;">
   - List Item: <li class="MuiListItem-root MuiTypography-root MuiTypography-body2" style="margin-bottom: 4px; color: var(--color-text-muted);">List Item Text</li>

6. DATA TABLES:
   Use `table` elements to format tabular details or progress stats cleanly:
   - Table: <table class="MuiTable-root" style="width: 100%; border-collapse: collapse; margin-top: 8px;">
   - Table Head Cell: <th class="MuiTableCell-root MuiTableCell-head" style="font-weight: bold; border-bottom: 2px solid var(--color-panel-border); padding: 8px; text-align: left; font-size: 12px; color: var(--color-text);">Header</th>
   - Table Body Cell: <td class="MuiTableCell-root MuiTableCell-body" style="border-bottom: 1px solid var(--color-panel-border); padding: 8px; font-size: 13px; color: var(--color-text-muted);">Data</td>

DESIGN RULES:
- Avoid plain, unstyled HTML. Structure the content beautifully with padding, custom container cards, and chips.
- Focus on presenting a summary of the project's state, layout composition, active areas, and progress.
- Keep the summary clear, premium, and under 500 words.
- Do NOT wrap your output in markdown formatting (like ```html ... ```). Return ONLY the raw HTML string, starting immediately with your opening tags."#;

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
    let api_url = chat_completions_url(provider.base_url.as_str());

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

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(name: &str, base_url: &str) -> IntelligenceProviderConfig {
        IntelligenceProviderConfig {
            name: name.to_string(),
            provider: "openai".to_string(),
            model: "gpt-test".to_string(),
            api_key: "sk-test".to_string(),
            base_url: base_url.to_string(),
        }
    }

    #[test]
    fn active_provider_uses_first_provider_when_active_name_is_empty() {
        let config = IntelligenceConfig {
            enabled: true,
            active_provider: String::new(),
            providers: vec![provider("default", "")],
            ..Default::default()
        };

        let selected = get_active_provider(&config).expect("provider");

        assert_eq!(selected.name, "default");
        assert_eq!(selected.base_url, "https://api.openai.com/v1");
    }

    #[test]
    fn chat_completions_url_accepts_base_or_full_endpoint() {
        assert_eq!(
            chat_completions_url("https://api.example.test/v1"),
            "https://api.example.test/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://api.example.test/v1/chat/completions"),
            "https://api.example.test/v1/chat/completions"
        );
    }
}
