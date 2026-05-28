import { useEffect, useRef, useState, useCallback } from "react";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import ReplayIcon from "@mui/icons-material/Replay";
import { getAuthToken, getRuntimeFlags } from "../api/runtime.js";
import { VoiceWebSocket } from "../api/voiceClient.js";
import { AudioPipeline } from "../api/audioPipeline.js";
import type { VoiceServerEvent } from "../api/voiceTypes.js";
import { isVoiceAudioDeltaEvent, isVoiceTranscriptDeltaEvent, isVoiceTranscriptDoneEvent, isVoiceIntentReceivedEvent, isVoiceActionResultEvent, isVoiceErrorEvent, isVoiceConnectedEvent } from "../api/voiceTypes.js";
import { useAppState } from "../state/store.js";
import "../styles/voice.css";

const LEVEL_SEGMENTS = 12;

export function VoiceControl() {
	const {
		voiceStatus,
		voiceTranscript,
		voicePendingConfirmation,
		voiceError,
		setVoiceStatus,
		appendVoiceTranscript,
		setVoiceTranscript,
		setVoiceConfirmation,
		setVoiceError,
		setShowSettingsPanel,
	} = useAppState();

	const audioLevel = useRef(0);
	const [audioBars, setAudioBars] = useState<boolean[]>(new Array(LEVEL_SEGMENTS).fill(false));
	const wsRef = useRef<VoiceWebSocket | null>(null);
	const pipelineRef = useRef<AudioPipeline | null>(null);
	const isMutedRef = useRef(false);
	const wsConnectingRef = useRef(false);
	const voiceStatusRef = useRef(voiceStatus);

	useEffect(() => {
		voiceStatusRef.current = voiceStatus;
	}, [voiceStatus]);
	useEffect(() => {
		if (voiceStatus === "disabled" && getRuntimeFlags().voiceAvailable) {
			setVoiceStatus("idle");
		}
	}, [setVoiceStatus, voiceStatus]);

	const handleServerMessage = useCallback((event: VoiceServerEvent) => {
		if (isVoiceConnectedEvent(event)) {
			setVoiceStatus("listening");
			return;
		}

		if (isVoiceTranscriptDeltaEvent(event)) {
			appendVoiceTranscript(event.text);
			setVoiceError(null);
			return;
		}

		if (isVoiceTranscriptDoneEvent(event)) {
			setVoiceTranscript(event.text);
			setVoiceStatus("processing");
			return;
		}

		if (isVoiceIntentReceivedEvent(event)) {
			if (event.skill === "navigate_frontend" && event.params.route === "settings") {
				setShowSettingsPanel(true);
				window.history.pushState(null, "", `${window.location.pathname}?view=settings`);
			}
			if (event.confirmationRequired && event.confirmationId) {
				setVoiceConfirmation({
					confirmationId: event.confirmationId,
					skill: event.skill,
				});
				setVoiceStatus("confirming");
			} else {
				setVoiceStatus("processing");
			}
			return;
		}

		if (isVoiceActionResultEvent(event)) {
			setVoiceConfirmation(null);
			if (event.success) {
				setVoiceStatus("listening");
			} else {
				setVoiceError(event.error ?? `Action failed: ${event.skill}`);
				setVoiceStatus("error");
			}
			return;
		}

		if (isVoiceAudioDeltaEvent(event)) {
			setVoiceStatus("speaking");
			pipelineRef.current?.enqueuePlayback(event.pcm16Base64, event.sampleRate);
			return;
		}

		if (isVoiceErrorEvent(event)) {
			setVoiceError(event.message);
			setVoiceStatus("error");
		}
	}, [appendVoiceTranscript, setVoiceTranscript, setVoiceConfirmation, setVoiceError, setVoiceStatus, setShowSettingsPanel]);

	const connectVoice = useCallback(() => {
		if (wsConnectingRef.current || wsRef.current) return;

		const token = getAuthToken();
		if (!token) return;

		wsConnectingRef.current = true;
		setVoiceStatus("connecting");
		setVoiceTranscript("");
		setVoiceError(null);

		const ws = new VoiceWebSocket({
			token,
			onMessage: (event: VoiceServerEvent) => {
				handleServerMessage(event);
			},
			onOpen: () => {
				wsConnectingRef.current = false;
				setVoiceStatus("listening");
				setVoiceError(null);
			},
				onClose: () => {
					wsConnectingRef.current = false;
					if (!isMutedRef.current && voiceStatusRef.current !== "disabled") {
					setVoiceStatus("idle");
				}
				wsRef.current = null;
			},
			onError: () => {
				wsConnectingRef.current = false;
				setVoiceError("Connection failed");
				setVoiceStatus("error");
			},
		});

		ws.connect();
		wsRef.current = ws;
	}, [handleServerMessage, setVoiceStatus, setVoiceTranscript, setVoiceError]);

	const startListening = useCallback(async () => {
		if (isMutedRef.current) return;

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
			setVoiceTranscript("");
			setVoiceError(null);
		} catch {
			setVoiceError("Microphone access denied");
			setVoiceStatus("error");
		}
	}, [connectVoice, setVoiceTranscript, setVoiceError, setVoiceStatus]);

	const stopListening = useCallback(() => {
		pipelineRef.current?.stopCapture();
		pipelineRef.current?.stopPlayback();
		wsRef.current?.close();
		wsRef.current = null;
		wsConnectingRef.current = false;
		setAudioBars(new Array(LEVEL_SEGMENTS).fill(false));
		setVoiceStatus("idle");
	}, [setVoiceStatus]);

	const toggleMute = useCallback(() => {
		isMutedRef.current = !isMutedRef.current;
		if (isMutedRef.current) {
			stopListening();
		} else {
			void startListening();
		}
	}, [startListening, stopListening]);

	const handleConfirm = useCallback(() => {
		if (voicePendingConfirmation && wsRef.current?.isConnected()) {
			wsRef.current.send({
				type: "confirm_action",
				confirmationId: voicePendingConfirmation.confirmationId,
			});
		}
	}, [voicePendingConfirmation]);

	const handleCancel = useCallback(() => {
		if (voicePendingConfirmation && wsRef.current?.isConnected()) {
			wsRef.current.send({
				type: "cancel_action",
				confirmationId: voicePendingConfirmation.confirmationId,
			});
		}
		setVoiceConfirmation(null);
		setVoiceStatus("listening");
	}, [voicePendingConfirmation, setVoiceConfirmation, setVoiceStatus]);

	const handleReconnect = useCallback(() => {
		stopListening();
		setVoiceStatus("idle");
		void startListening();
	}, [startListening, stopListening, setVoiceStatus]);

	useEffect(() => {
		return () => {
			pipelineRef.current?.stopCapture();
			pipelineRef.current?.stopPlayback();
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, []);

	const isListening = voiceStatus === "listening" || voiceStatus === "processing" || voiceStatus === "speaking" || voiceStatus === "confirming";
	const isDisabled = voiceStatus === "disabled";

	return (
		<div className="voice-control" data-voice-state={voiceStatus}>
			<div className="voice-header">
				<div className="voice-title">
					<span className="voice-status-dot" />
					<span>Voice</span>
					<span className="voice-status-label">{voiceStatus}</span>
				</div>
				<div className="voice-controls">
					{!isListening && !isDisabled && (
						<button
							type="button"
							className="voice-btn voice-btn--start"
							aria-label="Start listening"
							onClick={startListening}
							disabled={wsConnectingRef.current}
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
					{voiceStatus === "error" && (
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
			</div>

			{(isListening || voiceStatus === "connecting") && (
				<div className="voice-level-bar">
					{audioBars.map((active, i) => (
						<span key={i} className={`voice-level-segment${active ? " voice-level-segment--active" : ""}`} />
					))}
				</div>
			)}

			{voiceTranscript && (
				<div className="voice-transcript">{voiceTranscript}</div>
			)}

			{voicePendingConfirmation && (
				<div className="voice-confirmation">
					<div className="voice-confirmation-text">
						Confirm action: <strong>{voicePendingConfirmation.skill}</strong>?
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

			{voiceError && (
				<div className="voice-error">{voiceError}</div>
			)}

			{isDisabled && (
				<div className="voice-disabled-indicator">Voice is disabled</div>
			)}
		</div>
	);
}
