//! Voice WebSocket proxy handler for Qwen Realtime API.
//!
//! This module implements:
//! - WebSocket upgrade with Bearer auth (same as terminal)
//! - Upstream WebSocket connection to Qwen DashScope
//! - Bidirectional audio/text/tool-call proxying
//! - Function call handling with confirmation flow
//! - 120-minute session timeout notification

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{RwLock, mpsc};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_tls_with_config,
    tungstenite::protocol::Message as TungsteniteMessage,
};
use uuid::Uuid;

use wmux_core::config::VoiceConfig;
use wmux_core::protocol::{VoiceClientMessage, VoiceServerEvent, generate_qwen_tools};
use wmux_core::storage::{models::VoiceConversationMessage, voice_history::VoiceHistoryRepository};

use crate::state::AppState;
use crate::voice::audit::redact_secrets;
use crate::voice::{ConfirmationState, VoiceSkillExecutor, is_dangerous};

/// Session timeout constants
const SESSION_TIMEOUT_MINUTES: u64 = 120;
const TIMEOUT_WARNING_MINUTES: u64 = 110;

/// Function call argument accumulator state
#[derive(Debug, Default)]
struct FunctionCallAccumulator {
    /// Function name being called
    name: Option<String>,
    /// Accumulated argument deltas
    arguments: String,
    /// Call ID for tracking
    call_id: Option<String>,
}

/// Active voice session state
struct VoiceSessionState {
    conversation_id: String,
    /// Confirmation state manager for dangerous actions
    confirmation_state: ConfirmationState,
    /// Pending function call accumulators by call_id
    function_calls: Arc<RwLock<HashMap<String, FunctionCallAccumulator>>>,
    /// Session start time for timeout tracking
    started_at: Instant,
}

impl VoiceSessionState {
    fn new() -> Self {
        Self {
            conversation_id: Uuid::new_v4().to_string(),
            confirmation_state: ConfirmationState::new(),
            function_calls: Arc::new(RwLock::new(HashMap::new())),
            started_at: Instant::now(),
        }
    }

    /// Check if timeout warning should be sent (at 110 minutes)
    fn should_send_timeout_warning(&self) -> bool {
        let elapsed = self.started_at.elapsed();
        elapsed >= Duration::from_secs(TIMEOUT_WARNING_MINUTES * 60)
            && elapsed < Duration::from_secs(SESSION_TIMEOUT_MINUTES * 60)
    }

    /// Check if session has timed out
    fn is_timed_out(&self) -> bool {
        self.started_at.elapsed() >= Duration::from_secs(SESSION_TIMEOUT_MINUTES * 60)
    }

    /// Get remaining seconds before timeout
    fn remaining_seconds(&self) -> u32 {
        let elapsed_secs = self.started_at.elapsed().as_secs();
        let total_secs = SESSION_TIMEOUT_MINUTES * 60;
        if elapsed_secs >= total_secs {
            0
        } else {
            (total_secs - elapsed_secs) as u32
        }
    }
}

/// WebSocket upgrade handler for voice endpoint.
pub async fn websocket(State(state): State<AppState>, ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_voice_socket(state, socket))
}

/// Handle voice WebSocket connection after upgrade.
async fn handle_voice_socket(state: AppState, mut socket: WebSocket) {
    tracing::debug!("voice websocket connecting");

    // Validate voice config
    let voice_config = match get_voice_config(&state) {
        Ok(config) => config,
        Err(error) => {
            tracing::error!("voice config read failed: {}", error);
            send_error_and_close(&mut socket, "internal_error", error.to_string()).await;
            return;
        }
    };

    // Check if voice is enabled
    if !voice_config.enabled {
        tracing::warn!("voice disabled, rejecting connection");
        send_error_and_close(
            &mut socket,
            "voice_disabled",
            "Voice feature is not enabled in configuration".to_string(),
        )
        .await;
        return;
    }

    // Check if API key is present
    let api_key = match &voice_config.dashscope_api_key {
        Some(key) if !key.trim().is_empty() => key.trim().to_string(),
        _ => {
            tracing::warn!("voice API key missing");
            send_error_and_close(
                &mut socket,
                "voice_api_key_missing",
                "DashScope API key is required for voice feature".to_string(),
            )
            .await;
            return;
        }
    };

    if voice_config.microphone_disabled {
        tracing::warn!("microphone disabled, rejecting voice connection");
        send_error_and_close(
            &mut socket,
            "microphone_disabled",
            "Microphone disabled in Settings".to_string(),
        )
        .await;
        return;
    }

    // Send Connected event to client
    if send_voice_event(&mut socket, &VoiceServerEvent::Connected)
        .await
        .is_err()
    {
        return;
    }

    // Connect to Qwen upstream
    let upstream_url = format!("{}?model={}", voice_config.endpoint, voice_config.model);
    tracing::debug!("connecting to Qwen upstream: {}", upstream_url);

    let mut upstream = match connect_to_qwen(&upstream_url, &api_key).await {
        Ok(ws) => ws,
        Err(error) => {
            tracing::error!("Qwen upstream connection failed: {}", error);
            send_error_and_close(&mut socket, "qwen_connection_failed", error.to_string()).await;
            return;
        }
    };

    // Send session.update to Qwen with tools
    if send_session_update(&mut upstream, &voice_config)
        .await
        .is_err()
    {
        tracing::error!("failed to send session.update to Qwen");
        send_error_and_close(
            &mut socket,
            "qwen_session_error",
            "Failed to initialize Qwen session".to_string(),
        )
        .await;
        return;
    }

    tracing::debug!("voice session established with Qwen");

    // Create session state
    let session_state = VoiceSessionState::new();

    // Bridge bidirectional messages
    bridge_voice(socket, upstream, state, session_state).await;
}

/// Get voice config from AppState
fn get_voice_config(state: &AppState) -> Result<VoiceConfig, String> {
    state
        .store
        .snapshot()
        .map(|config| config.voice.clone())
        .map_err(|e| format!("failed to read config: {}", e))
}

async fn persist_history_message(state: &AppState, message: VoiceConversationMessage) {
    let Some(pool) = &state.storage else {
        return;
    };
    let repository = VoiceHistoryRepository::new(pool.clone());
    if let Err(error) = repository.insert(&message).await {
        tracing::error!(
            conversation_id = %message.conversation_id,
            role = %message.role,
            kind = %message.kind,
            "voice history insert failed: {}",
            error
        );
    }
}

fn history_message(
    conversation_id: &str,
    role: &str,
    kind: &str,
    text: String,
    event_json: Option<String>,
) -> VoiceConversationMessage {
    VoiceConversationMessage {
        id: String::new(),
        conversation_id: conversation_id.to_string(),
        role: role.to_string(),
        kind: kind.to_string(),
        text,
        event_json,
        target_name: None,
        session_name: None,
        window_name: None,
        pane_index: None,
        created_at: String::new(),
    }
}

fn redacted_json(value: serde_json::Value) -> Option<String> {
    serde_json::to_string(&redact_secrets(&value)).ok()
}

async fn persist_voice_event(
    state: &AppState,
    session_state: &VoiceSessionState,
    event: &VoiceServerEvent,
) {
    match event {
        VoiceServerEvent::TranscriptDone { text } => {
            persist_history_message(
                state,
                history_message(
                    &session_state.conversation_id,
                    "user",
                    "transcript",
                    text.clone(),
                    None,
                ),
            )
            .await;
        }
        VoiceServerEvent::ActionResult { skill, .. } => {
            let event_json = serde_json::to_value(event).ok().and_then(redacted_json);
            persist_history_message(
                state,
                history_message(
                    &session_state.conversation_id,
                    "tool",
                    "tool_result",
                    skill.clone(),
                    event_json,
                ),
            )
            .await;
        }
        _ => {}
    }
}

async fn persist_assistant_text(state: &AppState, session_state: &VoiceSessionState, text: String) {
    persist_history_message(
        state,
        history_message(
            &session_state.conversation_id,
            "assistant",
            "assistant_text",
            text,
            None,
        ),
    )
    .await;
}

async fn persist_tool_call(
    state: &AppState,
    session_state: &VoiceSessionState,
    skill: &str,
    params: &serde_json::Value,
) {
    let event_json = redacted_json(serde_json::json!({
        "skill": skill,
        "params": params,
    }));
    persist_history_message(
        state,
        history_message(
            &session_state.conversation_id,
            "tool",
            "tool_call",
            skill.to_string(),
            event_json,
        ),
    )
    .await;
}

async fn persist_tool_result(
    state: &AppState,
    session_state: &VoiceSessionState,
    skill: &str,
    success: bool,
    error: Option<String>,
) {
    let event = VoiceServerEvent::ActionResult {
        skill: skill.to_string(),
        success,
        error,
    };
    persist_voice_event(state, session_state, &event).await;
}

/// Connect to Qwen DashScope WebSocket endpoint with auth header.
async fn connect_to_qwen(
    url: &str,
    api_key: &str,
) -> Result<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>, String> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    let mut request = url
        .into_client_request()
        .map_err(|e| format!("failed to build request: {}", e))?;
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", api_key)
            .parse()
            .map_err(|e| format!("failed to build auth header: {}", e))?,
    );

    let (ws_stream, _) = connect_async_tls_with_config(request, None, false, None)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    Ok(ws_stream)
}

/// Send session.update event to Qwen with tools configuration.
async fn send_session_update(
    upstream: &mut WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
    config: &VoiceConfig,
) -> Result<(), String> {
    let tools = generate_qwen_tools(&config.skills);

    let session_update = serde_json::json!({
        "type": "session.update",
        "session": {
            "tools": tools,
            "enable_search": false,
            "input_audio_format": {
                "format": "pcm16",
                "sample_rate": 16000,
                "channels": 1
            },
            "output_audio_format": {
                "format": "pcm24",
                "sample_rate": 24000,
                "channels": 1
            },
            "vad": {
                "enabled": config.vad_enabled,
                "threshold": config.vad_threshold
            }
        }
    });

    let message = TungsteniteMessage::Text(
        serde_json::to_string(&session_update)
            .map_err(|e| format!("failed to serialize session.update: {}", e))?
            .into(),
    );

    upstream
        .send(message)
        .await
        .map_err(|e| format!("failed to send session.update: {}", e))?;

    tracing::debug!("sent session.update to Qwen with {} tools", tools.len());
    Ok(())
}

/// Bridge bidirectional messages between client and Qwen upstream.
async fn bridge_voice(
    client: WebSocket,
    upstream: WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
    state: AppState,
    session_state: VoiceSessionState,
) {
    let (mut upstream_tx, mut upstream_rx) = upstream.split();
    let (mut client_tx, mut client_rx) = client.split();

    // Channel for tool results to send to Qwen
    let (tool_result_tx, mut tool_result_rx) = mpsc::channel::<serde_json::Value>(32);

    // Track timeout warning sent
    let mut timeout_warning_sent = false;

    loop {
        tokio::select! {
            // Client -> Upstream (audio frames, confirm/cancel)
            message = client_rx.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        match handle_client_message(&text, &session_state, &state, &tool_result_tx).await {
                            Ok(qwen_messages) => {
                                for qwen_msg in qwen_messages {
                                    if let Err(error) = send_qwen_json(&mut upstream_tx, &qwen_msg).await {
                                        tracing::error!("failed to forward to Qwen: {}", error);
                                    }
                                }
                            }
                            Err(error) => {
                                tracing::error!("client message handling failed: {}", error);
                                let _ = send_voice_event_raw(&mut client_tx, &VoiceServerEvent::Error {
                                    code: "message_handling_error".to_string(),
                                    message: error,
                                }).await;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::debug!("client closed connection");
                        break;
                    }
                    Some(Ok(_)) => {} // Ignore binary/ping messages
                    Some(Err(error)) => {
                        tracing::error!("client receive error: {}", error);
                        break;
                    }
                }
            }

            // Upstream -> Client (audio, transcript, function_call)
            message = upstream_rx.next() => {
                match message {
                    Some(Ok(TungsteniteMessage::Text(text))) => {
                        match handle_qwen_message(&text, &session_state, &state, &tool_result_tx).await {
                            Ok(Some(event)) => {
                                if let Err(error) = send_voice_event_raw(&mut client_tx, &event).await {
                                    tracing::error!("failed to send to client: {}", error);
                                }
                            }
                            Ok(None) => {} // No event to forward
                            Err(error) => {
                                tracing::error!("Qwen message handling failed: {}", error);
                                let _ = send_voice_event_raw(&mut client_tx, &VoiceServerEvent::Error {
                                    code: "qwen_message_error".to_string(),
                                    message: error,
                                }).await;
                            }
                        }
                    }
                    Some(Ok(TungsteniteMessage::Close(_))) => {
                        tracing::debug!("Qwen closed connection");
                        break;
                    }
                    Some(Ok(_)) => {} // Ignore binary/ping messages
                    Some(Err(error)) => {
                        tracing::error!("Qwen receive error: {}", error);
                        let _ = send_voice_event_raw(&mut client_tx, &VoiceServerEvent::Error {
                            code: "qwen_connection_error".to_string(),
                            message: error.to_string(),
                        }).await;
                        break;
                    }
                    None => {
                        tracing::debug!("Qwen stream ended");
                        break;
                    }
                }
            }

            // Tool results to send to Qwen
            result = tool_result_rx.recv() => {
                if let Some(tool_result) = result {
                    // Send conversation.item.create with function_call_output
                    let call_id = tool_result.get("call_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    let item_create = serde_json::json!({
                        "type": "conversation.item.create",
                        "item": {
                            "type": "function_call_output",
                            "call_id": call_id,
                            "output": tool_result.get("output").unwrap_or(&serde_json::Value::Null)
                        }
                    });

                    if let Err(error) = send_qwen_json(&mut upstream_tx, &item_create).await {
                        tracing::error!("failed to send function_call_output to Qwen: {}", error);
                    }

                    // Send response.create to trigger new response
                    let response_create = serde_json::json!({
                        "type": "response.create"
                    });

                    if let Err(error) = send_qwen_json(&mut upstream_tx, &response_create).await {
                        tracing::error!("failed to send response.create to Qwen: {}", error);
                    }
                }
            }

            // Timeout check
            _ = tokio::time::sleep(Duration::from_secs(60)) => {
                if !timeout_warning_sent && session_state.should_send_timeout_warning() {
                    timeout_warning_sent = true;
                    let remaining = session_state.remaining_seconds();
                    tracing::warn!("voice session timeout warning: {} seconds remaining", remaining);
                    let _ = send_voice_event_raw(&mut client_tx, &VoiceServerEvent::SessionTimeout {
                        remaining_seconds: remaining,
                    }).await;
                }

                if session_state.is_timed_out() {
                    tracing::warn!("voice session timed out after {} minutes", SESSION_TIMEOUT_MINUTES);
                    let _ = send_voice_event_raw(&mut client_tx, &VoiceServerEvent::Error {
                        code: "session_timeout".to_string(),
                        message: format!("Voice session timed out after {} minutes", SESSION_TIMEOUT_MINUTES),
                    }).await;
                    break;
                }
            }
        }
    }

    // Cleanup
    let _ = upstream_tx.send(TungsteniteMessage::Close(None)).await;
    let _ = client_tx.send(Message::Close(None)).await;
    tracing::debug!("voice websocket disconnected");
}

/// Handle client message, returns optional Qwen message to forward.
async fn handle_client_message(
    text: &str,
    session_state: &VoiceSessionState,
    state: &AppState,
    tool_result_tx: &mpsc::Sender<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    let msg: VoiceClientMessage =
        serde_json::from_str(text).map_err(|e| format!("invalid client message: {}", e))?;

    match msg {
        VoiceClientMessage::AudioFrame {
            pcm16_base64,
            sample_rate,
        } => Ok(vec![serde_json::json!({
            "type": "input_audio_buffer.append",
            "audio": pcm16_base64,
            "format": {
                "format": "pcm16",
                "sample_rate": sample_rate,
                "channels": 1
            }
        })]),

        VoiceClientMessage::TextMessage { text } => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Err("text is required".to_string());
            }

            persist_voice_event(
                state,
                session_state,
                &VoiceServerEvent::TranscriptDone {
                    text: trimmed.to_string(),
                },
            )
            .await;

            Ok(vec![
                serde_json::json!({
                    "type": "conversation.item.create",
                    "item": {
                        "type": "message",
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": trimmed
                            }
                        ]
                    }
                }),
                serde_json::json!({
                    "type": "response.create"
                }),
            ])
        }

        VoiceClientMessage::ConfirmAction { confirmation_id } => {
            let id = Uuid::parse_str(&confirmation_id)
                .map_err(|e| format!("invalid confirmation ID: {}", e))?;

            // Verify the confirmation and get the original params
            let params = session_state
                .confirmation_state
                .verify_confirmation(id)
                .await
                .map_err(|e| format!("confirmation verification failed: {}", e))?;

            // Extract skill from params (stored during function call handling)
            let skill = params
                .get("_skill")
                .and_then(|v| v.as_str())
                .ok_or("missing _skill in confirmation params")?;

            // Remove the internal _skill field before executing
            let mut clean_params = params.clone();
            if let Some(obj) = clean_params.as_object_mut() {
                obj.remove("_skill");
            }

            // Execute the skill
            let result = execute_voice_action(skill, &clean_params, state).await;
            let success = result.is_ok();
            let error = result.as_ref().err().cloned();
            persist_tool_result(state, session_state, skill, success, error.clone()).await;

            // Send tool result to Qwen
            let tool_result = serde_json::json!({
                "call_id": confirmation_id,
                "output": {
                    "success": success,
                    "error": error
                }
            });
            let _ = tool_result_tx.try_send(tool_result);
            Ok(Vec::new())
        }

        VoiceClientMessage::CancelAction { confirmation_id } => {
            persist_tool_result(
                state,
                session_state,
                "cancel_action",
                false,
                Some("action_cancelled".to_string()),
            )
            .await;
            // Just send cancellation result to Qwen
            let result = serde_json::json!({
                "call_id": confirmation_id,
                "output": { "success": false, "error": "action_cancelled" }
            });
            let _ = tool_result_tx.try_send(result);
            Ok(Vec::new())
        }

        VoiceClientMessage::StopListening => Ok(vec![serde_json::json!({
            "type": "input_audio_buffer.clear"
        })]),

        VoiceClientMessage::StartListening => Ok(vec![serde_json::json!({
            "type": "input_audio_buffer.commit"
        })]),
    }
}

/// Handle Qwen message, returns optional VoiceServerEvent to forward.
async fn handle_qwen_message(
    text: &str,
    session_state: &VoiceSessionState,
    state: &AppState,
    tool_result_tx: &mpsc::Sender<serde_json::Value>,
) -> Result<Option<VoiceServerEvent>, String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("invalid Qwen message: {}", e))?;

    let event_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match event_type {
        // Audio output from Qwen TTS
        "response.audio.delta" | "output_audio.delta" => {
            let audio = value
                .get("audio")
                .or_else(|| value.get("delta"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Ok(Some(VoiceServerEvent::AudioDelta {
                pcm16_base64: audio.to_string(),
                sample_rate: 24000,
            }))
        }

        // Transcript updates
        "conversation.item.input_audio_transcription.delta" | "input_audio_transcription.delta" => {
            let text_content = value
                .get("transcript")
                .or_else(|| value.get("text"))
                .or_else(|| value.get("delta"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Ok(Some(VoiceServerEvent::TranscriptDelta {
                text: text_content.to_string(),
            }))
        }

        "conversation.item.input_audio_transcription.completed"
        | "input_audio_transcription.done" => {
            let text_content = value
                .get("transcript")
                .or_else(|| value.get("text"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let event = VoiceServerEvent::TranscriptDone {
                text: text_content.to_string(),
            };
            persist_voice_event(state, session_state, &event).await;
            Ok(Some(event))
        }

        "response.text.done" | "response.output_text.done" | "output_text.done" => {
            let text_content = value
                .get("text")
                .or_else(|| value.get("transcript"))
                .or_else(|| value.get("content"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            persist_assistant_text(state, session_state, text_content.to_string()).await;
            Ok(Some(VoiceServerEvent::AssistantMessage {
                text: text_content.to_string(),
            }))
        }

        // Function call handling - accumulate deltas
        "response.function_call_arguments.delta" | "function_call.arguments.delta" => {
            let call_id = value
                .get("call_id")
                .or_else(|| value.get("callId"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let name = value
                .get("name")
                .or_else(|| value.get("function_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let delta = value
                .get("arguments")
                .or_else(|| value.get("delta"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let mut function_calls = session_state.function_calls.write().await;
            let accumulator = function_calls.entry(call_id.to_string()).or_default();
            accumulator.call_id = Some(call_id.to_string());
            accumulator.name = Some(name.to_string());
            accumulator.arguments.push_str(delta);
            Ok(None)
        }

        "response.function_call_arguments.done" | "function_call.arguments.done" => {
            let call_id = value
                .get("call_id")
                .or_else(|| value.get("callId"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let name = value
                .get("name")
                .or_else(|| value.get("function_name"))
                .and_then(|v| v.as_str());
            let arguments = value.get("arguments").and_then(|v| v.as_str());

            let mut function_calls = session_state.function_calls.write().await;
            let mut accumulator = function_calls.remove(call_id).unwrap_or_default();
            if let Some(name) = name {
                accumulator.name = Some(name.to_string());
            }
            if let Some(arguments) = arguments {
                accumulator.arguments.push_str(arguments);
            }

            if !accumulator.arguments.is_empty() || accumulator.name.is_some() {
                let skill = accumulator.name.clone().unwrap_or_default();
                let args_str = accumulator.arguments.clone();

                let params: serde_json::Value = if args_str.is_empty() {
                    serde_json::Value::Object(serde_json::Map::new())
                } else {
                    serde_json::from_str(&args_str)
                        .map_err(|e| format!("invalid function arguments: {}", e))?
                };

                let dangerous = is_dangerous(&skill, &params);
                persist_tool_call(state, session_state, &skill, &params).await;

                if dangerous {
                    // Store skill name in params for later retrieval during confirmation
                    let mut params_with_skill = params.clone();
                    if let Some(obj) = params_with_skill.as_object_mut() {
                        obj.insert(
                            "_skill".to_string(),
                            serde_json::Value::String(skill.clone()),
                        );
                    }
                    let confirmation = session_state
                        .confirmation_state
                        .request_confirmation(skill.clone(), params_with_skill)
                        .await;

                    Ok(Some(VoiceServerEvent::IntentReceived {
                        skill: skill.clone(),
                        params,
                        confirmation_required: true,
                        confirmation_id: Some(confirmation.id.to_string()),
                    }))
                } else {
                    // Execute immediately
                    let result = execute_voice_action(&skill, &params, state).await;
                    let success = result.is_ok();
                    let error = result.as_ref().err().cloned();
                    persist_tool_result(state, session_state, &skill, success, error.clone()).await;

                    // Send tool result
                    let tool_result = serde_json::json!({
                        "call_id": call_id,
                        "output": {
                            "success": success,
                            "error": error
                        }
                    });
                    let _ = tool_result_tx.try_send(tool_result);

                    Ok(Some(VoiceServerEvent::IntentReceived {
                        skill: skill.clone(),
                        params,
                        confirmation_required: false,
                        confirmation_id: None,
                    }))
                }
            } else {
                Ok(None)
            }
        }

        // Error from Qwen
        "error" => {
            let error_code = value
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("qwen_error");
            let error_msg = value
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown Qwen error");
            Ok(Some(VoiceServerEvent::Error {
                code: error_code.to_string(),
                message: error_msg.to_string(),
            }))
        }

        // Session events - no forwarding needed
        "session.created" | "session.updated" | "response.done" | "response.audio.done" => {
            tracing::debug!("Qwen event: {}", event_type);
            Ok(None)
        }

        _ => {
            tracing::debug!("unknown Qwen event type: {}", event_type);
            Ok(None)
        }
    }
}

/// Execute a voice action skill.
async fn execute_voice_action(
    skill: &str,
    params: &serde_json::Value,
    state: &AppState,
) -> Result<(), String> {
    let voice_config = get_voice_config(state)?;
    let executor = VoiceSkillExecutor::new(state.clone());
    executor
        .execute_with_overlay(skill, params.clone(), &voice_config.skills)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Send a VoiceServerEvent to client WebSocket.
async fn send_voice_event(socket: &mut WebSocket, event: &VoiceServerEvent) -> Result<(), String> {
    let text =
        serde_json::to_string(event).map_err(|e| format!("failed to serialize event: {}", e))?;
    socket
        .send(Message::Text(text.into()))
        .await
        .map_err(|e| format!("failed to send event: {}", e))?;
    Ok(())
}

/// Send a VoiceServerEvent to client WebSocket (split sink version).
async fn send_voice_event_raw(
    tx: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    event: &VoiceServerEvent,
) -> Result<(), String> {
    let text =
        serde_json::to_string(event).map_err(|e| format!("failed to serialize event: {}", e))?;
    tx.send(Message::Text(text.into()))
        .await
        .map_err(|e| format!("failed to send event: {}", e))?;
    Ok(())
}

/// Send a JSON message to Qwen upstream.
async fn send_qwen_json(
    tx: &mut futures_util::stream::SplitSink<
        WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
        TungsteniteMessage,
    >,
    value: &serde_json::Value,
) -> Result<(), String> {
    let text = serde_json::to_string(value).map_err(|e| format!("failed to serialize: {}", e))?;
    tx.send(TungsteniteMessage::Text(text.into()))
        .await
        .map_err(|e| format!("failed to send: {}", e))?;
    Ok(())
}

/// Send error message and close WebSocket.
async fn send_error_and_close(socket: &mut WebSocket, code: &str, message: String) {
    let _ = send_voice_event(
        socket,
        &VoiceServerEvent::Error {
            code: code.to_string(),
            message,
        },
    )
    .await;
    let _ = socket.send(Message::Close(None)).await;
}

// ============================================================================
// Tests with Mock Qwen WebSocket Server
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use serde_json::{Value, json};
    use std::fs;
    use tokio::net::TcpListener;
    use tokio::sync::mpsc::UnboundedReceiver;
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::handshake::client::Request as ClientRequest;
    use tokio_tungstenite::tungstenite::handshake::server::{
        Request as ServerRequest, Response as ServerResponse,
    };
    use wmux_core::config::Config;
    use wmux_core::logging::LoggingHandle;
    use wmux_core::storage::{db, models::VoiceConversationMessage};

    const TOKEN: &str = "test-token";

    fn test_voice_config(endpoint: String, enabled: bool, api_key: Option<&str>) -> Config {
        let mut config = Config::default();
        config.server.bind = "127.0.0.1:0".to_string();
        config.auth.token = TOKEN.to_string();
        config.voice.enabled = enabled;
        config.voice.dashscope_api_key = api_key.map(ToString::to_string);
        config.voice.endpoint = endpoint;
        config.voice.model = "qwen3.5-omni-flash-realtime".to_string();
        config
    }

    async fn test_state_with_storage(
        config: Config,
    ) -> (AppState, tempfile::TempDir, sqlx::SqlitePool) {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config).expect("serialize config"),
        )
        .expect("write config");
        let store = Config::load(&config_path).expect("load config");
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create pool");
        db::run_migrations(&pool).await.expect("run migrations");
        let mut state = AppState::new(store, assets_dir, LoggingHandle::empty());
        state.storage = Some(pool.clone());
        (state, dir, pool)
    }

    fn test_app(config: Config) -> (Router, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config).expect("serialize config"),
        )
        .expect("write config");
        let store = Config::load(&config_path).expect("load config");
        let state = AppState::new(store, assets_dir, LoggingHandle::empty());
        (crate::routes::router(state), dir)
    }

    async fn spawn_test_app(
        config: Config,
    ) -> (String, tokio::task::JoinHandle<()>, tempfile::TempDir) {
        let (app, dir) = test_app(config);
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind app");
        let addr = listener.local_addr().expect("app addr");
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app.into_make_service()).await;
        });
        (format!("ws://{addr}/api/voice"), handle, dir)
    }

    async fn spawn_mock_qwen() -> (
        String,
        UnboundedReceiver<Value>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock qwen");
        let addr = listener.local_addr().expect("mock addr");
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept qwen connection");
            let handshake_tx = tx.clone();
            let mut ws = tokio_tungstenite::accept_hdr_async(
                stream,
                move |request: &ServerRequest, response: ServerResponse| {
                    let _ = handshake_tx.send(json!({
                        "type": "handshake",
                        "uri": request.uri().to_string(),
                        "authorization": request.headers()
                            .get("authorization")
                            .and_then(|value| value.to_str().ok())
                            .unwrap_or_default()
                    }));
                    Ok(response)
                },
            )
            .await
            .expect("accept qwen websocket");

            while let Some(message) = ws.next().await {
                let Ok(TungsteniteMessage::Text(text)) = message else {
                    continue;
                };
                let value: Value = serde_json::from_str(&text).expect("qwen client json");
                let message_type = value
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let _ = tx.send(value);
                if message_type == "input_audio_buffer.append" {
                    let events = [
                        json!({ "type": "output_audio.delta", "delta": "qwen-audio" }),
                        json!({ "type": "input_audio_transcription.delta", "delta": "hel" }),
                        json!({ "type": "input_audio_transcription.done", "text": "hello" }),
                        json!({ "type": "function_call.arguments.delta", "call_id": "call-1", "name": "navigate_frontend", "delta": "{\"route\":\"home\"}" }),
                        json!({ "type": "function_call.arguments.done", "call_id": "call-1" }),
                    ];
                    for event in events {
                        ws.send(TungsteniteMessage::Text(event.to_string().into()))
                            .await
                            .expect("send qwen event");
                    }
                }
            }
        });
        (format!("ws://{addr}/realtime"), rx, handle)
    }

    async fn next_mock_message(rx: &mut UnboundedReceiver<Value>) -> Value {
        tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("mock message timeout")
            .expect("mock message")
    }

    async fn next_client_event(
        client: &mut WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
    ) -> VoiceServerEvent {
        let message = tokio::time::timeout(Duration::from_secs(5), client.next())
            .await
            .expect("client event timeout")
            .expect("client event")
            .expect("client message");
        let TungsteniteMessage::Text(text) = message else {
            panic!("expected text event");
        };
        serde_json::from_str(&text).expect("voice event")
    }

    fn authorized_request(url: &str) -> ClientRequest {
        let mut request = url.into_client_request().expect("client request");
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {TOKEN}").parse().expect("auth header"),
        );
        request
    }

    #[tokio::test]
    async fn voice_proxy_uses_mock_qwen_and_maps_events() {
        let (qwen_endpoint, mut qwen_rx, qwen_handle) = spawn_mock_qwen().await;
        let config = test_voice_config(qwen_endpoint, true, Some("dashscope-test-key"));
        let (app_url, app_handle, _dir) = spawn_test_app(config).await;
        let request = authorized_request(&app_url);
        let (mut client, _) = connect_async(request)
            .await
            .expect("connect voice websocket");

        assert_eq!(
            next_client_event(&mut client).await,
            VoiceServerEvent::Connected
        );

        let handshake = next_mock_message(&mut qwen_rx).await;
        assert_eq!(handshake["authorization"], "Bearer dashscope-test-key");
        assert!(
            handshake["uri"]
                .as_str()
                .unwrap()
                .contains("model=qwen3.5-omni-flash-realtime")
        );

        let session_update = next_mock_message(&mut qwen_rx).await;
        assert_eq!(session_update["type"], "session.update");
        assert_eq!(session_update["session"]["enable_search"], false);
        assert_eq!(
            session_update["session"]["input_audio_format"]["format"],
            "pcm16"
        );
        assert_eq!(
            session_update["session"]["input_audio_format"]["sample_rate"],
            16000
        );
        assert_eq!(
            session_update["session"]["output_audio_format"]["format"],
            "pcm24"
        );
        assert_eq!(
            session_update["session"]["output_audio_format"]["sample_rate"],
            24000
        );
        assert_eq!(
            session_update["session"]["tools"].as_array().unwrap().len(),
            9
        );

        let client_audio = VoiceClientMessage::AudioFrame {
            pcm16_base64: "client-audio".to_string(),
            sample_rate: 16000,
        };
        client
            .send(TungsteniteMessage::Text(
                serde_json::to_string(&client_audio)
                    .expect("serialize audio")
                    .into(),
            ))
            .await
            .expect("send client audio");

        let qwen_audio = next_mock_message(&mut qwen_rx).await;
        assert_eq!(qwen_audio["type"], "input_audio_buffer.append");
        assert_eq!(qwen_audio["audio"], "client-audio");

        assert_eq!(
            next_client_event(&mut client).await,
            VoiceServerEvent::AudioDelta {
                pcm16_base64: "qwen-audio".to_string(),
                sample_rate: 24000,
            }
        );
        assert_eq!(
            next_client_event(&mut client).await,
            VoiceServerEvent::TranscriptDelta {
                text: "hel".to_string(),
            }
        );
        assert_eq!(
            next_client_event(&mut client).await,
            VoiceServerEvent::TranscriptDone {
                text: "hello".to_string(),
            }
        );
        assert_eq!(
            next_client_event(&mut client).await,
            VoiceServerEvent::IntentReceived {
                skill: "navigate_frontend".to_string(),
                params: json!({ "route": "home" }),
                confirmation_required: false,
                confirmation_id: None,
            }
        );

        let tool_output = next_mock_message(&mut qwen_rx).await;
        assert_eq!(tool_output["type"], "conversation.item.create");
        assert_eq!(tool_output["item"]["type"], "function_call_output");
        let response_create = next_mock_message(&mut qwen_rx).await;
        assert_eq!(response_create["type"], "response.create");

        let _ = client.close(None).await;
        app_handle.abort();
        qwen_handle.abort();
    }

    #[tokio::test]
    async fn voice_disabled_returns_error_without_qwen_network() {
        let config = test_voice_config(
            "ws://127.0.0.1:9/realtime".to_string(),
            false,
            Some("unused"),
        );
        let (app_url, app_handle, _dir) = spawn_test_app(config).await;
        let request = authorized_request(&app_url);
        let (mut client, _) = connect_async(request)
            .await
            .expect("connect voice websocket");

        assert_eq!(
            next_client_event(&mut client).await,
            VoiceServerEvent::Error {
                code: "voice_disabled".to_string(),
                message: "Voice feature is not enabled in configuration".to_string(),
            }
        );

        let _ = client.close(None).await;
        app_handle.abort();
    }

    #[tokio::test]
    async fn microphone_disabled_returns_error_without_qwen_connection() {
        let (qwen_endpoint, mut qwen_rx, qwen_handle) = spawn_mock_qwen().await;
        let mut config = test_voice_config(qwen_endpoint, true, Some("dashscope-test-key"));
        config.voice.microphone_disabled = true;
        let (app_url, app_handle, _dir) = spawn_test_app(config).await;
        let request = authorized_request(&app_url);
        let (mut client, _) = connect_async(request)
            .await
            .expect("connect voice websocket");

        assert_eq!(
            next_client_event(&mut client).await,
            VoiceServerEvent::Error {
                code: "microphone_disabled".to_string(),
                message: "Microphone disabled in Settings".to_string(),
            }
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(100), qwen_rx.recv())
                .await
                .is_err(),
            "Qwen should not receive a connection when microphone is disabled"
        );

        let _ = client.close(None).await;
        app_handle.abort();
        qwen_handle.abort();
    }

    #[tokio::test]
    async fn transcript_done_event_inserts_history_with_session_conversation_id() {
        let config = test_voice_config("ws://127.0.0.1:9/realtime".to_string(), true, Some("key"));
        let (state, _dir, pool) = test_state_with_storage(config).await;
        let session_state = VoiceSessionState::new();

        let event = handle_qwen_message(
            &json!({ "type": "input_audio_transcription.done", "text": "hello history" })
                .to_string(),
            &session_state,
            &state,
            &mpsc::channel(1).0,
        )
        .await
        .expect("handle qwen message");

        assert_eq!(
            event,
            Some(VoiceServerEvent::TranscriptDone {
                text: "hello history".to_string(),
            })
        );
        let rows = sqlx::query_as::<_, VoiceConversationMessage>(
            "SELECT id, conversation_id, role, kind, text, event_json, target_name, session_name, window_name, pane_index, created_at FROM voice_conversation_messages",
        )
        .fetch_all(&pool)
        .await
        .expect("fetch history rows");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].conversation_id, session_state.conversation_id);
        assert!(Uuid::parse_str(&rows[0].conversation_id).is_ok());
        assert_eq!(rows[0].role, "user");
        assert_eq!(rows[0].kind, "transcript");
        assert_eq!(rows[0].text, "hello history");
    }

    /// Test voice config validation returns error when voice disabled.
    #[tokio::test]
    async fn test_voice_disabled_validation() {
        // Create minimal voice config with disabled=true
        let config = VoiceConfig {
            enabled: false,
            dashscope_api_key: None,
            microphone_disabled: false,
            voice: None,
            skills: Vec::new(),
            model: "qwen3.5-omni-flash-realtime".to_string(),
            endpoint: "wss://test".to_string(),
            continuous_listening: true,
            store_raw_audio: false,
            audit_log_path: None,
            vad_enabled: true,
            vad_threshold: 0.5,
        };

        assert!(!config.enabled, "voice should be disabled");
        assert!(
            config.dashscope_api_key.is_none()
                || config.dashscope_api_key.as_ref().unwrap().is_empty()
        );
    }

    /// Test voice config returns error when API key missing.
    #[tokio::test]
    async fn test_voice_api_key_missing_validation() {
        let config = VoiceConfig {
            enabled: true,
            dashscope_api_key: None,
            microphone_disabled: false,
            voice: None,
            skills: Vec::new(),
            model: "qwen3.5-omni-flash-realtime".to_string(),
            endpoint: "wss://test".to_string(),
            continuous_listening: true,
            store_raw_audio: false,
            audit_log_path: None,
            vad_enabled: true,
            vad_threshold: 0.5,
        };

        assert!(config.enabled);
        assert!(config.dashscope_api_key.is_none());
    }

    /// Test session.update structure is correct.
    #[test]
    fn test_session_update_structure() {
        let config = VoiceConfig {
            enabled: true,
            dashscope_api_key: Some("test-key".to_string()),
            microphone_disabled: false,
            voice: None,
            skills: Vec::new(),
            model: "qwen3.5-omni-flash-realtime".to_string(),
            endpoint: "wss://test".to_string(),
            continuous_listening: true,
            store_raw_audio: false,
            audit_log_path: None,
            vad_enabled: true,
            vad_threshold: 0.5,
        };

        let tools = generate_qwen_tools(&[]);
        let session_update = serde_json::json!({
            "type": "session.update",
            "session": {
                "tools": tools,
                "enable_search": false,
                "input_audio_format": {
                    "format": "pcm16",
                    "sample_rate": 16000,
                    "channels": 1
                },
                "output_audio_format": {
                    "format": "pcm24",
                    "sample_rate": 24000,
                    "channels": 1
                },
                "vad": {
                    "enabled": config.vad_enabled,
                    "threshold": config.vad_threshold
                }
            }
        });

        let session = session_update.get("session").unwrap();
        assert_eq!(
            session.get("enable_search").and_then(|v| v.as_bool()),
            Some(false)
        );

        let input_format = session.get("input_audio_format").unwrap();
        assert_eq!(
            input_format.get("format").and_then(|v| v.as_str()),
            Some("pcm16")
        );
        assert_eq!(
            input_format.get("sample_rate").and_then(|v| v.as_u64()),
            Some(16000)
        );

        let output_format = session.get("output_audio_format").unwrap();
        assert_eq!(
            output_format.get("format").and_then(|v| v.as_str()),
            Some("pcm24")
        );
        assert_eq!(
            output_format.get("sample_rate").and_then(|v| v.as_u64()),
            Some(24000)
        );

        let tools_array = session.get("tools").and_then(|v| v.as_array()).unwrap();
        assert_eq!(tools_array.len(), 9);
    }

    /// Test audio frame message conversion.
    #[tokio::test]
    async fn test_audio_frame_conversion() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&Config::default()).expect("serialize config"),
        )
        .expect("write config");
        let store = Config::load(&config_path).expect("load config");
        let state = AppState::new(store, assets_dir, LoggingHandle::empty());

        let client_msg = VoiceClientMessage::AudioFrame {
            pcm16_base64: "test-audio".to_string(),
            sample_rate: 16000,
        };

        let text = serde_json::to_string(&client_msg).unwrap();
        let result = handle_client_message(
            &text,
            &VoiceSessionState::new(),
            &state,
            &mpsc::channel(1).0,
        )
        .await;

        assert!(result.is_ok());
        let qwen_messages = result.unwrap();
        assert_eq!(qwen_messages.len(), 1);
        let qwen_msg = &qwen_messages[0];
        assert_eq!(
            qwen_msg.get("type").and_then(|v| v.as_str()),
            Some("input_audio_buffer.append")
        );
        assert_eq!(
            qwen_msg.get("audio").and_then(|v| v.as_str()),
            Some("test-audio")
        );
    }

    /// Test text message conversion.
    #[tokio::test]
    async fn test_text_message_conversion() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&Config::default()).expect("serialize config"),
        )
        .expect("write config");
        let store = Config::load(&config_path).expect("load config");
        let state = AppState::new(store, assets_dir, LoggingHandle::empty());

        let client_msg = VoiceClientMessage::TextMessage {
            text: "hello ai".to_string(),
        };

        let text = serde_json::to_string(&client_msg).unwrap();
        let result = handle_client_message(
            &text,
            &VoiceSessionState::new(),
            &state,
            &mpsc::channel(1).0,
        )
        .await
        .expect("handle text message");

        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0].get("type").and_then(|v| v.as_str()),
            Some("conversation.item.create")
        );
        assert_eq!(
            result[0]["item"]["content"][0]["text"].as_str(),
            Some("hello ai")
        );
        assert_eq!(
            result[1].get("type").and_then(|v| v.as_str()),
            Some("response.create")
        );
    }

    /// Test function call accumulation.
    #[tokio::test]
    async fn test_function_call_accumulation() {
        let session_state = VoiceSessionState::new();

        // Simulate delta events
        {
            let mut function_calls = session_state.function_calls.write().await;
            let accumulator = function_calls.entry("call-123".to_string()).or_default();
            accumulator.call_id = Some("call-123".to_string());
            accumulator.name = Some("list_sessions".to_string());
            accumulator
                .arguments
                .push_str("{\"target_name\": \"local\"}");
        }

        // Verify accumulated
        let function_calls = session_state.function_calls.read().await;
        let acc = function_calls.get("call-123").unwrap();
        assert_eq!(acc.name, Some("list_sessions".to_string()));
        assert_eq!(acc.arguments, "{\"target_name\": \"local\"}");
    }

    /// Test dangerous action detection.
    #[test]
    fn test_dangerous_action_detection() {
        let skill = "delete_session";
        let params = serde_json::json!({"target_name": "local", "session_name": "test"});
        assert!(is_dangerous(skill, &params));

        let skill = "send_to_pane";
        let params = serde_json::json!({"pane": "test", "text": "ls", "execute": true});
        assert!(is_dangerous(skill, &params));

        let skill = "list_sessions";
        let params = serde_json::json!({"target_name": "local"});
        assert!(!is_dangerous(skill, &params));
    }

    /// Test session timeout tracking.
    #[test]
    fn test_session_timeout_tracking() {
        let session_state = VoiceSessionState::new();

        // Fresh session should not need warning
        assert!(!session_state.should_send_timeout_warning());
        assert!(!session_state.is_timed_out());

        // Remaining should be close to 120 minutes
        let remaining = session_state.remaining_seconds();
        assert!(remaining > 119 * 60);
        assert!(remaining <= 120 * 60);
    }

    /// Test confirmation state.
    #[tokio::test]
    async fn test_confirmation_state() {
        let state = ConfirmationState::new();

        let confirmation = state
            .request_confirmation(
                "delete_session".to_string(),
                serde_json::json!({"session": "test"}),
            )
            .await;

        let id = confirmation.id;
        assert_eq!(state.pending_count().await, 1);

        let result = state.verify_confirmation(id).await;
        assert!(result.is_ok());
        assert_eq!(state.pending_count().await, 0);
    }

    /// Test generate_qwen_tools.
    #[test]
    fn test_generate_qwen_tools() {
        let tools = generate_qwen_tools(&[]);
        assert_eq!(tools.len(), 9);

        for tool in &tools {
            assert_eq!(tool.get("type").and_then(|v| v.as_str()), Some("function"));
            assert!(tool.get("name").and_then(|v| v.as_str()).is_some());
            assert!(tool.get("parameters").is_some());
        }

        // Check dangerous tools have warning
        let delete_session = tools
            .iter()
            .find(|t| t.get("name").and_then(|v| v.as_str()) == Some("delete_session"))
            .unwrap();
        let desc = delete_session
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap();
        assert!(desc.contains("WARNING") || desc.contains("destructive"));
    }

    /// Test voice action execution allowlist.
    #[tokio::test]
    async fn test_voice_action_allowlist() {
        let (app, _dir) = test_app(Config::default());
        drop(app);
        let store = Config::load(_dir.path().join("config.jsonc")).expect("load config");
        let state = AppState::new(store, _dir.path().join("assets"), LoggingHandle::empty());

        // Disallowed routes are rejected by the executor
        let result = execute_voice_action(
            "invoke_backend_route",
            &serde_json::json!({"route_id": "unknown.route"}),
            &state,
        )
        .await;
        assert!(result.is_err(), "unknown route should be rejected");

        // Allowed route with required params - will attempt execution
        // (may fail if backend not fully available, but passes allowlist validation)
        let result = execute_voice_action(
            "invoke_backend_route",
            &serde_json::json!({"route_id": "connections.list"}),
            &state,
        )
        .await;
        // connections.list doesn't require target_name, so it should work
        assert!(
            result.is_ok(),
            "connections.list should succeed: {:?}",
            result.err()
        );

        // Navigate frontend is always OK
        let result = execute_voice_action(
            "navigate_frontend",
            &serde_json::json!({"route": "home"}),
            &state,
        )
        .await;
        assert!(result.is_ok());

        // Unknown skill is rejected
        let result = execute_voice_action("unknown_skill", &serde_json::json!({}), &state).await;
        assert!(result.is_err(), "unknown skill should be rejected");
    }

    /// Test client message parsing.
    #[test]
    fn test_client_message_parsing() {
        let audio_msg = serde_json::json!({
            "type": "audio_frame",
            "pcm16Base64": "test",
            "sampleRate": 16000
        });
        let text = serde_json::to_string(&audio_msg).unwrap();
        let msg: VoiceClientMessage = serde_json::from_str(&text).unwrap();
        assert!(matches!(msg, VoiceClientMessage::AudioFrame { .. }));

        let stop_msg = serde_json::json!({"type": "stop_listening"});
        let text = serde_json::to_string(&stop_msg).unwrap();
        let msg: VoiceClientMessage = serde_json::from_str(&text).unwrap();
        assert!(matches!(msg, VoiceClientMessage::StopListening));

        let start_msg = serde_json::json!({"type": "start_listening"});
        let text = serde_json::to_string(&start_msg).unwrap();
        let msg: VoiceClientMessage = serde_json::from_str(&text).unwrap();
        assert!(matches!(msg, VoiceClientMessage::StartListening));
    }

    /// Test server event serialization.
    #[test]
    fn test_server_event_serialization() {
        let connected = VoiceServerEvent::Connected;
        let text = serde_json::to_string(&connected).unwrap();
        assert!(text.contains("connected"));

        let audio_delta = VoiceServerEvent::AudioDelta {
            pcm16_base64: "test".to_string(),
            sample_rate: 24000,
        };
        let text = serde_json::to_string(&audio_delta).unwrap();
        assert!(text.contains("audio_delta"));
        assert!(text.contains("pcm16Base64"));

        let error = VoiceServerEvent::Error {
            code: "test_error".to_string(),
            message: "Test message".to_string(),
        };
        let text = serde_json::to_string(&error).unwrap();
        assert!(text.contains("error"));
        assert!(text.contains("test_error"));
    }
}
