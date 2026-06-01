import { describe, it, expect } from "vitest"
import {
  isOmniClientMessage,
  isOmniServerEvent,
  isVoiceAudioFrameMessage,
  isVoiceTextMessage,
  isVoiceConfirmActionMessage,
  isVoiceCancelActionMessage,
  isVoiceStopListeningMessage,
  isVoiceStartListeningMessage,
  isVoiceStopResponseMessage,
  isVoiceSessionContextMessage,
  isVoiceConnectedEvent,
  isVoiceAudioDeltaEvent,
  isVoiceTranscriptDeltaEvent,
  isVoiceTranscriptDoneEvent,
  isVoiceIntentReceivedEvent,
  isVoiceActionResultEvent,
  isVoiceAssistantMessageEvent,
  isVoiceAssistantDeltaEvent,
  isVoiceErrorEvent,
  isVoiceSessionTimeoutEvent,
  isVoiceTokenUsageEvent,
  isValidVoiceSkill,
  isValidFrontendRoute,
  isValidBackendRoute,
  FRONTEND_ROUTES,
  BACKEND_ROUTES,
  type OmniClientMessage,
  type OmniServerEvent,
  type FrontendRoute,
  type BackendRoute,
} from "./voiceTypes.js"
import voiceIntentsFixture from "./__fixtures__/voice-intents.json"

describe("voiceTypes", () => {
  describe("OmniClientMessage type guards", () => {
    it("recognizes audio_frame message", () => {
      const msg = { type: "audio_frame", pcm16Base64: "AUDIO_DATA", sampleRate: 16000 }
      expect(isOmniClientMessage(msg)).toBe(true)
      if (isOmniClientMessage(msg)) {
        expect(isVoiceAudioFrameMessage(msg)).toBe(true)
      }
    })

    it("recognizes confirm_action message", () => {
      const msg = { type: "confirm_action", confirmationId: "uuid-123" }
      expect(isOmniClientMessage(msg)).toBe(true)
      if (isOmniClientMessage(msg)) {
        expect(isVoiceConfirmActionMessage(msg)).toBe(true)
      }
    })

    it("recognizes text_message message", () => {
      const msg = { type: "text_message", text: "hello" }
      expect(isOmniClientMessage(msg)).toBe(true)
      if (isOmniClientMessage(msg)) {
        expect(isVoiceTextMessage(msg)).toBe(true)
      }
    })

    it("recognizes session_context message", () => {
      const msg = { type: "session_context", target: { targetName: "local", session: "main" } }
      expect(isOmniClientMessage(msg)).toBe(true)
      if (isOmniClientMessage(msg)) {
        expect(isVoiceSessionContextMessage(msg)).toBe(true)
      }
    })

    it("recognizes cancel_action message", () => {
      const msg = { type: "cancel_action", confirmationId: "uuid-123" }
      expect(isOmniClientMessage(msg)).toBe(true)
      if (isOmniClientMessage(msg)) {
        expect(isVoiceCancelActionMessage(msg)).toBe(true)
      }
    })

    it("recognizes stop_listening message", () => {
      const msg = { type: "stop_listening" }
      expect(isOmniClientMessage(msg)).toBe(true)
      if (isOmniClientMessage(msg)) {
        expect(isVoiceStopListeningMessage(msg)).toBe(true)
      }
    })

    it("recognizes start_listening message", () => {
      const msg = { type: "start_listening" }
      expect(isOmniClientMessage(msg)).toBe(true)
      if (isOmniClientMessage(msg)) {
        expect(isVoiceStartListeningMessage(msg)).toBe(true)
      }
    })

    it("recognizes stop_response message", () => {
      const msg = { type: "stop_response" }
      expect(isOmniClientMessage(msg)).toBe(true)
      if (isOmniClientMessage(msg)) {
        expect(isVoiceStopResponseMessage(msg)).toBe(true)
      }
    })

    it("rejects invalid client message types", () => {
      const msg = { type: "invalid_type" }
      expect(isOmniClientMessage(msg)).toBe(false)
    })

    it("rejects null and undefined", () => {
      expect(isOmniClientMessage(null)).toBe(false)
      expect(isOmniClientMessage(undefined)).toBe(false)
    })

    it("rejects non-objects", () => {
      expect(isOmniClientMessage("audio_frame")).toBe(false)
      expect(isOmniClientMessage(123)).toBe(false)
    })

    it("rejects server event types", () => {
      const msg = { type: "connected" }
      expect(isOmniClientMessage(msg)).toBe(false)
    })
  })

  describe("OmniServerEvent type guards", () => {
    it("recognizes connected event", () => {
      const event = { type: "connected" }
      expect(isOmniServerEvent(event)).toBe(true)
      if (isOmniServerEvent(event)) {
        expect(isVoiceConnectedEvent(event)).toBe(true)
      }
    })

    it("recognizes audio_delta event", () => {
      const event = { type: "audio_delta", pcm16Base64: "AUDIO", sampleRate: 24000 }
      expect(isOmniServerEvent(event)).toBe(true)
      if (isOmniServerEvent(event)) {
        expect(isVoiceAudioDeltaEvent(event)).toBe(true)
      }
    })

    it("recognizes transcript_delta event", () => {
      const event = { type: "transcript_delta", text: "Hello" }
      expect(isOmniServerEvent(event)).toBe(true)
      if (isOmniServerEvent(event)) {
        expect(isVoiceTranscriptDeltaEvent(event)).toBe(true)
      }
    })

    it("recognizes transcript_done event", () => {
      const event = { type: "transcript_done", text: "Hello world" }
      expect(isOmniServerEvent(event)).toBe(true)
      if (isOmniServerEvent(event)) {
        expect(isVoiceTranscriptDoneEvent(event)).toBe(true)
      }
    })

    it("recognizes intent_received event", () => {
      const event = {
        type: "intent_received",
        skill: "list_sessions",
        params: { target_name: "local" },
        confirmationRequired: false,
      }
      expect(isOmniServerEvent(event)).toBe(true)
      if (isOmniServerEvent(event)) {
        expect(isVoiceIntentReceivedEvent(event)).toBe(true)
      }
    })

    it("recognizes action_result event", () => {
      const event = { type: "action_result", skill: "list_sessions", success: true }
      expect(isOmniServerEvent(event)).toBe(true)
      if (isOmniServerEvent(event)) {
        expect(isVoiceActionResultEvent(event)).toBe(true)
      }
    })

    it("recognizes assistant_message event", () => {
      const event = { type: "assistant_message", text: "Done" }
      expect(isOmniServerEvent(event)).toBe(true)
      if (isOmniServerEvent(event)) {
        expect(isVoiceAssistantMessageEvent(event)).toBe(true)
      }
    })

    it("recognizes assistant_delta event", () => {
      const event = { type: "assistant_delta", text: "Don" }
      expect(isOmniServerEvent(event)).toBe(true)
      if (isOmniServerEvent(event)) {
        expect(isVoiceAssistantDeltaEvent(event)).toBe(true)
      }
    })

    it("recognizes error event", () => {
      const event = { type: "error", code: "voice_disabled", message: "Voice is disabled" }
      expect(isOmniServerEvent(event)).toBe(true)
      if (isOmniServerEvent(event)) {
        expect(isVoiceErrorEvent(event)).toBe(true)
      }
    })

    it("recognizes session_timeout event", () => {
      const event = { type: "session_timeout", remainingSeconds: 30 }
      expect(isOmniServerEvent(event)).toBe(true)
      if (isOmniServerEvent(event)) {
        expect(isVoiceSessionTimeoutEvent(event)).toBe(true)
      }
    })

    it("recognizes token_usage event", () => {
      const event = {
        type: "token_usage",
        usage: { inputTokens: 120, outputTokens: 35, totalTokens: 155 },
      }
      expect(isOmniServerEvent(event)).toBe(true)
      if (isOmniServerEvent(event)) {
        expect(isVoiceTokenUsageEvent(event)).toBe(true)
      }
    })

    it("rejects invalid server event types", () => {
      const event = { type: "invalid_type" }
      expect(isOmniServerEvent(event)).toBe(false)
    })

    it("rejects null and undefined", () => {
      expect(isOmniServerEvent(null)).toBe(false)
      expect(isOmniServerEvent(undefined)).toBe(false)
    })

    it("rejects non-objects", () => {
      expect(isOmniServerEvent("connected")).toBe(false)
      expect(isOmniServerEvent(123)).toBe(false)
    })

    it("rejects client message types", () => {
      const event = { type: "audio_frame" }
      expect(isOmniServerEvent(event)).toBe(false)
    })
  })

  describe("VoiceSkill validation", () => {
    it("validates known skills", () => {
      expect(isValidVoiceSkill("navigate_frontend")).toBe(true)
      expect(isValidVoiceSkill("invoke_backend_route")).toBe(true)
      expect(isValidVoiceSkill("list_sessions")).toBe(true)
      expect(isValidVoiceSkill("create_session")).toBe(true)
      expect(isValidVoiceSkill("rename_session")).toBe(true)
      expect(isValidVoiceSkill("delete_session")).toBe(true)
      expect(isValidVoiceSkill("send_to_pane")).toBe(true)
      expect(isValidVoiceSkill("confirm_action")).toBe(true)
      expect(isValidVoiceSkill("cancel_action")).toBe(true)
      expect(isValidVoiceSkill("new_chat")).toBe(true)
    })

    it("rejects non-string types", () => {
      expect(isValidVoiceSkill(null)).toBe(false)
      expect(isValidVoiceSkill(undefined)).toBe(false)
      expect(isValidVoiceSkill(123)).toBe(false)
      expect(isValidVoiceSkill({})).toBe(false)
    })
  })

  describe("FrontendRoute validation", () => {
    it("validates known frontend routes", () => {
      expect(isValidFrontendRoute("home")).toBe(true)
      expect(isValidFrontendRoute("settings")).toBe(true)
      expect(isValidFrontendRoute("projects")).toBe(true)
      expect(isValidFrontendRoute("connections")).toBe(true)
      expect(isValidFrontendRoute("session")).toBe(true)
      expect(isValidFrontendRoute("window")).toBe(true)
      expect(isValidFrontendRoute("pane")).toBe(true)
      expect(isValidFrontendRoute("stats")).toBe(true)
      expect(isValidFrontendRoute("ai_logs")).toBe(true)
    })

    it("rejects unknown frontend routes", () => {
      expect(isValidFrontendRoute("unknown")).toBe(false)
      expect(isValidFrontendRoute("admin")).toBe(false)
    })

    it("FRONTEND_ROUTES constant contains all 9 routes", () => {
      const routes = Object.values(FRONTEND_ROUTES)
      expect(routes.length).toBe(9)
    })
  })

  describe("BackendRoute validation", () => {
    it("validates known backend routes", () => {
      expect(isValidBackendRoute("connections.list")).toBe(true)
      expect(isValidBackendRoute("sessions.list")).toBe(true)
      expect(isValidBackendRoute("sessions.create")).toBe(true)
      expect(isValidBackendRoute("sessions.rename")).toBe(true)
      expect(isValidBackendRoute("sessions.delete")).toBe(true)
      expect(isValidBackendRoute("sessions.analyze")).toBe(true)
      expect(isValidBackendRoute("windows.list")).toBe(true)
      expect(isValidBackendRoute("windows.create")).toBe(true)
      expect(isValidBackendRoute("windows.delete")).toBe(true)
      expect(isValidBackendRoute("panes.list")).toBe(true)
      expect(isValidBackendRoute("panes.split")).toBe(true)
      expect(isValidBackendRoute("panes.delete")).toBe(true)
      expect(isValidBackendRoute("projects.list")).toBe(true)
      expect(isValidBackendRoute("projects.create")).toBe(true)
      expect(isValidBackendRoute("projects.update")).toBe(true)
      expect(isValidBackendRoute("projects.delete")).toBe(true)
      expect(isValidBackendRoute("projects.launch")).toBe(true)
      expect(isValidBackendRoute("projects.sync_from_tmux")).toBe(true)
      expect(isValidBackendRoute("projects.generate_ai_html")).toBe(true)
      expect(isValidBackendRoute("tmux_analysis.list")).toBe(true)
      expect(isValidBackendRoute("tmux_analysis.cleanup")).toBe(true)
      expect(isValidBackendRoute("ai_logs.list")).toBe(true)
      expect(isValidBackendRoute("ai_logs.clear")).toBe(true)
    })

    it("rejects unknown backend routes", () => {
      expect(isValidBackendRoute("sessions.kill")).toBe(false)
      expect(isValidBackendRoute("admin.delete")).toBe(false)
      expect(isValidBackendRoute("unknown.route")).toBe(false)
    })

    it("BACKEND_ROUTES constant contains all 23 routes", () => {
      const routes = Object.values(BACKEND_ROUTES)
      expect(routes.length).toBe(23)
    })
  })

  describe("Fixture validation", () => {
    it("send_to_pane intent fixture is valid", () => {
      const intent = voiceIntentsFixture.send_to_pane_intent
      expect(isOmniServerEvent(intent)).toBe(true)
      if (isOmniServerEvent(intent)) {
        expect(isVoiceIntentReceivedEvent(intent)).toBe(true)
        expect(intent.skill).toBe("send_to_pane")
        expect(intent.confirmationRequired).toBe(true)
        expect(intent.confirmationId).toBeDefined()
      }
    })

    it("delete_session intent fixture is valid", () => {
      const intent = voiceIntentsFixture.delete_session_intent
      expect(isOmniServerEvent(intent)).toBe(true)
      if (isOmniServerEvent(intent)) {
        expect(isVoiceIntentReceivedEvent(intent)).toBe(true)
        expect(intent.skill).toBe("delete_session")
        expect(intent.confirmationRequired).toBe(true)
      }
    })

    it("list_sessions intent fixture is valid and safe", () => {
      const intent = voiceIntentsFixture.list_sessions_intent
      expect(isOmniServerEvent(intent)).toBe(true)
      if (isOmniServerEvent(intent)) {
        expect(isVoiceIntentReceivedEvent(intent)).toBe(true)
        if (isVoiceIntentReceivedEvent(intent)) {
          expect(intent.skill).toBe("list_sessions")
          expect(intent.confirmationRequired).toBe(false)
          expect(intent.confirmationId).toBeUndefined()
        }
      }
    })

    it("navigate_frontend intent fixture is valid", () => {
      const intent = voiceIntentsFixture.navigate_frontend_intent
      expect(isOmniServerEvent(intent)).toBe(true)
      if (isOmniServerEvent(intent)) {
        expect(isVoiceIntentReceivedEvent(intent)).toBe(true)
        expect(intent.skill).toBe("navigate_frontend")
        expect(intent.confirmationRequired).toBe(false)
        expect(intent.params.route).toBe("settings")
        expect(isValidFrontendRoute(intent.params.route)).toBe(true)
      }
    })

    it("unknown skill intent fixture has skill as string", () => {
      const intent = voiceIntentsFixture.unknown_skill_intent
      expect(isOmniServerEvent(intent)).toBe(true)
      if (isOmniServerEvent(intent)) {
        expect(intent.skill).toBe("run_arbitrary_shell")
        expect(isValidVoiceSkill(intent.skill)).toBe(true)
      }
    })

    it("invalid route intent fixture has route outside allowlist", () => {
      const intent = voiceIntentsFixture.invalid_route_intent
      expect(isOmniServerEvent(intent)).toBe(true)
      if (isOmniServerEvent(intent)) {
        expect(intent.skill).toBe("invoke_backend_route")
        expect(intent.params.route_id).toBe("sessions.kill")
        expect(isValidBackendRoute(intent.params.route_id)).toBe(false)
      }
    })
  })

  describe("Type narrowing", () => {
    it("narrows OmniClientMessage union correctly", () => {
      const messages: OmniClientMessage[] = [
        { type: "audio_frame", pcm16Base64: "AUDIO", sampleRate: 16000 },
        { type: "session_context", target: { targetName: "local", session: "main" } },
        { type: "confirm_action", confirmationId: "uuid-1" },
        { type: "cancel_action", confirmationId: "uuid-2" },
        { type: "stop_listening" },
        { type: "start_listening" },
      ]

      for (const msg of messages) {
        expect(isOmniClientMessage(msg)).toBe(true)

        if (isVoiceAudioFrameMessage(msg)) {
          expect(msg.pcm16Base64).toBeDefined()
          expect(msg.sampleRate).toBeGreaterThan(0)
        } else if (isVoiceSessionContextMessage(msg)) {
          expect(msg.target.targetName).toBe("local")
        } else if (isVoiceConfirmActionMessage(msg)) {
          expect(msg.confirmationId).toBeDefined()
        } else if (isVoiceCancelActionMessage(msg)) {
          expect(msg.confirmationId).toBeDefined()
        } else if (isVoiceStopListeningMessage(msg)) {
          expect(msg.type).toBe("stop_listening")
        } else if (isVoiceStartListeningMessage(msg)) {
          expect(msg.type).toBe("start_listening")
        }
      }
    })

    it("narrows OmniServerEvent union correctly", () => {
      const events: OmniServerEvent[] = [
        { type: "connected" },
        { type: "audio_delta", pcm16Base64: "AUDIO", sampleRate: 24000 },
        { type: "transcript_delta", text: "Hello" },
        { type: "transcript_done", text: "Hello world" },
        {
          type: "intent_received",
          skill: "list_sessions",
          params: {},
          confirmationRequired: false,
        },
        { type: "action_result", skill: "list_sessions", success: true },
        { type: "assistant_delta", text: "Don" },
        { type: "error", code: "voice_disabled", message: "Voice is disabled" },
        { type: "session_timeout", remainingSeconds: 30 },
        { type: "token_usage", usage: { inputTokens: 120, outputTokens: 35, totalTokens: 155 } },
      ]

      for (const event of events) {
        expect(isOmniServerEvent(event)).toBe(true)

        if (isVoiceConnectedEvent(event)) {
          expect(event.type).toBe("connected")
        } else if (isVoiceAudioDeltaEvent(event)) {
          expect(event.pcm16Base64).toBeDefined()
        } else if (isVoiceTranscriptDeltaEvent(event)) {
          expect(event.text).toBeDefined()
        } else if (isVoiceTranscriptDoneEvent(event)) {
          expect(event.text).toBeDefined()
        } else if (isVoiceIntentReceivedEvent(event)) {
          expect(event.skill).toBeDefined()
          expect(event.confirmationRequired).toBeDefined()
        } else if (isVoiceActionResultEvent(event)) {
          expect(event.success).toBeDefined()
        } else if (isVoiceErrorEvent(event)) {
          expect(event.code).toBeDefined()
          expect(event.message).toBeDefined()
        } else if (isVoiceSessionTimeoutEvent(event)) {
          expect(event.remainingSeconds).toBeGreaterThan(0)
        } else if (isVoiceTokenUsageEvent(event)) {
          expect(event.usage.totalTokens).toBeGreaterThan(0)
        }
      }
    })
  })
})
