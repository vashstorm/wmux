import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

vi.mock("@xterm/xterm", () => ({
	Terminal: vi.fn().mockImplementation(() => ({
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
		fit: vi.fn(),
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
