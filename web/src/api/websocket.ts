export type ClientMessage =
	| { type: "input"; data: string }
	| { type: "resize"; cols: number; rows: number }
	| { type: "close" };

export type ServerMessage =
	| { type: "output"; data: string }
	| { type: "status"; status: string }
	| { type: "error"; error: { code: string; message: string } }
	| { type: "close" };

export interface TerminalWebSocketOptions {
	connectionId: string;
	session: string;
	window?: string;
	pane?: string;
	token: string;
	onMessage: (message: ServerMessage) => void;
	onOpen?: () => void;
	onClose?: () => void;
	onError?: (error: Event) => void;
}

export class TerminalWebSocket {
	private ws: WebSocket | null = null;
	private options: TerminalWebSocketOptions;
	private writeLock = false;
	private writeQueue: ClientMessage[] = [];
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 3;
	private reconnectDelay = 1000;
	private closed = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(options: TerminalWebSocketOptions) {
		this.options = options;
	}

	connect(): void {
		if (this.closed || this.ws) {
			return;
		}

		const { connectionId, session, window: windowId, pane, token } = this.options;
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const host = window.location.host;
		const params = new URLSearchParams();
		params.set("connectionId", connectionId);
		params.set("session", session);
		if (windowId) params.set("window", windowId);
		if (pane) params.set("pane", pane);
		params.set("token", token);
		const url = `${protocol}//${host}/api/terminal?${params.toString()}`;

		this.ws = new WebSocket(url);

		this.ws.onopen = () => {
			this.reconnectAttempts = 0;
			this.options.onOpen?.();
		};

		this.ws.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data as string) as ServerMessage;
				this.options.onMessage(message);
			} catch {
				void 0;
			}
		};

		this.ws.onclose = () => {
			const shouldReconnect = !this.closed;
			this.ws = null;

			if (!shouldReconnect) {
				return;
			}

			this.options.onClose?.();

			if (this.reconnectAttempts < this.maxReconnectAttempts) {
				this.reconnectAttempts++;
				this.reconnectTimer = setTimeout(() => {
					this.reconnectTimer = null;
					this.connect();
				}, this.reconnectDelay * this.reconnectAttempts);
			}
		};

		this.ws.onerror = (event) => {
			this.options.onError?.(event);
		};
	}

	private flushQueue(): void {
		while (this.writeQueue.length > 0) {
			const msg = this.writeQueue.shift();
			if (msg && this.ws && this.ws.readyState === WebSocket.OPEN) {
				this.ws.send(JSON.stringify(msg));
			}
		}
		this.writeLock = false;
	}

	send(message: ClientMessage): void {
		if (this.closed) {
			return;
		}

		if (this.writeLock) {
			this.writeQueue.push(message);
			return;
		}

		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			this.writeQueue.push(message);
			return;
		}

		this.writeLock = true;
		this.ws.send(JSON.stringify(message));
		this.writeLock = false;

		// Process any queued messages
		if (this.writeQueue.length > 0) {
			this.flushQueue();
		}
	}

	close(): void {
		this.closed = true;
		this.writeQueue = [];
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			const ws = this.ws;
			this.ws = null;
			ws.onopen = null;
			ws.onmessage = null;
			ws.onclose = null;
			ws.onerror = null;
			ws.close();
		}
	}

	isConnected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}
}
