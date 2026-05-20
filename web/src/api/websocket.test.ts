import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { TerminalWebSocket } from "./websocket.js";

describe("TerminalWebSocket", () => {
	let mockWs: {
		readyState: number;
		send: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
		onopen: (() => void) | null;
		onmessage: ((event: { data: string }) => void) | null;
		onclose: (() => void) | null;
		onerror: ((event: Event) => void) | null;
	};

	beforeEach(() => {
		vi.useFakeTimers();
		mockWs = {
			readyState: WebSocket.CONNECTING,
			send: vi.fn(),
			close: vi.fn(),
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
		};
		vi.stubGlobal(
			"WebSocket",
			vi.fn(() => mockWs),
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		delete window.__WMUX_RUNTIME__;
	});

	function createSocket(overrides?: Partial<ConstructorParameters<typeof TerminalWebSocket>[0]>) {
		return new TerminalWebSocket({
			targetName: "conn-1",
			session: "dev",
			window: "win-1",
			pane: "%1",
			token: "secret",
			onMessage: vi.fn(),
			...overrides,
		});
	}

	test("constructs correct WebSocket URL", () => {
		const socket = createSocket({ rows: 40, cols: 120 });
		socket.connect();

		const call = vi.mocked(WebSocket).mock.calls[0]!;
		const url = call[0] as string;
		expect(url).toContain("targetName=conn-1");
		expect(url).toContain("session=dev");
		expect(url).toContain("window=win-1");
		expect(url).toContain("pane=%251");
		expect(url).toContain("rows=40");
		expect(url).toContain("cols=120");
		expect(url).toContain("token=secret");
	});

	test("constructs WebSocket URL from Tauri runtime base URL", () => {
		window.__WMUX_RUNTIME__ = {
			baseUrl: "http://127.0.0.1:7331",
			token: "runtime-token",
		};
		const socket = createSocket();

		socket.connect();

		const call = vi.mocked(WebSocket).mock.calls[0]!;
		const url = call[0] as string;
		expect(url).toContain("ws://127.0.0.1:7331/api/terminal?");
		expect(url).toContain("token=secret");
	});

	test("omits invalid terminal dimensions from WebSocket URL", () => {
		const socket = createSocket({ rows: 0, cols: -1 });
		socket.connect();

		const call = vi.mocked(WebSocket).mock.calls[0]!;
		const url = call[0] as string;
		expect(url).not.toContain("rows=");
		expect(url).not.toContain("cols=");
	});

	test("constructs WebSocket URL with empty token", () => {
		const socket = createSocket({ token: "" });
		socket.connect();

		const call = vi.mocked(WebSocket).mock.calls[0]!;
		const url = call[0] as string;
		expect(url).toContain("token=");
		expect(url).not.toContain("token=secret");
	});

	test("calls onOpen when connection opens", () => {
		const onOpen = vi.fn();
		const socket = createSocket({ onOpen });
		socket.connect();

		mockWs.readyState = WebSocket.OPEN;
		mockWs.onopen?.();
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	test("calls onMessage when message received", () => {
		const onMessage = vi.fn();
		const socket = createSocket({ onMessage });
		socket.connect();

		mockWs.onmessage?.({ data: JSON.stringify({ type: "output", data: "hello" }) });
		expect(onMessage).toHaveBeenCalledWith({ type: "output", data: "hello" });
	});

	test("calls onClose when connection closes", () => {
		const onClose = vi.fn();
		const socket = createSocket({ onClose });
		socket.connect();

		mockWs.onclose?.();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	test("calls onError on error", () => {
		const onError = vi.fn();
		const socket = createSocket({ onError });
		socket.connect();

		const event = new Event("error");
		mockWs.onerror?.(event);
		expect(onError).toHaveBeenCalledWith(event);
	});

	test("queues messages before connection is open", () => {
		const socket = createSocket();
		socket.connect();

		socket.send({ type: "input", data: "ls\n" });
		expect(mockWs.send).not.toHaveBeenCalled();

		mockWs.readyState = WebSocket.OPEN;
		mockWs.onopen?.();
		socket.send({ type: "input", data: "trigger" });
		expect(mockWs.send).toHaveBeenCalled();
	});

	test("sends immediately when connected", () => {
		const socket = createSocket();
		socket.connect();

		mockWs.readyState = WebSocket.OPEN;
		mockWs.onopen?.();
		socket.send({ type: "input", data: "pwd\n" });
		expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "pwd\n" }));
	});

	test("flushes queued messages in order", () => {
		const socket = createSocket();
		socket.connect();

		socket.send({ type: "input", data: "1" });
		socket.send({ type: "input", data: "2" });
		socket.send({ type: "input", data: "3" });

		mockWs.readyState = WebSocket.OPEN;
		mockWs.onopen?.();
		socket.send({ type: "input", data: "trigger" });

		expect(mockWs.send).toHaveBeenCalledTimes(4);
		expect(mockWs.send.mock.calls[0]![0]).toBe(JSON.stringify({ type: "input", data: "trigger" }));
		expect(mockWs.send.mock.calls[1]![0]).toBe(JSON.stringify({ type: "input", data: "1" }));
		expect(mockWs.send.mock.calls[2]![0]).toBe(JSON.stringify({ type: "input", data: "2" }));
		expect(mockWs.send.mock.calls[3]![0]).toBe(JSON.stringify({ type: "input", data: "3" }));
	});

	test("attempts reconnect with exponential backoff", () => {
		const socket = createSocket();
		socket.connect();

		mockWs.readyState = WebSocket.OPEN;
		mockWs.onopen?.();

		mockWs.onclose?.();
		expect(WebSocket).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1000);
		expect(WebSocket).toHaveBeenCalledTimes(2);

		mockWs.onclose?.();
		vi.advanceTimersByTime(2000);
		expect(WebSocket).toHaveBeenCalledTimes(3);
	});

	test("stops reconnecting after max attempts", () => {
		const socket = createSocket();
		socket.connect();

		mockWs.readyState = WebSocket.OPEN;
		mockWs.onopen?.();

		for (let i = 0; i < 4; i++) {
			mockWs.onclose?.();
			vi.advanceTimersByTime(1000 * (i + 1));
		}

		mockWs.onclose?.();
		vi.advanceTimersByTime(10000);
		expect(WebSocket).toHaveBeenCalledTimes(4);
	});

	test("close prevents reconnect", () => {
		const socket = createSocket();
		socket.connect();

		mockWs.readyState = WebSocket.OPEN;
		mockWs.onopen?.();

		socket.close();
		mockWs.onclose?.();
		vi.advanceTimersByTime(10000);
		expect(WebSocket).toHaveBeenCalledTimes(1);
	});

	test("close does not call onClose for intentional shutdown", () => {
		const onClose = vi.fn();
		const socket = createSocket({ onClose });
		socket.connect();

		socket.close();
		mockWs.onclose?.();

		expect(onClose).not.toHaveBeenCalled();
	});

	test("close cancels pending reconnect", () => {
		const socket = createSocket();
		socket.connect();

		mockWs.onclose?.();
		socket.close();

		vi.advanceTimersByTime(10000);
		expect(WebSocket).toHaveBeenCalledTimes(1);
	});

	test("connect is ignored after close", () => {
		const socket = createSocket();
		socket.connect();
		socket.close();

		socket.connect();

		expect(WebSocket).toHaveBeenCalledTimes(1);
	});

	test("close clears queue", () => {
		const socket = createSocket();
		socket.connect();

		socket.send({ type: "input", data: "test" });
		socket.close();

		mockWs.readyState = WebSocket.OPEN;
		mockWs.onopen?.();
		expect(mockWs.send).not.toHaveBeenCalled();
	});

	test("isConnected returns true only when OPEN", () => {
		const socket = createSocket();
		expect(socket.isConnected()).toBe(false);

		socket.connect();
		expect(socket.isConnected()).toBe(false);

		mockWs.readyState = WebSocket.OPEN;
		mockWs.onopen?.();
		expect(socket.isConnected()).toBe(true);

		mockWs.onclose?.();
		expect(socket.isConnected()).toBe(false);
	});
});
