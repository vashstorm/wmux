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
const mockFit = vi.fn();
const mockProposeDimensions = vi.fn(() => ({ cols: 120, rows: 40 }));

vi.mock("@xterm/xterm", () => ({
	Terminal: vi.fn().mockImplementation(() => ({
		cols: 80,
		rows: 24,
		unicode: {
			activeVersion: "6",
		},
		open: mockXTermOpen,
		write: mockXTermWrite,
		writeln: mockXTermWriteln,
		loadAddon: mockXTermLoadAddon,
		dispose: mockXTermDispose,
		onData: mockXTermOnData,
		onResize: mockXTermOnResize,
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
			close: mockClose,
			isConnected: vi.fn(() => false),
		};
	}),
}));

vi.mock("../state/store.js", () => ({
	useAppState: vi.fn(() => ({
		setError: vi.fn(),
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
		mockFit.mockClear();
		mockProposeDimensions.mockClear();
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
		expect(mockFit).toHaveBeenCalled();
		expect(callArgs.cols).toBe(120);
		expect(callArgs.rows).toBe(40);
	});

	test("uses Unicode 11 width tables for CJK terminal output", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);

		const xtermOptions = vi.mocked(XTerm).mock.calls[0]![0]!;
		const xtermInstance = vi.mocked(XTerm).mock.results[0]!.value;
		const unicodeAddon = vi.mocked(Unicode11Addon).mock.results[0]!.value;

		expect(xtermOptions.allowProposedApi).toBe(true);
		expect(Unicode11Addon).toHaveBeenCalledTimes(1);
		expect(mockXTermLoadAddon).toHaveBeenCalledWith(unicodeAddon);
		expect(xtermInstance.unicode.activeVersion).toBe("11");
	});

	test("writes output data to xterm when receiving output message", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);

		expect(capturedOnMessage).not.toBeNull();
		capturedOnMessage!({ type: "output", data: "hello world" });

		expect(mockXTermWrite).toHaveBeenCalledTimes(1);
		expect(mockXTermWrite).toHaveBeenCalledWith("hello world");
	});

	test("writes status message to xterm when receiving status message", () => {
		render(<Terminal selectedPane={mockSelectedPane} />);

		capturedOnMessage!({ type: "status", status: "connected" });

		expect(mockXTermWriteln).toHaveBeenCalledWith("\r\n[status: connected]\r\n");
	});
});
