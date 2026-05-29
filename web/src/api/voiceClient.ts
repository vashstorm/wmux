import { getWebSocketUrl } from "./runtime.js";
import type { OmniClientMessage, OmniServerEvent } from "./voiceTypes.js";

export interface OmniWebSocketOptions {
	token: string;
	onMessage: (event: OmniServerEvent) => void;
	onOpen?: () => void;
	onClose?: () => void;
	onError?: (error: Event) => void;
}

export class OmniWebSocket {
	private ws: WebSocket | null = null;
	private options: OmniWebSocketOptions;
	private writeLock = false;
	private writeQueue: OmniClientMessage[] = [];
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 3;
	private reconnectDelay = 1000;
	private closed = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(options: OmniWebSocketOptions) {
		this.options = options;
	}

	connect(): void {
		if (this.closed || this.ws) {
			return;
		}

		const { token } = this.options;
		const params = new URLSearchParams();
		params.set("token", token);
		const url = getWebSocketUrl("/api/voice", params);

		this.ws = new WebSocket(url);

		this.ws.onopen = () => {
			this.reconnectAttempts = 0;
			this.options.onOpen?.();
		};

		this.ws.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data as string) as OmniServerEvent;
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

	send(message: OmniClientMessage): void {
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

	getReconnectAttempts(): number {
		return this.reconnectAttempts;
	}
}
