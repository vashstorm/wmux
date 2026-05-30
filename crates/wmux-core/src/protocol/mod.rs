use serde::de::{Error as DeError, Unexpected};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::skills::OmniSkillDef;

pub const ERROR_UNAUTHORIZED: &str = "unauthorized";
pub const ERROR_NOT_FOUND: &str = "not_found";
pub const ERROR_BAD_REQUEST: &str = "bad_request";
pub const ERROR_CONFLICT: &str = "conflict";
pub const ERROR_NOT_IMPLEMENTED: &str = "not_implemented";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

impl ErrorResponse {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            error: ErrorDetail {
                code: code.into(),
                message: message.into(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalMessage {
    Input(String),
    Output(String),
    Resize { cols: u16, rows: u16 },
    Close,
    Error(String),
}

impl Serialize for TerminalMessage {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Input(data) => serialize_data_message(serializer, "input", data),
            Self::Output(data) => serialize_data_message(serializer, "output", data),
            Self::Error(data) => serialize_data_message(serializer, "error", data),
            Self::Resize { cols, rows } => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("type", "resize")?;
                map.serialize_entry("cols", cols)?;
                map.serialize_entry("rows", rows)?;
                map.end()
            }
            Self::Close => {
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("type", "close")?;
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for TerminalMessage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawTerminalMessage::deserialize(deserializer)?;
        match raw.message_type.as_str() {
            "input" => Ok(Self::Input(raw.data.unwrap_or_default())),
            "output" => Ok(Self::Output(raw.data.unwrap_or_default())),
            "resize" => Ok(Self::Resize {
                cols: raw.cols.ok_or_else(|| DeError::missing_field("cols"))?,
                rows: raw.rows.ok_or_else(|| DeError::missing_field("rows"))?,
            }),
            "close" => Ok(Self::Close),
            "error" => Ok(Self::Error(raw.data.unwrap_or_default())),
            other => Err(DeError::invalid_value(
                Unexpected::Str(other),
                &"input, output, resize, close, or error",
            )),
        }
    }
}

#[derive(Deserialize)]
struct RawTerminalMessage {
    #[serde(rename = "type")]
    message_type: String,
    #[serde(default)]
    data: Option<String>,
    #[serde(default)]
    cols: Option<u16>,
    #[serde(default)]
    rows: Option<u16>,
}

fn serialize_data_message<S>(
    serializer: S,
    message_type: &str,
    data: &str,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let mut map = serializer.serialize_map(Some(2))?;
    map.serialize_entry("type", message_type)?;
    map.serialize_entry("data", data)?;
    map.end()
}

// ============================================================================
// Voice Protocol Types (Qwen3.5-Omni Realtime Voice WebSocket)
// ============================================================================

/// Voice skill identifiers for Qwen function-call tool definitions.
///
/// These correspond to function names that Qwen can invoke during voice sessions.
/// Wire format uses snake_case to match Qwen API expectations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OmniSkill {
    /// Navigate frontend to a specific page/route.
    NavigateFrontend,
    /// Invoke a backend REST API route (with allowlist).
    InvokeBackendRoute,
    /// List tmux sessions for a target connection.
    ListSessions,
    /// Create a new tmux session.
    CreateSession,
    /// Rename an existing tmux session.
    RenameSession,
    /// Delete a tmux session (dangerous, requires confirmation).
    DeleteSession,
    /// Send text/commands to a pane (dangerous with execute/enter flags).
    SendToPane,
    /// Confirm a pending dangerous action.
    ConfirmAction,
    /// Cancel a pending dangerous action.
    CancelAction,
}

/// Target specification for voice actions.
///
/// Used to identify which connection/session/window/pane an action targets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmniTarget {
    /// Target connection name (e.g., "local" or SSH host).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_name: Option<String>,
    /// Session name within the target.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    /// Window name or index within the session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
    /// Pane index within the window.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane: Option<String>,
}

impl Default for OmniTarget {
    fn default() -> Self {
        Self {
            target_name: None,
            session: None,
            window: None,
            pane: None,
        }
    }
}

/// Result of a voice-initiated action execution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmniActionResult {
    /// The skill that was executed.
    pub skill: String,
    /// Whether execution succeeded.
    pub success: bool,
    /// Error message if execution failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Client-to-server voice WebSocket messages.
///
/// Sent from frontend to backend during voice sessions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OmniClientMessage {
    /// Send audio data to Qwen for processing.
    AudioFrame {
        /// PCM16 audio data encoded as base64.
        #[serde(rename = "pcm16Base64")]
        pcm16_base64: String,
        /// Audio sample rate (e.g., 16000).
        #[serde(rename = "sampleRate")]
        sample_rate: u32,
    },
    /// Send typed text to Qwen for processing.
    TextMessage {
        /// User text input.
        text: String,
    },
    /// Confirm a pending dangerous action.
    ConfirmAction {
        /// Confirmation ID from intent_received event.
        #[serde(rename = "confirmationId")]
        confirmation_id: String,
    },
    /// Cancel a pending dangerous action.
    CancelAction {
        /// Confirmation ID to cancel.
        #[serde(rename = "confirmationId")]
        confirmation_id: String,
    },
    /// Stop voice recognition/listening.
    StopListening,
    /// Start voice recognition/listening.
    StartListening,
}

/// Server-to-client voice WebSocket events.
///
/// Sent from backend to frontend during voice sessions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OmniServerEvent {
    /// Voice session established successfully.
    Connected,
    /// Audio output from Qwen (TTS response).
    AudioDelta {
        /// PCM16 audio data encoded as base64.
        #[serde(rename = "pcm16Base64")]
        pcm16_base64: String,
        /// Audio sample rate.
        #[serde(rename = "sampleRate")]
        sample_rate: u32,
    },
    /// Incremental transcript update (partial recognition).
    TranscriptDelta {
        /// Partial transcript text.
        text: String,
    },
    /// Final transcript (complete recognition).
    TranscriptDone {
        /// Complete transcript text.
        text: String,
    },
    /// Intent parsed from transcript with action parameters.
    IntentReceived {
        /// Skill name (snake_case).
        skill: String,
        /// Action parameters (JSON object).
        params: serde_json::Value,
        /// Whether this action requires confirmation.
        #[serde(rename = "confirmationRequired")]
        confirmation_required: bool,
        /// Confirmation ID if confirmation is required.
        #[serde(rename = "confirmationId", skip_serializing_if = "Option::is_none")]
        confirmation_id: Option<String>,
    },
    /// Result of executed action.
    ActionResult {
        /// Skill that was executed.
        skill: String,
        /// Whether execution succeeded.
        success: bool,
        /// Error message if failed.
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// Assistant text response.
    AssistantMessage {
        /// Assistant message text.
        text: String,
    },
    /// Voice session error.
    Error {
        /// Stable error code.
        code: String,
        /// Human-readable error message.
        message: String,
    },
    /// Session timeout warning.
    SessionTimeout {
        /// Seconds remaining before timeout.
        #[serde(rename = "remainingSeconds")]
        remaining_seconds: u32,
    },
}

/// Allowed frontend routes for navigate_frontend skill.
pub const VOICE_FRONTEND_ROUTES: [&str; 7] = [
    "home",
    "settings",
    "projects",
    "connections",
    "session",
    "window",
    "pane",
];

/// Allowed backend routes for invoke_backend_route skill.
pub const VOICE_BACKEND_ROUTES: [&str; 11] = [
    "connections.list",
    "sessions.list",
    "sessions.create",
    "sessions.rename",
    "sessions.delete",
    "windows.list",
    "windows.create",
    "windows.delete",
    "panes.list",
    "panes.split",
    "panes.delete",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum OmniSkillRiskLevel {
    Safe,
    Write,
    Dangerous,
    Dynamic,
    FlowControl,
}

/// Find a skill definition by id in the loaded skills list.
pub fn find_skill<'a>(skills: &'a [OmniSkillDef], id: &str) -> Option<&'a OmniSkillDef> {
    skills.iter().find(|skill| skill.id == id)
}

fn omni_skill_description<'a>(
    skill_defs: &'a [OmniSkillDef],
    skill_id: &str,
) -> &'a str {
    find_skill(skill_defs, skill_id)
        .map(|skill| skill.description.as_str())
        .unwrap_or("No description available.")
}

/// Generate Qwen function-call tool definitions for all V1 voice skills.
///
/// Returns JSON array of tool definitions compatible with Qwen Realtime API.
/// Each tool has: type="function", name (snake_case), description, parameters (JSON Schema).
pub fn generate_qwen_tools(
    skill_defs: &[OmniSkillDef],
) -> Vec<serde_json::Value> {
    let mut tools = vec![
        // navigate_frontend
        serde_json::json!({
            "type": "function",
            "name": "navigate_frontend",
            "description": omni_skill_description(skill_defs, "navigate_frontend"),
            "parameters": {
                "type": "object",
                "properties": {
                    "route": {
                        "type": "string",
                        "enum": VOICE_FRONTEND_ROUTES,
                        "description": "Target frontend route/page."
                    }
                },
                "required": ["route"]
            }
        }),
        // invoke_backend_route
        serde_json::json!({
            "type": "function",
            "name": "invoke_backend_route",
            "description": omni_skill_description(skill_defs, "invoke_backend_route"),
            "parameters": {
                "type": "object",
                "properties": {
                    "route_id": {
                        "type": "string",
                        "enum": VOICE_BACKEND_ROUTES,
                        "description": "Backend route to invoke (allowlist enforced)."
                    },
                    "params": {
                        "type": "object",
                        "description": "Route-specific parameters (e.g., target_name, session_name).",
                        "additionalProperties": true
                    }
                },
                "required": ["route_id"]
            }
        }),
        // list_sessions
        serde_json::json!({
            "type": "function",
            "name": "list_sessions",
            "description": omni_skill_description(skill_defs, "list_sessions"),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_name": {
                        "type": "string",
                        "description": "Target connection name (e.g., 'local' or SSH host)."
                    }
                },
                "required": ["target_name"]
            }
        }),
        // create_session
        serde_json::json!({
            "type": "function",
            "name": "create_session",
            "description": omni_skill_description(skill_defs, "create_session"),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_name": {
                        "type": "string",
                        "description": "Target connection name."
                    },
                    "session_name": {
                        "type": "string",
                        "description": "Name for the new session."
                    }
                },
                "required": ["target_name", "session_name"]
            }
        }),
        // rename_session
        serde_json::json!({
            "type": "function",
            "name": "rename_session",
            "description": omni_skill_description(skill_defs, "rename_session"),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_name": {
                        "type": "string",
                        "description": "Target connection name."
                    },
                    "old_name": {
                        "type": "string",
                        "description": "Current session name."
                    },
                    "new_name": {
                        "type": "string",
                        "description": "New session name."
                    }
                },
                "required": ["target_name", "old_name", "new_name"]
            }
        }),
        // delete_session (dangerous)
        serde_json::json!({
            "type": "function",
            "name": "delete_session",
            "description": omni_skill_description(skill_defs, "delete_session"),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_name": {
                        "type": "string",
                        "description": "Target connection name."
                    },
                    "session_name": {
                        "type": "string",
                        "description": "Session to delete."
                    }
                },
                "required": ["target_name", "session_name"]
            }
        }),
        // send_to_pane (dangerous)
        serde_json::json!({
            "type": "function",
            "name": "send_to_pane",
            "description": omni_skill_description(skill_defs, "send_to_pane"),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_name": {
                        "type": "string",
                        "description": "Target connection name."
                    },
                    "session_name": {
                        "type": "string",
                        "description": "Session name."
                    },
                    "window_name": {
                        "type": "string",
                        "description": "Window name or index."
                    },
                    "pane_index": {
                        "type": "integer",
                        "description": "Pane index within window."
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to send to the pane."
                    },
                    "execute": {
                        "type": "boolean",
                        "default": false,
                        "description": "If true, execute as command (dangerous)."
                    },
                    "append_enter": {
                        "type": "boolean",
                        "default": false,
                        "description": "If true, append Enter key after text (dangerous)."
                    },
                    "control": {
                        "type": "boolean",
                        "default": false,
                        "description": "If true, send as control sequence (dangerous)."
                    },
                    "multiline": {
                        "type": "boolean",
                        "default": false,
                        "description": "If true, text contains multiple lines (dangerous)."
                    }
                },
                "required": ["target_name", "session_name", "window_name", "pane_index", "text"]
            }
        }),
        // confirm_action
        serde_json::json!({
            "type": "function",
            "name": "confirm_action",
            "description": omni_skill_description(skill_defs, "confirm_action"),
            "parameters": {
                "type": "object",
                "properties": {
                    "confirmation_id": {
                        "type": "string",
                        "format": "uuid",
                        "description": "Confirmation ID from intent_received event."
                    }
                },
                "required": ["confirmation_id"]
            }
        }),
        // cancel_action
        serde_json::json!({
            "type": "function",
            "name": "cancel_action",
            "description": omni_skill_description(skill_defs, "cancel_action"),
            "parameters": {
                "type": "object",
                "properties": {
                    "confirmation_id": {
                        "type": "string",
                        "format": "uuid",
                        "description": "Confirmation ID to cancel."
                    }
                },
                "required": ["confirmation_id"]
            }
        }),
    ];

    tools
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::OmniSkillDef;

    #[test]
    fn protocol_terminal_message_round_trips() {
        let messages = [
            TerminalMessage::Input("hello".to_string()),
            TerminalMessage::Output("world".to_string()),
            TerminalMessage::Resize {
                cols: 120,
                rows: 40,
            },
            TerminalMessage::Close,
            TerminalMessage::Error("boom".to_string()),
        ];

        for message in messages {
            let json = serde_json::to_string(&message).expect("serialize");
            let decoded: TerminalMessage = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(decoded, message);
        }
    }

    #[test]
    fn protocol_terminal_message_uses_go_json_shape() {
        assert_eq!(
            serde_json::to_value(TerminalMessage::Input("hello".to_string())).expect("serialize"),
            serde_json::json!({ "type": "input", "data": "hello" })
        );
        assert_eq!(
            serde_json::to_value(TerminalMessage::Resize { cols: 80, rows: 24 })
                .expect("serialize"),
            serde_json::json!({ "type": "resize", "cols": 80, "rows": 24 })
        );
    }

    #[test]
    fn protocol_error_response_serializes_stable_codes() {
        let response = ErrorResponse {
            error: ErrorDetail {
                code: ERROR_CONFLICT.to_string(),
                message: "config file changed on disk".to_string(),
            },
        };

        assert_eq!(
            serde_json::to_value(response).expect("serialize"),
            serde_json::json!({ "error": { "code": "conflict", "message": "config file changed on disk" } })
        );
    }

    #[test]
    fn protocol_exports_stable_error_codes() {
        assert_eq!(ERROR_UNAUTHORIZED, "unauthorized");
        assert_eq!(ERROR_NOT_FOUND, "not_found");
        assert_eq!(ERROR_BAD_REQUEST, "bad_request");
        assert_eq!(ERROR_CONFLICT, "conflict");
        assert_eq!(ERROR_NOT_IMPLEMENTED, "not_implemented");
    }

    // Voice protocol tests
    #[test]
    fn voice_skill_serializes_to_snake_case() {
        assert_eq!(
            serde_json::to_value(OmniSkill::NavigateFrontend).expect("serialize"),
            serde_json::json!("navigate_frontend")
        );
        assert_eq!(
            serde_json::to_value(OmniSkill::InvokeBackendRoute).expect("serialize"),
            serde_json::json!("invoke_backend_route")
        );
        assert_eq!(
            serde_json::to_value(OmniSkill::DeleteSession).expect("serialize"),
            serde_json::json!("delete_session")
        );
    }

    #[test]
    fn voice_skill_deserializes_from_snake_case() {
        let skill: OmniSkill =
            serde_json::from_value(serde_json::json!("navigate_frontend")).expect("deserialize");
        assert_eq!(skill, OmniSkill::NavigateFrontend);

        let skill: OmniSkill =
            serde_json::from_value(serde_json::json!("send_to_pane")).expect("deserialize");
        assert_eq!(skill, OmniSkill::SendToPane);
    }

    #[test]
    fn voice_skill_unknown_rejected() {
        let result: Result<OmniSkill, _> =
            serde_json::from_value(serde_json::json!("run_arbitrary_shell"));
        assert!(result.is_err(), "unknown skill should be rejected");
    }

    #[test]
    fn voice_client_message_round_trips() {
        let messages = [
            OmniClientMessage::AudioFrame {
                pcm16_base64: "BASE64_AUDIO_DATA".to_string(),
                sample_rate: 16000,
            },
            OmniClientMessage::TextMessage {
                text: "hello from keyboard".to_string(),
            },
            OmniClientMessage::ConfirmAction {
                confirmation_id: "uuid-confirmation-id".to_string(),
            },
            OmniClientMessage::CancelAction {
                confirmation_id: "uuid-confirmation-id".to_string(),
            },
            OmniClientMessage::StopListening,
            OmniClientMessage::StartListening,
        ];

        for message in messages {
            let json = serde_json::to_string(&message).expect("serialize");
            let decoded: OmniClientMessage = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(decoded, message);
        }
    }

    #[test]
    fn voice_client_message_json_shape() {
        // AudioFrame with camelCase field names
        assert_eq!(
            serde_json::to_value(OmniClientMessage::AudioFrame {
                pcm16_base64: "audio".to_string(),
                sample_rate: 16000,
            })
            .expect("serialize"),
            serde_json::json!({
                "type": "audio_frame",
                "pcm16Base64": "audio",
                "sampleRate": 16000
            })
        );

        assert_eq!(
            serde_json::to_value(OmniClientMessage::TextMessage {
                text: "hello".to_string(),
            })
            .expect("serialize"),
            serde_json::json!({
                "type": "text_message",
                "text": "hello"
            })
        );

        // ConfirmAction with camelCase confirmationId
        assert_eq!(
            serde_json::to_value(OmniClientMessage::ConfirmAction {
                confirmation_id: "abc123".to_string(),
            })
            .expect("serialize"),
            serde_json::json!({
                "type": "confirm_action",
                "confirmationId": "abc123"
            })
        );
    }

    #[test]
    fn voice_server_event_round_trips() {
        let events = [
            OmniServerEvent::Connected,
            OmniServerEvent::AudioDelta {
                pcm16_base64: "AUDIO_OUTPUT".to_string(),
                sample_rate: 24000,
            },
            OmniServerEvent::TranscriptDelta {
                text: "Hello".to_string(),
            },
            OmniServerEvent::TranscriptDone {
                text: "Hello world".to_string(),
            },
            OmniServerEvent::IntentReceived {
                skill: "list_sessions".to_string(),
                params: serde_json::json!({ "target_name": "local" }),
                confirmation_required: false,
                confirmation_id: None,
            },
            OmniServerEvent::ActionResult {
                skill: "list_sessions".to_string(),
                success: true,
                error: None,
            },
            OmniServerEvent::AssistantMessage {
                text: "Done".to_string(),
            },
            OmniServerEvent::Error {
                code: "voice_disabled".to_string(),
                message: "Voice feature is not enabled".to_string(),
            },
            OmniServerEvent::SessionTimeout {
                remaining_seconds: 30,
            },
        ];

        for event in events {
            let json = serde_json::to_string(&event).expect("serialize");
            let decoded: OmniServerEvent = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(decoded, event);
        }
    }

    #[test]
    fn voice_server_event_intent_received_with_confirmation() {
        let event = OmniServerEvent::IntentReceived {
            skill: "delete_session".to_string(),
            params: serde_json::json!({ "target_name": "local", "session_name": "test" }),
            confirmation_required: true,
            confirmation_id: Some("uuid-confirmation-id".to_string()),
        };

        let json = serde_json::to_string(&event).expect("serialize");
        let decoded: OmniServerEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(decoded, event);

        // Verify JSON shape with camelCase fields
        let value = serde_json::to_value(&event).expect("serialize");
        assert_eq!(value["type"], "intent_received");
        assert_eq!(value["skill"], "delete_session");
        assert_eq!(value["confirmationRequired"], true);
        assert_eq!(value["confirmationId"], "uuid-confirmation-id");
    }

    #[test]
    fn voice_server_event_action_result_with_error() {
        let event = OmniServerEvent::ActionResult {
            skill: "delete_session".to_string(),
            success: false,
            error: Some("Session not found".to_string()),
        };

        let json = serde_json::to_string(&event).expect("serialize");
        let decoded: OmniServerEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(decoded, event);

        // Verify error field is present when there's an error
        let value = serde_json::to_value(&event).expect("serialize");
        assert_eq!(value["error"], "Session not found");
    }

    #[test]
    fn voice_server_event_skips_none_fields() {
        // ActionResult with no error should not have error field in JSON
        let event = OmniServerEvent::ActionResult {
            skill: "list_sessions".to_string(),
            success: true,
            error: None,
        };

        let value = serde_json::to_value(&event).expect("serialize");
        assert!(
            value.get("error").is_none(),
            "error field should be skipped when None"
        );

        // IntentReceived without confirmation should not have confirmationId
        let event = OmniServerEvent::IntentReceived {
            skill: "list_sessions".to_string(),
            params: serde_json::json!({}),
            confirmation_required: false,
            confirmation_id: None,
        };

        let value = serde_json::to_value(&event).expect("serialize");
        assert!(
            value.get("confirmationId").is_none(),
            "confirmationId should be skipped when None"
        );
    }

    #[test]
    fn voice_target_default() {
        let target = OmniTarget::default();
        assert_eq!(target.target_name, None);
        assert_eq!(target.session, None);
        assert_eq!(target.window, None);
        assert_eq!(target.pane, None);
    }

    #[test]
    fn voice_target_serializes_with_camel_case() {
        let target = OmniTarget {
            target_name: Some("local".to_string()),
            session: Some("main".to_string()),
            window: Some("0".to_string()),
            pane: Some("1".to_string()),
        };

        let value = serde_json::to_value(&target).expect("serialize");
        assert_eq!(value["targetName"], "local");
        assert_eq!(value["session"], "main");
        assert_eq!(value["window"], "0");
        assert_eq!(value["pane"], "1");
    }

    #[test]
    fn voice_action_result_serializes_with_camel_case() {
        let result = OmniActionResult {
            skill: "delete_session".to_string(),
            success: true,
            error: None,
        };

        let value = serde_json::to_value(&result).expect("serialize");
        assert_eq!(value["skill"], "delete_session");
        assert_eq!(value["success"], true);
        assert!(value.get("error").is_none());
    }

    #[test]
    fn generate_qwen_tools_returns_nine_tools() {
        let tools = generate_qwen_tools(&[]);
        assert_eq!(tools.len(), 9, "should have 9 voice skills");

        // Verify each tool has required structure
        for tool in &tools {
            assert_eq!(tool["type"], "function");
            assert!(tool.get("name").is_some());
            assert!(tool.get("description").is_some());
            assert!(tool.get("parameters").is_some());
        }
    }

    #[test]
    fn generate_qwen_tools_invoke_backend_route_has_allowlist() {
        let tools = generate_qwen_tools(&[]);
        let invoke_route = tools
            .iter()
            .find(|t| t["name"] == "invoke_backend_route")
            .expect("invoke_backend_route tool should exist");

        let route_enum = invoke_route["parameters"]["properties"]["route_id"]["enum"]
            .as_array()
            .expect("route_id should have enum allowlist");

        // Verify allowlist contains expected routes
        let expected_routes = [
            "connections.list",
            "sessions.list",
            "sessions.create",
            "sessions.rename",
            "sessions.delete",
            "windows.list",
            "windows.create",
            "windows.delete",
            "panes.list",
            "panes.split",
            "panes.delete",
        ];

        for route in expected_routes {
            assert!(
                route_enum.contains(&serde_json::json!(route)),
                "allowlist should contain {}",
                route
            );
        }
    }

    #[test]
    fn generate_qwen_tools_navigate_frontend_has_route_enum() {
        let tools = generate_qwen_tools(&[]);
        let navigate = tools
            .iter()
            .find(|t| t["name"] == "navigate_frontend")
            .expect("navigate_frontend tool should exist");

        let route_enum = navigate["parameters"]["properties"]["route"]["enum"]
            .as_array()
            .expect("route should have enum");

        // Verify allowed frontend routes
        let expected_routes = [
            "home",
            "settings",
            "projects",
            "connections",
            "session",
            "window",
            "pane",
        ];

        for route in expected_routes {
            assert!(
                route_enum.contains(&serde_json::json!(route)),
                "navigate_frontend allowlist should contain {}",
                route
            );
        }
    }

    #[test]
    fn generate_qwen_tools_send_to_pane_has_dangerous_flags() {
        let tools = generate_qwen_tools(&[]);
        let send_to_pane = tools
            .iter()
            .find(|t| t["name"] == "send_to_pane")
            .expect("send_to_pane tool should exist");

        // Verify dangerous flag parameters exist
        let props = &send_to_pane["parameters"]["properties"];
        assert!(props.get("execute").is_some());
        assert!(props.get("append_enter").is_some());
        assert!(props.get("control").is_some());
        assert!(props.get("multiline").is_some());

        // Verify they are boolean with default false
        assert_eq!(props["execute"]["type"], "boolean");
        assert_eq!(props["execute"]["default"], false);
    }



}
