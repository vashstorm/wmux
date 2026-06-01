import { describe, test, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react"
import { Sidebar } from "./Sidebar.js"
import { ConfirmDialog } from "./ConfirmDialog.js"
import { AppProvider, useAppState } from "../state/store.js"
import * as client from "../api/client.js"
import { ApiError } from "../api/errors.js"

vi.mock("../api/client.js", () => ({
  listConnections: vi.fn(),
  listConnectionHealth: vi.fn(),
  listSessions: vi.fn(),
  listWindows: vi.fn(),
  listPanes: vi.fn(),
  createSession: vi.fn(),
  killSession: vi.fn(),
  renameSession: vi.fn(),
  fetchErrorLogs: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}))

const mockListConnections = vi.mocked(client.listConnections)
const mockListConnectionHealth = vi.mocked(client.listConnectionHealth)
const mockListSessions = vi.mocked(client.listSessions)
const mockListWindows = vi.mocked(client.listWindows)
const mockListPanes = vi.mocked(client.listPanes)
const mockFetchErrorLogs = vi.mocked(client.fetchErrorLogs)
const mockListProjects = vi.mocked(client.listProjects)
const mockCreateProject = vi.mocked(client.createProject)
const mockUpdateProject = vi.mocked(client.updateProject)
const mockDeleteProject = vi.mocked(client.deleteProject)

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <AppProvider>{children}</AppProvider>
}

describe("Sidebar session loading", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mockListConnections.mockResolvedValue([{ targetName: "conn1", type: "local" }])
    mockListConnectionHealth.mockResolvedValue([])
    mockFetchErrorLogs.mockResolvedValue({
      enabled: true,
      path: "/tmp/wmux-error.log",
      lines: [],
      truncated: false,
      maxLines: 1000,
    })
  })

  describe("handleOpenSession happy path", () => {
    test("periodically refreshes sessions for external tmux changes", async () => {
      mockListSessions
        .mockResolvedValueOnce({
          targetName: "conn1",
          mode: "local",
          data: [{ name: "session1" }],
        })
        .mockResolvedValueOnce({
          targetName: "conn1",
          mode: "local",
          data: [{ name: "session1" }, { name: "session2" }],
        })

      render(
        <TestWrapper>
          <Sidebar />
        </TestWrapper>,
      )

      await waitFor(() => {
        expect(screen.getByTestId("session-card-session1")).toBeInTheDocument()
      })

      await waitFor(
        () => {
          expect(screen.getByTestId("session-card-session2")).toBeInTheDocument()
        },
        { timeout: 3000 },
      )
    }, 4000)

    test("loads the first window and first pane without following external tmux active state", async () => {
      mockListSessions.mockResolvedValue({
        targetName: "conn1",
        mode: "local",
        data: [{ name: "session1" }],
      })

      mockListWindows.mockResolvedValue({
        targetName: "conn1",
        session: "session1",
        mode: "local",
        data: [
          {
            ID: "@1",
            Name: "editor",
            Index: 0,
            Active: false,
            PaneCount: 1,
            ActivePaneID: "%1",
            ActivePaneTitle: "bash",
          },
          {
            ID: "@2",
            Name: "terminal",
            Index: 1,
            Active: true,
            PaneCount: 2,
            ActivePaneID: "%3",
            ActivePaneTitle: "vim",
          },
        ],
      })

      mockListPanes.mockResolvedValue({
        targetName: "conn1",
        session: "session1",
        window: "@1",
        mode: "local",
        data: [
          {
            ID: "%1",
            Title: "bash",
            Index: 0,
            Active: false,
            Width: 80,
            Height: 24,
            Left: 0,
            Top: 0,
          },
        ],
      })

      render(
        <TestWrapper>
          <Sidebar />
        </TestWrapper>,
      )

      await waitFor(() => {
        expect(screen.getByTestId("session-card-session1")).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId("session-open-session1"))

      await waitFor(() => {
        expect(mockListWindows).toHaveBeenCalledWith("conn1", "session1")
      })

      await waitFor(() => {
        expect(mockListPanes).toHaveBeenCalledWith("conn1", "session1", "@1")
      })
    })

    test("falls back to first window when no active window", async () => {
      mockListSessions.mockResolvedValue({
        targetName: "conn1",
        mode: "local",
        data: [{ name: "session1" }],
      })

      mockListWindows.mockResolvedValue({
        targetName: "conn1",
        session: "session1",
        mode: "local",
        data: [
          {
            ID: "@1",
            Name: "editor",
            Index: 0,
            Active: false,
            PaneCount: 1,
            ActivePaneID: "%1",
            ActivePaneTitle: "bash",
          },
        ],
      })

      mockListPanes.mockResolvedValue({
        targetName: "conn1",
        session: "session1",
        window: "@1",
        mode: "local",
        data: [
          {
            ID: "%1",
            Title: "bash",
            Index: 0,
            Active: false,
            Width: 80,
            Height: 24,
            Left: 0,
            Top: 0,
          },
        ],
      })

      render(
        <TestWrapper>
          <Sidebar />
        </TestWrapper>,
      )

      await waitFor(() => {
        expect(screen.getByTestId("session-card-session1")).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId("session-open-session1"))

      await waitFor(() => {
        expect(mockListPanes).toHaveBeenCalledWith("conn1", "session1", "@1")
      })
    })

    test("sets session only when no windows exist", async () => {
      mockListSessions.mockResolvedValue({
        targetName: "conn1",
        mode: "local",
        data: [{ name: "session1" }],
      })

      mockListWindows.mockResolvedValue({
        targetName: "conn1",
        session: "session1",
        mode: "local",
        data: [],
      })

      render(
        <TestWrapper>
          <Sidebar />
        </TestWrapper>,
      )

      await waitFor(() => {
        expect(screen.getByTestId("session-card-session1")).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId("session-open-session1"))

      await waitFor(() => {
        expect(mockListWindows).toHaveBeenCalledWith("conn1", "session1")
      })

      expect(mockListPanes).not.toHaveBeenCalled()
    })
  })

  describe("handleOpenSession error path", () => {
    test("listWindows failure sets error in store", async () => {
      mockListSessions.mockResolvedValue({
        targetName: "conn1",
        mode: "local",
        data: [{ name: "session1" }],
      })

      const apiError = new Error("connection failed") as Error & { code: string }
      apiError.code = "connection_failed"
      mockListWindows.mockRejectedValue(apiError)

      function ErrorChecker() {
        const { error } = useAppState()
        return <span data-testid="error-state">{error ? `${error.code}` : "no-error"}</span>
      }

      render(
        <TestWrapper>
          <Sidebar />
          <ErrorChecker />
        </TestWrapper>,
      )

      await waitFor(() => {
        expect(screen.getByTestId("session-card-session1")).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId("session-open-session1"))

      await waitFor(() => {
        expect(mockListWindows).toHaveBeenCalledWith("conn1", "session1")
      })

      await waitFor(() => {
        expect(screen.getByTestId("error-state").textContent).toBe("connection_failed")
      })
    })

    test("listPanes failure sets error in store", async () => {
      mockListSessions.mockResolvedValue({
        targetName: "conn1",
        mode: "local",
        data: [{ name: "session1" }],
      })

      mockListWindows.mockResolvedValue({
        targetName: "conn1",
        session: "session1",
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

      const apiError = new Error("pane error") as Error & { code: string }
      apiError.code = "internal_error"
      mockListPanes.mockRejectedValue(apiError)

      function ErrorChecker() {
        const { error } = useAppState()
        return <span data-testid="error-state">{error ? `${error.code}` : "no-error"}</span>
      }

      render(
        <TestWrapper>
          <Sidebar />
          <ErrorChecker />
        </TestWrapper>,
      )

      await waitFor(() => {
        expect(screen.getByTestId("session-card-session1")).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId("session-open-session1"))

      await waitFor(() => {
        expect(screen.getByTestId("error-state").textContent).toBe("internal_error")
      })
    })
  })
})

describe("session card attention rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListConnections.mockResolvedValue([{ targetName: "conn1", type: "local" }])
    mockListConnectionHealth.mockResolvedValue([])
  })

  test("session card keeps action buttons in the absolute positioned floating element", async () => {
    mockListSessions.mockResolvedValue({
      targetName: "conn1",
      mode: "local",
      data: [{ name: "session1", windowCount: 3 }],
    })

    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("session-card-session1")).toBeInTheDocument()
    })

    const cardBodyShell = screen.getByTestId("session-open-session1").parentElement
    const actions = document.querySelector(".session-card-actions")

    expect(cardBodyShell).toHaveStyle({ width: "100%" })
    expect(actions).toHaveStyle({ position: "absolute" })
    expect(actions).toHaveStyle({
      right: "8px",
      transform: "translate(8px, -50%)",
      pointerEvents: "none",
    })
  })

  test("session card shows updated time on the session name row", async () => {
    mockListSessions.mockResolvedValue({
      targetName: "conn1",
      mode: "local",
      data: [
        {
          name: "session1",
          intelligenceStatus: "running",
          intelligenceUpdatedAt: new Date().toISOString(),
        },
      ],
    })

    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("session-card-session1")).toBeInTheDocument()
    })

    const time = document.querySelector(".session-card-time")
    expect(time).toBeInTheDocument()
  })
})

describe("sidebar navigation and logs features", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListConnections.mockResolvedValue([{ targetName: "conn1", type: "local" }])
    mockListConnectionHealth.mockResolvedValue([])
    mockListWindows.mockResolvedValue({
      targetName: "conn1",
      session: "session1",
      mode: "local",
      data: [],
    })
    mockListPanes.mockResolvedValue({
      targetName: "conn1",
      session: "session1",
      window: "@1",
      mode: "local",
      data: [],
    })
  })

  test("error logs button shows badge when error entries exist", async () => {
    mockFetchErrorLogs.mockResolvedValue({
      enabled: true,
      path: "/tmp/wmux-error.log",
      lines: ["ERROR one", "ERROR two"],
      truncated: false,
      maxLines: 1000,
    })
    mockListSessions.mockResolvedValue({
      targetName: "conn1",
      mode: "local",
      data: [{ name: "session1" }],
    })

    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("error-logs-badge")).toHaveTextContent("2")
    })
    expect(screen.getByTestId("open-error-logs-button")).toHaveAttribute("aria-label", "Logs (2)")
  })

  test("sidebar header switches between placeholder projects, sessions, and stats views", async () => {
    mockListSessions.mockResolvedValue({
      targetName: "conn1",
      mode: "local",
      data: [{ name: "session1" }],
    })

    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("session-card-session1")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId("open-projects-button"))
    expect(screen.getByTestId("projects-view")).toBeInTheDocument()
    expect(screen.queryByTestId("session-card-session1")).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId("open-stats-button"))
    expect(screen.getByTestId("stats-view")).toBeInTheDocument()
    expect(screen.queryByTestId("session-card-session1")).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId("open-session-button"))
    expect(screen.getByTestId("session-card-session1")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("open-ai-logs-button"))
    expect(screen.getByTestId("ai-logs-view")).toBeInTheDocument()
    expect(screen.queryByTestId("session-card-session1")).not.toBeInTheDocument()
  })

  test("sidebar icon controls use consistent sizing classes", async () => {
    mockListSessions.mockResolvedValue({
      targetName: "conn1",
      mode: "local",
      data: [{ name: "session1" }],
    })

    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("session-card-session1")).toBeInTheDocument()
    })

    for (const testId of [
      "open-projects-button",
      "open-session-button",
      "open-stats-button",
      "open-ai-logs-button",
      "open-settings-button",
      "open-error-logs-button",
    ]) {
      const button = screen.getByTestId(testId)
      expect(button).toHaveClass("sidebar-icon-button", "sidebar-icon-button-nav")
      expect(button.querySelector(".sidebar-icon")).toBeInTheDocument()
    }

    const newSessionButton = screen.getByTestId("new-session-button")
    expect(newSessionButton).toHaveClass("sidebar-icon-button", "sidebar-icon-button-compact")
    expect(newSessionButton.querySelector(".sidebar-icon")).toBeInTheDocument()

    for (const testId of ["rename-session-session1", "kill-session-session1"]) {
      const button = screen.getByTestId(testId)
      expect(button).toHaveClass("sidebar-icon-button", "sidebar-icon-button-row")
      expect(button.querySelector(".sidebar-icon")).toBeInTheDocument()
    }
  })
})

describe("Projects view", () => {
  beforeEach(() => {
    mockListConnections.mockResolvedValue([{ targetName: "conn1", type: "local" }])
    mockListConnectionHealth.mockResolvedValue([])
    mockFetchErrorLogs.mockResolvedValue({
      enabled: false,
      path: null,
      lines: [],
      truncated: false,
      maxLines: 1000,
    })
    mockListSessions.mockResolvedValue({
      targetName: "conn1",
      mode: "local",
      data: [],
    })
    mockListWindows.mockResolvedValue({
      targetName: "conn1",
      session: "new",
      mode: "local",
      data: [
        {
          ID: "@1",
          Name: "main",
          Index: 0,
          Active: true,
          PaneCount: 1,
          ActivePaneID: "%1",
          ActivePaneTitle: "bash",
        },
      ],
    })
    mockListPanes.mockResolvedValue({
      targetName: "conn1",
      session: "new",
      window: "@1",
      mode: "local",
      data: [
        { ID: "%1", Title: "bash", Index: 0, Active: true, Width: 80, Height: 24, Left: 0, Top: 0 },
      ],
    })
    vi.mocked(client.listProjects).mockReset().mockResolvedValue([])
    vi.mocked(client.createProject).mockReset().mockResolvedValue({
      id: "p1",
      name: "new",
      path: "/tmp",
      description: "",
      createdAt: "",
      updatedAt: "",
      sessionName: "",
      status: "stopped",
      workdir: "",
      layoutJson: "{}",
      detailsJson: "{}",
      progressJson: "{}",
      aiHtml: "",
      aiStatus: "idle",
      aiError: "",
      lastSyncedAt: null,
      schemaVersion: 1,
    })
    vi.mocked(client.updateProject).mockReset().mockResolvedValue({
      id: "p1",
      name: "new",
      path: "/tmp",
      description: "",
      createdAt: "",
      updatedAt: "",
      sessionName: "",
      status: "stopped",
      workdir: "",
      layoutJson: "{}",
      detailsJson: "{}",
      progressJson: "{}",
      aiHtml: "",
      aiStatus: "idle",
      aiError: "",
      lastSyncedAt: null,
      schemaVersion: 1,
    })
    vi.mocked(client.deleteProject).mockReset().mockResolvedValue(undefined)
    vi.mocked(client.createSession)
      .mockReset()
      .mockResolvedValue({
        targetName: "conn1",
        operation: "create_session",
        mode: "local",
        status: "ok",
      })
  })

  test("clicking Projects button loads projects and shows empty state", async () => {
    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )
    fireEvent.click(screen.getByTestId("open-projects-button"))
    await waitFor(() => {
      expect(screen.getByTestId("projects-empty")).toBeInTheDocument()
    })
  })

  test("creates a project and shows it in list", async () => {
    let projectsList: any[] = []
    vi.mocked(client.listProjects).mockImplementation(async () => projectsList)
    vi.mocked(client.createProject).mockImplementation(async (data) => {
      const p = {
        id: "p1",
        name: data.name,
        path: data.path ?? "",
        description: data.description ?? "",
        createdAt: "",
        updatedAt: "",
        sessionName: data.sessionName ?? "",
        status: "stopped",
        workdir: "",
        layoutJson: "{}",
        detailsJson: "{}",
        progressJson: "{}",
        aiHtml: "",
        aiStatus: "idle",
        aiError: "",
        lastSyncedAt: null,
        schemaVersion: 1,
      }
      projectsList = [p]
      return p
    })

    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )
    fireEvent.click(screen.getByTestId("open-projects-button"))
    await waitFor(() => expect(screen.getByTestId("projects-empty")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("projects-add-button"))
    const nameInput = screen.getByPlaceholderText("Project name")
    const pathInput = screen.getByPlaceholderText("Path (optional)")
    fireEvent.change(nameInput, { target: { value: "wmux-dev" } })
    fireEvent.change(pathInput, { target: { value: "/tmp/wmux" } })
    fireEvent.click(screen.getByTestId("project-submit-button"))

    await waitFor(() => {
      expect(screen.getByText("wmux-dev")).toBeInTheDocument()
    })
  })

  test("duplicate project name shows error", async () => {
    vi.mocked(client.createProject).mockRejectedValue(
      new ApiError("conflict", "project name already exists", 409),
    )

    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )
    fireEvent.click(screen.getByTestId("open-projects-button"))
    await waitFor(() => expect(screen.getByTestId("projects-empty")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("projects-add-button"))
    const nameInput = screen.getByPlaceholderText("Project name")
    fireEvent.change(nameInput, { target: { value: "dup" } })
    fireEvent.click(screen.getByTestId("project-submit-button"))

    await waitFor(() => {
      expect(screen.getByTestId("projects-error")).toBeInTheDocument()
    })
  })

  test("project session action creates missing session and jumps to it", async () => {
    vi.mocked(client.listProjects).mockResolvedValue([
      {
        id: "p1",
        name: "new",
        path: "/tmp",
        description: "",
        createdAt: "",
        updatedAt: "",
        sessionName: "new",
        status: "stopped",
        workdir: "",
        layoutJson: "{}",
        detailsJson: "{}",
        progressJson: "{}",
        aiHtml: "",
        aiStatus: "idle",
        aiError: "",
        lastSyncedAt: null,
        schemaVersion: 1,
      },
    ])

    function SelectedPaneChecker() {
      const { selectedPane } = useAppState()
      return (
        <span data-testid="selected-pane-state">
          {selectedPane
            ? `${selectedPane.targetName}:${selectedPane.session}:${selectedPane.window}:${selectedPane.pane}`
            : "none"}
        </span>
      )
    }

    render(
      <TestWrapper>
        <Sidebar />
        <SelectedPaneChecker />
      </TestWrapper>,
    )
    fireEvent.click(screen.getByTestId("open-projects-button"))
    await waitFor(() => expect(screen.getByTestId("project-item-p1")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("project-open-session-p1"))

    await waitFor(() => {
      expect(vi.mocked(client.createSession)).toHaveBeenCalledWith("conn1", "new")
      expect(screen.getByTestId("selected-pane-state")).toHaveTextContent("conn1:new:@1:%1")
    })
  })

  test("project session action jumps when session already exists", async () => {
    vi.mocked(client.listProjects).mockResolvedValue([
      {
        id: "p1",
        name: "new",
        path: "/tmp",
        description: "",
        createdAt: "",
        updatedAt: "",
        sessionName: "new",
        status: "running",
        workdir: "",
        layoutJson: "{}",
        detailsJson: "{}",
        progressJson: "{}",
        aiHtml: "",
        aiStatus: "idle",
        aiError: "",
        lastSyncedAt: null,
        schemaVersion: 1,
      },
    ])
    mockListSessions.mockResolvedValue({
      targetName: "conn1",
      mode: "local",
      data: [{ name: "new" }],
    })

    function SelectedPaneChecker() {
      const { selectedPane } = useAppState()
      return (
        <span data-testid="selected-pane-state">
          {selectedPane
            ? `${selectedPane.targetName}:${selectedPane.session}:${selectedPane.window}:${selectedPane.pane}`
            : "none"}
        </span>
      )
    }

    render(
      <TestWrapper>
        <Sidebar />
        <SelectedPaneChecker />
      </TestWrapper>,
    )
    fireEvent.click(screen.getByTestId("open-projects-button"))
    await waitFor(() => expect(screen.getByTestId("project-item-p1")).toBeInTheDocument())
    await waitFor(() => expect(mockListConnections).toHaveBeenCalled())

    fireEvent.click(screen.getByTestId("project-open-session-p1"))

    await waitFor(() => {
      expect(vi.mocked(client.createSession)).not.toHaveBeenCalled()
      expect(screen.getByTestId("selected-pane-state")).toHaveTextContent("conn1:new:@1:%1")
    })
  })
})

describe("Session Card Icons and Association Confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListConnections.mockResolvedValue([{ targetName: "conn1", type: "local" }])
    mockListConnectionHealth.mockResolvedValue([])
    mockFetchErrorLogs.mockResolvedValue({
      enabled: false,
      path: null,
      lines: [],
      truncated: false,
      maxLines: 1000,
    })
  })

  test("renders terminal icon when session has no associated project", async () => {
    mockListSessions.mockResolvedValue({
      targetName: "conn1",
      mode: "local",
      data: [{ name: "session1" }],
    })
    mockListProjects.mockResolvedValue([])

    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("session-icon-terminal")).toBeInTheDocument()
      expect(screen.queryByTestId("session-icon-project")).not.toBeInTheDocument()
      const buildBtn = screen.getByTestId("build-project-session1")
      expect(buildBtn).toHaveAttribute("aria-label", "Build project from session1")
      expect(buildBtn).toHaveAttribute("title", "Build project")
    })
  })

  test("renders folder icon when session has an associated project", async () => {
    mockListSessions.mockResolvedValue({
      targetName: "conn1",
      mode: "local",
      data: [{ name: "session1" }],
    })
    mockListProjects.mockResolvedValue([
      {
        id: "p1",
        name: "session1",
        path: "",
        description: "",
        createdAt: "",
        updatedAt: "",
        sessionName: "session1",
        status: "stopped",
        workdir: "",
        layoutJson: "{}",
        detailsJson: "{}",
        progressJson: "{}",
        aiHtml: "",
        aiStatus: "idle",
        aiError: "",
        lastSyncedAt: null,
        schemaVersion: 1,
      },
    ])

    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("session-icon-project")).toBeInTheDocument()
      expect(screen.queryByTestId("session-icon-terminal")).not.toBeInTheDocument()
      const buildBtn = screen.getByTestId("build-project-session1")
      expect(buildBtn).toHaveAttribute("aria-label", "Open project from session1")
      expect(buildBtn).toHaveAttribute("title", "Open project")
    })
  })

  test("launches two-step confirmation dialog when creating a project from a session card", async () => {
    mockListSessions.mockResolvedValue({
      targetName: "conn1",
      mode: "local",
      data: [{ name: "session1" }],
    })
    mockListProjects.mockResolvedValue([])
    mockCreateProject.mockResolvedValue({
      id: "p1",
      name: "session1",
      path: "",
      description: "",
      createdAt: "",
      updatedAt: "",
      sessionName: "session1",
      status: "stopped",
      workdir: "",
      layoutJson: "{}",
      detailsJson: "{}",
      progressJson: "{}",
      aiHtml: "",
      aiStatus: "idle",
      aiError: "",
      lastSyncedAt: null,
      schemaVersion: 1,
    })

    render(
      <TestWrapper>
        <Sidebar />
        <ConfirmDialog />
      </TestWrapper>,
    )

    // Wait for session card to render
    await waitFor(() => expect(screen.getByTestId("session-card-session1")).toBeInTheDocument())

    // Click the "Build project" button
    const buildButton = screen.getByTestId("build-project-session1")
    fireEvent.click(buildButton)

    // Assert first confirmation dialog is shown
    await waitFor(() => {
      expect(screen.getByText("Associate Project (Step 1/2)")).toBeInTheDocument()
    })

    // Click "Continue" to open the second step
    const continueButton = screen.getByTestId("confirm-dialog-confirm")
    fireEvent.click(continueButton)

    // Assert second confirmation dialog is shown
    await waitFor(() => {
      expect(screen.getByText("Confirm Association (Step 2/2)")).toBeInTheDocument()
    })

    // Click "Create Project" to complete the creation
    const confirmButton = screen.getByTestId("confirm-dialog-confirm")
    fireEvent.click(confirmButton)

    // Verify project creation was called and view was switched to projects
    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith({
        name: "session1",
        sessionName: "session1",
        path: "",
        description: "Imported from active session session1",
      })
      expect(screen.getByTestId("projects-view")).toBeInTheDocument()
    })
  })
})

describe("visibility gating for sidebar polling", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockListConnections.mockResolvedValue([{ targetName: "conn1", type: "local" }])
    mockListConnectionHealth.mockResolvedValue([])
    mockListSessions.mockResolvedValue({
      targetName: "conn1",
      mode: "local",
      data: [{ name: "session1" }],
    })
    mockFetchErrorLogs.mockResolvedValue({
      enabled: true,
      path: "/tmp/wmux-error.log",
      lines: [],
      truncated: false,
      maxLines: 1000,
    })
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    })
  })

  test("skips session sync polling when document is hidden", async () => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    })

    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mockListSessions).toHaveBeenCalledTimes(0)
  })

  test("skips error log badge polling when document is hidden", async () => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    })

    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })

    expect(mockFetchErrorLogs).toHaveBeenCalledTimes(0)
  })

  test("resumes session sync polling on visibility restore", async () => {
    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    const initialCallCount = mockListSessions.mock.calls.length

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    })
    document.dispatchEvent(new Event("visibilitychange"))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(mockListSessions.mock.calls.length).toBe(initialCallCount)

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    })
    document.dispatchEvent(new Event("visibilitychange"))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockListSessions.mock.calls.length).toBeGreaterThan(initialCallCount)
  })

  test("resumes error log badge polling on visibility restore", async () => {
    render(
      <TestWrapper>
        <Sidebar />
      </TestWrapper>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000)
    })

    const initialCallCount = mockFetchErrorLogs.mock.calls.length

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    })
    document.dispatchEvent(new Event("visibilitychange"))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })

    expect(mockFetchErrorLogs.mock.calls.length).toBe(initialCallCount)

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    })
    document.dispatchEvent(new Event("visibilitychange"))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockFetchErrorLogs.mock.calls.length).toBeGreaterThan(initialCallCount)
  })
})
