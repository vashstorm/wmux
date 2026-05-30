import { useEffect, useRef, useState, useCallback, type FormEvent } from "react";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import ReplayIcon from "@mui/icons-material/Replay";
import CloseIcon from "@mui/icons-material/Close";
import AssistantIcon from "@mui/icons-material/Assistant";
import SendIcon from "@mui/icons-material/Send";
import { getAuthToken, getRuntimeFlags } from "../api/runtime.js";
import { OmniWebSocket } from "../api/voiceClient.js";
import { AudioPipeline } from "../api/audioPipeline.js";
import type { OmniServerEvent } from "../api/voiceTypes.js";
import { isVoiceAudioDeltaEvent, isVoiceTranscriptDeltaEvent, isVoiceTranscriptDoneEvent, isVoiceIntentReceivedEvent, isVoiceActionResultEvent, isVoiceErrorEvent, isVoiceConnectedEvent, isVoiceAssistantMessageEvent } from "../api/voiceTypes.js";
import { useAppState } from "../state/store.js";
import { getConfig, getOmniHistory, type OmniConversationMessage } from "../api/client.js";
import "../styles/ai-assistant.css";

const LEVEL_SEGMENTS = 12;

function formatTime(iso: string): string {
	const d = new Date(iso);
	const h = d.getHours();
	const m = d.getMinutes();
	return `${h}:${m < 10 ? "0" : ""}${m}`;
}

function formatRole(role: string): string {
	return role === "user" ? "You" : "AI";
}

function omniComposerText(status: string): string {
	switch (status) {
		case "connecting":
			return "Connecting to AI...";
		case "listening":
			return "Listening...";
		case "processing":
			return "AI is thinking...";
		case "speaking":
			return "AI is speaking...";
		case "confirming":
			return "Waiting for confirmation...";
		default:
			return "Voice message to AI";
	}
}

export function AiAssistant() {
	const {
		omniStatus,
		omniTranscript,
		omniPendingConfirmation,
		omniError,
		setOmniStatus,
		appendVoiceTranscript,
		setOmniTranscript,
		setOmniConfirmation,
		setOmniError,
		setShowSettingsPanel,
	} = useAppState();

	const audioLevel = useRef(0);
	const [audioBars, setAudioBars] = useState<boolean[]>(new Array(LEVEL_SEGMENTS).fill(false));
	const wsRef = useRef<OmniWebSocket | null>(null);
	const pipelineRef = useRef<AudioPipeline | null>(null);
	const isMutedRef = useRef(false);
	const wsConnectingRef = useRef(false);
	const omniStatusRef = useRef(omniStatus);
	const [micDisabled, setMicDisabled] = useState(false);
	const [history, setHistory] = useState<OmniConversationMessage[]>([]);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [inputText, setInputText] = useState("");
	const [isHidden, setIsHidden] = useState(true);

	useEffect(() => {
		omniStatusRef.current = omniStatus;
	}, [omniStatus]);
	useEffect(() => {
		if (omniStatus === "disabled" && getRuntimeFlags().omniAvailable) {
			setOmniStatus("idle");
		}
	}, [setOmniStatus, omniStatus]);

	useEffect(() => {
		let cancelled = false;
		const loadMicState = async () => {
			try {
				const cfg = await getConfig();
				if (!cancelled) {
						setMicDisabled(cfg.omni?.microphoneDisabled ?? false);
				}
			} catch {
				// Config fetch failed — default to not disabled
			}
		};
		void loadMicState();
		return () => { cancelled = true; };
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadHistory = async () => {
			setHistoryLoading(true);
			try {
				const messages = await getOmniHistory({ conversationId: "default", limit: 20 });
				if (!cancelled) {
					setHistory(messages);
				}
			} catch {
				// History fetch failed — show empty
			} finally {
				if (!cancelled) {
					setHistoryLoading(false);
				}
			}
		};
		void loadHistory();
		return () => { cancelled = true; };
	}, []);

	const handleServerMessage = useCallback((event: OmniServerEvent) => {
		if (isVoiceConnectedEvent(event)) {
			if (omniStatusRef.current === "connecting") {
				setOmniStatus("listening");
			}
			return;
		}

		if (isVoiceTranscriptDeltaEvent(event)) {
			appendVoiceTranscript(event.text);
			setOmniError(null);
			return;
		}

		if (isVoiceTranscriptDoneEvent(event)) {
			setOmniTranscript(event.text);
			setOmniStatus("processing");
			setHistory((prev) => [
				...prev,
				{
					id: `local-${Date.now()}-user`,
					conversationId: "default",
					role: "user",
					kind: "transcript",
					text: event.text,
					createdAt: new Date().toISOString(),
				},
			]);
			return;
		}

		if (isVoiceIntentReceivedEvent(event)) {
			if (event.skill === "navigate_frontend" && event.params.route === "settings") {
				setShowSettingsPanel(true);
				window.history.pushState(null, "", `${window.location.pathname}?view=settings`);
			}
			if (event.confirmationRequired && event.confirmationId) {
				setOmniConfirmation({
					confirmationId: event.confirmationId,
					skill: event.skill,
				});
				setOmniStatus("confirming");
			} else {
				setOmniStatus("processing");
			}
			return;
		}

		if (isVoiceActionResultEvent(event)) {
			setOmniConfirmation(null);
			if (event.success) {
				setOmniStatus("listening");
				setHistory((prev) => [
					...prev,
					{
						id: `local-${Date.now()}-assistant`,
						conversationId: "default",
						role: "assistant",
						kind: "action_result",
						text: `Executed: ${event.skill}`,
						createdAt: new Date().toISOString(),
					},
				]);
			} else {
				setOmniError(event.error ?? `Action failed: ${event.skill}`);
				setOmniStatus("error");
			}
			return;
		}

		if (isVoiceAssistantMessageEvent(event)) {
			setOmniStatus("idle");
			setHistory((prev) => [
				...prev,
				{
					id: `local-${Date.now()}-assistant-message`,
					conversationId: "default",
					role: "assistant",
					kind: "assistant_text",
					text: event.text,
					createdAt: new Date().toISOString(),
				},
			]);
			return;
		}

		if (isVoiceAudioDeltaEvent(event)) {
			setOmniStatus("speaking");
			pipelineRef.current?.enqueuePlayback(event.pcm16Base64, event.sampleRate);
			return;
		}

		if (isVoiceErrorEvent(event)) {
			setOmniError(event.message);
			setOmniStatus("error");
		}
	}, [appendVoiceTranscript, setOmniTranscript, setOmniConfirmation, setOmniError, setOmniStatus, setShowSettingsPanel]);

	const connectVoice = useCallback(() => {
		if (wsConnectingRef.current || wsRef.current) return;

		const token = getAuthToken();
		if (!token) return;

		wsConnectingRef.current = true;
		omniStatusRef.current = "connecting";
		setOmniStatus("connecting");
		setOmniTranscript("");
		setOmniError(null);

		const ws = new OmniWebSocket({
			token,
			onMessage: (event: OmniServerEvent) => {
				handleServerMessage(event);
			},
			onOpen: () => {
				wsConnectingRef.current = false;
				if (omniStatusRef.current === "connecting") {
					setOmniStatus("listening");
				}
				setOmniError(null);
			},
			onClose: () => {
				wsConnectingRef.current = false;
				if (!isMutedRef.current && omniStatusRef.current !== "disabled") {
					setOmniStatus("idle");
				}
				wsRef.current = null;
			},
			onError: () => {
				wsConnectingRef.current = false;
				setOmniError("Connection failed");
				setOmniStatus("error");
			},
		});

		ws.connect();
		wsRef.current = ws;
	}, [handleServerMessage, setOmniStatus, setOmniTranscript, setOmniError]);

	const startListening = useCallback(async () => {
		if (isMutedRef.current) return;
		if (micDisabled) return;

		connectVoice();

		if (!pipelineRef.current) {
			pipelineRef.current = new AudioPipeline({
				sampleRateInput: 16000,
				sampleRateOutput: 24000,
				vadEnabled: true,
				vadThreshold: 50,
			});
		}

		try {
			await pipelineRef.current.startCapture(
				(frameBase64, sampleRate) => {
					if (wsRef.current?.isConnected()) {
						wsRef.current.send({ type: "audio_frame", pcm16Base64: frameBase64, sampleRate });
					}
				},
				{
					onLevel: (level) => {
						audioLevel.current = level;
						const activeBars = Math.min(LEVEL_SEGMENTS, Math.floor(level / 10));
						setAudioBars((prev) => {
							const next = [...prev];
							for (let i = 0; i < LEVEL_SEGMENTS; i++) {
								next[i] = i < activeBars;
							}
							return next;
						});
					},
				},
			);
			setOmniTranscript("");
			setOmniError(null);
		} catch {
			setOmniError("Microphone access denied");
			setOmniStatus("error");
		}
	}, [connectVoice, setOmniTranscript, setOmniError, setOmniStatus, micDisabled]);

	const stopListening = useCallback(() => {
		pipelineRef.current?.stopCapture();
		pipelineRef.current?.stopPlayback();
		wsRef.current?.close();
		wsRef.current = null;
		wsConnectingRef.current = false;
		setAudioBars(new Array(LEVEL_SEGMENTS).fill(false));
		setOmniStatus("idle");
	}, [setOmniStatus]);

	const toggleMute = useCallback(() => {
		isMutedRef.current = !isMutedRef.current;
		if (isMutedRef.current) {
			stopListening();
		} else {
			void startListening();
		}
	}, [startListening, stopListening]);

	const handleConfirm = useCallback(() => {
		if (omniPendingConfirmation && wsRef.current?.isConnected()) {
			wsRef.current.send({
				type: "confirm_action",
				confirmationId: omniPendingConfirmation.confirmationId,
			});
		}
	}, [omniPendingConfirmation]);

	const handleCancel = useCallback(() => {
		if (omniPendingConfirmation && wsRef.current?.isConnected()) {
			wsRef.current.send({
				type: "cancel_action",
				confirmationId: omniPendingConfirmation.confirmationId,
			});
		}
		setOmniConfirmation(null);
		setOmniStatus("listening");
	}, [omniPendingConfirmation, setOmniConfirmation, setOmniStatus]);

	const handleReconnect = useCallback(() => {
		stopListening();
		setOmniStatus("idle");
		void startListening();
	}, [startListening, stopListening, setOmniStatus]);

	const handleTextSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const text = inputText.trim();
		if (!text) return;

		const token = getAuthToken();
		if (!token) {
			setOmniError("Authentication token is missing");
			setOmniStatus("error");
			return;
		}

		connectVoice();
		if (!wsRef.current) {
			setOmniError("Connection failed");
			setOmniStatus("error");
			return;
		}

		const now = new Date().toISOString();
		setHistory((prev) => [
			...prev,
			{
				id: `local-${Date.now()}-typed-user`,
				conversationId: "default",
				role: "user",
				kind: "typed_text",
				text,
				createdAt: now,
			},
		]);
		setInputText("");
		setOmniTranscript("");
		setOmniError(null);
		omniStatusRef.current = "processing";
		setOmniStatus("processing");
		wsRef.current.send({ type: "text_message", text });
	}, [connectVoice, inputText, setOmniError, setOmniStatus, setOmniTranscript]);

	useEffect(() => {
		return () => {
			pipelineRef.current?.stopCapture();
			pipelineRef.current?.stopPlayback();
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, []);

	const isListening = omniStatus === "listening" || omniStatus === "processing" || omniStatus === "speaking" || omniStatus === "confirming";
	const isDisabled = omniStatus === "disabled";
	const visibleHistory = history.slice(-10);
	const showEmptyState = !historyLoading && visibleHistory.length === 0 && !omniTranscript && !omniError && !omniPendingConfirmation;

	if (isHidden) {
		return (
			<button
				type="button"
				className="voice-launcher"
				aria-label="Show AI Assistant"
				onClick={() => setIsHidden(false)}
			>
				<AssistantIcon fontSize="small" />
			</button>
		);
	}

	return (
		<div className="ai-assistant" data-ai-assistant-state={omniStatus}>
			<div className="voice-header">
				<div className="voice-title">
					<span className="voice-status-dot" />
				</div>
				<div className="voice-status-label">
					<span>{omniStatus}</span>
				</div>
				<button
					type="button"
					className="voice-btn voice-btn--ghost"
					aria-label="Hide AI Assistant"
					onClick={() => setIsHidden(true)}
				>
					<CloseIcon fontSize="small" />
				</button>
			</div>

			<div className="voice-chat">
				{historyLoading && (
					<div className="voice-history-loading">Loading conversation...</div>
				)}

				{visibleHistory.map((msg) => (
					<div key={msg.id} className={`voice-message voice-message--${msg.role === "user" ? "user" : "assistant"}`}>
						<div className="voice-message-meta">
							<span>{formatRole(msg.role)}</span>
							<span>{formatTime(msg.createdAt)}</span>
						</div>
						<div className="voice-message-bubble">{msg.text}</div>
					</div>
				))}

				{omniTranscript && (
					<div className="voice-message voice-message--user voice-message--live">
						<div className="voice-message-meta">
							<span>You</span>
							<span>Live</span>
						</div>
						<div className="voice-message-bubble">{omniTranscript}</div>
					</div>
				)}

				{omniPendingConfirmation && (
					<div className="voice-confirmation">
						<div className="voice-confirmation-text">
							Confirm action: <strong>{omniPendingConfirmation.skill}</strong>?
						</div>
						<div className="voice-confirmation-actions">
							<button type="button" className="voice-confirm-btn" onClick={handleConfirm}>
								Confirm
							</button>
							<button type="button" className="voice-cancel-btn" onClick={handleCancel}>
								Cancel
							</button>
						</div>
					</div>
				)}

				{omniError && (
					<div className="voice-error">{omniError}</div>
				)}

				{(isDisabled || micDisabled) && (
					<div className="voice-disabled-indicator">
						{micDisabled ? "Microphone disabled in Settings" : "Voice is disabled"}
					</div>
				)}

				{showEmptyState && !isDisabled && !micDisabled && (
					<div className="voice-empty-state">
						<div className="voice-empty-title">Ask AI with your voice</div>
						<div className="voice-empty-copy">Use the mic to talk with the assistant and run tmux actions.</div>
					</div>
				)}
			</div>

			<form className="voice-composer" aria-label="AI input" onSubmit={handleTextSubmit}>
				<div className="voice-composer-copy">
					<textarea
						className="voice-input"
						aria-label="Message AI Assistant"
						placeholder={omniComposerText(omniStatus)}
						value={inputText}
						rows={1}
						onChange={(event) => setInputText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								event.currentTarget.form?.requestSubmit();
							}
						}}
					/>
					{(isListening || omniStatus === "connecting") && (
						<div className="voice-level-bar" aria-hidden="true">
							{audioBars.map((active, i) => (
								<span key={i} className={`voice-level-segment${active ? " voice-level-segment--active" : ""}`} />
							))}
						</div>
					)}
				</div>
				<div className="ai-assistant-controls">
					<button
						type="submit"
						className="voice-btn voice-btn--send"
						aria-label="Send message"
						disabled={!inputText.trim() || isDisabled}
					>
						<SendIcon fontSize="small" />
					</button>
					{!isListening && !isDisabled && (
						<button
							type="button"
							className="voice-btn voice-btn--start"
							aria-label="Start listening"
							onClick={startListening}
							disabled={wsConnectingRef.current || micDisabled}
						>
							<PlayArrowIcon fontSize="small" />
						</button>
					)}
					{isListening && (
						<button
							type="button"
							className="voice-btn voice-btn--stop"
							aria-label="Stop listening"
							onClick={stopListening}
						>
							<StopIcon fontSize="small" />
						</button>
					)}
					<button
						type="button"
						className="voice-btn"
						aria-label={isMutedRef.current ? "Unmute" : "Mute"}
						onClick={toggleMute}
					>
						{isMutedRef.current ? <MicOffIcon fontSize="small" /> : <MicIcon fontSize="small" />}
					</button>
					{omniStatus === "error" && (
						<button
							type="button"
							className="voice-btn"
							aria-label="Reconnect"
							onClick={handleReconnect}
						>
							<ReplayIcon fontSize="small" />
						</button>
					)}
				</div>
			</form>
		</div>
	);
}
