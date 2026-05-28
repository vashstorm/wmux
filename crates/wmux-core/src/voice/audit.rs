//! Voice action audit logging with secret redaction.
//!
//! This module provides:
//! - Structured audit entries for voice-initiated actions
//! - JSON-lines logging to file or tracing fallback
//! - Automatic secret redaction for sensitive data

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use time::OffsetDateTime;
use tokio::sync::RwLock;
use tracing::error;

/// Confirmation state for audit logging.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfirmationState {
    /// Confirmation was required for this action.
    Required,
    /// Confirmation is pending (awaiting user response).
    Pending,
    /// Confirmation was verified and action executed.
    Confirmed,
    /// No confirmation was needed (safe/write action).
    None,
}

/// Result of a voice action attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionResult {
    /// Action executed successfully.
    Success,
    /// Action failed with an error.
    Failure,
    /// Action requires confirmation before execution.
    ConfirmationRequired,
}

/// Audit entry for a voice action attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Timestamp of the action attempt (ISO 8601 format).
    #[serde(with = "time::serde::iso8601")]
    pub timestamp: OffsetDateTime,

    /// Actor identifier (hash of auth token or "local").
    pub actor_id: String,

    /// Skill name invoked by voice.
    pub skill: String,

    /// Parameters passed to the skill (redacted).
    pub params: serde_json::Value,

    /// Target resource (session/window/pane path).
    pub target: String,

    /// Voice transcript text (optional, truncated).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript_text: Option<String>,

    /// Confirmation state for this action.
    pub confirmation_state: ConfirmationState,

    /// Result of the action.
    pub result: ActionResult,

    /// Error code if action failed (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,

    /// Time elapsed for action execution (milliseconds).
    pub elapsed_ms: u64,
}

impl AuditEntry {
    /// Create a new audit entry.
    pub fn new(
        actor_id: String,
        skill: String,
        params: serde_json::Value,
        target: String,
        confirmation_state: ConfirmationState,
        result: ActionResult,
        elapsed_ms: u64,
    ) -> Self {
        Self {
            timestamp: OffsetDateTime::now_utc(),
            actor_id,
            skill,
            params: redact_secrets(&params),
            target,
            transcript_text: None,
            confirmation_state,
            result,
            error_code: None,
            elapsed_ms,
        }
    }

    /// Set the transcript text (truncated to 200 chars).
    pub fn with_transcript(mut self, text: Option<String>) -> Self {
        self.transcript_text = text.map(|t| {
            let end = t
                .char_indices()
                .nth(200)
                .map_or(t.len(), |(i, _)| i);
            if end < t.len() {
                format!("{}...", &t[..end])
            } else {
                t
            }
        });
        self
    }

    /// Set the error code.
    pub fn with_error(mut self, code: Option<String>) -> Self {
        self.error_code = code;
        self
    }

    /// Serialize to JSON line (one JSON object per line).
    pub fn to_json_line(&self) -> String {
        serde_json::to_string(self).expect("audit entry should serialize")
    }
}

/// Audit logger for voice actions.
#[derive(Debug)]
pub struct AuditLogger {
    /// Optional file path for audit log.
    file_path: Option<PathBuf>,

    /// File handle for writing (if path configured).
    writer: Arc<RwLock<Option<std::fs::File>>>,
}

impl AuditLogger {
    /// Create a new audit logger.
    ///
    /// If `file_path` is None, logs to tracing instead.
    pub fn new(file_path: Option<PathBuf>) -> Self {
        let writer = if let Some(path) = &file_path {
            // Try to open file for appending
            let file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path);

            match file {
                Ok(f) => Arc::new(RwLock::new(Some(f))),
                Err(e) => {
                    error!("failed to open audit log file {}: {}", path.display(), e);
                    Arc::new(RwLock::new(None))
                }
            }
        } else {
            Arc::new(RwLock::new(None))
        };

        Self { file_path, writer }
    }

    /// Log an action to audit file or tracing.
    pub async fn log_action(&self, entry: &AuditEntry) {
        let json_line = entry.to_json_line();

        let mut writer = self.writer.write().await;
        if let Some(file) = writer.as_mut() {
            // Write to file
            if let Err(e) = writeln!(file, "{}", json_line) {
                error!("failed to write audit entry: {}", e);
            }
        } else {
            // Log to tracing
            tracing::info!(
                actor_id = %entry.actor_id,
                skill = %entry.skill,
                result = ?entry.result,
                confirmation_state = ?entry.confirmation_state,
                elapsed_ms = entry.elapsed_ms,
                "voice action audit"
            );
        }
    }

    /// Check if file logging is configured.
    pub fn has_file(&self) -> bool {
        self.file_path.is_some()
    }
}

impl Default for AuditLogger {
    fn default() -> Self {
        Self::new(None)
    }
}

/// Redact secrets in a JSON value.
///
/// Masks:
/// - Values containing "sk-" (API key prefix)
/// - Values containing "dashscope" (DashScope API key)
/// - Any field named "token", "api_key", "secret", "password"
pub fn redact_secrets(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            serde_json::Value::Object(
                map.iter()
                    .map(|(key, val)| {
                        // Check if key is sensitive
                        if matches!(
                            key.as_str(),
                            "token" | "api_key" | "apiKey" | "secret" | "password"
                        ) {
                            (
                                key.clone(),
                                serde_json::Value::String("<redacted>".to_string()),
                            )
                        } else {
                            // Check if value contains secret patterns
                            (key.clone(), redact_value(val))
                        }
                    })
                    .collect(),
            )
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(redact_value).collect())
        }
        other => redact_value(other),
    }
}

/// Redact a single value if it contains secret patterns.
fn redact_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::String(s) => {
            if s.contains("sk-") || s.contains("dashscope") {
                serde_json::Value::String("<redacted>".to_string())
            } else {
                value.clone()
            }
        }
        serde_json::Value::Object(_) | serde_json::Value::Array(_) => redact_secrets(value),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    // Test 8: log_action writes valid JSON line with all required fields
    #[tokio::test]
    async fn test_log_action_writes_json_line() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("audit.log");

        let logger = AuditLogger::new(Some(path.clone()));

        let entry = AuditEntry::new(
            "actor123".to_string(),
            "delete_session".to_string(),
            json!({"session": "test"}),
            "local:test".to_string(),
            ConfirmationState::Required,
            ActionResult::ConfirmationRequired,
            50,
        );

        logger.log_action(&entry).await;

        // Read file and verify JSON line
        let content = std::fs::read_to_string(&path).expect("read audit log");
        assert!(!content.is_empty());

        // Parse as JSON
        let parsed: serde_json::Value = serde_json::from_str(&content.trim()).expect("parse JSON");

        // Verify required fields
        assert!(parsed.get("timestamp").is_some());
        assert_eq!(
            parsed.get("actor_id").unwrap().as_str().unwrap(),
            "actor123"
        );
        assert_eq!(
            parsed.get("skill").unwrap().as_str().unwrap(),
            "delete_session"
        );
        assert_eq!(
            parsed.get("target").unwrap().as_str().unwrap(),
            "local:test"
        );
        assert_eq!(
            parsed.get("confirmation_state").unwrap().as_str().unwrap(),
            "required"
        );
        assert_eq!(
            parsed.get("result").unwrap().as_str().unwrap(),
            "confirmation_required"
        );
        assert_eq!(parsed.get("elapsed_ms").unwrap().as_u64().unwrap(), 50);
    }

    // Test 9: Audit log redacts secrets containing "sk-"
    #[test]
    fn test_redact_secrets_sk_prefix() {
        let params = json!({
            "api_key": "sk-1234567890abcdef",
            "other": "normal value"
        });

        let redacted = redact_secrets(&params);

        // api_key should be redacted
        assert_eq!(
            redacted.get("api_key").unwrap().as_str().unwrap(),
            "<redacted>"
        );

        // other should remain
        assert_eq!(
            redacted.get("other").unwrap().as_str().unwrap(),
            "normal value"
        );
    }

    // Test 10: Audit log redacts secrets containing "dashscope"
    #[test]
    fn test_redact_secrets_dashscope() {
        let params = json!({
            "key": "dashscope-api-key-123",
            "other": "safe value"
        });

        let redacted = redact_secrets(&params);

        // key containing dashscope should be redacted
        assert_eq!(redacted.get("key").unwrap().as_str().unwrap(), "<redacted>");

        // other should remain
        assert_eq!(
            redacted.get("other").unwrap().as_str().unwrap(),
            "safe value"
        );
    }

    // Test: Audit log never contains DashScope API key in any field
    #[test]
    fn test_audit_entry_no_dashscope_key() {
        let params = json!({
            "dashscope_key": "sk-dashscope-secret-key",
            "normal": "value"
        });

        let entry = AuditEntry::new(
            "local".to_string(),
            "test".to_string(),
            params,
            "target".to_string(),
            ConfirmationState::None,
            ActionResult::Success,
            10,
        );

        let json_line = entry.to_json_line();

        // Verify no dashscope in output
        assert!(!json_line.contains("dashscope-secret-key"));
        assert!(!json_line.contains("sk-dashscope"));

        // Verify redacted marker appears
        assert!(json_line.contains("<redacted>"));
    }

    // Test: Redact token field
    #[test]
    fn test_redact_token_field() {
        let params = json!({
            "token": "secret-token-123",
            "data": "normal"
        });

        let redacted = redact_secrets(&params);

        assert_eq!(
            redacted.get("token").unwrap().as_str().unwrap(),
            "<redacted>"
        );
    }

    // Test: Redact password field
    #[test]
    fn test_redact_password_field() {
        let params = json!({
            "password": "my-secret-password",
            "username": "user"
        });

        let redacted = redact_secrets(&params);

        assert_eq!(
            redacted.get("password").unwrap().as_str().unwrap(),
            "<redacted>"
        );
        assert_eq!(redacted.get("username").unwrap().as_str().unwrap(), "user");
    }

    // Test: Redact nested values
    #[test]
    fn test_redact_nested() {
        let params = json!({
            "config": {
                "api_key": "sk-nested-key",
                "endpoint": "https://api.example.com"
            }
        });

        let redacted = redact_secrets(&params);

        let config = redacted.get("config").unwrap().as_object().unwrap();
        assert_eq!(
            config.get("api_key").unwrap().as_str().unwrap(),
            "<redacted>"
        );
        assert_eq!(
            config.get("endpoint").unwrap().as_str().unwrap(),
            "https://api.example.com"
        );
    }

    // Test: Redact array values
    #[test]
    fn test_redact_array() {
        let params = json!({
            "keys": ["sk-123", "sk-456", "normal"]
        });

        let redacted = redact_secrets(&params);

        let keys = redacted.get("keys").unwrap().as_array().unwrap();
        assert_eq!(keys[0].as_str().unwrap(), "<redacted>");
        assert_eq!(keys[1].as_str().unwrap(), "<redacted>");
        assert_eq!(keys[2].as_str().unwrap(), "normal");
    }

    // Test: AuditLogger without file logs to tracing
    #[tokio::test]
    async fn test_audit_logger_no_file() {
        let logger = AuditLogger::new(None);
        assert!(!logger.has_file());

        // Should not panic when logging
        let entry = AuditEntry::new(
            "local".to_string(),
            "test".to_string(),
            json!({}),
            "target".to_string(),
            ConfirmationState::None,
            ActionResult::Success,
            5,
        );

        logger.log_action(&entry).await;
    }

    // Test: AuditEntry transcript truncation
    #[test]
    fn test_transcript_truncation() {
        let entry = AuditEntry::new(
            "local".to_string(),
            "test".to_string(),
            json!({}),
            "target".to_string(),
            ConfirmationState::None,
            ActionResult::Success,
            5,
        )
        .with_transcript(Some("a".repeat(250)));

        let transcript = entry.transcript_text.unwrap();
        assert_eq!(transcript.len(), 203); // 200 + "..."
        assert!(transcript.ends_with("..."));
    }

    // Test: AuditEntry with no transcript
    #[test]
    fn test_no_transcript() {
        let entry = AuditEntry::new(
            "local".to_string(),
            "test".to_string(),
            json!({}),
            "target".to_string(),
            ConfirmationState::None,
            ActionResult::Success,
            5,
        );

        assert!(entry.transcript_text.is_none());

        // Serialize and verify no transcript field
        let json = entry.to_json_line();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.get("transcript_text").is_none());
    }

    // Test: AuditEntry with error code
    #[test]
    fn test_with_error() {
        let entry = AuditEntry::new(
            "local".to_string(),
            "test".to_string(),
            json!({}),
            "target".to_string(),
            ConfirmationState::None,
            ActionResult::Failure,
            5,
        )
        .with_error(Some("session_not_found".to_string()));

        assert_eq!(entry.error_code.unwrap(), "session_not_found");
    }
}
