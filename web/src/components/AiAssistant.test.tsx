import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AiAssistant } from "./AiAssistant.js";
import { AppProvider, useAppState } from "../state/store.js";
import { useEffect } from "react";
import * as client from "../api/client.js";

const voiceClientMocks = vi.hoisted(() => ({
	send: vi.fn(),
	connect: vi.fn(),
	close: vi.fn(),
	onMessage: undefined as ((event: unknown) => void) | undefined,
}));

const audioPipelineMocks = vi.hoisted(() => ({
	enqueuePlayback: vi.fn(),
	startCapture: vi.fn(),
	stopCapture: vi.fn(),
	stopPlayback: vi.fn(),
}));

vi.mock("../api/client.js", () => ({
	getConfig: vi.fn(),
	getOmniHistory: vi.fn(),
	clearOmniHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../api/voiceClient.js", () => ({
	OmniWebSocket: vi.fn().mockImplementation((options: { onMessage?: (event: unknown) => void }) => {
		voiceClientMocks.onMessage = options.onMessage;
		return {
			connect: voiceClientMocks.connect,
			send: voiceClientMocks.send,
			close: voiceClientMocks.close,
			isConnected: () => true,
		};
	}),
}));

vi.mock("../api/audioPipeline.js", () => ({
	AudioPipeline: vi.fn().mockImplementation(() => ({
		enqueuePlayback: audioPipelineMocks.enqueuePlayback,
		startCapture: audioPipelineMocks.startCapture,
		stopCapture: audioPipelineMocks.stopCapture,
		stopPlayback: audioPipelineMocks.stopPlayback,
	})),
}));

beforeEach(() => {
	voiceClientMocks.send.mockClear();
	voiceClientMocks.connect.mockClear();
	voiceClientMocks.close.mockClear();
	voiceClientMocks.onMessage = undefined;
	audioPipelineMocks.enqueuePlayback.mockClear();
	audioPipelineMocks.startCapture.mockClear();
	audioPipelineMocks.stopCapture.mockClear();
	audioPipelineMocks.stopPlayback.mockClear();
	vi.mocked(client.getConfig).mockResolvedValue({
		schemaVersion: 1,
		path: ".",
		server: { bind: "127.0.0.1:7331" },
		auth: { token: "", tokenConfigured: false },
		tmux: { path: "tmux" },
		connections: [],
		ui: {
			theme: "dark",
			windowTheme: "dark",
			terminalFontSize: 14,
			terminalFontWeight: "normal",
		},
		intelligence: {
			enabled: false,
			providers: [],
			maxBytes: 4096,
			timeoutSec: 30,
			minSessionIntervalSec: 60,
			maxConcurrency: 2,
			cacheTTLSec: 300,
		},
			omni: {
			enabled: true,
			dashscopeApiKeyConfigured: false,
			microphoneDisabled: false,
			model: "qwen-omni",
			endpoint: "wss://example.com",
			continuousListening: false,
			storeRawAudio: false,
			vadEnabled: true,
			vadThreshold: 50,
		},
	});
	vi.mocked(client.getOmniHistory).mockResolvedValue([]);
});

function renderWithProvider() {
	return render(
		<AppProvider>
			<AiAssistant />
		</AppProvider>,
	);
}

function showAssistant() {
	fireEvent.click(screen.getByRole("button", { name: "Show AI Assistant" }));
}

function setupStateSetup(effectFn: (ctx: ReturnType<typeof useAppState>) => void) {
	return function Component() {
		const ctx = useAppState();
		useEffect(() => { effectFn(ctx); }, []);
		return null;
	};
}

function renderWithStateSetup(effectFn: (ctx: ReturnType<typeof useAppState>) => void) {
	const Setup = setupStateSetup(effectFn);
	return render(
		<AppProvider>
			<Setup />
			<AiAssistant />
		</AppProvider>,
	);
}

describe("AiAssistant", () => {
	test("shows disabled state by default", () => {
		renderWithProvider();
		showAssistant();
		const el = document.querySelector("[data-ai-assistant-state]");
		expect(el?.getAttribute("data-ai-assistant-state")).toBe("disabled");
	});

	test("shows start button when idle", () => {
		renderWithStateSetup((ctx) => {
			ctx.setOmniStatus("idle");
		});
		showAssistant();

		const el = document.querySelector("[data-ai-assistant-state]");
		expect(el?.getAttribute("data-ai-assistant-state")).toBe("idle");
	});

	test("shows transcript when present", () => {
		renderWithStateSetup((ctx) => {
			ctx.setOmniTranscript("hello world");
		});
		showAssistant();

		expect(screen.getByText("hello world")).toBeInTheDocument();
	});

	test("shows error message when omniError is set", () => {
		renderWithStateSetup((ctx) => {
			ctx.setOmniStatus("error");
			ctx.setOmniError("Microphone access denied");
		});
		showAssistant();

		expect(screen.getByText("Microphone access denied")).toBeInTheDocument();
	});

	test("shows confirmation prompt when omniPendingConfirmation is set", () => {
		renderWithStateSetup((ctx) => {
			ctx.setOmniStatus("confirming");
			ctx.setOmniConfirmation({ confirmationId: "c1", skill: "send_to_pane" });
		});
		showAssistant();

		expect(screen.getByText(/Confirm action:/)).toBeInTheDocument();
		expect(screen.getByText("send_to_pane")).toBeInTheDocument();
		expect(screen.getByText("Confirm")).toBeInTheDocument();
		expect(screen.getByText("Cancel")).toBeInTheDocument();
	});

	test("shows disabled indicator when voice is disabled", () => {
		renderWithProvider();
		showAssistant();
		expect(screen.getByText("Voice is disabled")).toBeInTheDocument();
	});

	test("shows status label matching omniStatus", () => {
		renderWithStateSetup((ctx) => {
			ctx.setOmniStatus("listening");
		});
		showAssistant();

		expect(screen.getByText("listening")).toBeInTheDocument();
	});

	test("shows mic disabled message when microphoneDisabled is true", async () => {
		vi.mocked(client.getConfig).mockResolvedValueOnce({
			schemaVersion: 1,
			path: ".",
			server: { bind: "127.0.0.1:7331" },
			auth: { token: "", tokenConfigured: false },
			tmux: { path: "tmux" },
			connections: [],
			ui: {
				theme: "dark",
				windowTheme: "dark",
				terminalFontSize: 14,
				terminalFontWeight: "normal",
			},
			intelligence: {
				enabled: false,
				providers: [],
				maxBytes: 4096,
				timeoutSec: 30,
				minSessionIntervalSec: 60,
				maxConcurrency: 2,
				cacheTTLSec: 300,
			},
				omni: {
				enabled: true,
				dashscopeApiKeyConfigured: false,
				microphoneDisabled: true,
				model: "qwen-omni",
				endpoint: "wss://example.com",
				continuousListening: false,
				storeRawAudio: false,
				vadEnabled: true,
				vadThreshold: 50,
			},
		});
		renderWithProvider();
		showAssistant();
		const msg = await screen.findByText("Microphone disabled in Settings");
		expect(msg).toBeInTheDocument();
	});

	test("start button is disabled when microphone is disabled", async () => {
		vi.mocked(client.getConfig).mockResolvedValueOnce({
			schemaVersion: 1,
			path: ".",
			server: { bind: "127.0.0.1:7331" },
			auth: { token: "", tokenConfigured: false },
			tmux: { path: "tmux" },
			connections: [],
			ui: {
				theme: "dark",
				windowTheme: "dark",
				terminalFontSize: 14,
				terminalFontWeight: "normal",
			},
			intelligence: {
				enabled: false,
				providers: [],
				maxBytes: 4096,
				timeoutSec: 30,
				minSessionIntervalSec: 60,
				maxConcurrency: 2,
				cacheTTLSec: 300,
			},
				omni: {
				enabled: true,
				dashscopeApiKeyConfigured: false,
				microphoneDisabled: true,
				model: "qwen-omni",
				endpoint: "wss://example.com",
				continuousListening: false,
				storeRawAudio: false,
				vadEnabled: true,
				vadThreshold: 50,
			},
		});
		renderWithStateSetup((ctx) => {
			ctx.setOmniStatus("idle");
		});
		showAssistant();
		const btn = await screen.findByRole("button", { name: /start listening/i });
		expect(btn).toBeDisabled();
	});

	test("shows history list when messages are loaded", async () => {
		vi.mocked(client.getOmniHistory).mockResolvedValueOnce([
			{
				id: "msg-1",
				conversationId: "default",
				role: "user",
				kind: "transcript",
				text: "hello there",
				createdAt: "2026-05-28T10:00:00Z",
			},
			{
				id: "msg-2",
				conversationId: "default",
				role: "assistant",
				kind: "action_result",
				text: "Executed: open_file",
				createdAt: "2026-05-28T10:00:05Z",
			},
		]);
		renderWithProvider();
		showAssistant();
		expect(await screen.findByText("hello there")).toBeInTheDocument();
		expect(screen.getByText("Executed: open_file")).toBeInTheDocument();
		expect(screen.getByText("You")).toBeInTheDocument();
		expect(screen.getByText("AI")).toBeInTheDocument();
	});

	test("sends typed text messages", () => {
		renderWithStateSetup((ctx) => {
			ctx.setOmniStatus("idle");
		});
		showAssistant();

		fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
			target: { value: "show sessions" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		expect(screen.getByText("show sessions")).toBeInTheDocument();
		expect(voiceClientMocks.send).toHaveBeenCalledWith({
			type: "text_message",
			text: "show sessions",
		});
	});

	test("sends current connection context before typed text messages", () => {
		renderWithStateSetup((ctx) => {
			ctx.setConnections([{ id: "local", targetName: "local", type: "local" }]);
			ctx.setSelectedTargetName("local");
			ctx.setSelectedPane({ targetName: "local", session: "main", window: "@1", pane: "%2" });
			ctx.setOmniStatus("idle");
		});
		showAssistant();

		fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
			target: { value: "新建 Session, hana" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		expect(voiceClientMocks.send).toHaveBeenNthCalledWith(1, {
			type: "session_context",
			target: {
				targetName: "local",
				session: "main",
				window: "@1",
				pane: "%2",
			},
			connectionType: "local",
		});
		expect(voiceClientMocks.send).toHaveBeenNthCalledWith(2, {
			type: "text_message",
			text: "新建 Session, hana",
		});
	});

	test("sends typed text messages when wmux auth token is empty on localhost", () => {
		sessionStorage.removeItem("wmux-auth-token");
		renderWithStateSetup((ctx) => {
			ctx.setOmniStatus("idle");
		});
		showAssistant();

		fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
			target: { value: "show sessions" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		expect(screen.queryByText("Authentication token is missing")).not.toBeInTheDocument();
		expect(screen.getByText("show sessions")).toBeInTheDocument();
		expect(voiceClientMocks.send).toHaveBeenCalledWith({
			type: "text_message",
			text: "show sessions",
		});
	});

	test("plays audio replies during typed text conversations", () => {
		renderWithStateSetup((ctx) => {
			ctx.setOmniStatus("idle");
		});
		showAssistant();

		fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
			target: { value: "say hello" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		voiceClientMocks.onMessage?.({
			type: "audio_delta",
			pcm16Base64: "AAAA",
			sampleRate: 24000,
		});

		expect(audioPipelineMocks.enqueuePlayback).toHaveBeenCalledWith("AAAA", 24000);
	});

	test("can show and hide the full assistant", () => {
		renderWithProvider();

		// Default state: assistant is hidden, only launcher button visible
		const launcher = screen.getByRole("button", { name: "Show AI Assistant" });
		expect(launcher).toBeInTheDocument();
		expect(document.querySelector(".ai-assistant")).toBeNull();

		fireEvent.click(launcher);
		expect(document.querySelector(".ai-assistant")).not.toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Hide AI Assistant" }));
		expect(document.querySelector(".ai-assistant")).toBeNull();
	});

	test("clears history when new chat button is clicked", async () => {
		vi.mocked(client.getOmniHistory).mockResolvedValueOnce([
			{
				id: "msg-1",
				conversationId: "default",
				role: "user",
				kind: "transcript",
				text: "old message",
				createdAt: "2026-05-28T10:00:00Z",
			},
		]);
		renderWithProvider();
		showAssistant();

		expect(await screen.findByText("old message")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "New chat" }));

		expect(client.clearOmniHistory).toHaveBeenCalledOnce();
		await screen.findByText("Ask AI with your voice");
		expect(screen.queryByText("old message")).not.toBeInTheDocument();
	});
});
