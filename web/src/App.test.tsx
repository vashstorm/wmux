import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { AppProvider, useAppState, type OmniStatus } from "./state/store.js"
import { PanelVisibility } from "./App.js"
import { useEffect, type ReactNode } from "react"

vi.mock("./components/NewConnectionForm.js", () => ({
  NewConnectionForm: () => <div data-testid="new-connection-form">NewConnectionForm</div>,
}))

vi.mock("./components/SettingsPanel.js", () => ({
  SettingsPanel: () => <div data-testid="settings-panel">SettingsPanel</div>,
}))

vi.mock("./components/ErrorLogsPanel.js", () => ({
  ErrorLogsPanel: () => <div data-testid="error-logs-panel">ErrorLogsPanel</div>,
}))

vi.mock("./components/AiAssistant.js", () => ({
  AiAssistant: () => (
    <div className="ai-assistant" data-testid="ai-assistant">
      AiAssistant
    </div>
  ),
  loadLauncherPos: () => ({ x: 100, y: 100 }),
}))

vi.mock("@mui/icons-material/Assistant", () => ({
  default: () => <span>AssistantIcon</span>,
}))

vi.mock("@mui/material", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mui/material")>()
  return {
    ...original,
    Tooltip: ({ children }: { children: ReactNode }) => children,
  }
})

vi.mock("./api/client.js", () => ({
  getConfig: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    path: ".",
    server: { bind: "127.0.0.1:7331" },
    auth: { token: "", tokenConfigured: false },
    tmux: { path: "tmux" },
    connections: [],
    ui: { theme: "dark", windowTheme: "dark" },
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
  }),
  getOmniHistory: vi.fn().mockResolvedValue([]),
}))

type SetupFn = (ctx: ReturnType<typeof useAppState>) => void

function StateSetup({ setup }: { setup: SetupFn }) {
  const ctx = useAppState()
  useEffect(() => {
    setup(ctx)
  }, [ctx, setup])
  return null
}

function renderPanels(setup: SetupFn) {
  return render(
    <AppProvider>
      <StateSetup setup={setup} />
      <PanelVisibility />
    </AppProvider>,
  )
}

function renderInitialPanels() {
  return render(
    <AppProvider>
      <PanelVisibility />
    </AppProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react")
  cleanup()
})

describe("PanelVisibility - Inactive overlays", () => {
  test("no panel DOM nodes present at initial state", () => {
    renderInitialPanels()

    expect(screen.queryByTestId("settings-panel")).not.toBeInTheDocument()
    expect(screen.queryByTestId("error-logs-panel")).not.toBeInTheDocument()
    expect(screen.queryByTestId("new-connection-form")).not.toBeInTheDocument()
    expect(screen.queryByTestId("ai-assistant")).not.toBeInTheDocument()
  })
})

describe("PanelVisibility - Panel mount/unmount", () => {
  test("SettingsPanel mounts when state is true", async () => {
    renderPanels((ctx) => {
      ctx.setShowSettingsPanel(true)
    })
    expect(await screen.findByTestId("settings-panel")).toBeInTheDocument()
  })

  test("ErrorLogsPanel mounts when state is true", async () => {
    renderPanels((ctx) => {
      ctx.setShowErrorLogsPanel(true)
    })
    expect(await screen.findByTestId("error-logs-panel")).toBeInTheDocument()
  })

  test("NewConnectionForm mounts when state is true", async () => {
    renderPanels((ctx) => {
      ctx.setShowNewConnectionForm(true)
    })
    expect(await screen.findByTestId("new-connection-form")).toBeInTheDocument()
  })

  test("AiAssistant mounts when omni enabled and showAiAssistant is true", async () => {
    renderPanels((ctx) => {
      ctx.setOmniStatus("idle" as OmniStatus)
      ctx.setShowAiAssistant(true)
    })
    expect(await screen.findByTestId("ai-assistant")).toBeInTheDocument()
  })

  test("AiAssistant absent when omniStatus is disabled", () => {
    renderPanels((ctx) => {
      ctx.setOmniStatus("disabled" as OmniStatus)
      ctx.setShowAiAssistant(true)
    })
    expect(screen.queryByTestId("ai-assistant")).not.toBeInTheDocument()
  })

  test("AiAssistant absent when showAiAssistant is false", () => {
    renderPanels((ctx) => {
      ctx.setOmniStatus("idle" as OmniStatus)
      ctx.setShowAiAssistant(false)
    })
    expect(screen.getByTestId("ai-assistant-wrapper")).toHaveStyle({ display: "none" })
  })

  test("multiple panels coexist when all states active", async () => {
    renderPanels((ctx) => {
      ctx.setShowSettingsPanel(true)
      ctx.setShowErrorLogsPanel(true)
      ctx.setOmniStatus("idle" as OmniStatus)
      ctx.setShowAiAssistant(true)
    })
    expect(await screen.findByTestId("settings-panel")).toBeInTheDocument()
    expect(screen.getByTestId("error-logs-panel")).toBeInTheDocument()
    expect(screen.getByTestId("ai-assistant")).toBeInTheDocument()
  })
})
