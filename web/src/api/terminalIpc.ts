import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close" };

export type ServerMessage =
  | { type: "output"; data: string }
  | { type: "status"; status: string }
  | { type: "error"; error: { code: string; message: string } }
  | { type: "close" };

export interface TerminalIpcOptions {
  targetName: string;
  session: string;
  window?: string;
  pane?: string;
  rows?: number;
  cols?: number;
  onMessage: (message: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

export class TerminalIpc {
  private options: TerminalIpcOptions;
  private channel: Channel<string> | null = null;
  private closed = false;
  private unlistenClose: (() => void) | null = null;
  public readonly connectionId: string;

  constructor(options: TerminalIpcOptions) {
    this.options = options;
    this.connectionId = Math.random().toString(36).substring(2, 15);
  }

  async connect(): Promise<void> {
    if (this.closed) {
      return;
    }

    const { targetName, session, window: windowId, pane, rows, cols } = this.options;

    this.channel = new Channel<string>();

    this.channel.onmessage = (message: string) => {
      try {
        const parsed = JSON.parse(message) as ServerMessage;
        this.options.onMessage(parsed);

        if (parsed.type === "status" && parsed.status === "connected") {
          this.options.onOpen?.();
        }
      } catch {
        // Ignore parse errors
      }
    };

    try {
      await invoke("terminal_open", {
        targetName,
        session,
        window: windowId,
        pane,
        cols: cols ?? 80,
        rows: rows ?? 24,
        connectionId: this.connectionId,
        onOutput: this.channel,
      });

      this.unlistenClose = await listen<{ payload: string }>("terminal-closed", (event) => {
        const key = `${targetName}:${session}${pane ? `:${pane}` : ""}:${this.connectionId}`;
        if (event.payload === key) {
          this.options.onClose?.();
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onError?.(err);
      throw error;
    }
  }

  send(message: ClientMessage): void {
    if (this.closed) {
      return;
    }

    if (message.type === "input") {
      void this.sendInput(message.data);
    } else if (message.type === "resize") {
      void this.resize(message.cols, message.rows);
    } else if (message.type === "close") {
      void this.close();
    }
  }

  private async sendInput(data: string): Promise<void> {
    const { targetName, session, pane } = this.options;
    await invoke("terminal_input", {
      targetName,
      session,
      pane,
      connectionId: this.connectionId,
      data,
    });
  }

  async resize(cols: number, rows: number): Promise<void> {
    const { targetName, session, pane } = this.options;
    await invoke("terminal_resize", {
      targetName,
      session,
      pane,
      connectionId: this.connectionId,
      cols,
      rows,
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    const { targetName, session, pane } = this.options;

    try {
      await invoke("terminal_close", {
        targetName,
        session,
        pane,
        connectionId: this.connectionId,
      });
    } catch {
      // Ignore close errors
    }

    this.channel = null;

    if (this.unlistenClose) {
      this.unlistenClose();
      this.unlistenClose = null;
    }
  }

  isConnected(): boolean {
    return this.channel !== null && !this.closed;
  }
}