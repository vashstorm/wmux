// @deprecated Use TerminalIpc from ./terminalIpc.js instead. This WebSocket-based implementation
// is kept for reference only and will be removed in a future version.
// The IPC-based TerminalIpc provides better integration with Tauri and removes the need for
// token-based authentication (authentication is handled automatically by Tauri's invoke system).
import { getWebSocketUrl } from "./runtime.js"

export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close" }

export type ServerMessage =
  | { type: "output"; data: string }
  | { type: "status"; status: string }
  | { type: "error"; error: { code: string; message: string } }
  | { type: "close" }

export interface TerminalWebSocketOptions {
  targetName: string
  session: string
  window?: string
  pane?: string
  rows?: number
  cols?: number
  token: string
  onMessage: (message: ServerMessage) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: { event: Event; target: string; readyState: number }) => void
}

export class TerminalWebSocket {
  private ws: WebSocket | null = null
  private options: TerminalWebSocketOptions
  private writeQueue: ClientMessage[] = []
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private baseDelay = 1000
  private maxDelay = 30000
  private closed = false
  private disconnected = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: TerminalWebSocketOptions) {
    this.options = options
  }

  connect(): void {
    if (this.closed || this.disconnected || this.ws) {
      return
    }

    const { targetName, session, window: windowId, pane, rows, cols, token } = this.options
    const params = new URLSearchParams()
    params.set("targetName", targetName)
    params.set("session", session)
    if (windowId) params.set("window", windowId)
    if (pane) params.set("pane", pane)
    if (isPositiveInteger(rows)) params.set("rows", String(rows))
    if (isPositiveInteger(cols)) params.set("cols", String(cols))
    params.set("token", token)
    const url = getWebSocketUrl("/api/terminal", params)

    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      if (this.reconnectAttempts > 0) {
        this.flushQueue()
      }
      this.reconnectAttempts = 0
      this.options.onOpen?.()
    }

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as ServerMessage
        this.options.onMessage(message)
      } catch {
        void 0
      }
    }

    this.ws.onclose = () => {
      const shouldReconnect = !this.closed && !this.disconnected
      this.ws = null

      if (!shouldReconnect) {
        return
      }

      this.options.onClose?.()

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++
        const base = Math.min(
          this.baseDelay * Math.pow(2, this.reconnectAttempts - 1),
          this.maxDelay,
        )
        const delay = base * (0.5 + Math.random() * 0.5)
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          this.connect()
        }, delay)
      }
    }

    this.ws.onerror = (event) => {
      const errInfo = {
        event,
        target: "ws",
        readyState: this.ws ? this.ws.readyState : -1,
      }
      this.options.onError?.(errInfo)
    }
  }

  private flushQueue(): void {
    while (this.writeQueue.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg = this.writeQueue.shift()
      if (msg) {
        this.ws.send(JSON.stringify(msg))
      }
    }
  }

  send(message: ClientMessage): void {
    if (this.closed) {
      return
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.writeQueue.push(message)
      return
    }

    this.ws.send(JSON.stringify(message))
    this.flushQueue()
  }

  disconnect(): void {
    this.disconnected = true
    this.close()
  }

  close(): void {
    this.closed = true
    this.writeQueue = []
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      const ws = this.ws
      this.ws = null
      ws.onopen = null
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
      ws.close()
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }
}

function isPositiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0
}
