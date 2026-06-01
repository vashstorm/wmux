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
        "input_audio_format": "pcm",
        "output_audio_format": "pcm",
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
            sample_rate: _,
        } => {
            if get_omni_config(state)?.microphone_disabled {
                return Err("Microphone disabled in Settings".to_string());
            }
            Ok(ClientMessageEffects::qwen(vec![serde_json::json!({
                "type": "input_audio_buffer.append",
                "audio": pcm16_base64
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
        "list_sessions"
            | "create_session"
            | "rename_session"
            | "delete_session"
            | "send_to_pane"
            | "read_pane_output"
            | "create_window"
            | "rename_window"
            | "split_pane"
            | "focus_pane"
            | "run_project"
            | "delete_window"
            | "kill_pane"
            | "clear_pane"
            | "analyze_session"
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
mod voice_tests;
