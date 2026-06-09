import { describe, test, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: vi.fn().mockImplementation(() => ({
    onmessage: null,
  })),
}))

const { invoke, Channel } = await import("@tauri-apps/api/core")
const { OmniIpc } = await import("./voiceIpc.js")

describe("OmniIpc", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("connect calls voice_open with channel and config", async () => {
    const onMessage = vi.fn()
    const onOpen = vi.fn()
    const ipc = new OmniIpc({ onMessage, onOpen })

    await ipc.connect({ target_name: "local", session: "test" })

    expect(Channel).toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith("voice_open", {
      config: { target_name: "local", session: "test" },
      onEvent: expect.any(Object),
    })
  })

  test("send calls voice_send with message", async () => {
    const onMessage = vi.fn()
    const ipc = new OmniIpc({ onMessage })

    // Simulate connected state
    ;(ipc as unknown as { connected: boolean }).connected = true

    ipc.send({ type: "text_message", text: "hello" } as never)

    expect(invoke).toHaveBeenCalledWith("voice_send", {
      message: { type: "text_message", text: "hello" },
    })
  })

  test("close calls voice_close", async () => {
    const onMessage = vi.fn()
    const onClose = vi.fn()
    const ipc = new OmniIpc({ onMessage, onClose })

    await ipc.close()

    expect(invoke).toHaveBeenCalledWith("voice_close", {})
    expect(onClose).toHaveBeenCalled()
  })

  test("isConnected returns correct state", () => {
    const onMessage = vi.fn()
    const ipc = new OmniIpc({ onMessage })

    expect(ipc.isConnected()).toBe(false)
  })
})
