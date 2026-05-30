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
}));

vi.mock("../api/client.js", () => ({
	getConfig: vi.fn(),
	getOmniHistory: vi.fn(),
}));

vi.mock("../api/voiceClient.js", () => ({
	OmniWebSocket: vi.fn().mockImplementation(() => ({
		connect: voiceClientMocks.connect,
		send: voiceClientMocks.send,
		close: voiceClientMocks.close,
		isConnected: () => true,
	})),
}));

beforeEach(() => {
	voiceClientMocks.send.mockClear();
	voiceClientMocks.connect.mockClear();
	voiceClientMocks.close.mockClear();
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
});
