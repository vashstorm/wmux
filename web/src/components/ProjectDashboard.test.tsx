import { describe, test, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { ProjectDashboard } from "./ProjectDashboard.js"
import { AppProvider, useAppState } from "../state/store.js"
import type { Project } from "../api/client.js"
import * as client from "../api/client.js"

vi.mock("../api/client.js", () => ({
  syncProjectFromTmux: vi.fn(),
  generateProjectAiHtml: vi.fn(),
  getProject: vi.fn(),
}))

const mockSyncProjectFromTmux = vi.mocked(client.syncProjectFromTmux)
const mockGetProject = vi.mocked(client.getProject)

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <AppProvider>{children}</AppProvider>
}

function enableProject(project: Project | null) {
  function Opener() {
    const { setSelectedProject } = useAppState()
    useEffect(() => {
      setSelectedProject(project)
    }, [project, setSelectedProject])
    return null
  }
  return <Opener />
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Project",
    path: "/tmp/test",
    description: "A test project",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    sessionName: "my-session",
    status: "idle",
    workdir: "/tmp/test",
    layoutJson: "{}",
    detailsJson: "{}",
    progressJson: "{}",
    aiHtml: "",
    aiStatus: "idle",
    aiError: "",
    lastSyncedAt: null,
    schemaVersion: 1,
    ...overrides,
  }
}

describe("ProjectDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("renders null when no project selected", () => {
    const { container } = render(
      <TestWrapper>
        {enableProject(null)}
        <ProjectDashboard />
      </TestWrapper>,
    )
    expect(container.innerHTML).toBe("")
  })

  test("renders project name and title", () => {
    render(
      <TestWrapper>
        {enableProject(makeProject())}
        <ProjectDashboard />
      </TestWrapper>,
    )
    expect(screen.getByTestId("project-dashboard-title")).toHaveTextContent("Test Project")
  })

  test("renders all action buttons", () => {
    render(
      <TestWrapper>
        {enableProject(makeProject())}
        <ProjectDashboard />
      </TestWrapper>,
    )
    expect(screen.queryByTestId("project-launch-button")).not.toBeInTheDocument()
    expect(screen.getByTestId("project-sync-button")).toBeInTheDocument()
    expect(screen.getByTestId("project-ai-generate-button")).toBeInTheDocument()
  })

  test("displays project metadata", () => {
    render(
      <TestWrapper>
        {enableProject(
          makeProject({
            name: "My Project",
            sessionName: "dev-session",
            status: "running",
            workdir: "/Users/dev/project",
            description: "Test description",
          }),
        )}
        <ProjectDashboard />
      </TestWrapper>,
    )
    expect(screen.getByTestId("project-dashboard-title")).toHaveTextContent("My Project")
    expect(screen.getByText("dev-session")).toBeInTheDocument()
    expect(screen.queryAllByText("running")).toHaveLength(2)
    expect(screen.getByText("/Users/dev/project")).toBeInTheDocument()
    expect(screen.getByText("Test description")).toBeInTheDocument()
  })

  test("sync button calls syncProjectFromTmux API", async () => {
    const updatedProject = makeProject({ lastSyncedAt: "2025-01-01T00:00:00Z" })
    mockSyncProjectFromTmux.mockResolvedValue({ project: updatedProject, operation: "sync" })
    mockGetProject.mockResolvedValue(updatedProject)

    render(
      <TestWrapper>
        {enableProject(makeProject())}
        <ProjectDashboard />
      </TestWrapper>,
    )

    fireEvent.click(screen.getByTestId("project-sync-button"))

    await waitFor(() => {
      expect(mockSyncProjectFromTmux).toHaveBeenCalledWith("proj-1")
    })
  })

  test("API error on sync shows error message", async () => {
    const { ApiError } = await import("../api/errors.js")
    mockSyncProjectFromTmux.mockRejectedValue(new ApiError("bad_request", "Session conflict", 409))

    render(
      <TestWrapper>
        {enableProject(makeProject())}
        <ProjectDashboard />
      </TestWrapper>,
    )

    fireEvent.click(screen.getByTestId("project-sync-button"))

    await waitFor(() => {
      expect(screen.getByText("Session conflict")).toBeInTheDocument()
    })
  })

  test("action buttons disabled while another action is loading", async () => {
    const neverResolve = new Promise(() => {})
    mockSyncProjectFromTmux.mockReturnValue(neverResolve as never)

    render(
      <TestWrapper>
        {enableProject(makeProject())}
        <ProjectDashboard />
      </TestWrapper>,
    )

    fireEvent.click(screen.getByTestId("project-sync-button"))

    await waitFor(() => {
      expect((screen.getByTestId("project-ai-generate-button") as HTMLButtonElement).disabled).toBe(
        true,
      )
    })
  })

  test("displays layout summary when layoutJson contains windows", () => {
    render(
      <TestWrapper>
        {enableProject(
          makeProject({
            layoutJson: JSON.stringify({ windows: [{ id: "1" }, { id: "2" }] }),
          }),
        )}
        <ProjectDashboard />
      </TestWrapper>,
    )
    expect(screen.getByText("2 windows")).toBeInTheDocument()
  })

  test("displays generated AI HTML with status, size, and updated time", () => {
    render(
      <TestWrapper>
        {enableProject(
          makeProject({
            aiHtml: "<section><h2>Generated Summary</h2><p>Project is healthy.</p></section>",
            aiStatus: "completed",
            updatedAt: "2025-01-02T03:04:05Z",
          }),
        )}
        <ProjectDashboard />
      </TestWrapper>,
    )

    expect(screen.getByTestId("project-ai-html")).toBeInTheDocument()
    expect(screen.getByTestId("project-ai-html-content")).toHaveTextContent("Generated Summary")
    expect(screen.getByTestId("project-ai-meta")).toHaveTextContent("completed")
    expect(screen.getByTestId("project-ai-meta")).toHaveTextContent("B")
    expect(screen.getByTestId("project-ai-meta")).toHaveTextContent("Updated")
    expect(screen.getByText("AI Output")).toBeInTheDocument()
  })

  test("shows AI generation error in the main content panel", () => {
    render(
      <TestWrapper>
        {enableProject(
          makeProject({
            aiStatus: "error",
            aiError: "Provider timeout",
          }),
        )}
        <ProjectDashboard />
      </TestWrapper>,
    )

    expect(screen.getByText("Generation failed")).toBeInTheDocument()
    expect(screen.getByTestId("project-ai-error")).toHaveTextContent("Provider timeout")
    expect(screen.getByTestId("project-ai-status")).toHaveTextContent("error")
  })

  test("displays status chip with correct color", () => {
    const { container } = render(
      <TestWrapper>
        {enableProject(makeProject({ status: "running" }))}
        <ProjectDashboard />
      </TestWrapper>,
    )
    const chip = container.querySelector(".MuiChip-colorSuccess")!
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveTextContent("running")
  })
})
