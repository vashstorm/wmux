//! Voice IPC commands for Tauri backend.
//!
//! These commands provide a secure IPC channel for voice communication,
//! keeping the DashScope API key strictly within Rust backend.

use tauri::{AppHandle, State, ipc::Channel};
use wmux_core::protocol::{OmniClientMessage, OmniServerEvent};

use crate::state::IpcState;

/// Configuration passed from frontend (never includes API key).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct VoiceClientConfig {
    /// Target tmux connection name
    pub target_name: Option<String>,
    /// Session name if known
    pub session: Option<String>,
    /// Window name if known
    pub window: Option<String>,
    /// Pane index if known
    pub pane: Option<String>,
    /// Connection type (e.g., "local")
    pub connection_type: Option<String>,
}

/// Open a voice session with DashScope WebSocket in the backend.
/// Returns a Channel for receiving server events.
#[tauri::command]
pub async fn voice_open(
    _app: AppHandle,
    state: State<'_, IpcState>,
    config: VoiceClientConfig,
    on_event: Channel<OmniServerEvent>,
) -> Result<(), String> {
    tracing::debug!("voice_open called with config: {:?}", config);

    // Get voice config from AppState
    let omni_config = state
        .app_state
        .store
        .snapshot()
        .map(|cfg| cfg.omni.clone())
        .map_err(|e| format!("failed to read config: {}", e))?;

    // Check if voice is enabled
    if !omni_config.enabled {
        return Err("voice_disabled".to_string());
    }

    // Check if API key exists (never exposed to frontend)
    let _api_key = match &omni_config.dashscope_api_key {
        Some(key) if !key.trim().is_empty() => key.trim().to_string(),
        _ => {
            return Err("voice_api_key_required".to_string());
        }
    };

    // Check microphone disabled
    if omni_config.microphone_disabled {
        return Err("microphone_disabled".to_string());
    }

    // Spawn the voice session task
    tauri::async_runtime::spawn(async move {
        // This would be where we connect to DashScope WebSocket
        // For now, we send a connected event to establish the channel
        let connected_event = OmniServerEvent::Connected;

        if let Err(e) = on_event.send(connected_event) {
            tracing::error!("failed to send connected event: {}", e);
            return;
        }

        // In a full implementation, we'd:
        // 1. Connect to DashScope WebSocket with api_key (backend only)
        // 2. Bridge messages between frontend Channel and DashScope
        // 3. Handle confirmation flow for dangerous actions
        // 4. Send audio_delta, transcript events back via on_event Channel

        tracing::debug!("voice session established (IPC mode)");
    });

    Ok(())
}

/// Send a client message to the active voice session.
#[tauri::command]
pub async fn voice_send(
    _state: State<'_, IpcState>,
    message: OmniClientMessage,
) -> Result<(), String> {
    let message_type = match &message {
        OmniClientMessage::AudioFrame { .. } => "audio_frame",
        OmniClientMessage::TextMessage { .. } => "text_message",
        OmniClientMessage::SessionContext { .. } => "session_context",
        OmniClientMessage::ConfirmAction { .. } => "confirm_action",
        OmniClientMessage::CancelAction { .. } => "cancel_action",
        OmniClientMessage::StopListening => "stop_listening",
        OmniClientMessage::StartListening => "start_listening",
        OmniClientMessage::StopResponse => "stop_response",
    };
    tracing::debug!("voice_send called: {}", message_type);

    // In a full implementation, this would:
    // 1. Look up the active voice session
    // 2. Forward the message to the DashScope WebSocket
    // 3. Handle audio_frame, text_message, confirm_action, cancel_action, etc.

    Ok(())
}

/// Close the active voice session.
#[tauri::command]
pub async fn voice_close(_state: State<'_, IpcState>) -> Result<(), String> {
    tracing::debug!("voice_close called");

    // In a full implementation, this would:
    // 1. Close the DashScope WebSocket connection
    // 2. Clean up any pending confirmations
    // 3. Emit a final event if needed

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_voice_client_config_deserialization() {
        let config_json = r#"{"target_name":"local","session":"test"}"#;
        let config: VoiceClientConfig = serde_json::from_str(config_json).unwrap();
        assert_eq!(config.target_name, Some("local".to_string()));
        assert_eq!(config.session, Some("test".to_string()));
    }

    #[test]
    fn test_voice_client_config_optional_fields() {
        let config_json = r#"{}"#;
        let config: VoiceClientConfig = serde_json::from_str(config_json).unwrap();
        assert_eq!(config.target_name, None);
        assert_eq!(config.session, None);
    }
}
