use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, FromRow, Default)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub session_name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub workdir: String,
    #[serde(default)]
    pub layout_json: String,
    #[serde(default)]
    pub details_json: String,
    #[serde(default)]
    pub progress_json: String,
    #[serde(default)]
    pub ai_html: String,
    #[serde(default)]
    pub ai_status: String,
    #[serde(default)]
    pub ai_error: String,
    pub last_synced_at: Option<String>,
    #[serde(default)]
    pub schema_version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub name: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub session_name: Option<String>,
    #[serde(default)]
    pub workdir: Option<String>,
    #[serde(default)]
    pub layout_json: Option<String>,
    #[serde(default)]
    pub details_json: Option<String>,
    #[serde(default)]
    pub progress_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProject {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub session_name: Option<String>,
    #[serde(default)]
    pub workdir: Option<String>,
    #[serde(default)]
    pub layout_json: Option<String>,
    #[serde(default)]
    pub details_json: Option<String>,
    #[serde(default)]
    pub progress_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLayout {
    pub schema_version: u32,
    pub windows: Vec<ProjectLayoutWindow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLayoutWindow {
    pub name: String,
    pub index: u32,
    pub active: bool,
    pub panes: Vec<ProjectLayoutPane>,
    pub window_layout: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLayoutPane {
    pub index: u32,
    pub active: bool,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageEvent {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub target_name: String,
    #[serde(default)]
    pub session_name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub duration_ms: i64,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub estimated_cost: Option<f64>,
    pub error_message: Option<String>,
    pub window_number: Option<i64>,
    pub response_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageSummary {
    pub total_events: i64,
    pub total_success: i64,
    pub total_error: i64,
    pub total_duration_ms: i64,
    pub total_prompt_tokens: i64,
    pub total_completion_tokens: i64,
    pub total_tokens: i64,
    pub total_estimated_cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAiUsageEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub target_name: String,
    #[serde(default)]
    pub session_name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub duration_ms: i64,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub estimated_cost: Option<f64>,
    pub error_message: Option<String>,
    pub window_number: Option<i64>,
    pub response_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OmniConversationMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub kind: String,
    pub text: String,
    pub event_json: Option<String>,
    pub target_name: Option<String>,
    pub session_name: Option<String>,
    pub window_name: Option<String>,
    pub pane_index: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmniHistoryListResponse {
    pub data: Vec<OmniConversationMessage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiLogEntry {
    pub id: String,
    pub conversation_id: String,
    pub event_kind: String,
    pub model: String,
    pub status: String,
    pub prompt_text: Option<String>,
    pub tool_name: Option<String>,
    pub tool_call_id: Option<String>,
    pub tool_arguments_json: Option<String>,
    pub tool_result_json: Option<String>,
    #[serde(default = "default_empty_json_object")]
    pub metrics_json: String,
    pub duration_ms: Option<i64>,
    #[serde(default = "default_empty_json_object")]
    pub raw_event_json: String,
    pub error_message: Option<String>,
    pub created_at: String,
}

fn default_empty_json_object() -> String {
    "{}".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAiLogEntry {
    pub id: Option<String>,
    pub conversation_id: String,
    pub event_kind: String,
    pub model: String,
    pub status: String,
    pub prompt_text: Option<String>,
    pub tool_name: Option<String>,
    pub tool_call_id: Option<String>,
    pub tool_arguments_json: Option<String>,
    pub tool_result_json: Option<String>,
    #[serde(default = "default_empty_json_object")]
    pub metrics_json: String,
    pub duration_ms: Option<i64>,
    #[serde(default = "default_empty_json_object")]
    pub raw_event_json: String,
    pub error_message: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiLogListResponse {
    pub data: Vec<AiLogEntry>,
    pub next_cursor: Option<String>,
}
