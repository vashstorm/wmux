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
pub fn get_active_provider(config: &IntelligenceConfig) -> Result<IntelligenceProviderConfig, AiError> {
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
        "p", "br", "strong", "em", "code", "pre",
        "ul", "ol", "li", "h2", "h3",
        "section", "article", "div", "span",
        "table", "thead", "tbody", "tr", "th", "td", "a",
    ].iter().cloned().collect();

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
pub async fn generate_sanitized_html(config: &Config, project: &Project) -> Result<String, AiError> {
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
        return Err(AiError::HttpError(format!("AI provider returned HTTP {}", status)));
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

    #[test]
    fn sanitizer_strips_script_tags() {
        let html = "<p>Hello</p><script>alert('xss')</script><p>World</p>";
        let sanitized = sanitize_html(html);
        assert!(!sanitized.contains("<script"));
        assert!(!sanitized.contains("alert"));
        assert!(sanitized.contains("<p>Hello</p>"));
        assert!(sanitized.contains("<p>World</p>"));
    }

    #[test]
    fn sanitizer_strips_iframe_tags() {
        let html = "<iframe src=\"evil.com\"></iframe><p>Safe</p>";
        let sanitized = sanitize_html(html);
        assert!(!sanitized.contains("<iframe"));
        assert!(sanitized.contains("<p>Safe</p>"));
    }

    #[test]
    fn sanitizer_strips_form_tags() {
        let html = "<form action=\"evil.com\"><input type=\"text\"/><p>Content</p></form>";
        let sanitized = sanitize_html(html);
        assert!(!sanitized.contains("<form"));
        assert!(!sanitized.contains("<input"));
        assert!(sanitized.contains("<p>Content</p>"));
    }

    #[test]
    fn sanitizer_strips_object_and_embed_tags() {
        let html = "<object data=\"evil.swf\"></object><embed src=\"evil.swf\"/><p>Safe</p>";
        let sanitized = sanitize_html(html);
        assert!(!sanitized.contains("<object"));
        assert!(!sanitized.contains("<embed"));
        assert!(sanitized.contains("<p>Safe</p>"));
    }

    #[test]
    fn sanitizer_strips_style_tags() {
        let html = "<style>body{background:red}</style><p>Content</p>";
        let sanitized = sanitize_html(html);
        assert!(!sanitized.contains("<style"));
        assert!(sanitized.contains("<p>Content</p>"));
    }

    #[test]
    fn sanitizer_strips_event_handlers() {
        let html = "<p onclick=\"alert('xss')\">Click me</p>";
        let sanitized = sanitize_html(html);
        assert!(!sanitized.contains("onclick"));
        assert!(sanitized.contains("<p>Click me</p>"));
    }

    #[test]
    fn sanitizer_strips_onerror_attribute() {
        let html = "<img src=\"x\" onerror=\"alert('xss')\">";
        let sanitized = sanitize_html(html);
        assert!(!sanitized.contains("onerror"));
        // img is not in whitelist, so it's stripped entirely
        assert!(!sanitized.contains("<img"));
    }

    #[test]
    fn sanitizer_strips_javascript_urls() {
        let html = "<a href=\"javascript:alert('xss')\">Click</a>";
        let sanitized = sanitize_html(html);
        assert!(!sanitized.contains("javascript:"));
        // Link without valid href becomes just text
        assert!(sanitized.contains("Click"));
    }

    #[test]
    fn sanitizer_keeps_https_urls() {
        let html = "<a href=\"https://example.com\">Link</a>";
        let sanitized = sanitize_html(html);
        assert!(sanitized.contains("https://example.com"));
        assert!(sanitized.contains("<a href"));
        assert!(sanitized.contains("rel=\"noopener noreferrer\""));
    }

    #[test]
    fn sanitizer_keeps_http_urls() {
        let html = "<a href=\"http://example.com\">Link</a>";
        let sanitized = sanitize_html(html);
        assert!(sanitized.contains("http://example.com"));
        assert!(sanitized.contains("<a href"));
    }

    #[test]
    fn sanitizer_keeps_mailto_urls() {
        let html = "<a href=\"mailto:test@example.com\">Email</a>";
        let sanitized = sanitize_html(html);
        assert!(sanitized.contains("mailto:test@example.com"));
        assert!(sanitized.contains("<a href"));
    }

    #[test]
    fn sanitizer_keeps_allowed_tags() {
        let html = "<h2>Title</h2><h3>Subtitle</h3><p>Text</p><ul><li>Item</li></ul><ol><li>Item</li></ol><strong>Bold</strong><em>Italic</em><code>code</code><pre>preformatted</pre>";
        let sanitized = sanitize_html(html);
        assert!(sanitized.contains("<h2>"));
        assert!(sanitized.contains("<h3>"));
        assert!(sanitized.contains("<p>"));
        assert!(sanitized.contains("<ul>"));
        assert!(sanitized.contains("<ol>"));
        assert!(sanitized.contains("<li>"));
        assert!(sanitized.contains("<strong>"));
        assert!(sanitized.contains("<em>"));
        assert!(sanitized.contains("<code>"));
        assert!(sanitized.contains("<pre>"));
    }

    #[test]
    fn sanitizer_keeps_table_elements() {
        let html = "<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>";
        let sanitized = sanitize_html(html);
        assert!(sanitized.contains("<table>"));
        assert!(sanitized.contains("<thead>"));
        assert!(sanitized.contains("<tbody>"));
        assert!(sanitized.contains("<tr>"));
        assert!(sanitized.contains("<th>"));
        assert!(sanitized.contains("<td>"));
    }

    #[test]
    fn sanitizer_keeps_semantic_elements() {
        let html = "<section><article><div><span>Content</span></div></article></section>";
        let sanitized = sanitize_html(html);
        assert!(sanitized.contains("<section>"));
        assert!(sanitized.contains("<article>"));
        assert!(sanitized.contains("<div>"));
        assert!(sanitized.contains("<span>"));
    }

    #[test]
    fn sanitizer_strips_class_without_prefix() {
        let html = "<p class=\"evil-class\">Text</p>";
        let sanitized = sanitize_html(html);
        // class attribute not in allowed attributes for p, so stripped
        assert!(!sanitized.contains("class"));
        assert!(sanitized.contains("<p>Text</p>"));
    }

    #[test]
    fn missing_provider_returns_provider_not_configured() {
        let config = IntelligenceConfig::default();
        let result = get_active_provider(&config);
        assert!(matches!(result, Err(AiError::ProviderNotConfigured)));
    }

    #[test]
    fn missing_base_url_returns_provider_not_configured() {
        let config = IntelligenceConfig {
            active_provider: "test".to_string(),
            providers: vec![IntelligenceProviderConfig {
                name: "test".to_string(),
                provider: "openai".to_string(),
                model: "gpt-4".to_string(),
                api_key: "key".to_string(),
                base_url: "".to_string(), // missing
            }],
            ..Default::default()
        };
        let result = get_active_provider(&config);
        assert!(matches!(result, Err(AiError::ProviderNotConfigured)));
    }

    #[test]
    fn missing_model_returns_provider_not_configured() {
        let config = IntelligenceConfig {
            active_provider: "test".to_string(),
            providers: vec![IntelligenceProviderConfig {
                name: "test".to_string(),
                provider: "openai".to_string(),
                model: "".to_string(), // missing
                api_key: "key".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
            }],
            ..Default::default()
        };
        let result = get_active_provider(&config);
        assert!(matches!(result, Err(AiError::ProviderNotConfigured)));
    }

    #[test]
    fn missing_api_key_returns_provider_not_configured() {
        let config = IntelligenceConfig {
            active_provider: "test".to_string(),
            providers: vec![IntelligenceProviderConfig {
                name: "test".to_string(),
                provider: "openai".to_string(),
                model: "gpt-4".to_string(),
                api_key: "".to_string(), // missing
                base_url: "https://api.openai.com/v1".to_string(),
            }],
            ..Default::default()
        };
        let result = get_active_provider(&config);
        assert!(matches!(result, Err(AiError::ProviderNotConfigured)));
    }

    #[test]
    fn valid_provider_returns_config() {
        let config = IntelligenceConfig {
            active_provider: "test".to_string(),
            providers: vec![IntelligenceProviderConfig {
                name: "test".to_string(),
                provider: "openai".to_string(),
                model: "gpt-4".to_string(),
                api_key: "sk-test".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
            }],
            ..Default::default()
        };
        let result = get_active_provider(&config);
        assert!(result.is_ok());
        let provider = result.unwrap();
        assert_eq!(provider.name, "test");
        assert_eq!(provider.model, "gpt-4");
    }

    #[test]
    fn prompt_builder_does_not_include_pane_output() {
        // Create a project with layout but no pane output field
        let project = Project {
            id: "test-id".to_string(),
            name: "Test Project".to_string(),
            path: "/test/path".to_string(),
            description: "A test project".to_string(),
            session_name: "test-session".to_string(),
            status: "active".to_string(),
            workdir: "/test/workdir".to_string(),
            layout_json: serde_json::to_string(&ProjectLayout {
                schema_version: 1,
                windows: vec![crate::storage::models::ProjectLayoutWindow {
                    name: "main".to_string(),
                    index: 0,
                    active: true,
                    panes: vec![crate::storage::models::ProjectLayoutPane {
                        index: 0,
                        active: true,
                        width: 80,
                        height: 24,
                    }],
                    window_layout: None,
                }],
            }).unwrap(),
            details_json: "{\"key\":\"value\"}".to_string(),
            progress_json: "{\"status\":\"in-progress\"}".to_string(),
            ai_html: "".to_string(),
            ai_status: "".to_string(),
            ai_error: "".to_string(),
            last_synced_at: None,
            schema_version: 1,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let prompt = build_prompt(&project);

        // Should include project metadata
        assert!(prompt.contains("Project Name: Test Project"));
        assert!(prompt.contains("Description: A test project"));
        assert!(prompt.contains("Layout: 1 windows, 1 panes"));
        assert!(prompt.contains("Window names: main"));

        // Should NOT include any pane output (no such field exists anyway)
        // The prompt should only mention counts, not content
        assert!(!prompt.contains("output"));
        assert!(!prompt.contains("terminal"));
    }

    #[test]
    fn prompt_builder_handles_empty_fields() {
        let project = Project {
            id: "test-id".to_string(),
            name: "Test Project".to_string(),
            path: "".to_string(),
            description: "".to_string(),  // empty
            session_name: "".to_string(),
            status: "".to_string(),
            workdir: "".to_string(),
            layout_json: "".to_string(),  // empty
            details_json: "".to_string(),  // empty
            progress_json: "".to_string(),  // empty
            ai_html: "".to_string(),
            ai_status: "".to_string(),
            ai_error: "".to_string(),
            last_synced_at: None,
            schema_version: 1,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let prompt = build_prompt(&project);

        // Should only include name (non-empty)
        assert!(prompt.contains("Project Name: Test Project"));

        // Should NOT include empty fields
        assert!(!prompt.contains("Description:"));
        assert!(!prompt.contains("Details:"));
        assert!(!prompt.contains("Progress:"));
        assert!(!prompt.contains("Layout:"));
    }

#[test]
fn truncate_respects_utf8_boundary() {
    let s = "你好世界Hello";
    
    let truncated = truncate_to_size(s, 9);
    assert_eq!(truncated, "你好世");
    
    let full = truncate_to_size(s, 100);
    assert_eq!(full, s);
    
    let tiny = truncate_to_size(s, 2);
    assert_eq!(tiny, "");
}

#[test]
fn truncate_keeps_valid_string() {
    let s = "Hello World";
    let truncated = truncate_to_size(s, 5);
    assert_eq!(truncated, "Hello");
    
    let within = truncate_to_size(s, 7);
    assert_eq!(within, "Hello W");
}

    #[test]
    fn ai_error_to_api_error_mapping() {
        // ProviderNotConfigured -> bad_request
        let err = AiError::ProviderNotConfigured;
        let api_err: ApiError = err.into();
        assert_eq!(api_err.code(), "bad_request");

        // HttpError -> bad_request
        let err = AiError::HttpError("connection failed".to_string());
        let api_err: ApiError = err.into();
        assert_eq!(api_err.code(), "bad_request");

        // ParseError -> internal_error
        let err = AiError::ParseError("invalid JSON".to_string());
        let api_err: ApiError = err.into();
        assert_eq!(api_err.code(), "internal_error");

        // SizeExceeded -> internal_error
        let err = AiError::SizeExceeded;
        let api_err: ApiError = err.into();
        assert_eq!(api_err.code(), "internal_error");
    }
}