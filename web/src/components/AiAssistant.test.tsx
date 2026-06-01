import { describe, test, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { AiAssistant } from "./AiAssistant.js"
import { LAUNCHER_POS_CHANGE_EVENT } from "./AiAssistantUtils.js"
import { AppProvider, useAppState } from "../state/store.js"
import { useEffect } from "react"
import type { OmniStatus } from "../state/store.js"
import * as client from "../api/client.js"

const voiceClientMocks = vi.hoisted(() => ({
  send: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  onMessage: undefined as ((event: unknown) => void) | undefined,
  onOpen: undefined as (() => void) | undefined,
}))

const audioPipelineMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  enqueuePlayback: vi.fn(),
  startCapture: vi.fn(),
  stopCapture: vi.fn(),
  stopPlayback: vi.fn(),
}))

vi.mock("../api/client.js", () => ({
  getConfig: vi.fn(),
  getOmniHistory: vi.fn(),
  clearOmniHistory: vi.fn().mockResolvedValue(undefined),
  getProject: vi.fn(),
  listPanes: vi.fn(),
  listProjects: vi.fn(),
  listSessions: vi.fn(),
  listWindows: vi.fn(),
}))

vi.mock("../api/voiceClient.js", () => ({
  OmniWebSocket: vi
    .fn()
    .mockImplementation(
      (options: { onMessage?: (event: unknown) => void; onOpen?: () => void }) => {
        voiceClientMocks.onMessage = options.onMessage
        voiceClientMocks.onOpen = options.onOpen
        return {
          connect: voiceClientMocks.connect,
          send: voiceClientMocks.send,
          close: voiceClientMocks.close,
          isConnected: () => true,
        }
      },
    ),
}))

vi.mock("../api/audioPipeline.js", () => ({
  AudioPipeline: vi.fn().mockImplementation((config: unknown) => {
    audioPipelineMocks.constructor(config)
    return {
      enqueuePlayback: audioPipelineMocks.enqueuePlayback,
      startCapture: audioPipelineMocks.startCapture,
      stopCapture: audioPipelineMocks.stopCapture,
      stopPlayback: audioPipelineMocks.stopPlayback,
    }
  }),
}))

beforeEach(() => {
  localStorage.removeItem("wmux-ai-assistant-size")
  localStorage.removeItem("wmux-launcher-pos")
  voiceClientMocks.send.mockClear()
  voiceClientMocks.connect.mockClear()
  voiceClientMocks.close.mockClear()
  voiceClientMocks.onMessage = undefined
  voiceClientMocks.onOpen = undefined
  audioPipelineMocks.constructor.mockClear()
  audioPipelineMocks.enqueuePlayback.mockClear()
  audioPipelineMocks.startCapture.mockClear()
  audioPipelineMocks.stopCapture.mockClear()
  audioPipelineMocks.stopPlayback.mockClear()
  vi.mocked(client.clearOmniHistory).mockClear()
  vi.mocked(client.getConfig).mockResolvedValue({
    schemaVersion: 1,
    path: ".",
    server: { bind: "127.0.0.1:7331" },
    auth: { token: "", tokenConfigured: false },
    tmux: { path: "tmux" },
    connections: [],
    ui: {
      theme: "dark",
      windowTheme: "dark",
      terminalFontSize: 14,
      terminalFontWeight: "normal",
    },
    intelligence: {
      enabled: false,
      providers: [],
      maxBytes: 4096,
      timeoutSec: 30,
      minSessionIntervalSec: 60,
      maxConcurrency: 2,
      cacheTTLSec: 300,
    },
    omni: {
      enabled: true,
      dashscopeApiKeyConfigured: false,
      microphoneDisabled: false,
      model: "qwen-omni",
      endpoint: "wss://example.com",
      continuousListening: false,
      storeRawAudio: false,
      vadEnabled: true,
      vadThreshold: 0.5,
    },
  })
  vi.mocked(client.getOmniHistory).mockResolvedValue([])
  vi.mocked(client.getProject).mockResolvedValue({
    id: "proj-1",
    name: "Project One",
    path: "/tmp/project-one",
    description: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    sessionName: "project-one",
    status: "idle",
    workdir: "",
    layoutJson: "",
    detailsJson: "",
    progressJson: "",
    aiHtml: "",
    aiStatus: "",
    aiError: "",
    lastSyncedAt: null,
    schemaVersion: 1,
  })
  vi.mocked(client.listProjects).mockResolvedValue([])
  vi.mocked(client.listSessions).mockResolvedValue({
    targetName: "local",
    mode: "local",
    data: [{ name: "dev" }],
  })
  vi.mocked(client.listWindows).mockResolvedValue({
    targetName: "local",
    session: "dev",
    mode: "local",
    data: [
      {
        ID: "@1",
        Name: "editor",
        Index: 0,
        Active: true,
        PaneCount: 1,
        ActivePaneID: "%1",
        ActivePaneTitle: "bash",
      },
    ],
  })
  vi.mocked(client.listPanes).mockResolvedValue({
    targetName: "local",
    session: "dev",
    window: "@1",
    mode: "local",
    data: [
      {
        ID: "%1",
        Title: "bash",
        Index: 0,
        Active: true,
        Width: 80,
        Height: 24,
        Left: 0,
        Top: 0,
      },
    ],
  })
})

function renderWithProvider() {
  return render(
    <AppProvider>
      <ShowAi />
      <AiAssistant />
    </AppProvider>,
  )
}

function ShowAi() {
  const { setShowAiAssistant } = useAppState()
  useEffect(() => {
    setShowAiAssistant(true)
  }, [setShowAiAssistant])
  return null
}

function setupStateSetup(effectFn: (ctx: ReturnType<typeof useAppState>) => void) {
  return function Component() {
    const ctx = useAppState()
    useEffect(() => {
      effectFn(ctx)
    }, [])
    return null
  }
}

function renderWithStateSetup(effectFn: (ctx: ReturnType<typeof useAppState>) => void) {
  const Setup = setupStateSetup(effectFn)
  return render(
    <AppProvider>
      <Setup />
      <AiAssistant />
    </AppProvider>,
  )
}

function StateProbe() {
  const { selectedPane, selectedProject } = useAppState()
  return (
    <>
      <div data-testid="selected-pane">
        {selectedPane
          ? `${selectedPane.targetName}/${selectedPane.session}/${selectedPane.window ?? ""}/${selectedPane.pane ?? ""}`
          : "none"}
      </div>
      <div data-testid="selected-project">{selectedProject?.id ?? "none"}</div>
    </>
  )
}

function renderWithStateSetupAndProbe(effectFn: (ctx: ReturnType<typeof useAppState>) => void) {
  const Setup = setupStateSetup(effectFn)
  return render(
    <AppProvider>
      <Setup />
      <StateProbe />
      <AiAssistant />
    </AppProvider>,
  )
}

describe("AiAssistant", () => {
  test("shows idle state when omni is enabled", async () => {
    renderWithProvider()
    await waitFor(() => {
      const el = document.querySelector("[data-ai-assistant-state]")
      expect(el?.getAttribute("data-ai-assistant-state")).toBe("idle")
    })
  })

  test("shows assistant output controls when idle", () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    const el = document.querySelector("[data-ai-assistant-state]")
    expect(el?.getAttribute("data-ai-assistant-state")).toBe("idle")
    const controls = document.querySelector(".ai-assistant-controls")
    expect(controls?.querySelectorAll("button")).toHaveLength(3)
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Mute AI voice" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start listening" })).toBeInTheDocument()
  })

  test("resizes dialog from the top-left drag handle", () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    const dialog = document.querySelector(".ai-assistant") as HTMLElement
    const handle = document.querySelector(".voice-resize-corner--top-left") as HTMLElement
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 40, clientY: 20 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 40, clientY: 20 })

    expect(dialog.style.getPropertyValue("--ai-assistant-width")).toBe("440px")
    expect(dialog.style.getPropertyValue("--ai-assistant-height")).toBe("600px")
    expect(JSON.parse(localStorage.getItem("wmux-ai-assistant-size") ?? "{}")).toEqual({
      width: 440,
      height: 600,
    })
  })

  test("keeps launcher position anchored to dialog bottom-right after dragging", async () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    const dialog = document.querySelector(".ai-assistant") as HTMLElement
    const header = document.querySelector(".voice-header") as HTMLElement
    fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 500, clientY: 260 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 440, clientY: 230 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 440, clientY: 230 })

    await waitFor(() => {
      expect(localStorage.getItem("wmux-launcher-pos")).not.toBeNull()
    })

    const dialogX = Number.parseInt(dialog.style.getPropertyValue("--ai-assistant-x"), 10)
    const dialogY = Number.parseInt(dialog.style.getPropertyValue("--ai-assistant-y"), 10)
    const dialogWidth = Number.parseInt(dialog.style.getPropertyValue("--ai-assistant-width"), 10)
    const dialogHeight = Number.parseInt(dialog.style.getPropertyValue("--ai-assistant-height"), 10)
    expect(JSON.parse(localStorage.getItem("wmux-launcher-pos") ?? "{}")).toEqual({
      x: dialogX + dialogWidth - 42,
      y: dialogY + dialogHeight - 42,
    })
  })

  test("moves dialog when launcher position changes", async () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    const dialog = document.querySelector(".ai-assistant") as HTMLElement
    act(() => {
      window.dispatchEvent(
        new CustomEvent(LAUNCHER_POS_CHANGE_EVENT, {
          detail: { x: 900, y: 700 },
        }),
      )
    })

    await waitFor(() => {
      expect(dialog.style.getPropertyValue("--ai-assistant-x")).toBe("562px")
      expect(dialog.style.getPropertyValue("--ai-assistant-y")).toBe("222px")
    })
  })

  test("shows transcript when present", () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniTranscript("hello world")
    })

    expect(screen.getByText("hello world")).toBeInTheDocument()
  })

  test("replaces live voice transcript with one finalized user message", async () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "connect" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "transcript_delta",
        text: "hello world",
      })
    })

    expect(screen.getByText("Live")).toBeInTheDocument()
    expect(screen.getByText("hello world")).toBeInTheDocument()

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "transcript_done",
        text: "hello world",
      })
    })

    await waitFor(() => {
      expect(screen.queryByText("Live")).not.toBeInTheDocument()
      expect(screen.getAllByText("hello world")).toHaveLength(1)
    })
  })

  test("shows error message when omniError is set", () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("error")
      ctx.setOmniError("Microphone access denied")
    })

    expect(screen.getByText("Microphone access denied")).toBeInTheDocument()
  })

  test("shows confirmation prompt when omniPendingConfirmation is set", () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("confirming")
      ctx.setOmniConfirmation({ confirmationId: "c1", skill: "send_to_pane" })
    })

    expect(screen.getByText(/Confirm action:/)).toBeInTheDocument()
    expect(screen.getByText("send_to_pane")).toBeInTheDocument()
    expect(screen.getByText("Confirm")).toBeInTheDocument()
    expect(screen.getByText("Cancel")).toBeInTheDocument()
  })

  test("shows disabled indicator when voice is disabled", () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("disabled" as OmniStatus)
      ctx.setShowAiAssistant(true)
    })
    expect(screen.getByText("Voice is disabled")).toBeInTheDocument()
  })

  test("shows status label matching omniStatus", () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("listening")
    })

    expect(screen.getByText("listening")).toBeInTheDocument()
  })

  test("updates token usage totals from voice events", () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    expect(screen.getByTestId("ai-token-meter")).toHaveTextContent("Total 0")
    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "count this" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "token_usage",
        usage: { inputTokens: 120, outputTokens: 35, totalTokens: 155 },
      })
      voiceClientMocks.onMessage?.({
        type: "token_usage",
        usage: { inputTokens: 1000, outputTokens: 250, totalTokens: 1250 },
      })
    })

    expect(screen.getByTestId("ai-token-meter")).toHaveTextContent("Total 1,405")
    expect(screen.getByTestId("ai-token-meter")).toHaveTextContent("Last 1,250")
  })

  test("shows mic disabled message when microphoneDisabled is true", async () => {
    vi.mocked(client.getConfig).mockResolvedValueOnce({
      schemaVersion: 1,
      path: ".",
      server: { bind: "127.0.0.1:7331" },
      auth: { token: "", tokenConfigured: false },
      tmux: { path: "tmux" },
      connections: [],
      ui: {
        theme: "dark",
        windowTheme: "dark",
        terminalFontSize: 14,
        terminalFontWeight: "normal",
      },
      intelligence: {
        enabled: false,
        providers: [],
        maxBytes: 4096,
        timeoutSec: 30,
        minSessionIntervalSec: 60,
        maxConcurrency: 2,
        cacheTTLSec: 300,
      },
      omni: {
        enabled: true,
        dashscopeApiKeyConfigured: false,
        microphoneDisabled: true,
        model: "qwen-omni",
        endpoint: "wss://example.com",
        continuousListening: false,
        storeRawAudio: false,
        vadEnabled: true,
        vadThreshold: 0.5,
      },
    })
    renderWithProvider()
    const msg = await screen.findByText("Microphone disabled in Settings")
    expect(msg).toBeInTheDocument()
  })

  test("start button is disabled when microphone is disabled", async () => {
    vi.mocked(client.getConfig).mockResolvedValueOnce({
      schemaVersion: 1,
      path: ".",
      server: { bind: "127.0.0.1:7331" },
      auth: { token: "", tokenConfigured: false },
      tmux: { path: "tmux" },
      connections: [],
      ui: {
        theme: "dark",
        windowTheme: "dark",
        terminalFontSize: 14,
        terminalFontWeight: "normal",
      },
      intelligence: {
        enabled: false,
        providers: [],
        maxBytes: 4096,
        timeoutSec: 30,
        minSessionIntervalSec: 60,
        maxConcurrency: 2,
        cacheTTLSec: 300,
      },
      omni: {
        enabled: true,
        dashscopeApiKeyConfigured: false,
        microphoneDisabled: true,
        model: "qwen-omni",
        endpoint: "wss://example.com",
        continuousListening: false,
        storeRawAudio: false,
        vadEnabled: true,
        vadThreshold: 0.5,
      },
    })
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })
    const btn = await screen.findByRole("button", { name: /start listening/i })
    expect(btn).toBeDisabled()
  })

  test("shows history list when messages are loaded", async () => {
    vi.mocked(client.getOmniHistory).mockResolvedValueOnce([
      {
        id: "msg-1",
        conversationId: "default",
        role: "user",
        kind: "transcript",
        text: "hello there",
        createdAt: "2026-05-28T10:00:00Z",
      },
      {
        id: "msg-2",
        conversationId: "default",
        role: "assistant",
        kind: "action_result",
        text: "Executed: open_file",
        createdAt: "2026-05-28T10:00:05Z",
      },
    ])
    renderWithProvider()
    expect(await screen.findByText("hello there")).toBeInTheDocument()
    expect(screen.getByText("Executed: open_file")).toBeInTheDocument()
    expect(screen.getByText("You")).toBeInTheDocument()
    expect(screen.getByText("AI")).toBeInTheDocument()
  })

  test("sends typed text messages", () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "show sessions" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    expect(screen.getByText("show sessions")).toBeInTheDocument()
    expect(voiceClientMocks.send).toHaveBeenCalledWith({
      type: "text_message",
      text: "show sessions",
    })
  })

  test("keeps mic start available after sending typed text", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    })
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "show sessions" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))
    voiceClientMocks.onOpen?.()

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start listening" })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole("button", { name: "Start listening" }))

    await waitFor(() => {
      expect(audioPipelineMocks.startCapture).toHaveBeenCalledOnce()
    })
    expect(screen.getByRole("button", { name: "Stop listening" })).toBeInTheDocument()
  })

  test("leaves client VAD disabled so server VAD receives silence", async () => {
    vi.mocked(client.getConfig).mockResolvedValueOnce({
      schemaVersion: 1,
      path: ".",
      server: { bind: "127.0.0.1:7331" },
      auth: { token: "", tokenConfigured: false },
      tmux: { path: "tmux" },
      connections: [],
      ui: {
        theme: "dark",
        windowTheme: "dark",
        terminalFontSize: 14,
        terminalFontWeight: "normal",
      },
      intelligence: {
        enabled: false,
        providers: [],
        maxBytes: 4096,
        timeoutSec: 30,
        minSessionIntervalSec: 60,
        maxConcurrency: 2,
        cacheTTLSec: 300,
      },
      omni: {
        enabled: true,
        dashscopeApiKeyConfigured: false,
        microphoneDisabled: false,
        model: "qwen-omni",
        endpoint: "wss://example.com",
        continuousListening: false,
        storeRawAudio: false,
        vadEnabled: true,
        vadThreshold: 0.25,
      },
    })
    renderWithProvider()
    await waitFor(() => {
      expect(
        document
          .querySelector("[data-ai-assistant-state]")
          ?.getAttribute("data-ai-assistant-state"),
      ).toBe("idle")
    })

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "show sessions" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    expect(audioPipelineMocks.constructor).toHaveBeenCalledWith(
      expect.objectContaining({
        vadEnabled: false,
        vadThreshold: 0,
      }),
    )
  })

  test("sends current connection context before typed text messages", () => {
    renderWithStateSetup((ctx) => {
      ctx.setConnections([{ id: "local", targetName: "local", type: "local" }])
      ctx.setSelectedTargetName("local")
      ctx.setSelectedPane({ targetName: "local", session: "main", window: "@1", pane: "%2" })
      ctx.setOmniStatus("idle")
    })

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "新建 Session, hana" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    expect(voiceClientMocks.send).toHaveBeenNthCalledWith(1, {
      type: "session_context",
      target: {
        targetName: "local",
        session: "main",
        window: "@1",
        pane: "%2",
      },
      connectionType: "local",
    })
    expect(voiceClientMocks.send).toHaveBeenNthCalledWith(2, {
      type: "text_message",
      text: "新建 Session, hana",
    })
  })

  test("navigates to a specific session from navigate_frontend intent", async () => {
    renderWithStateSetupAndProbe((ctx) => {
      ctx.setConnections([{ id: "local", targetName: "local", type: "local" }])
      ctx.setSelectedTargetName("local")
      ctx.setOmniStatus("idle")
    })

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "open dev session" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "intent_received",
        skill: "navigate_frontend",
        params: { route: "session", target_name: "local", session_name: "dev" },
        confirmationRequired: false,
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId("selected-pane")).toHaveTextContent("local/dev/@1/%1")
    })
    expect(client.listWindows).toHaveBeenCalledWith("local", "dev")
    expect(client.listPanes).toHaveBeenCalledWith("local", "dev", "@1")
  })

  test("opens a specific project from navigate_frontend intent", async () => {
    renderWithStateSetupAndProbe((ctx) => {
      ctx.setConnections([{ id: "local", targetName: "local", type: "local" }])
      ctx.setSelectedTargetName("local")
      ctx.setOmniStatus("idle")
    })

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "open project one" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "intent_received",
        skill: "navigate_frontend",
        params: { route: "projects", project_id: "proj-1" },
        confirmationRequired: false,
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId("selected-project")).toHaveTextContent("proj-1")
    })
    expect(client.getProject).toHaveBeenCalledWith("proj-1")
  })

  test("sends context when get_current_focus intent arrives", () => {
    renderWithStateSetup((ctx) => {
      ctx.setConnections([{ id: "local", targetName: "local", type: "local" }])
      ctx.setSelectedTargetName("local")
      ctx.setSelectedPane({ targetName: "local", session: "main", window: "@1", pane: "%2" })
      ctx.setOmniStatus("idle")
    })

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "where am I" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))
    voiceClientMocks.send.mockClear()

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "intent_received",
        skill: "get_current_focus",
        params: {},
        confirmationRequired: false,
      })
    })

    expect(voiceClientMocks.send).toHaveBeenCalledWith({
      type: "session_context",
      target: {
        targetName: "local",
        session: "main",
        window: "@1",
        pane: "%2",
      },
      connectionType: "local",
    })
  })

  test("starts a new chat from new_chat intent", async () => {
    vi.mocked(client.getOmniHistory).mockResolvedValueOnce([
      {
        id: "msg-1",
        conversationId: "default",
        role: "user",
        kind: "transcript",
        text: "old message",
        createdAt: "2026-05-28T10:00:00Z",
      },
    ])
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    expect(await screen.findByText("old message")).toBeInTheDocument()

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "new chat" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "intent_received",
        skill: "new_chat",
        params: {},
        confirmationRequired: false,
      })
    })

    expect(client.clearOmniHistory).toHaveBeenCalledOnce()
    await screen.findByText("Ask AI with your voice")
    expect(screen.queryByText("old message")).not.toBeInTheDocument()
    expect(screen.queryByText("new chat")).not.toBeInTheDocument()
  })

  test("sends typed text messages when wmux auth token is empty on localhost", () => {
    sessionStorage.removeItem("wmux-auth-token")
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "show sessions" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    expect(screen.queryByText("Authentication token is missing")).not.toBeInTheDocument()
    expect(screen.getByText("show sessions")).toBeInTheDocument()
    expect(voiceClientMocks.send).toHaveBeenCalledWith({
      type: "text_message",
      text: "show sessions",
    })
  })

  test("plays audio replies during typed text conversations", () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "say hello" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    voiceClientMocks.onMessage?.({
      type: "audio_delta",
      pcm16Base64: "AAAA",
      sampleRate: 24000,
    })

    expect(audioPipelineMocks.enqueuePlayback).toHaveBeenCalledWith("AAAA", 24000)
  })

  test("mute keeps assistant text but skips voice playback", async () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    fireEvent.click(screen.getByRole("button", { name: "Mute AI voice" }))

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "say hello" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "assistant_delta",
        text: "Hello",
      })
      voiceClientMocks.onMessage?.({
        type: "audio_delta",
        pcm16Base64: "AAAA",
        sampleRate: 24000,
      })
    })

    expect(screen.getByText("Hello")).toBeInTheDocument()
    expect(audioPipelineMocks.enqueuePlayback).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Unmute AI voice" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })

  test("stopping mic capture keeps AI output and websocket alive", async () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    fireEvent.click(screen.getByRole("button", { name: "Start listening" }))

    await waitFor(() => {
      expect(audioPipelineMocks.startCapture).toHaveBeenCalledOnce()
    })

    fireEvent.click(screen.getByRole("button", { name: "Stop listening" }))

    expect(audioPipelineMocks.stopCapture).toHaveBeenCalledOnce()
    expect(audioPipelineMocks.stopPlayback).not.toHaveBeenCalled()
    expect(voiceClientMocks.close).not.toHaveBeenCalled()
    expect(voiceClientMocks.send).toHaveBeenCalledWith({ type: "stop_listening" })

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "audio_delta",
        pcm16Base64: "BBBB",
        sampleRate: 24000,
      })
    })

    expect(audioPipelineMocks.enqueuePlayback).toHaveBeenCalledWith("BBBB", 24000)
  })

  test("stop AI output cancels current response and ignores later deltas", () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "say hello" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "assistant_delta",
        text: "Hel",
      })
    })
    expect(screen.getByText("Hel")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Stop AI output" }))

    expect(audioPipelineMocks.stopPlayback).toHaveBeenCalled()
    expect(voiceClientMocks.send).toHaveBeenCalledWith({ type: "stop_response" })
    expect(screen.queryByText("Hel")).not.toBeInTheDocument()

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "assistant_delta",
        text: "lo",
      })
      voiceClientMocks.onMessage?.({
        type: "audio_delta",
        pcm16Base64: "CCCC",
        sampleRate: 24000,
      })
    })

    expect(screen.queryByText("lo")).not.toBeInTheDocument()
    expect(audioPipelineMocks.enqueuePlayback).not.toHaveBeenCalled()
  })

  test("shows assistant text while voice reply audio is streaming", async () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    await screen.findByText("Ask AI with your voice")

    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "say hello" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => {
      expect(voiceClientMocks.send).toHaveBeenCalledWith({
        type: "text_message",
        text: "say hello",
      })
    })

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "assistant_delta",
        text: "Hel",
      })
      voiceClientMocks.onMessage?.({
        type: "audio_delta",
        pcm16Base64: "AAAA",
        sampleRate: 24000,
      })
      voiceClientMocks.onMessage?.({
        type: "assistant_delta",
        text: "lo",
      })
    })

    await waitFor(() => {
      expect(screen.getByText("Live")).toBeInTheDocument()
      expect(screen.getByText("Hello")).toBeInTheDocument()
    })

    act(() => {
      voiceClientMocks.onMessage?.({
        type: "assistant_message",
        text: "Hello",
      })
    })

    await waitFor(() => {
      expect(screen.queryByText("Live")).not.toBeInTheDocument()
    })
    expect(screen.getByText("Hello")).toBeInTheDocument()
  })

  test("scrolls to the newest message during text conversations", async () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle")
    })

    const chat = document.querySelector(".voice-chat") as HTMLDivElement
    Object.defineProperty(chat, "scrollHeight", { configurable: true, value: 750 })
    fireEvent.change(screen.getByRole("textbox", { name: "Message AI Assistant" }), {
      target: { value: "show sessions" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => {
      expect(chat.scrollTop).toBe(750)
    })

    Object.defineProperty(chat, "scrollHeight", { configurable: true, value: 900 })
    voiceClientMocks.onMessage?.({
      type: "assistant_message",
      text: "Done",
    })

    await waitFor(() => {
      expect(chat.scrollTop).toBe(900)
    })
  })

  test("Hide AI Assistant button renders and is clickable", () => {
    renderWithStateSetup((ctx) => {
      ctx.setOmniStatus("idle" as OmniStatus)
      ctx.setShowAiAssistant(true)
    })

    expect(document.querySelector(".ai-assistant")).not.toBeNull()
    const hideBtn = screen.getByRole("button", { name: "Hide AI Assistant" })
    expect(hideBtn).toBeInTheDocument()
    fireEvent.click(hideBtn)
  })

  test("clears history when new chat button is clicked", async () => {
    vi.mocked(client.getOmniHistory).mockResolvedValueOnce([
      {
        id: "msg-1",
        conversationId: "default",
        role: "user",
        kind: "transcript",
        text: "old message",
        createdAt: "2026-05-28T10:00:00Z",
      },
    ])
    renderWithProvider()

    expect(await screen.findByText("old message")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "New chat" }))

    expect(client.clearOmniHistory).toHaveBeenCalledOnce()
    await screen.findByText("Ask AI with your voice")
    expect(screen.queryByText("old message")).not.toBeInTheDocument()
  })
})
