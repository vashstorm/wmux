import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import type { ConnectionConfig } from "../api/client.js"
import type { SelectedPane } from "../state/store.js"
import { useWorkspaceNavigation } from "./useWorkspaceNavigation.js"
import * as workspaceUrl from "../navigation/workspaceUrl.js"
import * as apiClient from "../api/client.js"

let mockConnections: ConnectionConfig[] = []
let mockSelectedPane: SelectedPane | null = null
const mockStore = vi.hoisted(() => ({
  setSelectedTargetName: vi.fn(),
  setSessions: vi.fn(),
  setWindows: vi.fn(),
  setPanes: vi.fn(),
  setSelectedPane: vi.fn(),
}))

vi.mock("../state/store.js", () => {
  return {
    useAppState: () => ({
      connections: mockConnections,
      selectedPane: mockSelectedPane,
      setSelectedTargetName: mockStore.setSelectedTargetName,
      setSessions: mockStore.setSessions,
      setWindows: mockStore.setWindows,
      setPanes: mockStore.setPanes,
      setSelectedPane: mockStore.setSelectedPane,
    }),
  }
})

vi.mock("../api/client.js", () => ({
  listSessions: vi.fn(),
  listWindows: vi.fn(),
  listPanes: vi.fn(),
}))

vi.mock("../navigation/workspaceUrl.js", () => ({
  parseWorkspaceUrl: vi.fn(),
  formatWorkspaceUrl: vi.fn(),
  toSelectedPane: vi.fn(),
  fromSelectedPane: vi.fn(),
  getWorkspaceHistoryAction: vi.fn(),
}))

const mockPushState = vi.fn()
const mockReplaceState = vi.fn()
const mockAddEventListener = vi.fn()
const mockRemoveEventListener = vi.fn()

let originalLocation: typeof window.location
let originalHistory: typeof window.history
let originalAddEventListener: typeof window.addEventListener
let originalRemoveEventListener: typeof window.removeEventListener

function setLocationSearch(search: string): void {
  Object.defineProperty(window, "location", {
    value: {
      ...originalLocation,
      search: search,
      pathname: "/",
    },
    writable: true,
    configurable: true,
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.setSelectedTargetName.mockClear()
  mockStore.setSessions.mockClear()
  mockStore.setWindows.mockClear()
  mockStore.setPanes.mockClear()
  mockStore.setSelectedPane.mockClear()

  mockConnections = []
  mockSelectedPane = null

  originalLocation = window.location
  originalHistory = window.history
  originalAddEventListener = window.addEventListener
  originalRemoveEventListener = window.removeEventListener

  Object.defineProperty(window, "location", {
    value: { ...originalLocation, search: "", pathname: "/" },
    writable: true,
    configurable: true,
  })

  Object.defineProperty(window, "history", {
    value: { ...originalHistory, pushState: mockPushState, replaceState: mockReplaceState },
    writable: true,
    configurable: true,
  })

  Object.defineProperty(window, "addEventListener", {
    value: mockAddEventListener,
    writable: true,
    configurable: true,
  })

  Object.defineProperty(window, "removeEventListener", {
    value: mockRemoveEventListener,
    writable: true,
    configurable: true,
  })

  vi.mocked(workspaceUrl.formatWorkspaceUrl).mockImplementation((location: unknown) => {
    if (!location) return ""
    return "?mocked-url"
  })
  vi.mocked(workspaceUrl.fromSelectedPane).mockImplementation((pane: SelectedPane | null) => {
    if (!pane) return null
    return {
      connection: pane.targetName,
      session: pane.session,
      window: pane.window,
      pane: pane.pane,
    }
  })
  vi.mocked(workspaceUrl.getWorkspaceHistoryAction).mockReturnValue("push")
})

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(window, "history", {
    value: originalHistory,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(window, "addEventListener", {
    value: originalAddEventListener,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(window, "removeEventListener", {
    value: originalRemoveEventListener,
    writable: true,
    configurable: true,
  })
})

describe("useWorkspaceNavigation", () => {
  describe("initial mount with empty URL", () => {
    it("should not call API or setters when URL is empty", () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)

      renderHook(() => useWorkspaceNavigation())

      expect(vi.mocked(apiClient.listSessions)).not.toHaveBeenCalled()
      expect(vi.mocked(apiClient.listWindows)).not.toHaveBeenCalled()
      expect(vi.mocked(apiClient.listPanes)).not.toHaveBeenCalled()
    })

    it("should register popstate listener on mount", () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)

      renderHook(() => useWorkspaceNavigation())

      expect(mockAddEventListener).toHaveBeenCalledWith("popstate", expect.any(Function))
    })

    it("should unregister popstate listener on unmount", () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)

      const { unmount } = renderHook(() => useWorkspaceNavigation())

      unmount()

      expect(mockRemoveEventListener).toHaveBeenCalledWith("popstate", expect.any(Function))
    })
  })

  describe("initial mount with valid URL", () => {
    it("should wait for connections and restore state when URL has connection+session", async () => {
      const location = { connection: "local", session: "session1" }

      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(location)
      vi.mocked(workspaceUrl.toSelectedPane).mockReturnValue({
        targetName: "local",
        session: "session1",
      })

      vi.mocked(apiClient.listSessions).mockResolvedValue({
        targetName: "local",
        mode: "local",
        data: [{ name: "session1", id: "session1" }],
      })

      const { rerender } = renderHook(() => useWorkspaceNavigation())

      expect(vi.mocked(apiClient.listSessions)).not.toHaveBeenCalled()

      mockConnections = [{ targetName: "local", type: "local" }]

      act(() => {
        rerender()
      })

      expect(vi.mocked(apiClient.listSessions)).toHaveBeenCalledWith("local")
    })

    it("should call listWindows and listPanes when URL has session only, selects first window and active pane", async () => {
      const location = { connection: "local", session: "session1" }
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(location)
      vi.mocked(workspaceUrl.toSelectedPane).mockReturnValue({
        targetName: "local",
        session: "session1",
      })

      mockConnections = [{ targetName: "local", type: "local" }]

      vi.mocked(apiClient.listSessions).mockResolvedValue({
        targetName: "local",
        mode: "local",
        data: [{ name: "session1", id: "session1" }],
      })

      vi.mocked(apiClient.listWindows).mockResolvedValue({
        targetName: "local",
        session: "session1",
        mode: "local",
        data: [
          {
            ID: "w1",
            Name: "win1",
            Index: 0,
            Active: true,
            PaneCount: 2,
            ActivePaneID: "p2",
            ActivePaneTitle: "bash",
          },
        ],
      })

      vi.mocked(apiClient.listPanes).mockResolvedValue({
        targetName: "local",
        session: "session1",
        window: "w1",
        mode: "local",
        data: [
          {
            ID: "p1",
            Title: "zsh",
            Index: 0,
            Active: false,
            Width: 80,
            Height: 24,
            Left: 0,
            Top: 0,
          },
          {
            ID: "p2",
            Title: "bash",
            Index: 1,
            Active: true,
            Width: 80,
            Height: 24,
            Left: 0,
            Top: 0,
          },
        ],
      })

      renderHook(() => useWorkspaceNavigation())

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(vi.mocked(apiClient.listSessions)).toHaveBeenCalledWith("local")
      expect(vi.mocked(apiClient.listWindows)).toHaveBeenCalledWith("local", "session1")
      expect(vi.mocked(apiClient.listPanes)).toHaveBeenCalledWith("local", "session1", "w1")
    })

    it("should call listWindows, listPanes when URL has window+pane", async () => {
      const location = {
        connection: "local",
        session: "session1",
        window: "window1",
        pane: "pane1",
      }

      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(location)
      vi.mocked(workspaceUrl.toSelectedPane).mockReturnValue({
        targetName: "local",
        session: "session1",
        window: "window1",
        pane: "pane1",
      })

      mockConnections = [{ targetName: "local", type: "local" }]

      vi.mocked(apiClient.listSessions).mockResolvedValue({
        targetName: "local",
        mode: "local",
        data: [{ name: "session1", id: "session1" }],
      })

      vi.mocked(apiClient.listWindows).mockResolvedValue({
        targetName: "local",
        session: "session1",
        mode: "local",
        data: [
          {
            ID: "window1",
            Name: "win1",
            Index: 0,
            Active: true,
            PaneCount: 1,
            ActivePaneID: "pane1",
            ActivePaneTitle: "test",
          },
        ],
      })

      vi.mocked(apiClient.listPanes).mockResolvedValue({
        targetName: "local",
        session: "session1",
        window: "window1",
        mode: "local",
        data: [
          {
            ID: "pane1",
            Title: "test",
            Index: 0,
            Active: true,
            Width: 80,
            Height: 24,
            Left: 0,
            Top: 0,
          },
        ],
      })

      renderHook(() => useWorkspaceNavigation())

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(vi.mocked(apiClient.listSessions)).toHaveBeenCalledWith("local")
      expect(vi.mocked(apiClient.listWindows)).toHaveBeenCalledWith("local", "session1")
      expect(vi.mocked(apiClient.listPanes)).toHaveBeenCalledWith("local", "session1", "window1")
    })

    it("should not restore stale URL selection after the user switches sessions during startup", async () => {
      const location = { connection: "local", session: "session1" }
      const windowsDeferred = deferred<Awaited<ReturnType<typeof apiClient.listWindows>>>()

      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(location)
      vi.mocked(workspaceUrl.toSelectedPane).mockReturnValue({
        targetName: "local",
        session: "session1",
      })

      mockConnections = [{ targetName: "local", type: "local" }]

      vi.mocked(apiClient.listSessions).mockResolvedValue({
        targetName: "local",
        mode: "local",
        data: [{ name: "session1", id: "session1" }],
      })

      vi.mocked(apiClient.listWindows).mockReturnValue(windowsDeferred.promise)
      vi.mocked(apiClient.listPanes).mockResolvedValue({
        targetName: "local",
        session: "session1",
        window: "w1",
        mode: "local",
        data: [
          {
            ID: "p1",
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

      const { rerender } = renderHook(() => useWorkspaceNavigation())

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(vi.mocked(apiClient.listWindows)).toHaveBeenCalledWith("local", "session1")

      mockSelectedPane = { targetName: "local", session: "session2", window: "@2", pane: "%2" }
      act(() => {
        rerender()
      })

      expect(mockPushState).toHaveBeenCalledWith(null, "", "?mocked-url")

      await act(async () => {
        windowsDeferred.resolve({
          targetName: "local",
          session: "session1",
          mode: "local",
          data: [
            {
              ID: "w1",
              Name: "win1",
              Index: 0,
              Active: true,
              PaneCount: 1,
              ActivePaneID: "p1",
              ActivePaneTitle: "bash",
            },
          ],
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(mockStore.setSelectedPane).not.toHaveBeenCalledWith(
        expect.objectContaining({ session: "session1" }),
      )
    })
  })

  describe("stale URL handling", () => {
    it("should setSelectedPane(null) and replaceState to base when session not found", async () => {
      const location = { connection: "local", session: "nonexistent-session" }

      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(location)
      vi.mocked(workspaceUrl.toSelectedPane).mockReturnValue({
        targetName: "local",
        session: "nonexistent-session",
      })

      mockConnections = [{ targetName: "local", type: "local" }]

      vi.mocked(apiClient.listSessions).mockResolvedValue({
        targetName: "local",
        mode: "local",
        data: [],
      })

      renderHook(() => useWorkspaceNavigation())

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(mockReplaceState).toHaveBeenCalledWith(null, "", "/")
    })

    it("should setSelectedPane(null) and replaceState to base when API throws error", async () => {
      const location = { connection: "local", session: "session1" }

      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(location)
      vi.mocked(workspaceUrl.toSelectedPane).mockReturnValue({
        targetName: "local",
        session: "session1",
      })

      mockConnections = [{ targetName: "local", type: "local" }]
      vi.mocked(apiClient.listSessions).mockRejectedValue(new Error("Connection not found"))

      renderHook(() => useWorkspaceNavigation())

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(mockReplaceState).toHaveBeenCalledWith(null, "", "/")
    })

    it("should setSelectedPane(null) when window not found", async () => {
      const location = { connection: "local", session: "session1", window: "nonexistent-window" }

      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(location)
      vi.mocked(workspaceUrl.toSelectedPane).mockReturnValue({
        targetName: "local",
        session: "session1",
        window: "nonexistent-window",
      })

      mockConnections = [{ targetName: "local", type: "local" }]

      vi.mocked(apiClient.listSessions).mockResolvedValue({
        targetName: "local",
        mode: "local",
        data: [{ name: "session1", id: "session1" }],
      })

      vi.mocked(apiClient.listWindows).mockResolvedValue({
        targetName: "local",
        session: "session1",
        mode: "local",
        data: [],
      })

      renderHook(() => useWorkspaceNavigation())

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(vi.mocked(apiClient.listSessions)).toHaveBeenCalledWith("local")
      expect(vi.mocked(apiClient.listWindows)).toHaveBeenCalledWith("local", "session1")
      expect(mockReplaceState).toHaveBeenCalledWith(null, "", "/")
    })

    it("should setSelectedPane(null) when pane not found", async () => {
      const location = {
        connection: "local",
        session: "session1",
        window: "window1",
        pane: "nonexistent-pane",
      }

      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(location)
      vi.mocked(workspaceUrl.toSelectedPane).mockReturnValue({
        targetName: "local",
        session: "session1",
        window: "window1",
        pane: "nonexistent-pane",
      })

      mockConnections = [{ targetName: "local", type: "local" }]

      vi.mocked(apiClient.listSessions).mockResolvedValue({
        targetName: "local",
        mode: "local",
        data: [{ name: "session1", id: "session1" }],
      })

      vi.mocked(apiClient.listWindows).mockResolvedValue({
        targetName: "local",
        session: "session1",
        mode: "local",
        data: [
          {
            ID: "window1",
            Name: "win1",
            Index: 0,
            Active: true,
            PaneCount: 1,
            ActivePaneID: "pane1",
            ActivePaneTitle: "test",
          },
        ],
      })

      vi.mocked(apiClient.listPanes).mockResolvedValue({
        targetName: "local",
        session: "session1",
        window: "window1",
        mode: "local",
        data: [
          {
            ID: "pane1",
            Title: "test",
            Index: 0,
            Active: true,
            Width: 80,
            Height: 24,
            Left: 0,
            Top: 0,
          },
        ],
      })

      renderHook(() => useWorkspaceNavigation())

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(vi.mocked(apiClient.listSessions)).toHaveBeenCalledWith("local")
      expect(vi.mocked(apiClient.listWindows)).toHaveBeenCalledWith("local", "session1")
      expect(vi.mocked(apiClient.listPanes)).toHaveBeenCalledWith("local", "session1", "window1")
      expect(mockReplaceState).toHaveBeenCalledWith(null, "", "/")
    })
  })

  describe("selectedPane change -> URL write", () => {
    it("should call pushState when selectedPane changes from null to session", () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)
      mockConnections = [{ targetName: "local", type: "local" }]

      mockSelectedPane = null
      vi.mocked(workspaceUrl.getWorkspaceHistoryAction).mockReturnValue("push")
      vi.mocked(workspaceUrl.formatWorkspaceUrl).mockReturnValue(
        "?connection=local&session=session1",
      )

      const { rerender } = renderHook(() => useWorkspaceNavigation())

      mockSelectedPane = { targetName: "local", session: "session1" }

      act(() => {
        rerender()
      })

      expect(mockPushState).toHaveBeenCalledWith(null, "", "?connection=local&session=session1")
    })

    it("should call replaceState when pane-only change within same window", () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)
      mockConnections = [{ targetName: "local", type: "local" }]

      mockSelectedPane = {
        targetName: "local",
        session: "session1",
        window: "window1",
        pane: "pane1",
      }
      vi.mocked(workspaceUrl.getWorkspaceHistoryAction).mockReturnValue("replace")
      vi.mocked(workspaceUrl.formatWorkspaceUrl).mockReturnValue(
        "?connection=local&session=session1&window=window1&pane=pane2",
      )

      const { rerender } = renderHook(() => useWorkspaceNavigation())

      mockSelectedPane = {
        targetName: "local",
        session: "session1",
        window: "window1",
        pane: "pane2",
      }

      act(() => {
        rerender()
      })

      expect(mockReplaceState).toHaveBeenCalledWith(
        null,
        "",
        "?connection=local&session=session1&window=window1&pane=pane2",
      )
      expect(mockPushState).not.toHaveBeenCalled()
    })

    it("should call pushState when session changes", () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)
      mockConnections = [{ targetName: "local", type: "local" }]

      mockSelectedPane = { targetName: "local", session: "session1" }
      vi.mocked(workspaceUrl.getWorkspaceHistoryAction).mockReturnValue("push")
      vi.mocked(workspaceUrl.formatWorkspaceUrl).mockReturnValue(
        "?connection=local&session=session2",
      )

      const { rerender } = renderHook(() => useWorkspaceNavigation())

      mockSelectedPane = { targetName: "local", session: "session2" }

      act(() => {
        rerender()
      })

      expect(mockPushState).toHaveBeenCalledWith(null, "", "?connection=local&session=session2")
    })

    it("should call replaceState with base URL when selectedPane becomes null", () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)
      mockConnections = [{ targetName: "local", type: "local" }]

      mockSelectedPane = { targetName: "local", session: "session1" }
      vi.mocked(workspaceUrl.getWorkspaceHistoryAction).mockReturnValue("replace")
      vi.mocked(workspaceUrl.formatWorkspaceUrl).mockImplementation((location: unknown) => {
        if (!location) return ""
        return "?connection=local&session=session1"
      })

      const { rerender } = renderHook(() => useWorkspaceNavigation())

      mockSelectedPane = null

      act(() => {
        rerender()
      })

      expect(mockReplaceState).toHaveBeenCalledWith(null, "", "/")
    })

    it("should skip duplicate URL writes", () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)
      mockConnections = [{ targetName: "local", type: "local" }]

      mockSelectedPane = { targetName: "local", session: "session1" }
      vi.mocked(workspaceUrl.formatWorkspaceUrl).mockReturnValue(
        "?connection=local&session=session1",
      )

      const { rerender } = renderHook(() => useWorkspaceNavigation())

      expect(mockPushState).toHaveBeenCalledTimes(1)

      mockPushState.mockClear()

      act(() => {
        rerender()
      })

      expect(mockPushState).not.toHaveBeenCalled()
    })
  })

  describe("popstate event handling", () => {
    it("should restore from URL without calling pushState/replaceState during popstate", async () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)
      mockConnections = [{ targetName: "local", type: "local" }]

      renderHook(() => useWorkspaceNavigation())

      const popstateHandler = mockAddEventListener.mock.calls.find(
        (call) => call[0] === "popstate",
      )?.[1]

      if (!popstateHandler) throw new Error("popstate handler not registered")

      setLocationSearch("?connection=local&session=session2")
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue({
        connection: "local",
        session: "session2",
      })
      vi.mocked(workspaceUrl.toSelectedPane).mockReturnValue({
        targetName: "local",
        session: "session2",
      })

      await act(async () => {
        popstateHandler()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(mockPushState).not.toHaveBeenCalled()
      expect(mockReplaceState).not.toHaveBeenCalled()
    })

    it("should handle popstate with null URL", async () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)
      mockConnections = [{ targetName: "local", type: "local" }]

      renderHook(() => useWorkspaceNavigation())

      const popstateHandler = mockAddEventListener.mock.calls.find(
        (call) => call[0] === "popstate",
      )?.[1]

      if (!popstateHandler) throw new Error("popstate handler not registered")

      setLocationSearch("")
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)

      await act(async () => {
        popstateHandler()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    })
  })

  describe("connections not yet available", () => {
    it("should wait for connections before restoring URL", () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue({
        connection: "local",
        session: "session1",
      })
      vi.mocked(workspaceUrl.toSelectedPane).mockReturnValue({
        targetName: "local",
        session: "session1",
      })

      vi.mocked(apiClient.listSessions).mockResolvedValue({
        targetName: "local",
        mode: "local",
        data: [{ name: "session1", id: "session1" }],
      })

      renderHook(() => useWorkspaceNavigation())

      expect(vi.mocked(apiClient.listSessions)).not.toHaveBeenCalled()
    })
  })

  describe("suppressCountRef reset", () => {
    it("should allow URL write after stale URL restore sets selectedPane to same value (null → null)", async () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue({
        connection: "local",
        session: "nonexistent-session",
      })
      mockConnections = [{ targetName: "local", type: "local" }]
      mockSelectedPane = null

      vi.mocked(apiClient.listSessions).mockResolvedValue({
        targetName: "local",
        mode: "local",
        data: [],
      })

      const { rerender } = renderHook(() => useWorkspaceNavigation())

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      mockPushState.mockClear()
      mockReplaceState.mockClear()

      vi.mocked(workspaceUrl.formatWorkspaceUrl).mockReturnValue(
        "?connection=local&session=session1",
      )
      vi.mocked(workspaceUrl.getWorkspaceHistoryAction).mockReturnValue("push")
      mockSelectedPane = { targetName: "local", session: "session1" }

      act(() => {
        rerender()
      })

      expect(mockPushState).toHaveBeenCalledWith(null, "", "?connection=local&session=session1")
    })

    it("should allow URL write after popstate sets selectedPane to same value", async () => {
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)
      mockConnections = [{ targetName: "local", type: "local" }]
      mockSelectedPane = null

      const { rerender } = renderHook(() => useWorkspaceNavigation())

      const popstateHandler = mockAddEventListener.mock.calls.find(
        (call) => call[0] === "popstate",
      )?.[1]
      if (!popstateHandler) throw new Error("popstate handler not registered")

      setLocationSearch("")
      vi.mocked(workspaceUrl.parseWorkspaceUrl).mockReturnValue(null)

      await act(async () => {
        popstateHandler()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      mockPushState.mockClear()
      mockReplaceState.mockClear()

      vi.mocked(workspaceUrl.formatWorkspaceUrl).mockReturnValue(
        "?connection=local&session=session1",
      )
      vi.mocked(workspaceUrl.getWorkspaceHistoryAction).mockReturnValue("push")
      mockSelectedPane = { targetName: "local", session: "session1" }

      act(() => {
        rerender()
      })

      expect(mockPushState).toHaveBeenCalledWith(null, "", "?connection=local&session=session1")
    })
  })
})
