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

use wmux_core::config::OmniConfig;
use wmux_core::protocol::{OmniClientMessage, OmniServerEvent, OmniTarget, generate_qwen_tools};
use wmux_core::state::RuntimeSkills;
use wmux_core::storage::{
    AiLogRepository,
    models::{NewAiLogEntry, OmniConversationMessage},
    voice_history::OmniHistoryRepository,
};

use crate::state::AppState;
use crate::voice::audit::redact_secrets;
use crate::voice::{ConfirmationState, OmniSkillExecutor, is_dangerous};

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

#[derive(Debug, Clone)]
struct VoiceSessionContext {
    target: OmniTarget,
}

/// Active voice session state
struct OmniSessionState {
    conversation_id: String,
    /// Confirmation state manager for dangerous actions
    confirmation_state: ConfirmationState,
    /// Pending function call accumulators by call_id
    function_calls: Arc<RwLock<HashMap<String, FunctionCallAccumulator>>>,
    /// Current frontend workspace context supplied by the client
    context: Arc<RwLock<Option<VoiceSessionContext>>>,
    /// Session start time for timeout tracking
    started_at: Instant,
}

impl OmniSessionState {
    fn new() -> Self {
        Self {
            conversation_id: Uuid::new_v4().to_string(),
            confirmation_state: ConfirmationState::new(),
            function_calls: Arc::new(RwLock::new(HashMap::new())),
            context: Arc::new(RwLock::new(None)),
            started_at: Instant::now(),
        }
    }

    async fn set_context(&self, target: OmniTarget, _connection_type: Option<String>) {
        *self.context.write().await = Some(VoiceSessionContext { target });
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
    let voice_config = match get_omni_config(&state) {
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

    // Send Connected event to client
    if send_omni_event(&mut socket, &OmniServerEvent::Connected)
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
    if send_session_update(&mut upstream, &voice_config, &state.skills)
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
    let session_state = OmniSessionState::new();

    // Bridge bidirectional messages
    bridge_voice(socket, upstream, state, session_state).await;
}

/// Get voice config from AppState
fn get_omni_config(state: &AppState) -> Result<OmniConfig, String> {
    state
        .store
        .snapshot()
        .map(|config| config.omni.clone())
        .map_err(|e| format!("failed to read config: {}", e))
}

async fn persist_omni_history_message(state: &AppState, message: OmniConversationMessage) {
    let Some(pool) = &state.storage else {
        return;
    };
    let repository = OmniHistoryRepository::new(pool.clone());
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

async fn persist_ai_log(state: &AppState, entry: NewAiLogEntry) {
    let Some(pool) = &state.storage else {
        return;
    };
    let repository = AiLogRepository::new(pool.clone());
    if let Err(error) = repository.insert(&entry).await {
        tracing::error!(
            conversation_id = %entry.conversation_id,
            event_kind = %entry.event_kind,
            "ai log insert failed: {}",
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
) -> OmniConversationMessage {
    OmniConversationMessage {
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
    session_state: &OmniSessionState,
    event: &OmniServerEvent,
) {
    match event {
        OmniServerEvent::TranscriptDone { text } => {
            persist_omni_history_message(
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
            let model = get_omni_config(state)
                .map(|c| c.model)
                .unwrap_or_else(|_| "qwen-omni".to_string());
            persist_ai_log(
                state,
                NewAiLogEntry {
                    id: None,
                    conversation_id: session_state.conversation_id.clone(),
                    event_kind: "prompt".to_string(),
                    model,
                    status: "success".to_string(),
                    prompt_text: Some(text.clone()),
                    tool_name: None,
                    tool_call_id: None,
                    tool_arguments_json: None,
                    tool_result_json: None,
                    metrics_json: "{}".to_string(),
                    duration_ms: None,
                    raw_event_json: "{}".to_string(),
                    error_message: None,
                    created_at: None,
                },
            )
            .await;
        }
        OmniServerEvent::ActionResult { skill, .. } => {
            let event_json = serde_json::to_value(event).ok().and_then(redacted_json);
            persist_omni_history_message(
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

async fn persist_assistant_text(state: &AppState, session_state: &OmniSessionState, text: String) {
    persist_omni_history_message(
        state,
        history_message(
            &session_state.conversation_id,
            "assistant",
            "assistant_text",
            text.clone(),
            None,
        ),
    )
    .await;
    let model = get_omni_config(state)
        .map(|c| c.model)
        .unwrap_or_else(|_| "qwen-omni".to_string());
    persist_ai_log(
        state,
        NewAiLogEntry {
            id: None,
            conversation_id: session_state.conversation_id.clone(),
            event_kind: "assistant".to_string(),
            model,
            status: "success".to_string(),
            prompt_text: Some(text),
            tool_name: None,
            tool_call_id: None,
            tool_arguments_json: None,
            tool_result_json: None,
            metrics_json: "{}".to_string(),
            duration_ms: None,
            raw_event_json: "{}".to_string(),
            error_message: None,
            created_at: None,
        },
    )
    .await;
}

async fn persist_tool_call(
    state: &AppState,
    session_state: &OmniSessionState,
    skill: &str,
    call_id: &str,
    params: &serde_json::Value,
) {
    let event_json = redacted_json(serde_json::json!({
        "skill": skill,
        "params": params,
    }));
    persist_omni_history_message(
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
    let model = get_omni_config(state)
        .map(|c| c.model)
        .unwrap_or_else(|_| "qwen-omni".to_string());
    let args_json = serde_json::to_string(params).ok();
    persist_ai_log(
        state,
        NewAiLogEntry {
            id: None,
            conversation_id: session_state.conversation_id.clone(),
            event_kind: "tool_call".to_string(),
            model,
            status: "pending".to_string(),
            prompt_text: None,
            tool_name: Some(skill.to_string()),
            tool_call_id: Some(call_id.to_string()),
            tool_arguments_json: args_json,
            tool_result_json: None,
            metrics_json: "{}".to_string(),
            duration_ms: None,
            raw_event_json: "{}".to_string(),
            error_message: None,
            created_at: None,
        },
    )
    .await;
}

async fn persist_tool_result(
    state: &AppState,
    session_state: &OmniSessionState,
    skill: &str,
    call_id: Option<&str>,
    success: bool,
    error: Option<String>,
    duration_ms: Option<i64>,
    result_json: Option<String>,
) {
    let model = get_omni_config(state)
        .map(|c| c.model)
        .unwrap_or_else(|_| "qwen-omni".to_string());
    let status = if success { "success" } else { "error" };
    persist_ai_log(
        state,
        NewAiLogEntry {
            id: None,
            conversation_id: session_state.conversation_id.clone(),
            event_kind: "tool_result".to_string(),
            model,
            status: status.to_string(),
            prompt_text: None,
            tool_name: Some(skill.to_string()),
            tool_call_id: call_id.map(|s| s.to_string()),
            tool_arguments_json: None,
            tool_result_json: result_json,
            metrics_json: "{}".to_string(),
            duration_ms,
            raw_event_json: "{}".to_string(),
            error_message: error.clone(),
            created_at: None,
        },
    )
    .await;
    let event = OmniServerEvent::ActionResult {
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
    config: &OmniConfig,
    skills: &RuntimeSkills,
) -> Result<(), String> {
    let tools = generate_qwen_tools(&skills.list());

    let turn_detection = if config.vad_enabled {
        serde_json::json!({
            "type": "server_vad",
            "threshold": config.vad_threshold,
            "silence_duration_ms": 800
        })
    } else {
        serde_json::Value::Null
    };

    let mut session = serde_json::json!({
        "modalities": ["text", "audio"],
        "tools": tools,
        "enable_search": false,
        "input_audio_format": "pcm16",
        "output_audio_format": "pcm24",
        "turn_detection": turn_detection
    });
    if let Some(voice) = config.voice.as_deref().filter(|voice| !voice.is_empty()) {
        session["voice"] = serde_json::Value::String(voice.to_string());
    }

    let session_update = serde_json::json!({
        "type": "session.update",
        "session": session
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
    session_state: OmniSessionState,
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
                            Ok(effects) => {
                                for qwen_msg in effects.qwen_messages {
                                    if let Err(error) = send_qwen_json(&mut upstream_tx, &qwen_msg).await {
                                        tracing::error!("failed to forward to Qwen: {}", error);
                                    }
                                }
                                for event in effects.client_events {
                                    if let Err(error) = send_omni_event_raw(&mut client_tx, &event).await {
                                        tracing::error!("failed to send local voice event: {}", error);
                                    }
                                }
                            }
                            Err(error) => {
                                tracing::error!("client message handling failed: {}", error);
                                let _ = send_omni_event_raw(&mut client_tx, &OmniServerEvent::Error {
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
                                if let Err(error) = send_omni_event_raw(&mut client_tx, &event).await {
                                    tracing::error!("failed to send to client: {}", error);
                                }
                            }
                            Ok(None) => {} // No event to forward
                            Err(error) => {
                                tracing::error!("Qwen message handling failed: {}", error);
                                let _ = send_omni_event_raw(&mut client_tx, &OmniServerEvent::Error {
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
                        let _ = send_omni_event_raw(&mut client_tx, &OmniServerEvent::Error {
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
                    let output = serde_json::to_string(
                        tool_result
                            .get("output")
                            .unwrap_or(&serde_json::Value::Null),
                    )
                    .unwrap_or_else(|_| "null".to_string());

                    let item_create = serde_json::json!({
                        "type": "conversation.item.create",
                        "item": {
                            "type": "function_call_output",
                            "call_id": call_id,
                            "output": output
                        }
                    });

                    if let Err(error) = send_qwen_json(&mut upstream_tx, &item_create).await {
                        tracing::error!("failed to send function_call_output to Qwen: {}", error);
                    }

                }
            }

            // Timeout check
            _ = tokio::time::sleep(Duration::from_secs(60)) => {
                if !timeout_warning_sent && session_state.should_send_timeout_warning() {
                    timeout_warning_sent = true;
                    let remaining = session_state.remaining_seconds();
                    tracing::warn!("voice session timeout warning: {} seconds remaining", remaining);
                    let _ = send_omni_event_raw(&mut client_tx, &OmniServerEvent::SessionTimeout {
                        remaining_seconds: remaining,
                    }).await;
                }

                if session_state.is_timed_out() {
                    tracing::warn!("voice session timed out after {} minutes", SESSION_TIMEOUT_MINUTES);
                    let _ = send_omni_event_raw(&mut client_tx, &OmniServerEvent::Error {
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

#[derive(Debug, Default)]
struct ClientMessageEffects {
    qwen_messages: Vec<serde_json::Value>,
    client_events: Vec<OmniServerEvent>,
}

impl ClientMessageEffects {
    fn qwen(qwen_messages: Vec<serde_json::Value>) -> Self {
        Self {
            qwen_messages,
            client_events: Vec::new(),
        }
    }
}

/// Handle client message, returns Qwen messages and local events to forward.
async fn handle_client_message(
    text: &str,
    session_state: &OmniSessionState,
    state: &AppState,
    tool_result_tx: &mpsc::Sender<serde_json::Value>,
) -> Result<ClientMessageEffects, String> {
    let msg: OmniClientMessage =
        serde_json::from_str(text).map_err(|e| format!("invalid client message: {}", e))?;

    match msg {
        OmniClientMessage::AudioFrame {
            pcm16_base64,
            sample_rate,
        } => {
            if get_omni_config(state)?.microphone_disabled {
                return Err("Microphone disabled in Settings".to_string());
            }
            Ok(ClientMessageEffects::qwen(vec![serde_json::json!({
                "type": "input_audio_buffer.append",
                "audio": pcm16_base64,
                "format": {
                    "format": "pcm16",
                    "sample_rate": sample_rate,
                    "channels": 1
                }
            })]))
        }

        OmniClientMessage::TextMessage { text } => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Err("text is required".to_string());
            }

            persist_voice_event(
                state,
                session_state,
                &OmniServerEvent::TranscriptDone {
                    text: trimmed.to_string(),
                },
            )
            .await;

            Ok(ClientMessageEffects::qwen(vec![
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
            ]))
        }

        OmniClientMessage::SessionContext {
            target,
            connection_type,
        } => {
            session_state
                .set_context(target.clone(), connection_type.clone())
                .await;
            Ok(ClientMessageEffects::qwen(vec![serde_json::json!({
                "type": "session.update",
                "session": {
                    "instructions": context_prompt_text(&target, connection_type.as_deref())
                }
            })]))
        }

        OmniClientMessage::ConfirmAction { confirmation_id } => {
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
                .map(ToString::to_string)
                .ok_or("missing _skill in confirmation params")?;
            let call_id = params
                .get("_call_id")
                .and_then(|v| v.as_str())
                .map(ToString::to_string)
                .ok_or("missing _call_id in confirmation params")?;

            // Remove the internal _skill field before executing
            let mut clean_params = params.clone();
            if let Some(obj) = clean_params.as_object_mut() {
                obj.remove("_skill");
                obj.remove("_call_id");
            }

            // Execute the skill
            let start = std::time::Instant::now();
            let result = execute_voice_action(&skill, &clean_params, state, true).await;
            let duration_ms = Some(start.elapsed().as_millis() as i64);
            let success = result.is_ok();
            let error = result.as_ref().err().cloned();
            let result_json = if success {
                serde_json::to_string(&serde_json::json!({"success": true})).ok()
            } else {
                None
            };
            persist_tool_result(
                state,
                session_state,
                &skill,
                Some(&call_id),
                success,
                error.clone(),
                duration_ms,
                result_json,
            )
            .await;

            // Send tool result to Qwen
            let tool_result = serde_json::json!({
                "call_id": call_id,
                "output": {
                    "success": success,
                    "error": error.clone()
                }
            });
            let _ = tool_result_tx.try_send(tool_result);
            Ok(ClientMessageEffects {
                qwen_messages: Vec::new(),
                client_events: vec![OmniServerEvent::ActionResult {
                    skill,
                    success,
                    error,
                }],
            })
        }

        OmniClientMessage::CancelAction { confirmation_id } => {
            let id = Uuid::parse_str(&confirmation_id)
                .map_err(|e| format!("invalid confirmation ID: {}", e))?;
            let params = session_state
                .confirmation_state
                .verify_confirmation(id)
                .await
                .map_err(|e| format!("confirmation verification failed: {}", e))?;
            let skill = params
                .get("_skill")
                .and_then(|v| v.as_str())
                .unwrap_or("cancel_action")
                .to_string();
            let call_id = params
                .get("_call_id")
                .and_then(|v| v.as_str())
                .unwrap_or(&confirmation_id)
                .to_string();
            persist_tool_result(
                state,
                session_state,
                &skill,
                Some(&call_id),
                false,
                Some("action_cancelled".to_string()),
                None,
                None,
            )
            .await;
            // Just send cancellation result to Qwen
            let result = serde_json::json!({
                "call_id": call_id,
                "output": { "success": false, "error": "action_cancelled" }
            });
            let _ = tool_result_tx.try_send(result);
            Ok(ClientMessageEffects::default())
        }

        OmniClientMessage::StopListening => {
            Ok(ClientMessageEffects::qwen(vec![serde_json::json!({
                "type": "input_audio_buffer.clear"
            })]))
        }

        OmniClientMessage::StartListening => {
            Ok(ClientMessageEffects::qwen(vec![serde_json::json!({
                "type": "input_audio_buffer.commit"
            })]))
        }
    }
}

/// Handle Qwen message, returns optional OmniServerEvent to forward.
async fn handle_qwen_message(
    text: &str,
    session_state: &OmniSessionState,
    state: &AppState,
    tool_result_tx: &mpsc::Sender<serde_json::Value>,
) -> Result<Option<OmniServerEvent>, String> {
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
            Ok(Some(OmniServerEvent::AudioDelta {
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
            Ok(Some(OmniServerEvent::TranscriptDelta {
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
            let event = OmniServerEvent::TranscriptDone {
                text: text_content.to_string(),
            };
            persist_voice_event(state, session_state, &event).await;
            Ok(Some(event))
        }

        "response.text.done"
        | "response.output_text.done"
        | "output_text.done"
        | "response.audio_transcript.done"
        | "response.audio.transcript.done" => {
            let text_content = value
                .get("text")
                .or_else(|| value.get("transcript"))
                .or_else(|| value.get("content"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            persist_assistant_text(state, session_state, text_content.to_string()).await;
            Ok(Some(OmniServerEvent::AssistantMessage {
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
                .get("delta")
                .or_else(|| value.get("arguments"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let mut function_calls = session_state.function_calls.write().await;
            let accumulator = function_calls.entry(call_id.to_string()).or_default();
            accumulator.call_id = Some(call_id.to_string());
            if !name.is_empty() {
                accumulator.name = Some(name.to_string());
            }
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
                accumulator.arguments = arguments.to_string();
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
                let params = apply_session_context_defaults(&skill, params, session_state).await;

                let dangerous = is_dangerous(&skill, &params);
                persist_tool_call(state, session_state, &skill, call_id, &params).await;

                if dangerous {
                    // Store skill name in params for later retrieval during confirmation
                    let mut params_with_skill = params.clone();
                    if let Some(obj) = params_with_skill.as_object_mut() {
                        obj.insert(
                            "_skill".to_string(),
                            serde_json::Value::String(skill.clone()),
                        );
                        obj.insert(
                            "_call_id".to_string(),
                            serde_json::Value::String(call_id.to_string()),
                        );
                    }
                    let confirmation = session_state
                        .confirmation_state
                        .request_confirmation(skill.clone(), params_with_skill)
                        .await;

                    Ok(Some(OmniServerEvent::IntentReceived {
                        skill: skill.clone(),
                        params,
                        confirmation_required: true,
                        confirmation_id: Some(confirmation.id.to_string()),
                    }))
                } else {
                    // Execute immediately
                    let start = std::time::Instant::now();
                    let result = execute_voice_action(&skill, &params, state, false).await;
                    let duration_ms = Some(start.elapsed().as_millis() as i64);
                    let success = result.is_ok();
                    let error = result.as_ref().err().cloned();
                    let result_json = if success {
                        serde_json::to_string(&serde_json::json!({"success": true})).ok()
                    } else {
                        None
                    };
                    persist_tool_result(
                        state,
                        session_state,
                        &skill,
                        Some(call_id),
                        success,
                        error.clone(),
                        duration_ms,
                        result_json,
                    )
                    .await;

                    // Send tool result
                    let tool_result = serde_json::json!({
                        "call_id": call_id,
                        "output": {
                            "success": success,
                            "error": error
                        }
                    });
                    let _ = tool_result_tx.try_send(tool_result);

                    Ok(Some(OmniServerEvent::IntentReceived {
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
                .or_else(|| value.pointer("/error/code").and_then(|v| v.as_str()))
                .unwrap_or("qwen_error");
            let error_msg = value
                .get("message")
                .and_then(|v| v.as_str())
                .or_else(|| value.pointer("/error/message").and_then(|v| v.as_str()))
                .unwrap_or("Unknown Qwen error");
            Ok(Some(OmniServerEvent::Error {
                code: error_code.to_string(),
                message: error_msg.to_string(),
            }))
        }

        // Session events - no forwarding needed
        "session.created" | "session.updated" | "response.audio.done" => {
            tracing::debug!("Qwen event: {}", event_type);
            Ok(None)
        }

        "response.done" => {
            tracing::debug!("Qwen event: {}", event_type);
            let usage = value.pointer("/response/usage");
            if let Some(usage) = usage {
                let metrics_json =
                    serde_json::to_string(usage).unwrap_or_else(|_| "{}".to_string());
                let model = get_omni_config(state)
                    .map(|c| c.model)
                    .unwrap_or_else(|_| "qwen-omni".to_string());
                persist_ai_log(
                    state,
                    NewAiLogEntry {
                        id: None,
                        conversation_id: session_state.conversation_id.clone(),
                        event_kind: "metrics".to_string(),
                        model,
                        status: "success".to_string(),
                        prompt_text: None,
                        tool_name: None,
                        tool_call_id: None,
                        tool_arguments_json: None,
                        tool_result_json: None,
                        metrics_json,
                        duration_ms: None,
                        raw_event_json: "{}".to_string(),
                        error_message: None,
                        created_at: None,
                    },
                )
                .await;
            }
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
    confirmed: bool,
) -> Result<(), String> {
    let executor = OmniSkillExecutor::new(state.clone());
    let execution = if confirmed {
        executor.execute_preconfirmed(skill, params.clone()).await
    } else {
        executor.execute(skill, params.clone()).await
    };
    execution.map(|_| ()).map_err(|e| e.to_string())
}

async fn apply_session_context_defaults(
    skill: &str,
    params: serde_json::Value,
    session_state: &OmniSessionState,
) -> serde_json::Value {
    let Some(context) = session_state.context.read().await.clone() else {
        return params;
    };
    let Some(target_name) = context
        .target
        .target_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return params;
    };

    if skill == "invoke_backend_route" {
        return apply_context_to_route_params(params, target_name);
    }

    if !skill_uses_tmux_target(skill) {
        return params;
    }

    let Some(mut object) = params.as_object().cloned() else {
        return params;
    };
    if !has_string_alias(
        &serde_json::Value::Object(object.clone()),
        &["target_name", "targetName"],
    ) {
        object.insert(
            "target_name".to_string(),
            serde_json::Value::String(target_name.to_string()),
        );
    }
    serde_json::Value::Object(object)
}

fn apply_context_to_route_params(
    params: serde_json::Value,
    target_name: &str,
) -> serde_json::Value {
    let route_id = params
        .get("route_id")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if !route_uses_tmux_target(route_id) {
        return params;
    }
    let Some(mut object) = params.as_object().cloned() else {
        return params;
    };
    let route_params = object
        .get("params")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let Some(mut route_object) = route_params.as_object().cloned() else {
        return serde_json::Value::Object(object);
    };
    if !has_string_alias(
        &serde_json::Value::Object(route_object.clone()),
        &["target_name", "targetName"],
    ) {
        route_object.insert(
            "target_name".to_string(),
            serde_json::Value::String(target_name.to_string()),
        );
        object.insert(
            "params".to_string(),
            serde_json::Value::Object(route_object),
        );
    }
    serde_json::Value::Object(object)
}

fn skill_uses_tmux_target(skill: &str) -> bool {
    matches!(
        skill,
        "list_sessions" | "create_session" | "rename_session" | "delete_session" | "send_to_pane"
    )
}

fn route_uses_tmux_target(route_id: &str) -> bool {
    route_id.starts_with("sessions.")
        || route_id.starts_with("windows.")
        || route_id.starts_with("panes.")
}

fn has_string_alias(params: &serde_json::Value, fields: &[&str]) -> bool {
    fields.iter().any(|field| {
        params
            .get(*field)
            .and_then(|value| value.as_str())
            .is_some_and(|value| !value.trim().is_empty())
    })
}

fn context_prompt_text(target: &OmniTarget, connection_type: Option<&str>) -> String {
    let mut parts = Vec::new();
    if let Some(target_name) = target
        .target_name
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        parts.push(format!("target_name={target_name}"));
    }
    if let Some(connection_type) = connection_type.filter(|value| !value.is_empty()) {
        parts.push(format!("connection_type={connection_type}"));
    }
    if let Some(session) = target.session.as_deref().filter(|value| !value.is_empty()) {
        parts.push(format!("session={session}"));
    }
    if let Some(window) = target.window.as_deref().filter(|value| !value.is_empty()) {
        parts.push(format!("window={window}"));
    }
    if let Some(pane) = target.pane.as_deref().filter(|value| !value.is_empty()) {
        parts.push(format!("pane={pane}"));
    }
    format!(
        "Current Wmux context: {}. Use target_name as the default connection for tmux actions when the user does not name a connection.",
        parts.join(", ")
    )
}

/// Send a OmniServerEvent to client WebSocket.
async fn send_omni_event(socket: &mut WebSocket, event: &OmniServerEvent) -> Result<(), String> {
    let text =
        serde_json::to_string(event).map_err(|e| format!("failed to serialize event: {}", e))?;
    socket
        .send(Message::Text(text.into()))
        .await
        .map_err(|e| format!("failed to send event: {}", e))?;
    Ok(())
}

/// Send a OmniServerEvent to client WebSocket (split sink version).
async fn send_omni_event_raw(
    tx: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    event: &OmniServerEvent,
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
    let _ = send_omni_event(
        socket,
        &OmniServerEvent::Error {
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
    use std::path::{Path, PathBuf};
    use std::process::Command as StdCommand;
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
    use wmux_core::storage::{db, models::OmniConversationMessage};

    const TOKEN: &str = "test-token";

    fn test_voice_config(endpoint: String, enabled: bool, api_key: Option<&str>) -> Config {
        let mut config = Config::default();
        config.server.bind = "127.0.0.1:0".to_string();
        config.auth.token = TOKEN.to_string();
        config.omni.enabled = enabled;
        config.omni.dashscope_api_key = api_key.map(ToString::to_string);
        config.omni.endpoint = endpoint;
        config.omni.model = "qwen3.5-omni-flash-realtime".to_string();
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

    async fn spawn_real_config_app(
        config_path: &Path,
    ) -> (String, tokio::task::JoinHandle<()>, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");
        let store = Config::load(config_path).expect("load real config");
        let state = AppState::new(store, assets_dir, LoggingHandle::empty());
        let skills_dir = config_path
            .parent()
            .map(|parent| parent.join("skills"))
            .unwrap_or_else(|| PathBuf::from("skills"));
        state.skills.load_from_dir(skills_dir);
        let app = crate::routes::router(state);
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
    ) -> OmniServerEvent {
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

    async fn next_client_event_with_timeout(
        client: &mut WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
        timeout: Duration,
    ) -> OmniServerEvent {
        let message = tokio::time::timeout(timeout, client.next())
            .await
            .expect("client event timeout")
            .expect("client event")
            .expect("client message");
        let TungsteniteMessage::Text(text) = message else {
            panic!("expected text event");
        };
        serde_json::from_str(&text).expect("voice event")
    }

    async fn wait_for_intent(
        client: &mut WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
        skill_name: &str,
    ) -> OmniServerEvent {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(45);
        loop {
            let now = tokio::time::Instant::now();
            assert!(now < deadline, "timed out waiting for {skill_name} intent");
            let remaining = deadline - now;
            let event = next_client_event_with_timeout(client, remaining).await;
            match &event {
                OmniServerEvent::IntentReceived { skill, .. } if skill == skill_name => {
                    return event;
                }
                OmniServerEvent::Error { code, message } => {
                    panic!("voice error while waiting for {skill_name}: {code}: {message}");
                }
                _ => {}
            }
        }
    }

    async fn wait_for_action_result(
        client: &mut WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
        skill_name: &str,
    ) -> OmniServerEvent {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        loop {
            let now = tokio::time::Instant::now();
            assert!(now < deadline, "timed out waiting for {skill_name} result");
            let remaining = deadline - now;
            let event = next_client_event_with_timeout(client, remaining).await;
            match &event {
                OmniServerEvent::ActionResult { skill, .. } if skill == skill_name => {
                    return event;
                }
                OmniServerEvent::Error { code, message } => {
                    panic!("voice error while waiting for {skill_name} result: {code}: {message}");
                }
                _ => {}
            }
        }
    }

    async fn send_text_message(
        client: &mut WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
        text: &str,
    ) {
        let message = OmniClientMessage::TextMessage {
            text: text.to_string(),
        };
        client
            .send(TungsteniteMessage::Text(
                serde_json::to_string(&message)
                    .expect("serialize text")
                    .into(),
            ))
            .await
            .expect("send text message");
    }

    fn authorized_request(url: &str) -> ClientRequest {
        authorized_request_with_token(url, TOKEN)
    }

    fn authorized_request_with_token(url: &str, token: &str) -> ClientRequest {
        let mut request = url.into_client_request().expect("client request");
        if !token.trim().is_empty() {
            request.headers_mut().insert(
                "Authorization",
                format!("Bearer {}", token.trim())
                    .parse()
                    .expect("auth header"),
            );
        }
        request
    }

    #[cfg(unix)]
    fn make_executable(path: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("chmod");
    }

    fn real_omni_config_path() -> PathBuf {
        if let Ok(path) = std::env::var("WMUX_OMNI_TEST_CONFIG") {
            return PathBuf::from(path);
        }
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("workspace root")
            .join("config.jsonc")
    }

    fn load_real_omni_config() -> (PathBuf, Config) {
        let config_path = real_omni_config_path();
        let store = Config::load(&config_path).unwrap_or_else(|error| {
            panic!("failed to load {}: {error}", config_path.to_string_lossy())
        });
        let config = store.snapshot().expect("read config snapshot");
        assert!(
            config.omni.enabled,
            "{} must enable omni for real Omni integration tests",
            config_path.to_string_lossy()
        );
        assert!(
            config
                .omni
                .dashscope_api_key
                .as_deref()
                .is_some_and(|key| !key.trim().is_empty()),
            "{} must include omni.dashscopeApiKey for real Omni integration tests",
            config_path.to_string_lossy()
        );
        (config_path, config)
    }

    fn tmux_status(tmux_path: &str, args: &[&str]) -> bool {
        StdCommand::new(tmux_path)
            .args(args)
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn tmux_output(tmux_path: &str, args: &[&str]) -> String {
        let output = StdCommand::new(tmux_path)
            .args(args)
            .output()
            .unwrap_or_else(|error| panic!("failed to run tmux {:?}: {error}", args));
        if !output.status.success() {
            panic!(
                "tmux {:?} failed: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
        }
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn cleanup_tmux_session(tmux_path: &str, session: &str) {
        let _ = StdCommand::new(tmux_path)
            .args(["kill-session", "-t", session])
            .status();
    }

    fn ensure_tmux_session_absent(tmux_path: &str, session: &str) {
        cleanup_tmux_session(tmux_path, session);
        assert!(
            !tmux_status(tmux_path, &["has-session", "-t", session]),
            "tmux session {session} should not exist"
        );
    }

    struct TmuxSessionGuard {
        tmux_path: String,
        sessions: Vec<String>,
    }

    impl TmuxSessionGuard {
        fn new(tmux_path: String, sessions: Vec<String>) -> Self {
            Self {
                tmux_path,
                sessions,
            }
        }
    }

    impl Drop for TmuxSessionGuard {
        fn drop(&mut self) {
            for session in &self.sessions {
                cleanup_tmux_session(&self.tmux_path, session);
            }
        }
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
            OmniServerEvent::Connected
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
        assert_eq!(session_update["session"]["input_audio_format"], "pcm16");
        assert_eq!(session_update["session"]["output_audio_format"], "pcm24");
        assert_eq!(
            session_update["session"]["turn_detection"]["type"],
            "server_vad"
        );
        assert_eq!(
            session_update["session"]["tools"].as_array().unwrap().len(),
            9
        );

        let client_audio = OmniClientMessage::AudioFrame {
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
            OmniServerEvent::AudioDelta {
                pcm16_base64: "qwen-audio".to_string(),
                sample_rate: 24000,
            }
        );
        assert_eq!(
            next_client_event(&mut client).await,
            OmniServerEvent::TranscriptDelta {
                text: "hel".to_string(),
            }
        );
        assert_eq!(
            next_client_event(&mut client).await,
            OmniServerEvent::TranscriptDone {
                text: "hello".to_string(),
            }
        );
        assert_eq!(
            next_client_event(&mut client).await,
            OmniServerEvent::IntentReceived {
                skill: "navigate_frontend".to_string(),
                params: json!({ "route": "home" }),
                confirmation_required: false,
                confirmation_id: None,
            }
        );

        let tool_output = next_mock_message(&mut qwen_rx).await;
        assert_eq!(tool_output["type"], "conversation.item.create");
        assert_eq!(tool_output["item"]["type"], "function_call_output");

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
            OmniServerEvent::Error {
                code: "voice_disabled".to_string(),
                message: "Voice feature is not enabled in configuration".to_string(),
            }
        );

        let _ = client.close(None).await;
        app_handle.abort();
    }

    #[tokio::test]
    async fn microphone_disabled_still_allows_text_qwen_session() {
        let (qwen_endpoint, mut qwen_rx, qwen_handle) = spawn_mock_qwen().await;
        let mut config = test_voice_config(qwen_endpoint, true, Some("dashscope-test-key"));
        config.omni.microphone_disabled = true;
        let (app_url, app_handle, _dir) = spawn_test_app(config).await;
        let request = authorized_request(&app_url);
        let (mut client, _) = connect_async(request)
            .await
            .expect("connect voice websocket");

        assert_eq!(
            next_client_event(&mut client).await,
            OmniServerEvent::Connected
        );
        let handshake = next_mock_message(&mut qwen_rx).await;
        assert_eq!(handshake["authorization"], "Bearer dashscope-test-key");
        let session_update = next_mock_message(&mut qwen_rx).await;
        assert_eq!(session_update["type"], "session.update");

        let _ = client.close(None).await;
        app_handle.abort();
        qwen_handle.abort();
    }

    #[tokio::test]
    #[ignore = "requires config.jsonc with real Qwen Omni credentials and tmux"]
    async fn real_omni_text_assistant_runs_tmux_session_crud_from_config() {
        let (config_path, config) = load_real_omni_config();
        let tmux_path = config.tmux.path.clone();
        let suffix = Uuid::new_v4().simple().to_string();
        let session = format!("wmux-omni-crud-{}", &suffix[..12]);
        let renamed = format!("wmux-omni-crud-renamed-{}", &suffix[..8]);
        let _guard =
            TmuxSessionGuard::new(tmux_path.clone(), vec![session.clone(), renamed.clone()]);
        ensure_tmux_session_absent(&tmux_path, &session);
        ensure_tmux_session_absent(&tmux_path, &renamed);

        let (app_url, app_handle, _app_dir) = spawn_real_config_app(&config_path).await;
        let request = authorized_request_with_token(&app_url, &config.auth.token);
        let (mut client, _) = connect_async(request)
            .await
            .expect("connect real Omni voice websocket");

        assert_eq!(
            next_client_event_with_timeout(&mut client, Duration::from_secs(20)).await,
            OmniServerEvent::Connected
        );

        send_text_message(
            &mut client,
            "Use the available function tool only. Call list_sessions exactly once with {\"target_name\":\"local\"}. Do not answer in natural language.",
        )
        .await;
        match wait_for_intent(&mut client, "list_sessions").await {
            OmniServerEvent::IntentReceived {
                params,
                confirmation_required: false,
                confirmation_id: None,
                ..
            } => assert_eq!(params, json!({ "target_name": "local" })),
            other => panic!("unexpected list_sessions event: {other:?}"),
        }

        send_text_message(
            &mut client,
            &format!(
                "Use the available function tool only. Call create_session exactly once with {{\"target_name\":\"local\",\"session_name\":\"{session}\"}}. Do not answer in natural language."
            ),
        )
        .await;
        match wait_for_intent(&mut client, "create_session").await {
            OmniServerEvent::IntentReceived {
                params,
                confirmation_required: false,
                confirmation_id: None,
                ..
            } => assert_eq!(
                params,
                json!({ "target_name": "local", "session_name": &session })
            ),
            other => panic!("unexpected create_session event: {other:?}"),
        }
        assert!(
            tmux_status(&tmux_path, &["has-session", "-t", &session]),
            "tmux session {session} should be created"
        );

        send_text_message(
            &mut client,
            &format!(
                "Use the available function tool only. Call rename_session exactly once with {{\"target_name\":\"local\",\"old_name\":\"{session}\",\"new_name\":\"{renamed}\"}}. Do not answer in natural language."
            ),
        )
        .await;
        match wait_for_intent(&mut client, "rename_session").await {
            OmniServerEvent::IntentReceived {
                params,
                confirmation_required: false,
                confirmation_id: None,
                ..
            } => assert_eq!(
                params,
                json!({ "target_name": "local", "old_name": &session, "new_name": &renamed })
            ),
            other => panic!("unexpected rename_session event: {other:?}"),
        }
        assert!(
            !tmux_status(&tmux_path, &["has-session", "-t", &session]),
            "old tmux session {session} should be renamed"
        );
        assert!(
            tmux_status(&tmux_path, &["has-session", "-t", &renamed]),
            "renamed tmux session {renamed} should exist"
        );

        send_text_message(
            &mut client,
            &format!(
                "Use the available function tool only. Call delete_session exactly once with {{\"target_name\":\"local\",\"session_name\":\"{renamed}\"}}. Do not answer in natural language."
            ),
        )
        .await;
        let confirmation_id = match wait_for_intent(&mut client, "delete_session").await {
            OmniServerEvent::IntentReceived {
                params,
                confirmation_required: true,
                confirmation_id: Some(id),
                ..
            } => {
                assert_eq!(
                    params,
                    json!({ "target_name": "local", "session_name": &renamed })
                );
                id
            }
            other => panic!("unexpected delete_session event: {other:?}"),
        };
        client
            .send(TungsteniteMessage::Text(
                serde_json::to_string(&OmniClientMessage::ConfirmAction { confirmation_id })
                    .expect("serialize confirm")
                    .into(),
            ))
            .await
            .expect("confirm delete");
        assert_eq!(
            wait_for_action_result(&mut client, "delete_session").await,
            OmniServerEvent::ActionResult {
                skill: "delete_session".to_string(),
                success: true,
                error: None,
            }
        );
        assert!(
            !tmux_status(&tmux_path, &["has-session", "-t", &renamed]),
            "tmux session {renamed} should be deleted"
        );

        let _ = client.close(None).await;
        app_handle.abort();
    }

    #[tokio::test]
    #[ignore = "requires config.jsonc with real Qwen Omni credentials and tmux"]
    async fn real_omni_text_assistant_sends_command_to_configured_tmux_window() {
        let (config_path, config) = load_real_omni_config();
        let tmux_path = config.tmux.path.clone();
        let suffix = Uuid::new_v4().simple().to_string();
        let session = format!("wmux-omni-send-{}", &suffix[..12]);
        let window = "editor";
        let marker = format!("WMUX_OMNI_MARKER_{}", &suffix[..10]);
        let command = format!("printf {marker}");
        let _guard = TmuxSessionGuard::new(tmux_path.clone(), vec![session.clone()]);
        ensure_tmux_session_absent(&tmux_path, &session);
        assert!(
            tmux_status(
                &tmux_path,
                &["new-session", "-d", "-s", &session, "-n", window]
            ),
            "fixture tmux session should be created"
        );
        let pane_index = tmux_output(
            &tmux_path,
            &[
                "list-panes",
                "-t",
                &format!("{session}:={window}"),
                "-F",
                "#{pane_index}",
            ],
        )
        .lines()
        .next()
        .expect("pane index")
        .to_string();

        let (app_url, app_handle, _app_dir) = spawn_real_config_app(&config_path).await;
        let request = authorized_request_with_token(&app_url, &config.auth.token);
        let (mut client, _) = connect_async(request)
            .await
            .expect("connect real Omni voice websocket");

        assert_eq!(
            next_client_event_with_timeout(&mut client, Duration::from_secs(20)).await,
            OmniServerEvent::Connected
        );

        send_text_message(
            &mut client,
            &format!(
                "Use the available function tool only. Call send_to_pane exactly once with {{\"target_name\":\"local\",\"session_name\":\"{session}\",\"window_name\":\"{window}\",\"pane_index\":{pane_index},\"text\":\"{command}\",\"append_enter\":true}}. Do not answer in natural language."
            ),
        )
        .await;
        let confirmation_id = match wait_for_intent(&mut client, "send_to_pane").await {
            OmniServerEvent::IntentReceived {
                params,
                confirmation_required: true,
                confirmation_id: Some(id),
                ..
            } => {
                assert_eq!(
                    params,
                    json!({
                        "target_name": "local",
                        "session_name": &session,
                        "window_name": window,
                        "pane_index": pane_index.parse::<usize>().expect("numeric pane index"),
                        "text": &command,
                        "append_enter": true
                    })
                );
                id
            }
            other => panic!("unexpected send_to_pane event: {other:?}"),
        };
        client
            .send(TungsteniteMessage::Text(
                serde_json::to_string(&OmniClientMessage::ConfirmAction { confirmation_id })
                    .expect("serialize confirm")
                    .into(),
            ))
            .await
            .expect("confirm send to pane");

        assert_eq!(
            wait_for_action_result(&mut client, "send_to_pane").await,
            OmniServerEvent::ActionResult {
                skill: "send_to_pane".to_string(),
                success: true,
                error: None,
            }
        );
        tokio::time::sleep(Duration::from_millis(500)).await;
        let pane = tmux_output(
            &tmux_path,
            &[
                "capture-pane",
                "-p",
                "-t",
                &format!("{session}:={window}.{pane_index}"),
            ],
        );
        assert!(
            pane.contains(&marker),
            "tmux pane should contain marker {marker}; output was {pane:?}"
        );

        let _ = client.close(None).await;
        app_handle.abort();
    }

    #[tokio::test]
    async fn transcript_done_event_inserts_history_with_session_conversation_id() {
        let config = test_voice_config("ws://127.0.0.1:9/realtime".to_string(), true, Some("key"));
        let (state, _dir, pool) = test_state_with_storage(config).await;
        let session_state = OmniSessionState::new();

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
            Some(OmniServerEvent::TranscriptDone {
                text: "hello history".to_string(),
            })
        );
        let rows = sqlx::query_as::<_, OmniConversationMessage>(
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

    #[tokio::test]
    async fn response_audio_transcript_done_emits_assistant_message() {
        let config = test_voice_config("ws://127.0.0.1:9/realtime".to_string(), true, Some("key"));
        let (state, _dir, pool) = test_state_with_storage(config).await;
        let session_state = OmniSessionState::new();

        let event = handle_qwen_message(
            &json!({ "type": "response.audio_transcript.done", "transcript": "assistant spoke this" })
                .to_string(),
            &session_state,
            &state,
            &mpsc::channel(1).0,
        )
        .await
        .expect("handle qwen audio transcript");

        assert_eq!(
            event,
            Some(OmniServerEvent::AssistantMessage {
                text: "assistant spoke this".to_string(),
            })
        );
        let rows = sqlx::query_as::<_, OmniConversationMessage>(
            "SELECT id, conversation_id, role, kind, text, event_json, target_name, session_name, window_name, pane_index, created_at FROM voice_conversation_messages",
        )
        .fetch_all(&pool)
        .await
        .expect("fetch history rows");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].conversation_id, session_state.conversation_id);
        assert_eq!(rows[0].role, "assistant");
        assert_eq!(rows[0].kind, "assistant_text");
        assert_eq!(rows[0].text, "assistant spoke this");
    }

    /// Test voice config validation returns error when voice disabled.
    #[tokio::test]
    async fn test_voice_disabled_validation() {
        // Create minimal voice config with disabled=true
        let config = OmniConfig {
            enabled: false,
            dashscope_api_key: None,
            microphone_disabled: false,
            voice: None,

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
        let config = OmniConfig {
            enabled: true,
            dashscope_api_key: None,
            microphone_disabled: false,
            voice: None,

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
        let config = OmniConfig {
            enabled: true,
            dashscope_api_key: Some("test-key".to_string()),
            microphone_disabled: false,
            voice: None,

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
                "modalities": ["text", "audio"],
                "tools": tools,
                "enable_search": false,
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm24",
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": config.vad_threshold,
                    "silence_duration_ms": 800
                }
            }
        });

        let session = session_update.get("session").unwrap();
        assert_eq!(
            session.get("enable_search").and_then(|v| v.as_bool()),
            Some(false)
        );

        assert_eq!(
            session.get("input_audio_format").and_then(|v| v.as_str()),
            Some("pcm16")
        );
        assert_eq!(
            session.get("output_audio_format").and_then(|v| v.as_str()),
            Some("pcm24")
        );
        assert_eq!(
            session
                .pointer("/turn_detection/type")
                .and_then(|v| v.as_str()),
            Some("server_vad")
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

        let client_msg = OmniClientMessage::AudioFrame {
            pcm16_base64: "test-audio".to_string(),
            sample_rate: 16000,
        };

        let text = serde_json::to_string(&client_msg).unwrap();
        let result =
            handle_client_message(&text, &OmniSessionState::new(), &state, &mpsc::channel(1).0)
                .await;

        assert!(result.is_ok());
        let qwen_messages = result.unwrap().qwen_messages;
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

    #[tokio::test]
    async fn test_audio_frame_rejected_when_microphone_disabled() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");
        let mut config = Config::default();
        config.omni.microphone_disabled = true;
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config).expect("serialize config"),
        )
        .expect("write config");
        let store = Config::load(&config_path).expect("load config");
        let state = AppState::new(store, assets_dir, LoggingHandle::empty());

        let client_msg = OmniClientMessage::AudioFrame {
            pcm16_base64: "test-audio".to_string(),
            sample_rate: 16000,
        };
        let text = serde_json::to_string(&client_msg).unwrap();
        let error =
            handle_client_message(&text, &OmniSessionState::new(), &state, &mpsc::channel(1).0)
                .await
                .expect_err("microphone disabled");

        assert_eq!(error, "Microphone disabled in Settings");
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

        let client_msg = OmniClientMessage::TextMessage {
            text: "hello ai".to_string(),
        };

        let text = serde_json::to_string(&client_msg).unwrap();
        let result =
            handle_client_message(&text, &OmniSessionState::new(), &state, &mpsc::channel(1).0)
                .await
                .expect("handle text message");

        assert_eq!(result.qwen_messages.len(), 2);
        assert_eq!(
            result.qwen_messages[0].get("type").and_then(|v| v.as_str()),
            Some("conversation.item.create")
        );
        assert_eq!(
            result.qwen_messages[0]["item"]["content"][0]["text"].as_str(),
            Some("hello ai")
        );
        assert_eq!(
            result.qwen_messages[1].get("type").and_then(|v| v.as_str()),
            Some("response.create")
        );
    }

    #[tokio::test]
    async fn session_context_message_is_forwarded_without_creating_response() {
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
        let session_state = OmniSessionState::new();
        let client_msg = OmniClientMessage::SessionContext {
            target: wmux_core::protocol::OmniTarget {
                target_name: Some("local".to_string()),
                session: Some("main".to_string()),
                window: Some("@1".to_string()),
                pane: Some("%2".to_string()),
            },
            connection_type: Some("local".to_string()),
        };

        let effects = handle_client_message(
            &serde_json::to_string(&client_msg).expect("serialize context"),
            &session_state,
            &state,
            &mpsc::channel(1).0,
        )
        .await
        .expect("handle context message");

        assert_eq!(effects.qwen_messages.len(), 1);
        assert_eq!(
            effects.qwen_messages[0]
                .get("type")
                .and_then(|v| v.as_str()),
            Some("session.update")
        );
        assert_eq!(
            effects.qwen_messages[0]["session"]["instructions"].as_str(),
            Some(
                "Current Wmux context: target_name=local, connection_type=local, session=main, window=@1, pane=%2. Use target_name as the default connection for tmux actions when the user does not name a connection."
            )
        );
    }

    #[tokio::test]
    async fn missing_tool_target_name_is_filled_from_session_context() {
        let session_state = OmniSessionState::new();
        session_state
            .set_context(
                wmux_core::protocol::OmniTarget {
                    target_name: Some("local".to_string()),
                    session: Some("main".to_string()),
                    window: None,
                    pane: None,
                },
                Some("local".to_string()),
            )
            .await;

        let params = apply_session_context_defaults(
            "create_session",
            serde_json::json!({ "session_name": "hana" }),
            &session_state,
        )
        .await;

        assert_eq!(
            params,
            serde_json::json!({ "target_name": "local", "session_name": "hana" })
        );
    }

    #[tokio::test]
    async fn dangerous_action_cancel_uses_original_qwen_call_id() {
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
        let session_state = OmniSessionState::new();
        let (tx, mut rx) = mpsc::channel(1);

        let event = handle_qwen_message(
            &json!({
                "type": "function_call.arguments.done",
                "call_id": "call-delete",
                "name": "delete_session",
                "arguments": "{\"target_name\":\"local\",\"session_name\":\"alpha\"}"
            })
            .to_string(),
            &session_state,
            &state,
            &tx,
        )
        .await
        .expect("handle dangerous action")
        .expect("confirmation event");

        let confirmation_id = match event {
            OmniServerEvent::IntentReceived {
                confirmation_required: true,
                confirmation_id: Some(id),
                ..
            } => id,
            other => panic!("unexpected event: {other:?}"),
        };

        let cancel = OmniClientMessage::CancelAction { confirmation_id };
        let effects = handle_client_message(
            &serde_json::to_string(&cancel).expect("serialize cancel"),
            &session_state,
            &state,
            &tx,
        )
        .await
        .expect("cancel action");

        assert!(effects.qwen_messages.is_empty());
        assert!(effects.client_events.is_empty());
        let tool_result = rx.recv().await.expect("tool result");
        assert_eq!(tool_result["call_id"], "call-delete");
        assert_eq!(tool_result["output"]["error"], "action_cancelled");
    }

    #[tokio::test]
    async fn dangerous_action_confirm_executes_once_and_uses_original_qwen_call_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");

        let tmux_path = dir.path().join("fake-tmux");
        fs::write(
            &tmux_path,
            r#"#!/bin/sh
log="$(dirname "$0")/tmux.log"
case "$1" in
  -V)
    printf 'tmux 3.4\n'
    ;;
  has-session)
    exit 0
    ;;
  kill-session)
    for arg in "$@"; do
      printf '[%s]' "$arg" >> "$log"
    done
    printf '\n' >> "$log"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
"#,
        )
        .expect("write fake tmux");
        make_executable(&tmux_path);

        let config = json!({
            "schemaVersion": 1,
            "server": { "bind": "127.0.0.1:0" },
            "auth": { "token": TOKEN },
            "tmux": { "path": tmux_path.to_string_lossy() },
            "connections": [],
            "ui": { "theme": "dark" }
        });
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config).expect("serialize config"),
        )
        .expect("write config");
        let store = Config::load(&config_path).expect("load config");
        let state = AppState::new(store, assets_dir, LoggingHandle::empty());
        let session_state = OmniSessionState::new();
        let (tx, mut rx) = mpsc::channel(1);

        let event = handle_qwen_message(
            &json!({
                "type": "function_call.arguments.done",
                "call_id": "call-confirm-delete",
                "name": "delete_session",
                "arguments": "{\"target_name\":\"local\",\"session_name\":\"alpha\"}"
            })
            .to_string(),
            &session_state,
            &state,
            &tx,
        )
        .await
        .expect("handle dangerous action")
        .expect("confirmation event");
        let confirmation_id = match event {
            OmniServerEvent::IntentReceived {
                confirmation_required: true,
                confirmation_id: Some(id),
                ..
            } => id,
            other => panic!("unexpected event: {other:?}"),
        };

        let confirm = OmniClientMessage::ConfirmAction { confirmation_id };
        let effects = handle_client_message(
            &serde_json::to_string(&confirm).expect("serialize confirm"),
            &session_state,
            &state,
            &tx,
        )
        .await
        .expect("confirm action");

        assert!(effects.qwen_messages.is_empty());
        assert_eq!(
            effects.client_events,
            vec![OmniServerEvent::ActionResult {
                skill: "delete_session".to_string(),
                success: true,
                error: None,
            }]
        );
        let tool_result = rx.recv().await.expect("tool result");
        assert_eq!(tool_result["call_id"], "call-confirm-delete");
        assert_eq!(tool_result["output"]["success"], true);
        let tmux_log = fs::read_to_string(dir.path().join("tmux.log")).expect("tmux log");
        assert_eq!(tmux_log, "[kill-session][-t][alpha]\n");
    }

    /// Test function call accumulation.
    #[tokio::test]
    async fn test_function_call_accumulation() {
        let session_state = OmniSessionState::new();

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
        let session_state = OmniSessionState::new();

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
        let skill_defs = vec![crate::skills::OmniSkillDef {
            id: "delete_session".to_string(),
            name: "Delete Session".to_string(),
            risk_level: crate::protocol::OmniSkillRiskLevel::Dangerous,
            enabled: true,
            prompt_mode: crate::skills::OmniSkillPromptMode::Description,
            description: "Delete a tmux session. WARNING: This is a destructive operation."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "target_name": { "type": "string" },
                    "session_name": { "type": "string" }
                },
                "required": ["target_name", "session_name"]
            }),
            full_prompt: String::new(),
        }];
        let tools = generate_qwen_tools(&skill_defs);
        assert_eq!(tools.len(), 1);

        for tool in &tools {
            assert_eq!(tool.get("type").and_then(|v| v.as_str()), Some("function"));
            assert!(
                tool.pointer("/function/name")
                    .and_then(|v| v.as_str())
                    .is_some()
            );
            assert!(tool.pointer("/function/parameters").is_some());
        }

        // Check dangerous tools have warning
        let delete_session = tools
            .iter()
            .find(|t| {
                t.pointer("/function/name").and_then(|v| v.as_str()) == Some("delete_session")
            })
            .unwrap();
        let desc = delete_session
            .pointer("/function/description")
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
            false,
        )
        .await;
        assert!(result.is_err(), "unknown route should be rejected");

        // Allowed route with required params - will attempt execution
        // (may fail if backend not fully available, but passes allowlist validation)
        let result = execute_voice_action(
            "invoke_backend_route",
            &serde_json::json!({"route_id": "connections.list"}),
            &state,
            false,
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
            false,
        )
        .await;
        assert!(result.is_ok());

        // Unknown skill is rejected
        let result =
            execute_voice_action("unknown_skill", &serde_json::json!({}), &state, false).await;
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
        let msg: OmniClientMessage = serde_json::from_str(&text).unwrap();
        assert!(matches!(msg, OmniClientMessage::AudioFrame { .. }));

        let stop_msg = serde_json::json!({"type": "stop_listening"});
        let text = serde_json::to_string(&stop_msg).unwrap();
        let msg: OmniClientMessage = serde_json::from_str(&text).unwrap();
        assert!(matches!(msg, OmniClientMessage::StopListening));

        let start_msg = serde_json::json!({"type": "start_listening"});
        let text = serde_json::to_string(&start_msg).unwrap();
        let msg: OmniClientMessage = serde_json::from_str(&text).unwrap();
        assert!(matches!(msg, OmniClientMessage::StartListening));
    }

    /// Test server event serialization.
    #[test]
    fn test_server_event_serialization() {
        let connected = OmniServerEvent::Connected;
        let text = serde_json::to_string(&connected).unwrap();
        assert!(text.contains("connected"));

        let audio_delta = OmniServerEvent::AudioDelta {
            pcm16_base64: "test".to_string(),
            sample_rate: 24000,
        };
        let text = serde_json::to_string(&audio_delta).unwrap();
        assert!(text.contains("audio_delta"));
        assert!(text.contains("pcm16Base64"));

        let error = OmniServerEvent::Error {
            code: "test_error".to_string(),
            message: "Test message".to_string(),
        };
        let text = serde_json::to_string(&error).unwrap();
        assert!(text.contains("error"));
        assert!(text.contains("test_error"));
    }

    /// Test AI log persistence for tool_result events.
    #[tokio::test]
    async fn ai_log_persists_tool_result_with_storage() {
        use crate::storage::db;

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create pool");
        db::run_migrations(&pool).await.expect("run migrations");

        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");

        let mut config = Config::default();
        config.omni.enabled = true;
        config.omni.dashscope_api_key = Some("test-key".to_string());

        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config).expect("serialize config"),
        )
        .expect("write config");

        let store = Config::load(&config_path).expect("load config");
        let mut state = AppState::new(store, assets_dir, LoggingHandle::empty());
        state.storage = Some(pool.clone());

        let session_state = OmniSessionState::new();
        let model = get_omni_config(&state).expect("get omni config").model;

        let entry = NewAiLogEntry {
            id: None,
            conversation_id: session_state.conversation_id.clone(),
            event_kind: "tool_result".to_string(),
            model,
            status: "success".to_string(),
            prompt_text: None,
            tool_name: Some("list_sessions".to_string()),
            tool_call_id: Some("call-123".to_string()),
            tool_arguments_json: None,
            tool_result_json: Some("{\"sessions\":[]}".to_string()),
            metrics_json: "{}".to_string(),
            duration_ms: Some(150),
            raw_event_json: "{}".to_string(),
            error_message: None,
            created_at: None,
        };

        let repo = AiLogRepository::new(pool);
        repo.insert(&entry).await.expect("insert ai log");

        let logs = repo.list(10, None).await.expect("list logs");
        assert_eq!(logs.data.len(), 1);
        assert_eq!(logs.data[0].event_kind, "tool_result");
        assert_eq!(logs.data[0].tool_name, Some("list_sessions".to_string()));
        assert_eq!(logs.data[0].duration_ms, Some(150));
    }

    /// Test AI log failure does not break voice flow when storage is None.
    #[tokio::test]
    async fn ai_log_without_storage_continues_gracefully() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");
        fs::create_dir_all(&assets_dir).expect("create assets dir");
        fs::write(assets_dir.join("index.html"), "<html></html>").expect("write index");

        let mut config = Config::default();
        config.omni.enabled = true;
        config.omni.dashscope_api_key = Some("test-key".to_string());

        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config).expect("serialize config"),
        )
        .expect("write config");

        let store = Config::load(&config_path).expect("load config");
        let state = AppState::new(store, assets_dir, LoggingHandle::empty());

        let session_state = OmniSessionState::new();

        persist_tool_result(
            &state,
            &session_state,
            "list_sessions",
            None,
            true,
            None,
            None,
            None,
        )
        .await;
    }
}
