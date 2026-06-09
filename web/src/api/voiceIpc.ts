/**
 * Voice IPC client using Tauri invoke/Channel instead of WebSocket.
 *
 * This class provides the same interface as OmniWebSocket but uses
 * Tauri IPC for communication, keeping the DashScope API key in the backend.
 */

import { invoke, Channel } from "@tauri-apps/api/core";
import type { OmniClientMessage, OmniServerEvent } from "./voiceTypes.js";

export interface OmniIpcOptions {
    /** Callback for received server events */
    onMessage: (event: OmniServerEvent) => void;
    /** Called when connection is established */
    onOpen?: () => void;
    /** Called when connection is closed */
    onClose?: () => void;
    /** Called on connection error */
    onError?: (error: Error) => void;
}

export interface VoiceClientConfig {
    /** Target tmux connection name */
    target_name?: string;
    /** Session name if known */
    session?: string;
    /** Window name if known */
    window?: string;
    /** Pane index if known */
    pane?: string;
    /** Connection type (e.g., "local") */
    connection_type?: string;
}

/**
 * IPC-based voice client replacing OmniWebSocket.
 *
 * Uses Tauri invoke for client->server messages and Channel for
 * server->client events, keeping the API key in the backend.
 */
export class OmniIpc {
    private options: OmniIpcOptions;
    private connected = false;
    private closing = false;
    private writeLock = false;
    private writeQueue: OmniClientMessage[] = [];

    constructor(options: OmniIpcOptions) {
        this.options = options;
    }

    /**
     * Connect to voice service via IPC Channel.
     * Opens a voice session in the backend with the DashScope WebSocket.
     */
    async connect(config?: VoiceClientConfig): Promise<void> {
        if (this.connected || this.closing) {
            return;
        }

        try {
            const channel = new Channel<OmniServerEvent>();

            channel.onmessage = (event: OmniServerEvent) => {
                if (event.type === "connected") {
                    this.connected = true;
                    this.flushQueue();
                    this.options.onOpen?.();
                }

                this.options.onMessage(event);
            };

            await invoke("voice_open", { config: config ?? {}, onEvent: channel });
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.options.onError?.(err);
            throw error;
        }
    }

    /**
     * Send a client message to the voice session.
     * Uses invoke to send messages to the backend.
     */
    send(message: OmniClientMessage): void {
        if (this.closing) {
            return;
        }

        if (!this.connected) {
            this.writeQueue.push(message);
            return;
        }

        if (this.writeLock) {
            this.writeQueue.push(message);
            return;
        }

        this.writeLock = true;

        invoke("voice_send", { message })
            .then(() => {
                this.writeLock = false;
                if (this.writeQueue.length > 0) {
                    this.flushQueue();
                }
            })
            .catch((error) => {
                this.writeLock = false;
                const err = error instanceof Error ? error : new Error(String(error));
                this.options.onError?.(err);
            });
    }

    /**
     * Close the voice session gracefully.
     */
    async close(): Promise<void> {
        if (this.closing) {
            return;
        }

        this.closing = true;
        this.writeQueue = [];

try {
            await invoke("voice_close", {});
        } catch {
        } finally {
            this.connected = false;
            this.closing = false;
            this.options.onClose?.();
        }
    }

    /**
     * Check if currently connected.
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Flush queued messages after connection is established.
     */
    private flushQueue(): void {
        while (this.writeQueue.length > 0) {
            const msg = this.writeQueue.shift();
            if (msg) {
                this.send(msg);
            }
        }
    }
}