//! Voice action risk classification and confirmation management.
//!
//! This module implements:
//! - Risk level classification (Safe, Write, Dangerous)
//! - Dangerous action detection for destructive operations
//! - Confirmation state machine with 30-second TTL

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::RwLock;
use uuid::Uuid;

/// Risk level for voice-initiated actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionRiskLevel {
    /// Safe read-only operations (list, navigate).
    Safe,
    /// Write operations that modify state but are reversible.
    Write,
    /// Dangerous operations that are destructive or execute commands.
    Dangerous,
}

/// Represents a dangerous action that requires confirmation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DangerousAction {
    /// The skill name being invoked.
    pub skill: String,
    /// Whether this is a dangerous action.
    pub is_dangerous: bool,
    /// Human-readable reason for danger classification.
    pub reason: Option<String>,
}

/// Errors from confirmation operations.
#[derive(Debug, Error)]
pub enum ConfirmationError {
    #[error("confirmation not found: {0}")]
    NotFound(Uuid),
    #[error("confirmation expired")]
    Expired,
    #[error("invalid confirmation state")]
    InvalidState,
}

/// A pending confirmation request awaiting user approval.
#[derive(Debug, Clone)]
pub struct PendingConfirmation {
    /// Unique identifier for this confirmation request.
    pub id: Uuid,
    /// The skill that triggered this confirmation.
    pub skill: String,
    /// The original parameters (redacted for logging).
    pub params: serde_json::Value,
    /// When this confirmation was created.
    pub created_at: Instant,
    /// When this confirmation expires (30 seconds after creation).
    pub expires_at: Instant,
}

impl PendingConfirmation {
    /// Create a new pending confirmation with 30-second TTL.
    pub fn new(skill: String, params: serde_json::Value) -> Self {
        let now = Instant::now();
        Self {
            id: Uuid::new_v4(),
            skill,
            params,
            created_at: now,
            expires_at: now + Duration::from_secs(30),
        }
    }

    /// Check if this confirmation has expired.
    pub fn is_expired(&self) -> bool {
        Instant::now() >= self.expires_at
    }
}

/// Manages pending confirmations for dangerous actions.
#[derive(Debug)]
pub struct ConfirmationState {
    /// Map of confirmation IDs to pending entries.
    pending: Arc<RwLock<HashMap<Uuid, PendingConfirmation>>>,
}

impl ConfirmationState {
    /// Create a new confirmation state manager.
    pub fn new() -> Self {
        Self {
            pending: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Request confirmation for a dangerous action.
    ///
    /// Creates a pending confirmation entry with a unique ID and 30-second TTL.
    pub async fn request_confirmation(
        &self,
        skill: String,
        params: serde_json::Value,
    ) -> PendingConfirmation {
        let confirmation = PendingConfirmation::new(skill, params);
        let id = confirmation.id;

        let mut pending = self.pending.write().await;
        pending.insert(id, confirmation.clone());

        confirmation
    }

    /// Verify a confirmation by ID.
    ///
    /// Returns the original parameters if the confirmation exists and hasn't expired.
    /// Removes the confirmation from the pending map on success.
    pub async fn verify_confirmation(
        &self,
        id: Uuid,
    ) -> Result<serde_json::Value, ConfirmationError> {
        let mut pending = self.pending.write().await;

        let confirmation = pending.remove(&id).ok_or(ConfirmationError::NotFound(id))?;

        if confirmation.is_expired() {
            return Err(ConfirmationError::Expired);
        }

        Ok(confirmation.params)
    }

    /// Remove all stale confirmations that have expired.
    pub async fn expire_stale(&self) -> usize {
        let mut pending = self.pending.write().await;
        let now = Instant::now();

        let expired_ids: Vec<Uuid> = pending
            .iter()
            .filter(|(_, conf)| now >= conf.expires_at)
            .map(|(id, _)| *id)
            .collect();

        let count = expired_ids.len();
        for id in expired_ids {
            pending.remove(&id);
        }

        count
    }

    /// Get the number of pending confirmations.
    pub async fn pending_count(&self) -> usize {
        let pending = self.pending.read().await;
        pending.len()
    }
}

impl Default for ConfirmationState {
    fn default() -> Self {
        Self::new()
    }
}

/// Classify the risk level of a skill operation.
pub fn classify_risk_level(skill: &str, params: &serde_json::Value) -> ActionRiskLevel {
    if is_dangerous(skill, params) {
        ActionRiskLevel::Dangerous
    } else if is_write_operation(skill) {
        ActionRiskLevel::Write
    } else {
        ActionRiskLevel::Safe
    }
}

/// Determine if a skill with given parameters is dangerous.
///
/// Dangerous actions include:
/// - `delete_session`, `delete_window`, `delete_pane` (destructive)
/// - `send_to_pane` with execute=true, append_enter, control, or multiline flags
/// - `invoke_backend_route` with write methods (POST, PUT, DELETE, PATCH)
pub fn is_dangerous(skill: &str, params: &serde_json::Value) -> bool {
    // Destructive operations
    if matches!(
        skill,
        "delete_session"
            | "delete_window"
            | "delete_pane"
            | "kill_pane"
            | "run_project"
            | "delete_project"
            | "cleanup_tmux_analysis"
            | "clear_ai_logs"
    ) {
        return true;
    }

    // send_to_pane with dangerous flags
    if skill == "send_to_pane" {
        if let Some(obj) = params.as_object() {
            // Check for execute flag
            if let Some(execute) = obj.get("execute") {
                if execute.as_bool() == Some(true) {
                    return true;
                }
            }

            // Check for append_enter flag
            if let Some(append_enter) = obj.get("append_enter") {
                if append_enter.as_bool() == Some(true) {
                    return true;
                }
            }

            // Check for control flag
            if let Some(control) = obj.get("control") {
                if control.as_bool() == Some(true) {
                    return true;
                }
            }

            // Check for multiline flag
            if let Some(multiline) = obj.get("multiline") {
                if multiline.as_bool() == Some(true) {
                    return true;
                }
            }
        }
    }

    // invoke_backend_route with write methods
    if skill == "invoke_backend_route" {
        if let Some(obj) = params.as_object() {
            if let Some(method) = obj.get("method") {
                if let Some(method_str) = method.as_str() {
                    if matches!(method_str, "POST" | "PUT" | "DELETE" | "PATCH") {
                        return true;
                    }
                }
            }
        }
    }

    false
}

/// Determine if a skill is a write operation (but not dangerous).
fn is_write_operation(skill: &str) -> bool {
    matches!(
        skill,
        "create_session"
            | "rename_session"
            | "create_window"
            | "rename_window"
            | "split_pane"
            | "clear_pane"
            | "create_project"
            | "update_project"
            | "launch_project"
            | "sync_project_from_tmux"
            | "generate_project_ai_html"
            | "analyze_session"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Test 1: is_dangerous returns true for delete_session
    #[test]
    fn test_is_dangerous_delete_session() {
        let params = json!({"session": "test"});
        assert!(is_dangerous("delete_session", &params));
    }

    // Test 2: is_dangerous returns false for navigate_frontend
    #[test]
    fn test_is_dangerous_navigate_frontend() {
        let params = json!({"path": "/sessions"});
        assert!(!is_dangerous("navigate_frontend", &params));
    }

    // Test 3: is_dangerous returns false for list_sessions
    #[test]
    fn test_is_dangerous_list_sessions() {
        let params = json!({});
        assert!(!is_dangerous("list_sessions", &params));
    }

    // Test: is_dangerous returns true for delete_window
    #[test]
    fn test_is_dangerous_delete_window() {
        let params = json!({"session": "test", "window": "0"});
        assert!(is_dangerous("delete_window", &params));
    }

    // Test: is_dangerous returns true for delete_pane
    #[test]
    fn test_is_dangerous_delete_pane() {
        let params = json!({"session": "test", "window": "0", "pane": "0"});
        assert!(is_dangerous("delete_pane", &params));
    }

    // Test: is_dangerous returns true for send_to_pane with execute=true
    #[test]
    fn test_is_dangerous_send_to_pane_execute() {
        let params = json!({"pane": "test.0.0", "text": "ls", "execute": true});
        assert!(is_dangerous("send_to_pane", &params));
    }

    // Test: is_dangerous returns true for send_to_pane with append_enter
    #[test]
    fn test_is_dangerous_send_to_pane_append_enter() {
        let params = json!({"pane": "test.0.0", "text": "ls", "append_enter": true});
        assert!(is_dangerous("send_to_pane", &params));
    }

    // Test: is_dangerous returns false for send_to_pane without execute
    #[test]
    fn test_is_dangerous_send_to_pane_safe() {
        let params = json!({"pane": "test.0.0", "text": "ls"});
        assert!(!is_dangerous("send_to_pane", &params));
    }

    // Test: is_dangerous returns true for invoke_backend_route with POST
    #[test]
    fn test_is_dangerous_invoke_backend_route_post() {
        let params = json!({"method": "POST", "path": "/api/sessions"});
        assert!(is_dangerous("invoke_backend_route", &params));
    }

    // Test: is_dangerous returns false for invoke_backend_route with GET
    #[test]
    fn test_is_dangerous_invoke_backend_route_get() {
        let params = json!({"method": "GET", "path": "/api/sessions"});
        assert!(!is_dangerous("invoke_backend_route", &params));
    }

    // Test: classify_risk_level returns Dangerous for delete_session
    #[test]
    fn test_classify_risk_level_dangerous() {
        let params = json!({});
        assert_eq!(
            classify_risk_level("delete_session", &params),
            ActionRiskLevel::Dangerous
        );
    }

    // Test: classify_risk_level returns Write for create_session
    #[test]
    fn test_classify_risk_level_write() {
        let params = json!({"name": "test"});
        assert_eq!(
            classify_risk_level("create_session", &params),
            ActionRiskLevel::Write
        );
    }

    // Test: classify_risk_level returns Safe for list_sessions
    #[test]
    fn test_classify_risk_level_safe() {
        let params = json!({});
        assert_eq!(
            classify_risk_level("list_sessions", &params),
            ActionRiskLevel::Safe
        );
    }

    // Test 3: request_confirmation creates pending entry with UUID
    #[tokio::test]
    async fn test_request_confirmation_creates_entry() {
        let state = ConfirmationState::new();
        let skill = "delete_session".to_string();
        let params = json!({"session": "test"});

        let confirmation = state
            .request_confirmation(skill.clone(), params.clone())
            .await;

        // Verify UUID is generated
        assert_ne!(confirmation.id, Uuid::nil());

        // Verify skill matches
        assert_eq!(confirmation.skill, skill);

        // Verify params match
        assert_eq!(confirmation.params, params);

        // Verify TTL is 30 seconds
        let ttl = confirmation.expires_at - confirmation.created_at;
        assert_eq!(ttl, Duration::from_secs(30));

        // Verify it's in the pending map
        assert_eq!(state.pending_count().await, 1);
    }

    // Test 4: verify_confirmation with matching id returns Ok(params)
    #[tokio::test]
    async fn test_verify_confirmation_success() {
        let state = ConfirmationState::new();
        let params = json!({"session": "test"});

        let confirmation = state
            .request_confirmation("delete_session".to_string(), params.clone())
            .await;
        let id = confirmation.id;

        let result = state.verify_confirmation(id).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), params);

        // Verify it's removed after verification
        assert_eq!(state.pending_count().await, 0);
    }

    // Test 5: verify_confirmation with mismatched id returns Err
    #[tokio::test]
    async fn test_verify_confirmation_not_found() {
        let state = ConfirmationState::new();

        // Don't request any confirmation, verify with random UUID
        let random_id = Uuid::new_v4();
        let result = state.verify_confirmation(random_id).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ConfirmationError::NotFound(id) => assert_eq!(id, random_id),
            _ => panic!("expected NotFound error"),
        }
    }

    // Test 6: verify_confirmation with expired entry returns Err
    #[tokio::test]
    async fn test_verify_confirmation_expired() {
        let state = ConfirmationState::new();

        // Create a confirmation that's already expired
        let id = {
            let mut pending = state.pending.write().await;
            let expired_confirmation = PendingConfirmation {
                id: Uuid::new_v4(),
                skill: "delete_session".to_string(),
                params: json!({"session": "test"}),
                created_at: Instant::now() - Duration::from_secs(60),
                expires_at: Instant::now() - Duration::from_secs(30),
            };
            let id = expired_confirmation.id;
            pending.insert(id, expired_confirmation);
            id
        }; // write lock dropped here

        let result = state.verify_confirmation(id).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ConfirmationError::Expired => {}
            _ => panic!("expected Expired error"),
        }
    }

    // Test 7: expire_stale removes entries older than 30s
    #[tokio::test]
    async fn test_expire_stale() {
        let state = ConfirmationState::new();

        // Add expired confirmation and valid confirmation
        let (expired_id, valid_id) = {
            let mut pending = state.pending.write().await;
            let expired_id = Uuid::new_v4();
            pending.insert(
                expired_id,
                PendingConfirmation {
                    id: expired_id,
                    skill: "delete_session".to_string(),
                    params: json!({}),
                    created_at: Instant::now() - Duration::from_secs(60),
                    expires_at: Instant::now() - Duration::from_secs(30),
                },
            );

            // Add valid confirmation
            let valid_id = Uuid::new_v4();
            pending.insert(
                valid_id,
                PendingConfirmation {
                    id: valid_id,
                    skill: "delete_window".to_string(),
                    params: json!({}),
                    created_at: Instant::now(),
                    expires_at: Instant::now() + Duration::from_secs(30),
                },
            );
            (expired_id, valid_id)
        }; // write lock dropped here

        // Call expire_stale
        let count = state.expire_stale().await;
        assert_eq!(count, 1);
        assert_eq!(state.pending_count().await, 1);

        // Verify expired is gone and valid remains
        let pending = state.pending.read().await;
        assert!(!pending.contains_key(&expired_id));
        assert!(pending.contains_key(&valid_id));
    }

    // Test: PendingConfirmation::is_expired
    #[test]
    fn test_pending_confirmation_is_expired() {
        // Create fresh confirmation - not expired
        let fresh = PendingConfirmation::new("test".to_string(), json!({}));
        assert!(!fresh.is_expired());

        // Manually create expired confirmation
        let expired = PendingConfirmation {
            id: Uuid::new_v4(),
            skill: "test".to_string(),
            params: json!({}),
            created_at: Instant::now() - Duration::from_secs(60),
            expires_at: Instant::now() - Duration::from_secs(30),
        };
        assert!(expired.is_expired());
    }
}
