import { describe, it, expect } from "vitest";
import {
	isVoiceClientMessage,
	isVoiceServerEvent,
	isVoiceAudioFrameMessage,
	isVoiceConfirmActionMessage,
	isVoiceCancelActionMessage,
	isVoiceStopListeningMessage,
	isVoiceStartListeningMessage,
	isVoiceConnectedEvent,
	isVoiceAudioDeltaEvent,
	isVoiceTranscriptDeltaEvent,
	isVoiceTranscriptDoneEvent,
	isVoiceIntentReceivedEvent,
	isVoiceActionResultEvent,
	isVoiceErrorEvent,
	isVoiceSessionTimeoutEvent,
	isValidVoiceSkill,
	isValidFrontendRoute,
	isValidBackendRoute,
	VOICE_SKILLS,
	FRONTEND_ROUTES,
	BACKEND_ROUTES,
	type VoiceClientMessage,
	type VoiceServerEvent,
	type VoiceSkill,
	type FrontendRoute,
	type BackendRoute,
} from "./voiceTypes.js";
import voiceIntentsFixture from "./__fixtures__/voice-intents.json";

describe("voiceTypes", () => {
	describe("VoiceClientMessage type guards", () => {
		it("recognizes audio_frame message", () => {
			const msg = { type: "audio_frame", pcm16Base64: "AUDIO_DATA", sampleRate: 16000 };
			expect(isVoiceClientMessage(msg)).toBe(true);
			if (isVoiceClientMessage(msg)) {
				expect(isVoiceAudioFrameMessage(msg)).toBe(true);
			}
		});

		it("recognizes confirm_action message", () => {
			const msg = { type: "confirm_action", confirmationId: "uuid-123" };
			expect(isVoiceClientMessage(msg)).toBe(true);
			if (isVoiceClientMessage(msg)) {
				expect(isVoiceConfirmActionMessage(msg)).toBe(true);
			}
		});

		it("recognizes cancel_action message", () => {
			const msg = { type: "cancel_action", confirmationId: "uuid-123" };
			expect(isVoiceClientMessage(msg)).toBe(true);
			if (isVoiceClientMessage(msg)) {
				expect(isVoiceCancelActionMessage(msg)).toBe(true);
			}
		});

		it("recognizes stop_listening message", () => {
			const msg = { type: "stop_listening" };
			expect(isVoiceClientMessage(msg)).toBe(true);
			if (isVoiceClientMessage(msg)) {
				expect(isVoiceStopListeningMessage(msg)).toBe(true);
			}
		});

		it("recognizes start_listening message", () => {
			const msg = { type: "start_listening" };
			expect(isVoiceClientMessage(msg)).toBe(true);
			if (isVoiceClientMessage(msg)) {
				expect(isVoiceStartListeningMessage(msg)).toBe(true);
			}
		});

		it("rejects invalid client message types", () => {
			const msg = { type: "invalid_type" };
			expect(isVoiceClientMessage(msg)).toBe(false);
		});

		it("rejects null and undefined", () => {
			expect(isVoiceClientMessage(null)).toBe(false);
			expect(isVoiceClientMessage(undefined)).toBe(false);
		});

		it("rejects non-objects", () => {
			expect(isVoiceClientMessage("audio_frame")).toBe(false);
			expect(isVoiceClientMessage(123)).toBe(false);
		});

		it("rejects server event types", () => {
			const msg = { type: "connected" };
			expect(isVoiceClientMessage(msg)).toBe(false);
		});
	});

	describe("VoiceServerEvent type guards", () => {
		it("recognizes connected event", () => {
			const event = { type: "connected" };
			expect(isVoiceServerEvent(event)).toBe(true);
			if (isVoiceServerEvent(event)) {
				expect(isVoiceConnectedEvent(event)).toBe(true);
			}
		});

		it("recognizes audio_delta event", () => {
			const event = { type: "audio_delta", pcm16Base64: "AUDIO", sampleRate: 24000 };
			expect(isVoiceServerEvent(event)).toBe(true);
			if (isVoiceServerEvent(event)) {
				expect(isVoiceAudioDeltaEvent(event)).toBe(true);
			}
		});

		it("recognizes transcript_delta event", () => {
			const event = { type: "transcript_delta", text: "Hello" };
			expect(isVoiceServerEvent(event)).toBe(true);
			if (isVoiceServerEvent(event)) {
				expect(isVoiceTranscriptDeltaEvent(event)).toBe(true);
			}
		});

		it("recognizes transcript_done event", () => {
			const event = { type: "transcript_done", text: "Hello world" };
			expect(isVoiceServerEvent(event)).toBe(true);
			if (isVoiceServerEvent(event)) {
				expect(isVoiceTranscriptDoneEvent(event)).toBe(true);
			}
		});

		it("recognizes intent_received event", () => {
			const event = {
				type: "intent_received",
				skill: "list_sessions",
				params: { target_name: "local" },
				confirmationRequired: false,
			};
			expect(isVoiceServerEvent(event)).toBe(true);
			if (isVoiceServerEvent(event)) {
				expect(isVoiceIntentReceivedEvent(event)).toBe(true);
			}
		});

		it("recognizes action_result event", () => {
			const event = { type: "action_result", skill: "list_sessions", success: true };
			expect(isVoiceServerEvent(event)).toBe(true);
			if (isVoiceServerEvent(event)) {
				expect(isVoiceActionResultEvent(event)).toBe(true);
			}
		});

		it("recognizes error event", () => {
			const event = { type: "error", code: "voice_disabled", message: "Voice is disabled" };
			expect(isVoiceServerEvent(event)).toBe(true);
			if (isVoiceServerEvent(event)) {
				expect(isVoiceErrorEvent(event)).toBe(true);
			}
		});

		it("recognizes session_timeout event", () => {
			const event = { type: "session_timeout", remainingSeconds: 30 };
			expect(isVoiceServerEvent(event)).toBe(true);
			if (isVoiceServerEvent(event)) {
				expect(isVoiceSessionTimeoutEvent(event)).toBe(true);
			}
		});

		it("rejects invalid server event types", () => {
			const event = { type: "invalid_type" };
			expect(isVoiceServerEvent(event)).toBe(false);
		});

		it("rejects null and undefined", () => {
			expect(isVoiceServerEvent(null)).toBe(false);
			expect(isVoiceServerEvent(undefined)).toBe(false);
		});

		it("rejects non-objects", () => {
			expect(isVoiceServerEvent("connected")).toBe(false);
			expect(isVoiceServerEvent(123)).toBe(false);
		});

		it("rejects client message types", () => {
			const event = { type: "audio_frame" };
			expect(isVoiceServerEvent(event)).toBe(false);
		});
	});

	describe("VoiceSkill validation", () => {
		it("validates known skills", () => {
			expect(isValidVoiceSkill("navigate_frontend")).toBe(true);
			expect(isValidVoiceSkill("invoke_backend_route")).toBe(true);
			expect(isValidVoiceSkill("list_sessions")).toBe(true);
			expect(isValidVoiceSkill("create_session")).toBe(true);
			expect(isValidVoiceSkill("rename_session")).toBe(true);
			expect(isValidVoiceSkill("delete_session")).toBe(true);
			expect(isValidVoiceSkill("send_to_pane")).toBe(true);
			expect(isValidVoiceSkill("confirm_action")).toBe(true);
			expect(isValidVoiceSkill("cancel_action")).toBe(true);
		});

		it("rejects unknown skills", () => {
			expect(isValidVoiceSkill("run_arbitrary_shell")).toBe(false);
			expect(isValidVoiceSkill("execute_command")).toBe(false);
			expect(isValidVoiceSkill("unknown_skill")).toBe(false);
		});

		it("rejects non-string types", () => {
			expect(isValidVoiceSkill(null)).toBe(false);
			expect(isValidVoiceSkill(undefined)).toBe(false);
			expect(isValidVoiceSkill(123)).toBe(false);
			expect(isValidVoiceSkill({})).toBe(false);
		});

		it("VOICE_SKILLS constant contains all 9 skills", () => {
			const skills = Object.values(VOICE_SKILLS);
			expect(skills.length).toBe(9);
			expect(skills).toContain("navigate_frontend");
			expect(skills).toContain("invoke_backend_route");
			expect(skills).toContain("list_sessions");
			expect(skills).toContain("create_session");
			expect(skills).toContain("rename_session");
			expect(skills).toContain("delete_session");
			expect(skills).toContain("send_to_pane");
			expect(skills).toContain("confirm_action");
			expect(skills).toContain("cancel_action");
		});
	});

	describe("FrontendRoute validation", () => {
		it("validates known frontend routes", () => {
			expect(isValidFrontendRoute("home")).toBe(true);
			expect(isValidFrontendRoute("settings")).toBe(true);
			expect(isValidFrontendRoute("projects")).toBe(true);
			expect(isValidFrontendRoute("connections")).toBe(true);
			expect(isValidFrontendRoute("session")).toBe(true);
			expect(isValidFrontendRoute("window")).toBe(true);
			expect(isValidFrontendRoute("pane")).toBe(true);
		});

		it("rejects unknown frontend routes", () => {
			expect(isValidFrontendRoute("unknown")).toBe(false);
			expect(isValidFrontendRoute("admin")).toBe(false);
		});

		it("FRONTEND_ROUTES constant contains all 7 routes", () => {
			const routes = Object.values(FRONTEND_ROUTES);
			expect(routes.length).toBe(7);
		});
	});

	describe("BackendRoute validation", () => {
		it("validates known backend routes", () => {
			expect(isValidBackendRoute("connections.list")).toBe(true);
			expect(isValidBackendRoute("sessions.list")).toBe(true);
			expect(isValidBackendRoute("sessions.create")).toBe(true);
			expect(isValidBackendRoute("sessions.rename")).toBe(true);
			expect(isValidBackendRoute("sessions.delete")).toBe(true);
			expect(isValidBackendRoute("windows.list")).toBe(true);
			expect(isValidBackendRoute("windows.create")).toBe(true);
			expect(isValidBackendRoute("windows.delete")).toBe(true);
			expect(isValidBackendRoute("panes.list")).toBe(true);
			expect(isValidBackendRoute("panes.split")).toBe(true);
			expect(isValidBackendRoute("panes.delete")).toBe(true);
		});

		it("rejects unknown backend routes", () => {
			expect(isValidBackendRoute("sessions.kill")).toBe(false);
			expect(isValidBackendRoute("admin.delete")).toBe(false);
			expect(isValidBackendRoute("unknown.route")).toBe(false);
		});

		it("BACKEND_ROUTES constant contains all 11 routes", () => {
			const routes = Object.values(BACKEND_ROUTES);
			expect(routes.length).toBe(11);
		});
	});

	describe("Fixture validation", () => {
		it("send_to_pane intent fixture is valid", () => {
			const intent = voiceIntentsFixture.send_to_pane_intent;
			expect(isVoiceServerEvent(intent)).toBe(true);
			if (isVoiceServerEvent(intent)) {
				expect(isVoiceIntentReceivedEvent(intent)).toBe(true);
				expect(intent.skill).toBe("send_to_pane");
				expect(intent.confirmationRequired).toBe(true);
				expect(intent.confirmationId).toBeDefined();
			}
		});

		it("delete_session intent fixture is valid", () => {
			const intent = voiceIntentsFixture.delete_session_intent;
			expect(isVoiceServerEvent(intent)).toBe(true);
			if (isVoiceServerEvent(intent)) {
				expect(isVoiceIntentReceivedEvent(intent)).toBe(true);
				expect(intent.skill).toBe("delete_session");
				expect(intent.confirmationRequired).toBe(true);
			}
		});

		it("list_sessions intent fixture is valid and safe", () => {
			const intent = voiceIntentsFixture.list_sessions_intent;
			expect(isVoiceServerEvent(intent)).toBe(true);
			if (isVoiceServerEvent(intent)) {
				expect(isVoiceIntentReceivedEvent(intent)).toBe(true);
				if (isVoiceIntentReceivedEvent(intent)) {
					expect(intent.skill).toBe("list_sessions");
					expect(intent.confirmationRequired).toBe(false);
					expect(intent.confirmationId).toBeUndefined();
				}
			}
		});

		it("navigate_frontend intent fixture is valid", () => {
			const intent = voiceIntentsFixture.navigate_frontend_intent;
			expect(isVoiceServerEvent(intent)).toBe(true);
			if (isVoiceServerEvent(intent)) {
				expect(isVoiceIntentReceivedEvent(intent)).toBe(true);
				expect(intent.skill).toBe("navigate_frontend");
				expect(intent.confirmationRequired).toBe(false);
				expect(intent.params.route).toBe("settings");
				expect(isValidFrontendRoute(intent.params.route)).toBe(true);
			}
		});

		it("unknown skill intent fixture has invalid skill", () => {
			const intent = voiceIntentsFixture.unknown_skill_intent;
			expect(isVoiceServerEvent(intent)).toBe(true);
			if (isVoiceServerEvent(intent)) {
				expect(intent.skill).toBe("run_arbitrary_shell");
				expect(isValidVoiceSkill(intent.skill)).toBe(false);
			}
		});

		it("invalid route intent fixture has route outside allowlist", () => {
			const intent = voiceIntentsFixture.invalid_route_intent;
			expect(isVoiceServerEvent(intent)).toBe(true);
			if (isVoiceServerEvent(intent)) {
				expect(intent.skill).toBe("invoke_backend_route");
				expect(intent.params.route_id).toBe("sessions.kill");
				expect(isValidBackendRoute(intent.params.route_id)).toBe(false);
			}
		});
	});

	describe("Type narrowing", () => {
		it("narrows VoiceClientMessage union correctly", () => {
			const messages: VoiceClientMessage[] = [
				{ type: "audio_frame", pcm16Base64: "AUDIO", sampleRate: 16000 },
				{ type: "confirm_action", confirmationId: "uuid-1" },
				{ type: "cancel_action", confirmationId: "uuid-2" },
				{ type: "stop_listening" },
				{ type: "start_listening" },
			];

			for (const msg of messages) {
				expect(isVoiceClientMessage(msg)).toBe(true);

				if (isVoiceAudioFrameMessage(msg)) {
					expect(msg.pcm16Base64).toBeDefined();
					expect(msg.sampleRate).toBeGreaterThan(0);
				} else if (isVoiceConfirmActionMessage(msg)) {
					expect(msg.confirmationId).toBeDefined();
				} else if (isVoiceCancelActionMessage(msg)) {
					expect(msg.confirmationId).toBeDefined();
				} else if (isVoiceStopListeningMessage(msg)) {
					expect(msg.type).toBe("stop_listening");
				} else if (isVoiceStartListeningMessage(msg)) {
					expect(msg.type).toBe("start_listening");
				}
			}
		});

		it("narrows VoiceServerEvent union correctly", () => {
			const events: VoiceServerEvent[] = [
				{ type: "connected" },
				{ type: "audio_delta", pcm16Base64: "AUDIO", sampleRate: 24000 },
				{ type: "transcript_delta", text: "Hello" },
				{ type: "transcript_done", text: "Hello world" },
				{ type: "intent_received", skill: "list_sessions", params: {}, confirmationRequired: false },
				{ type: "action_result", skill: "list_sessions", success: true },
				{ type: "error", code: "voice_disabled", message: "Voice is disabled" },
				{ type: "session_timeout", remainingSeconds: 30 },
			];

			for (const event of events) {
				expect(isVoiceServerEvent(event)).toBe(true);

				if (isVoiceConnectedEvent(event)) {
					expect(event.type).toBe("connected");
				} else if (isVoiceAudioDeltaEvent(event)) {
					expect(event.pcm16Base64).toBeDefined();
				} else if (isVoiceTranscriptDeltaEvent(event)) {
					expect(event.text).toBeDefined();
				} else if (isVoiceTranscriptDoneEvent(event)) {
					expect(event.text).toBeDefined();
				} else if (isVoiceIntentReceivedEvent(event)) {
					expect(event.skill).toBeDefined();
					expect(event.confirmationRequired).toBeDefined();
				} else if (isVoiceActionResultEvent(event)) {
					expect(event.success).toBeDefined();
				} else if (isVoiceErrorEvent(event)) {
					expect(event.code).toBeDefined();
					expect(event.message).toBeDefined();
				} else if (isVoiceSessionTimeoutEvent(event)) {
					expect(event.remainingSeconds).toBeGreaterThan(0);
				}
			}
		});
	});
});