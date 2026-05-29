/**
 * Voice WebSocket message types for Qwen3.5-Omni Realtime Voice integration.
 *
 * These types mirror the Rust protocol types in crates/wmux-core/src/protocol/mod.rs.
 * All message types use discriminated unions with a `type` field for type-safe parsing.
 */

// ============================================================================
// Voice Skill Names (snake_case for Qwen API compatibility)
// ============================================================================

/** Voice skill identifiers matching Qwen function-call tool names */
export const VOICE_SKILLS = {
	NAVIGATE_FRONTEND: "navigate_frontend",
	INVOKE_BACKEND_ROUTE: "invoke_backend_route",
	LIST_SESSIONS: "list_sessions",
	CREATE_SESSION: "create_session",
	RENAME_SESSION: "rename_session",
	DELETE_SESSION: "delete_session",
	SEND_TO_PANE: "send_to_pane",
	CONFIRM_ACTION: "confirm_action",
	CANCEL_ACTION: "cancel_action",
} as const;

export type VoiceSkill = (typeof VOICE_SKILLS)[keyof typeof VOICE_SKILLS];

/** Allowed frontend routes for navigate_frontend skill */
export const FRONTEND_ROUTES = {
	HOME: "home",
	SETTINGS: "settings",
	PROJECTS: "projects",
	CONNECTIONS: "connections",
	SESSION: "session",
	WINDOW: "window",
	PANE: "pane",
} as const;

export type FrontendRoute = (typeof FRONTEND_ROUTES)[keyof typeof FRONTEND_ROUTES];

/** Allowed backend routes for invoke_backend_route skill (allowlist enforced) */
export const BACKEND_ROUTES = {
	CONNECTIONS_LIST: "connections.list",
	SESSIONS_LIST: "sessions.list",
	SESSIONS_CREATE: "sessions.create",
	SESSIONS_RENAME: "sessions.rename",
	SESSIONS_DELETE: "sessions.delete",
	WINDOWS_LIST: "windows.list",
	WINDOWS_CREATE: "windows.create",
	WINDOWS_DELETE: "windows.delete",
	PANES_LIST: "panes.list",
	PANES_SPLIT: "panes.split",
	PANES_DELETE: "panes.delete",
} as const;

export type BackendRoute = (typeof BACKEND_ROUTES)[keyof typeof BACKEND_ROUTES];

// ============================================================================
// Voice Target Specification
// ============================================================================

/** Target specification for voice actions */
export interface VoiceTarget {
	targetName?: string;
	session?: string;
	window?: string;
	pane?: string;
}

// ============================================================================
// Voice Action Result
// ============================================================================

/** Result of a voice-initiated action execution */
export interface VoiceActionResult {
	skill: string;
	success: boolean;
	error?: string;
}

// ============================================================================
// Client-to-Server WebSocket Messages
// ============================================================================

/** Base type for all voice client messages */
export interface OmniClientMessageBase {
	type: string;
}

/** Send audio data to Qwen for processing */
export interface VoiceAudioFrameMessage extends OmniClientMessageBase {
	type: "audio_frame";
	pcm16Base64: string;
	sampleRate: number;
}

/** Send typed text to Qwen for processing */
export interface VoiceTextMessage extends OmniClientMessageBase {
	type: "text_message";
	text: string;
}

/** Confirm a pending dangerous action */
export interface VoiceConfirmActionMessage extends OmniClientMessageBase {
	type: "confirm_action";
	confirmationId: string;
}

/** Cancel a pending dangerous action */
export interface VoiceCancelActionMessage extends OmniClientMessageBase {
	type: "cancel_action";
	confirmationId: string;
}

/** Stop voice recognition/listening */
export interface VoiceStopListeningMessage extends OmniClientMessageBase {
	type: "stop_listening";
}

/** Start voice recognition/listening */
export interface VoiceStartListeningMessage extends OmniClientMessageBase {
	type: "start_listening";
}

/** Union type for all client-to-server voice messages */
export type OmniClientMessage =
	| VoiceAudioFrameMessage
	| VoiceTextMessage
	| VoiceConfirmActionMessage
	| VoiceCancelActionMessage
	| VoiceStopListeningMessage
	| VoiceStartListeningMessage;

// ============================================================================
// Server-to-Client WebSocket Events
// ============================================================================

/** Base type for all voice server events */
export interface OmniServerEventBase {
	type: string;
}

/** Voice session established successfully */
export interface VoiceConnectedEvent extends OmniServerEventBase {
	type: "connected";
}

/** Audio output from Qwen (TTS response) */
export interface VoiceAudioDeltaEvent extends OmniServerEventBase {
	type: "audio_delta";
	pcm16Base64: string;
	sampleRate: number;
}

/** Incremental transcript update (partial recognition) */
export interface VoiceTranscriptDeltaEvent extends OmniServerEventBase {
	type: "transcript_delta";
	text: string;
}

/** Final transcript (complete recognition) */
export interface VoiceTranscriptDoneEvent extends OmniServerEventBase {
	type: "transcript_done";
	text: string;
}

/** Intent parsed from transcript with action parameters */
export interface VoiceIntentReceivedEvent extends OmniServerEventBase {
	type: "intent_received";
	skill: string;
	params: Record<string, unknown>;
	confirmationRequired: boolean;
	confirmationId?: string;
}

/** Result of executed action */
export interface VoiceActionResultEvent extends OmniServerEventBase {
	type: "action_result";
	skill: string;
	success: boolean;
	error?: string;
}

/** Assistant text response */
export interface VoiceAssistantMessageEvent extends OmniServerEventBase {
	type: "assistant_message";
	text: string;
}

/** Voice session error */
export interface VoiceErrorEvent extends OmniServerEventBase {
	type: "error";
	code: string;
	message: string;
}

/** Session timeout warning */
export interface VoiceSessionTimeoutEvent extends OmniServerEventBase {
	type: "session_timeout";
	remainingSeconds: number;
}

/** Union type for all server-to-client voice events */
export type OmniServerEvent =
	| VoiceConnectedEvent
	| VoiceAudioDeltaEvent
	| VoiceTranscriptDeltaEvent
	| VoiceTranscriptDoneEvent
	| VoiceIntentReceivedEvent
	| VoiceActionResultEvent
	| VoiceAssistantMessageEvent
	| VoiceErrorEvent
	| VoiceSessionTimeoutEvent;

// ============================================================================
// Type Guards
// ============================================================================

/** Client message type strings */
const CLIENT_MESSAGE_TYPES = [
	"audio_frame",
	"text_message",
	"confirm_action",
	"cancel_action",
	"stop_listening",
	"start_listening",
] as const;

/** Server event type strings */
const SERVER_EVENT_TYPES = [
	"connected",
	"audio_delta",
	"transcript_delta",
	"transcript_done",
	"intent_received",
	"action_result",
	"assistant_message",
	"error",
	"session_timeout",
] as const;

/**
 * Type guard for OmniClientMessage.
 * Returns true if the object is a valid voice client message.
 */
export function isOmniClientMessage(msg: unknown): msg is OmniClientMessage {
	if (typeof msg !== "object" || msg === null) {
		return false;
	}
	const type = (msg as Record<string, unknown>)["type"];
	return typeof type === "string" && CLIENT_MESSAGE_TYPES.includes(type as (typeof CLIENT_MESSAGE_TYPES)[number]);
}

/**
 * Type guard for OmniServerEvent.
 * Returns true if the object is a valid voice server event.
 */
export function isOmniServerEvent(msg: unknown): msg is OmniServerEvent {
	if (typeof msg !== "object" || msg === null) {
		return false;
	}
	const type = (msg as Record<string, unknown>)["type"];
	return typeof type === "string" && SERVER_EVENT_TYPES.includes(type as (typeof SERVER_EVENT_TYPES)[number]);
}

/**
 * Type guard for VoiceAudioFrameMessage.
 */
export function isVoiceAudioFrameMessage(msg: OmniClientMessage): msg is VoiceAudioFrameMessage {
	return msg.type === "audio_frame";
}

/**
 * Type guard for VoiceTextMessage.
 */
export function isVoiceTextMessage(msg: OmniClientMessage): msg is VoiceTextMessage {
	return msg.type === "text_message";
}

/**
 * Type guard for VoiceConfirmActionMessage.
 */
export function isVoiceConfirmActionMessage(msg: OmniClientMessage): msg is VoiceConfirmActionMessage {
	return msg.type === "confirm_action";
}

/**
 * Type guard for VoiceCancelActionMessage.
 */
export function isVoiceCancelActionMessage(msg: OmniClientMessage): msg is VoiceCancelActionMessage {
	return msg.type === "cancel_action";
}

/**
 * Type guard for VoiceStopListeningMessage.
 */
export function isVoiceStopListeningMessage(msg: OmniClientMessage): msg is VoiceStopListeningMessage {
	return msg.type === "stop_listening";
}

/**
 * Type guard for VoiceStartListeningMessage.
 */
export function isVoiceStartListeningMessage(msg: OmniClientMessage): msg is VoiceStartListeningMessage {
	return msg.type === "start_listening";
}

/**
 * Type guard for VoiceConnectedEvent.
 */
export function isVoiceConnectedEvent(event: OmniServerEvent): event is VoiceConnectedEvent {
	return event.type === "connected";
}

/**
 * Type guard for VoiceAudioDeltaEvent.
 */
export function isVoiceAudioDeltaEvent(event: OmniServerEvent): event is VoiceAudioDeltaEvent {
	return event.type === "audio_delta";
}

/**
 * Type guard for VoiceTranscriptDeltaEvent.
 */
export function isVoiceTranscriptDeltaEvent(event: OmniServerEvent): event is VoiceTranscriptDeltaEvent {
	return event.type === "transcript_delta";
}

/**
 * Type guard for VoiceTranscriptDoneEvent.
 */
export function isVoiceTranscriptDoneEvent(event: OmniServerEvent): event is VoiceTranscriptDoneEvent {
	return event.type === "transcript_done";
}

/**
 * Type guard for VoiceIntentReceivedEvent.
 */
export function isVoiceIntentReceivedEvent(event: OmniServerEvent): event is VoiceIntentReceivedEvent {
	return event.type === "intent_received";
}

/**
 * Type guard for VoiceActionResultEvent.
 */
export function isVoiceActionResultEvent(event: OmniServerEvent): event is VoiceActionResultEvent {
	return event.type === "action_result";
}

/**
 * Type guard for VoiceAssistantMessageEvent.
 */
export function isVoiceAssistantMessageEvent(event: OmniServerEvent): event is VoiceAssistantMessageEvent {
	return event.type === "assistant_message";
}

/**
 * Type guard for VoiceErrorEvent.
 */
export function isVoiceErrorEvent(event: OmniServerEvent): event is VoiceErrorEvent {
	return event.type === "error";
}

/**
 * Type guard for VoiceSessionTimeoutEvent.
 */
export function isVoiceSessionTimeoutEvent(event: OmniServerEvent): event is VoiceSessionTimeoutEvent {
	return event.type === "session_timeout";
}

/**
 * Check if a skill name is a valid voice skill.
 */
export function isValidVoiceSkill(skill: unknown): skill is VoiceSkill {
	return typeof skill === "string" && (Object.values(VOICE_SKILLS) as string[]).includes(skill);
}

/**
 * Check if a route is a valid frontend route for navigate_frontend skill.
 */
export function isValidFrontendRoute(route: unknown): route is FrontendRoute {
	return typeof route === "string" && (Object.values(FRONTEND_ROUTES) as string[]).includes(route);
}

/**
 * Check if a route is a valid backend route for invoke_backend_route skill.
 */
export function isValidBackendRoute(route: unknown): route is BackendRoute {
	return typeof route === "string" && (Object.values(BACKEND_ROUTES) as string[]).includes(route);
}

// ============================================================================
// Error Codes
// ============================================================================

/** Voice error code constants */
export const VOICE_ERROR_CODES = {
	VOICE_DISABLED: "voice_disabled",
	UNAUTHORIZED: "unauthorized",
	INVALID_SKILL: "invalid_skill",
	CONFIRMATION_NOT_FOUND: "confirmation_not_found",
	CONFIRMATION_EXPIRED: "confirmation_expired",
	ACTION_FAILED: "action_failed",
	SESSION_TIMEOUT: "session_timeout",
	UNKNOWN_SKILL: "unknown_skill",
} as const;

export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[keyof typeof VOICE_ERROR_CODES];

/**
 * Check if an error code is a known voice error code.
 */
export function isVoiceErrorCode(code: unknown): code is VoiceErrorCode {
	return typeof code === "string" && (Object.values(VOICE_ERROR_CODES) as string[]).includes(code);
}
