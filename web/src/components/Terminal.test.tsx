import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Terminal as XTerm } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "./Terminal.js";
import { TerminalWebSocket } from "../api/websocket.js";
import type { SelectedPane } from "../state/store.js";

const mockXTermWrite = vi.fn();
const mockXTermWriteln = vi.fn();
const mockXTermOpen = vi.fn();
const mockXTermLoadAddon = vi.fn();
const mockXTermDispose = vi.fn();
const mockXTermOnData = vi.fn();
const mockXTermOnResize = vi.fn();
const mockXTermFocus = vi.fn();
const mockXTermResize = vi.fn();
const mockXTermRefresh = vi.fn();
const mockXTermClearTextureAtlas = vi.fn();
const mockFit = vi.fn();
const mockProposeDimensions = vi.fn(() => ({ cols: 120, rows: 40 }));
const mockWsSend = vi.fn();
const mockSetError = vi.fn();
let capturedOnResize: ((size: { cols: number; rows: number }) => void) | null = null;

vi.mock("@xterm/xterm", () => ({
	Terminal: vi.fn().mockImplementation((options) => ({
		cols: 80,
		rows: 24,
		unicode: {
			activeVersion: "6",
		},
		options: { fontSize: options?.fontSize },
		open: mockXTermOpen,
		write: mockXTermWrite,
		writeln: mockXTermWriteln,
		loadAddon: mockXTermLoadAddon,
		dispose: mockXTermDispose,
		onData: mockXTermOnData,
		onResize: vi.fn((callback: (size: { cols: number; rows: number }) => void) => {
			capturedOnResize = callback;
			mockXTermOnResize(callback);
		}),
		focus: mockXTermFocus,
		resize: mockXTermResize,
		refresh: mockXTermRefresh,
		clearTextureAtlas: mockXTermClearTextureAtlas,
	})),
}));

vi.mock("@xterm/addon-fit", () => ({
	FitAddon: vi.fn().mockImplementation(() => ({
		fit: mockFit,
		proposeDimensions: mockProposeDimensions,
	})),
}));

vi.mock("@xterm/addon-unicode11", () => ({
	Unicode11Addon: vi.fn().mockImplementation(() => ({
		activate: vi.fn(),
	})),
}));

vi.mock("@xterm/addon-web-links", () => ({
	WebLinksAddon: vi.fn().mockImplementation(() => ({
		activate: vi.fn(),
	})),
}));

const mockConnect = vi.fn();
const mockClose = vi.fn();
let capturedOnMessage: ((message: { type: string; data?: string; status?: string; error?: { code: string; message: string } }) => void) | null = null;

vi.mock("../api/websocket.js", () => ({
	TerminalWebSocket: vi.fn().mockImplementation((options) => {
		capturedOnMessage = options.onMessage;
		return {
			connect: mockConnect,
			send: mockWsSend,
			close: mockClose,
			isConnected: vi.fn(() => false),
		};
	}),
}));

vi.mock("../state/store.js", () => ({
	useAppState: vi.fn(() => ({
		setError: mockSetError,
		uiSettings: {
			theme: "dark",
			windowTheme: "dark",
			fontSize: 16,
			terminalFontSize: 14,
		},
	})),
}));

const mockSelectedPane: SelectedPane = {
	connectionId: "conn-1",
	session: "dev",
	window: "@1",
	pane: "%1",
};

describe("Terminal", () => {
	beforeEach(() => {
		sessionStorage.clear();
		mockConnect.mockClear();
		mockClose.mockClear();
		mockXTermWrite.mockClear();
		mockXTermWriteln.mockClear();
		mockXTermFocus.mockClear();
		mockXTermResize.mockClear();
		mockXTermRefresh.mockClear();
		mockXTermClearTextureAtlas.mockClear();
		mockFit.mockClear();
		mockProposeDimensions.mockClear();
		mockWsSend.mockClear();
		mockSetError.mockClear();
		capturedOnResize = null;
		capturedOnMessage = null;
		vi.mocked(TerminalWebSocket).mockClear();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	test("renders terminal container", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);
		expect(screen.getByTestId("terminal")).toBeInTheDocument();
	});

	test("creates WebSocket connection when auth token exists in sessionStorage", () => {
		sessionStorage.setItem("wmux-auth-token", "test-token");
		render(<Terminal selectedPane={mockSelectedPane} />);

		expect(TerminalWebSocket).toHaveBeenCalledTimes(1);
		expect(mockConnect).toHaveBeenCalledTimes(1);
		const callArgs = vi.mocked(TerminalWebSocket).mock.calls[0]![0];
		expect(callArgs.token).toBe("test-token");
	});

	test("creates WebSocket connection even when auth token is missing from sessionStorage", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);

		expect(TerminalWebSocket).toHaveBeenCalledTimes(1);
		expect(mockConnect).toHaveBeenCalledTimes(1);
		const callArgs = vi.mocked(TerminalWebSocket).mock.calls[0]![0];
		expect(callArgs.token).toBe("");
		expect(screen.queryByText("Authentication token not found")).not.toBeInTheDocument();
	});

	test("passes correct pane parameters to WebSocket", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);

		const callArgs = vi.mocked(TerminalWebSocket).mock.calls[0]![0];
		expect(callArgs.connectionId).toBe("conn-1");
		expect(callArgs.session).toBe("dev");
		expect(callArgs.window).toBe("@1");
		expect(callArgs.pane).toBe("%1");
	});

	test("passes fitted dimensions to WebSocket for the initial PTY size", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);

		const callArgs = vi.mocked(TerminalWebSocket).mock.calls[0]![0];
		expect(mockProposeDimensions).toHaveBeenCalled();
		expect(mockFit).not.toHaveBeenCalled();
		expect(callArgs.cols).toBe(118);
		expect(callArgs.rows).toBe(39);
	});

	test("uses fitted dimensions when tmux pane is wider than the viewport", () => {
		render(<Terminal selectedPane={mockSelectedPane} sourceSize={{ cols: 160, rows: 45 }} />);

		const callArgs = vi.mocked(TerminalWebSocket).mock.calls[0]![0];
		expect(mockXTermResize).toHaveBeenCalledWith(118, 39);
		expect(callArgs.cols).toBe(118);
		expect(callArgs.rows).toBe(39);
	});

	test("redraws terminal after fitting the viewport", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);

		expect(mockXTermClearTextureAtlas).toHaveBeenCalled();
		expect(mockXTermRefresh).toHaveBeenCalledWith(0, 23);
	});

	test("does not recreate WebSocket when pane identifiers are unchanged", () => {
		const { rerender } = render(<Terminal selectedPane={mockSelectedPane} />);

		rerender(<Terminal selectedPane={{ ...mockSelectedPane }} />);

		expect(TerminalWebSocket).toHaveBeenCalledTimes(1);
		expect(mockClose).not.toHaveBeenCalled();
	});

	test("does not resend duplicate terminal resize dimensions", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);

		expect(capturedOnResize).not.toBeNull();
		capturedOnResize!({ cols: 118, rows: 39 });

		expect(mockWsSend).not.toHaveBeenCalled();
	});

	test("sends terminal resize when dimensions change", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);

		expect(capturedOnResize).not.toBeNull();
		capturedOnResize!({ cols: 119, rows: 39 });

		expect(mockWsSend).toHaveBeenCalledTimes(1);
		expect(mockWsSend).toHaveBeenCalledWith({ type: "resize", cols: 119, rows: 39 });
	});

test("uses Unicode 11 width tables for CJK terminal output", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);

		const xtermOptions = vi.mocked(XTerm).mock.calls[0]![0]!;
		const xtermInstance = vi.mocked(XTerm).mock.results[0]!.value;
		const unicodeAddon = vi.mocked(Unicode11Addon).mock.results[0]!.value;

		expect(xtermOptions.allowProposedApi).toBe(true);
		expect(xtermOptions.scrollback).toBe(0);
		expect(Unicode11Addon).toHaveBeenCalledTimes(1);
		expect(mockXTermLoadAddon).toHaveBeenCalledWith(unicodeAddon);
		expect(xtermInstance.unicode.activeVersion).toBe("11");
	});

	test("uses the mapped palette for non-default window themes", () => {
		render(<Terminal selectedPane={mockSelectedPane} windowTheme="light" />);

		const xtermOptions = vi.mocked(XTerm).mock.calls[0]![0]!;
		expect(xtermOptions.theme).toMatchObject({
			background: "#f1eeee",
			cursor: "#007aff",
			blue: "#007aff",
		});
	});

	test("applies the terminal theme background to the wrapper", () => {
		render(<Terminal selectedPane={mockSelectedPane} windowTheme="light" />);

		expect(screen.getByTestId("terminal-wrapper").style.getPropertyValue("--terminal-background")).toBe("#f1eeee");
	});

	test("writes output data to xterm when receiving output message", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);

		expect(capturedOnMessage).not.toBeNull();
		capturedOnMessage!({ type: "output", data: "hello world" });

		expect(mockXTermWrite).toHaveBeenCalledTimes(1);
		expect(mockXTermWrite).toHaveBeenCalledWith("hello world");
	});

	test("does not write connection status messages into the terminal buffer", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);

		capturedOnMessage!({ type: "status", status: "connected" });

		expect(mockXTermWriteln).not.toHaveBeenCalled();
	});
});
