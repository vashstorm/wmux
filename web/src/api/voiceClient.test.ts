import { describe, test, expect, vi, beforeEach } from "vitest"
import { OmniWebSocket } from "./voiceClient.js"

function mockWebSocket(url: string) {
  const ws: {
    url: string
    readyState: number
    onopen: ((ev: Event) => void) | null
    onmessage: ((ev: MessageEvent) => void) | null
    onclose: ((ev: CloseEvent) => void) | null
    onerror: ((ev: Event) => void) | null
    send: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  } = {
    url,
    readyState: WebSocket.OPEN,
    onopen: null as ((ev: Event) => void) | null,
    onmessage: null as ((ev: MessageEvent) => void) | null,
    onclose: null as ((ev: CloseEvent) => void) | null,
    onerror: null as ((ev: Event) => void) | null,
    send: vi.fn(),
    close: vi.fn(),
  }
  const MockWebSocket = vi.fn().mockImplementation((u: string) => {
    ws.url = u
    return ws
  }) as unknown as typeof WebSocket
  Object.defineProperty(MockWebSocket, "CONNECTING", { value: 0 })
  Object.defineProperty(MockWebSocket, "OPEN", { value: 1 })
  Object.defineProperty(MockWebSocket, "CLOSING", { value: 2 })
  Object.defineProperty(MockWebSocket, "CLOSED", { value: 3 })
  global.WebSocket = MockWebSocket
  return ws
}

describe("OmniWebSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  test("connects to /api/voice with token", () => {
    const ws = mockWebSocket("")
    const onMessage = vi.fn()
    const client = new OmniWebSocket({
      token: "test-token",
      onMessage,
    })
    client.connect()

    expect(global.WebSocket).toHaveBeenCalledWith(expect.stringContaining("/api/voice"))
    expect(global.WebSocket).toHaveBeenCalledWith(expect.stringContaining("token=test-token"))
  })

  test("calls onOpen when connection opens", () => {
    const ws = mockWebSocket("")
    const onOpen = vi.fn()
    const client = new OmniWebSocket({
      token: "t",
      onMessage: vi.fn(),
      onOpen,
    })
    client.connect()
    ws.onopen?.(new Event("open"))

    expect(onOpen).toHaveBeenCalledOnce()
  })

  test("parses and dispatches server events", () => {
    const ws = mockWebSocket("")
    const onMessage = vi.fn()
    const client = new OmniWebSocket({
      token: "t",
      onMessage,
    })
    client.connect()

    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "connected" }),
      }),
    )

    expect(onMessage).toHaveBeenCalledWith({ type: "connected" })
  })

  test("sends audio_frame messages", () => {
    const ws = mockWebSocket("")
    const client = new OmniWebSocket({
      token: "t",
      onMessage: vi.fn(),
    })
    client.connect()
    ws.onopen?.(new Event("open"))

    client.send({ type: "audio_frame", pcm16Base64: "abc123", sampleRate: 16000 })

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "audio_frame", pcm16Base64: "abc123", sampleRate: 16000 }),
    )
  })

  test("sends confirm_action messages", () => {
    const ws = mockWebSocket("")
    const client = new OmniWebSocket({
      token: "t",
      onMessage: vi.fn(),
    })
    client.connect()
    ws.onopen?.(new Event("open"))

    client.send({ type: "confirm_action", confirmationId: "conf-1" })

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "confirm_action", confirmationId: "conf-1" }),
    )
  })

  test("queues messages when socket is not open", () => {
    const ws = mockWebSocket("")
    ws.readyState = 0
    const client = new OmniWebSocket({
      token: "t",
      onMessage: vi.fn(),
    })
    client.connect()

    client.send({ type: "audio_frame", pcm16Base64: "xyz", sampleRate: 16000 })
    expect(ws.send).not.toHaveBeenCalled()

    ws.readyState = WebSocket.OPEN
    ws.onopen?.(new Event("open"))
    client.send({ type: "stop_listening" })

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "audio_frame", pcm16Base64: "xyz", sampleRate: 16000 }),
    )
  })

  test("flushes queued messages when connection opens", () => {
    const ws = mockWebSocket("")
    ws.readyState = WebSocket.CONNECTING
    const client = new OmniWebSocket({
      token: "t",
      onMessage: vi.fn(),
    })
    client.connect()

    client.send({ type: "text_message", text: "show sessions" })
    expect(ws.send).not.toHaveBeenCalled()

    ws.readyState = WebSocket.OPEN
    ws.onopen?.(new Event("open"))

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "text_message", text: "show sessions" }),
    )
  })

  test("does not send after close", () => {
    const ws = mockWebSocket("")
    const client = new OmniWebSocket({
      token: "t",
      onMessage: vi.fn(),
    })
    client.connect()
    client.close()

    client.send({ type: "stop_listening" })
    expect(ws.send).not.toHaveBeenCalled()
  })

  test("isConnected returns correct state", () => {
    const ws = mockWebSocket("")
    const client = new OmniWebSocket({
      token: "t",
      onMessage: vi.fn(),
    })
    expect(client.isConnected()).toBe(false)

    client.connect()
    ws.onopen?.(new Event("open"))
    expect(client.isConnected()).toBe(true)
  })

  test("reconnects on close with linear backoff", () => {
    const ws1 = mockWebSocket("")
    const onClose = vi.fn()
    const onOpen = vi.fn()
    const client = new OmniWebSocket({
      token: "t",
      onMessage: vi.fn(),
      onClose,
      onOpen,
    })
    client.connect()

    ws1.readyState = WebSocket.CLOSED
    ws1.onclose?.(new CloseEvent("close"))

    expect(onClose).toHaveBeenCalledOnce()
    expect(client.getReconnectAttempts()).toBe(1)

    vi.advanceTimersByTime(1000)
    const ws2 = mockWebSocket("")
    expect(onOpen).not.toHaveBeenCalled()
  })
})
