import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import {
  fetchHealth,
  listConnections,
  createConnection,
  getConnection,
  updateConnection,
  deleteConnection,
  listSessions,
  listWindows,
  listPanes,
  createSession,
  getConfig,
  updateConfig,
  listConnectionHealth,
  getConnectionHealth,
  fetchErrorLogs,
  clearErrorLogs,
  listProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  launchProject,
  syncProjectFromTmux,
  getOmniHistory,
  clearOmniHistory,
  listAiLogs,
  clearAiLogs,
} from "./client.js"
import { ApiError } from "./errors.js"

const mockInvoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

const invoke = {
  configure: (config: {
    successResults?: Record<string, unknown>
    errorResponses?: Record<string, { code: string; message: string }>
  }) => {
    mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      const errorResponse = config.errorResponses?.[cmd]
      if (errorResponse) {
        const error = new Error(errorResponse.message) as Error & { code: string }
        error.code = errorResponse.code
        throw error
      }
      const successResult = config.successResults?.[cmd]
      if (successResult !== undefined) {
        return successResult
      }
      return undefined
    })
  },
  mockFn: mockInvoke,
}

describe("api client", () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("fetchHealth returns status", async () => {
    invoke.configure({
      successResults: { get_health: { status: "ok" } },
    })
    const result = await fetchHealth()
    expect(result.status).toBe("ok")
  })

  test("listConnections returns data array", async () => {
    invoke.configure({
      successResults: { list_connections: [{ targetName: "1", type: "local" }] },
    })
    const result = await listConnections()
    expect(result).toHaveLength(1)
    expect(result[0]!.targetName).toBe("1")
    expect(result[0]!.type).toBe("local")
  })

  test("listConnections normalizes config-style ids", async () => {
    invoke.configure({
      successResults: { list_connections: [{ id: "local-dev", type: "local" }] },
    })
    const result = await listConnections()
    expect(result[0]!.targetName).toBe("local-dev")
    expect(result[0]!.id).toBe("local-dev")
  })

  test("createConnection POSTs payload", async () => {
    invoke.configure({
      successResults: { create_connection: { targetName: "2", type: "local" } },
    })
    const result = await createConnection({ type: "local" })
    expect(result.type).toBe("local")

    expect(invoke.mockFn).toHaveBeenCalledWith("create_connection", {
      connection: { type: "local" },
    })
  })

  test("getConnection fetches by id", async () => {
    invoke.configure({
      successResults: { get_connection: { targetName: "1", type: "local" } },
    })
    const result = await getConnection("1")
    expect(result.targetName).toBe("1")
  })

  test("updateConnection PUTs payload", async () => {
    invoke.configure({
      successResults: { update_connection: { targetName: "1", type: "local" } },
    })
    const result = await updateConnection("1", { targetName: "1", type: "local" })
    expect(result.type).toBe("local")

    expect(invoke.mockFn).toHaveBeenCalledWith("update_connection", {
      id: "1",
      connection: { targetName: "1", type: "local" },
    })
  })

  test("deleteConnection sends DELETE", async () => {
    invoke.configure({
      successResults: { delete_connection: undefined },
    })
    await deleteConnection("1")

    expect(invoke.mockFn).toHaveBeenCalledWith("delete_connection", { id: "1" })
  })

  test("listSessions normalizes mixed formats", async () => {
    invoke.configure({
      successResults: {
        list_sessions: {
          targetName: "1",
          mode: "local",
          data: ["session1", { name: "session2" }, { Name: "session3" }],
        },
      },
    })
    const result = await listSessions("1")
    expect(result.data).toHaveLength(3)
    expect(result.data[0]!.name).toBe("session1")
    expect(result.data[1]!.name).toBe("session2")
    expect(result.data[2]!.name).toBe("session3")
  })

  test("listWindows returns windows", async () => {
    invoke.configure({
      successResults: {
        list_windows: {
          targetName: "1",
          session: "dev",
          mode: "local",
          data: [{ ID: "@1", Name: "editor", Index: 0, Active: true }],
        },
      },
    })
    const result = await listWindows("1", "dev")
    expect(result.data[0]!.Name).toBe("editor")
  })

  test("listWindows normalizes Rust camelCase fields", async () => {
    invoke.configure({
      successResults: {
        list_windows: {
          targetName: "1",
          session: "dev",
          mode: "local",
          data: [
            {
              id: "@1",
              name: "editor",
              index: 0,
              active: true,
              paneCount: 1,
              activePaneId: "%1",
              activePaneTitle: "shell",
              attentionState: "attention",
              attentionCount: 1,
              intelligenceSummary: "Window summary",
            },
          ],
        },
      },
    })
    const result = await listWindows("1", "dev")
    expect(result.data[0]!.ID).toBe("@1")
    expect(result.data[0]!.Active).toBe(true)
    expect(result.data[0]!.ActivePaneID).toBe("%1")
    expect(result.data[0]!.AttentionState).toBe("attention")
    expect(result.data[0]!.IntelligenceSummary).toBe("Window summary")
  })

  test("listPanes returns panes", async () => {
    invoke.configure({
      successResults: {
        list_panes: {
          targetName: "1",
          session: "dev",
          window: "@1",
          mode: "local",
          data: [{ ID: "%1", Title: "shell", Index: 0, Active: true, Width: 80, Height: 24 }],
        },
      },
    })
    const result = await listPanes("1", "dev", "@1")
    expect(result.data[0]!.Title).toBe("shell")
  })

  test("listPanes normalizes Rust camelCase fields", async () => {
    invoke.configure({
      successResults: {
        list_panes: {
          targetName: "1",
          session: "dev",
          window: "@1",
          mode: "local",
          data: [
            {
              id: "%1",
              title: "shell",
              index: 0,
              active: true,
              width: 80,
              height: 24,
              left: 0,
              top: 0,
              attentionState: "none",
            },
          ],
        },
      },
    })
    const result = await listPanes("1", "dev", "@1")
    expect(result.data[0]!.ID).toBe("%1")
    expect(result.data[0]!.Active).toBe(true)
    expect(result.data[0]!.Width).toBe(80)
    expect(result.data[0]!.AttentionState).toBe("none")
  })

  test("createSession POSTs name", async () => {
    invoke.configure({
      successResults: {
        create_session: {
          targetName: "1",
          operation: "create_session",
          mode: "local",
          status: "ok",
        },
      },
    })
    await createSession("1", "new-session")

    expect(invoke.mockFn).toHaveBeenCalledWith("create_session", {
      target: "1",
      name: "new-session",
    })
  })

  test("getConfig returns config", async () => {
    invoke.configure({
      successResults: {
        get_config: {
          schemaVersion: 1,
          path: ".",
          server: { bind: "127.0.0.1:7331" },
          auth: { token: "" },
          tmux: { path: "tmux" },
          connections: [],
          ui: {
            theme: "dark",
            windowTheme: "dark",
            fontSize: 14,
            terminalFontSize: 14,
            terminalFontWeight: "normal",
          },
          intelligence: {
            enabled: false,
            providers: [],
            maxBytes: 12000,
            timeoutSec: 8,
            minSessionIntervalSec: 60,
            maxConcurrency: 3,
            cacheTTLSec: 300,
          },
        },
      },
    })
    const result = await getConfig()
    expect(result.schemaVersion).toBe(1)
  })

  test("getConfig normalizes config connection ids to targetName", async () => {
    invoke.configure({
      successResults: {
        get_config: {
          schemaVersion: 1,
          path: ".",
          server: { bind: "127.0.0.1:7331" },
          auth: { token: "" },
          tmux: { path: "tmux" },
          connections: [{ id: "local-dev", type: "local" }],
          ui: {
            theme: "dark",
            windowTheme: "dark",
            fontSize: 14,
            terminalFontSize: 14,
            terminalFontWeight: "normal",
          },
          intelligence: {
            enabled: false,
            providers: [],
            maxBytes: 12000,
            timeoutSec: 8,
            minSessionIntervalSec: 60,
            maxConcurrency: 3,
            cacheTTLSec: 300,
          },
        },
      },
    })
    const result = await getConfig()
    expect(result.connections[0]!.targetName).toBe("local-dev")
    expect(result.connections[0]!.id).toBe("local-dev")
  })

  test("updateConfig PUTs payload", async () => {
    invoke.configure({
      successResults: {
        update_config: {
          schemaVersion: 1,
          path: ".",
          server: { bind: "127.0.0.1:7331" },
          auth: { token: "" },
          tmux: { path: "tmux" },
          connections: [],
          ui: {
            theme: "light",
            windowTheme: "light",
            fontSize: 14,
            terminalFontSize: 14,
            terminalFontWeight: "normal",
          },
          intelligence: {
            enabled: false,
            providers: [],
            maxBytes: 12000,
            timeoutSec: 8,
            minSessionIntervalSec: 60,
            maxConcurrency: 3,
            cacheTTLSec: 300,
          },
        },
      },
    })
    const result = await updateConfig({
      schemaVersion: 1,
      path: ".",
      server: { bind: "127.0.0.1:7331" },
      auth: { token: "" },
      tmux: { path: "tmux" },
      connections: [],
      ui: {
        theme: "light",
        windowTheme: "light",
        fontSize: 14,
        terminalFontSize: 14,
        terminalFontWeight: "normal",
      },
      intelligence: {
        enabled: false,
        providers: [],
        maxBytes: 12000,
        timeoutSec: 8,
        minSessionIntervalSec: 60,
        maxConcurrency: 3,
        cacheTTLSec: 300,
      },
    })
    expect(result.ui.theme).toBe("light")
  })

  test("updateConfig writes targetName connections as config ids", async () => {
    invoke.configure({
      successResults: {
        update_config: {
          schemaVersion: 1,
          path: ".",
          server: { bind: "127.0.0.1:7331" },
          auth: { token: "" },
          tmux: { path: "tmux" },
          connections: [{ id: "local-dev", type: "local" }],
          ui: {
            theme: "dark",
            windowTheme: "dark",
            fontSize: 14,
            terminalFontSize: 14,
            terminalFontWeight: "normal",
          },
          intelligence: {
            enabled: false,
            providers: [],
            maxBytes: 12000,
            timeoutSec: 8,
            minSessionIntervalSec: 60,
            maxConcurrency: 3,
            cacheTTLSec: 300,
          },
        },
      },
    })
    await updateConfig({
      schemaVersion: 1,
      path: ".",
      server: { bind: "127.0.0.1:7331" },
      auth: { token: "" },
      tmux: { path: "tmux" },
      connections: [{ targetName: "local-dev", type: "local" }],
      ui: {
        theme: "dark",
        windowTheme: "dark",
        fontSize: 14,
        terminalFontSize: 14,
        terminalFontWeight: "normal",
      },
      intelligence: {
        enabled: false,
        providers: [],
        maxBytes: 12000,
        timeoutSec: 8,
        minSessionIntervalSec: 60,
        maxConcurrency: 3,
        cacheTTLSec: 300,
      },
    })

    const call = invoke.mockFn.mock.calls[0]!
    expect(call[0]).toBe("update_config")
    const body = call[1] as { config: { connections: Array<{ id: string; type: string }> } }
    expect(body.config.connections).toEqual([{ id: "local-dev", type: "local" }])
  })

  test("listConnectionHealth returns health data", async () => {
    invoke.configure({
      successResults: {
        list_connections_health: [
          { targetName: "1", status: "online", checkedAt: "2024-01-01T00:00:00Z" },
        ],
      },
    })
    const result = await listConnectionHealth()
    expect(result[0]!.status).toBe("online")
  })

  test("getConnectionHealth returns single health", async () => {
    invoke.configure({
      successResults: {
        connection_health: { targetName: "1", status: "online", checkedAt: "2024-01-01T00:00:00Z" },
      },
    })
    const result = await getConnectionHealth("1")
    expect(result.status).toBe("online")
  })

  test("throws ApiError with parsed code and message", async () => {
    invoke.configure({
      errorResponses: { list_connections: { code: "unauthorized", message: "bad token" } },
    })
    await expect(listConnections()).rejects.toMatchObject({
      code: "unauthorized",
      message: "bad token",
      status: 500,
    })
  })

  test("throws ApiError with fallback for non-JSON error", async () => {
    invoke.configure({
      errorResponses: { list_connections: { code: "internal_error", message: "Server Error" } },
    })
    await expect(listConnections()).rejects.toMatchObject({
      code: "internal_error",
      message: "Server Error",
      status: 500,
    })
  })

  test("URL encodes path parameters", async () => {
    invoke.configure({
      successResults: { get_connection: { targetName: "conn#1", type: "local" } },
    })
    await getConnection("conn#1")

    expect(invoke.mockFn).toHaveBeenCalledWith("get_connection", {
      id: "conn#1",
    })
  })

  test("fetchErrorLogs returns error log lines", async () => {
    invoke.configure({
      successResults: {
        get_error_logs: {
          enabled: true,
          path: "/tmp/wmux-error.log",
          lines: ["ERROR test"],
          truncated: false,
          maxLines: 1000,
        },
      },
    })
    const result = await fetchErrorLogs()
    expect(result.enabled).toBe(true)
    expect(result.path).toBe("/tmp/wmux-error.log")
    expect(result.lines).toEqual(["ERROR test"])
    expect(result.truncated).toBe(false)
    expect(result.maxLines).toBe(1000)
  })

  test("clearErrorLogs sends DELETE request", async () => {
    invoke.configure({
      successResults: { clear_error_logs: undefined },
    })
    await clearErrorLogs()

    expect(invoke.mockFn).toHaveBeenCalledWith("clear_error_logs", undefined)
  })

  test("fetchErrorLogs handles truncated response", async () => {
    invoke.configure({
      successResults: {
        get_error_logs: {
          enabled: true,
          path: "/tmp/wmux-error.log",
          lines: ["line1", "line2"],
          truncated: true,
          maxLines: 1000,
        },
      },
    })
    const result = await fetchErrorLogs()
    expect(result.truncated).toBe(true)
    expect(result.lines).toHaveLength(2)
  })

  test("fetchErrorLogs returns disabled state", async () => {
    invoke.configure({
      successResults: {
        get_error_logs: {
          enabled: false,
          path: null,
          lines: [],
          truncated: false,
          maxLines: 1000,
        },
      },
    })
    const result = await fetchErrorLogs()
    expect(result.enabled).toBe(false)
    expect(result.path).toBeNull()
    expect(result.lines).toEqual([])
  })

  test("clearErrorLogs does not throw", async () => {
    invoke.configure({
      successResults: { clear_error_logs: undefined },
    })
    await expect(clearErrorLogs()).resolves.toBeUndefined()
  })

  describe("projects", () => {
    test("listProjects returns data array", async () => {
      invoke.configure({
        successResults: {
          list_projects: {
            data: [
              {
                id: "a1",
                name: "proj",
                path: "/tmp",
                description: "",
                createdAt: "2024-01-01T00:00:00Z",
                updatedAt: "2024-01-01T00:00:00Z",
              },
            ],
          },
        },
      })
      const result = await listProjects()
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe("proj")
    })

    test("createProject POSTs payload and returns project", async () => {
      invoke.configure({
        successResults: {
          create_project: {
            id: "a1",
            name: "proj",
            path: "/tmp",
            description: "",
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
          },
        },
      })
      const result = await createProject({ name: "proj", path: "/tmp" })
      expect(result.name).toBe("proj")

      expect(invoke.mockFn).toHaveBeenCalledWith("create_project", {
        payload: { name: "proj", path: "/tmp" },
      })
    })

    test("getProject fetches by id", async () => {
      invoke.configure({
        successResults: {
          get_project: {
            id: "a1",
            name: "proj",
            path: "",
            description: "",
            createdAt: "",
            updatedAt: "",
          },
        },
      })
      const result = await getProject("a1")
      expect(result.id).toBe("a1")
      expect(result.name).toBe("proj")
    })

    test("updateProject PUTs payload", async () => {
      invoke.configure({
        successResults: {
          update_project: {
            id: "a1",
            name: "updated",
            path: "/new",
            description: "",
            createdAt: "",
            updatedAt: "",
          },
        },
      })
      const result = await updateProject("a1", { name: "updated", path: "/new" })
      expect(result.name).toBe("updated")

      expect(invoke.mockFn).toHaveBeenCalledWith("update_project", {
        id: "a1",
        payload: { name: "updated", path: "/new" },
      })
    })

    test("deleteProject sends DELETE and handles", async () => {
      invoke.configure({
        successResults: { delete_project: undefined },
      })
      await expect(deleteProject("a1")).resolves.toBeUndefined()

      expect(invoke.mockFn).toHaveBeenCalledWith("delete_project", {
        id: "a1",
        killSession: false,
      })
    })

    test("project duplicate name throws ApiError", async () => {
      invoke.configure({
        errorResponses: {
          create_project: { code: "conflict", message: "project name already exists" },
        },
      })
      await expect(createProject({ name: "dup" })).rejects.toThrow(ApiError)
      try {
        await createProject({ name: "dup" })
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).code).toBe("conflict")
      }
    })

    test("launchProject POSTs to launch endpoint and returns ProjectActionResponse", async () => {
      invoke.configure({
        successResults: {
          launch_project: {
            project: {
              id: "a1",
              name: "proj",
              path: "/tmp",
              description: "",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
              sessionName: "proj",
              status: "active",
              workdir: "",
              layoutJson: "{}",
              detailsJson: "{}",
              progressJson: "{}",
              aiHtml: "",
              aiStatus: "idle",
              aiError: "",
              lastSyncedAt: "2024-01-01T00:00:00Z",
              schemaVersion: 1,
            },
            operation: "launch",
          },
        },
      })
      const result = await launchProject("a1")
      expect(result.project.id).toBe("a1")
      expect(result.operation).toBe("launch")

      expect(invoke.mockFn).toHaveBeenCalledWith("launch_project", { id: "a1" })
    })

    test("launchProject sends id param", async () => {
      invoke.configure({
        successResults: {
          launch_project: {
            project: {
              id: "proj#1",
              name: "proj",
              path: "",
              description: "",
              createdAt: "",
              updatedAt: "",
              sessionName: "",
              status: "",
              workdir: "",
              layoutJson: "",
              detailsJson: "",
              progressJson: "",
              aiHtml: "",
              aiStatus: "",
              aiError: "",
              lastSyncedAt: null,
              schemaVersion: 1,
            },
            operation: "launch",
          },
        },
      })
      await launchProject("proj#1")

      expect(invoke.mockFn).toHaveBeenCalledWith("launch_project", { id: "proj#1" })
    })

    test("syncProjectFromTmux POSTs to sync endpoint and returns ProjectActionResponse", async () => {
      invoke.configure({
        successResults: {
          sync_from_tmux: {
            project: {
              id: "a1",
              name: "proj",
              path: "/tmp",
              description: "",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
              sessionName: "proj",
              status: "active",
              workdir: "",
              layoutJson: '{"windows":[]}',
              detailsJson: "{}",
              progressJson: "{}",
              aiHtml: "",
              aiStatus: "idle",
              aiError: "",
              lastSyncedAt: "2024-01-01T00:00:00Z",
              schemaVersion: 1,
            },
            operation: "sync",
          },
        },
      })
      const result = await syncProjectFromTmux("a1")
      expect(result.project.id).toBe("a1")
      expect(result.operation).toBe("sync")

      expect(invoke.mockFn).toHaveBeenCalledWith("sync_from_tmux", { id: "a1" })
    })

    test("syncProjectFromTmux sends id param", async () => {
      invoke.configure({
        successResults: {
          sync_from_tmux: {
            project: {
              id: "proj#1",
              name: "proj",
              path: "",
              description: "",
              createdAt: "",
              updatedAt: "",
              sessionName: "",
              status: "",
              workdir: "",
              layoutJson: "",
              detailsJson: "",
              progressJson: "",
              aiHtml: "",
              aiStatus: "",
              aiError: "",
              lastSyncedAt: null,
              schemaVersion: 1,
            },
            operation: "sync",
          },
        },
      })
      await syncProjectFromTmux("proj#1")

      expect(invoke.mockFn).toHaveBeenCalledWith("sync_from_tmux", { id: "proj#1" })
    })
  })

  describe("voice history", () => {
    test("getOmniHistory returns data array", async () => {
      invoke.configure({
        successResults: {
          list_voice_history: {
            data: [
              {
                id: "msg1",
                conversationId: "conv1",
                role: "user",
                kind: "transcript",
                text: "Hello",
                createdAt: "2024-01-01T00:00:00Z",
              },
            ],
          },
        },
      })
      const result = await getOmniHistory({ conversationId: "conv1" })
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe("msg1")
      expect(result[0]!.conversationId).toBe("conv1")
      expect(result[0]!.role).toBe("user")
      expect(result[0]!.kind).toBe("transcript")
      expect(result[0]!.text).toBe("Hello")
    })

    test("getOmniHistory sends limit and before params", async () => {
      invoke.configure({
        successResults: { list_voice_history: { data: [] } },
      })
      await getOmniHistory({
        conversationId: "conv1",
        limit: 50,
        before: "msg10",
      })

      expect(invoke.mockFn).toHaveBeenCalledWith("list_voice_history", {
        conversationId: "conv1",
        limit: 50,
        before: "msg10",
      })
    })

    test("getOmniHistory returns empty array when data is null", async () => {
      invoke.configure({
        successResults: { list_voice_history: { data: null } },
      })
      const result = await getOmniHistory({ conversationId: "conv1" })
      expect(result).toEqual([])
    })

    test("clearOmniHistory sends DELETE request", async () => {
      invoke.configure({
        successResults: { clear_voice_history: { data: [] } },
      })
      await clearOmniHistory()

      expect(invoke.mockFn).toHaveBeenCalledWith("clear_voice_history", undefined)
    })

    test("clearOmniHistory does not throw", async () => {
      invoke.configure({
        successResults: { clear_voice_history: { data: [] } },
      })
      await expect(clearOmniHistory()).resolves.toBeUndefined()
    })

    test("getConfig returns voice with dashscopeApiKeyConfigured", async () => {
      invoke.configure({
        successResults: {
          get_config: {
            schemaVersion: 1,
            path: ".",
            server: { bind: "127.0.0.1:7331" },
            auth: { token: "" },
            tmux: { path: "tmux" },
            connections: [],
            ui: {
              theme: "dark",
              windowTheme: "dark",
              fontSize: 14,
              terminalFontSize: 14,
              terminalFontWeight: "normal",
            },
            intelligence: {
              enabled: false,
              providers: [],
              maxBytes: 12000,
              timeoutSec: 8,
              minSessionIntervalSec: 60,
              maxConcurrency: 3,
              cacheTTLSec: 300,
            },
            omni: {
              enabled: true,
              dashscopeApiKeyConfigured: true,
              microphoneDisabled: false,
              skillDefinitions: [],
              model: "qwen3.5-omni-flash-realtime",
              endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
              continuousListening: false,
              storeRawAudio: false,
              vadEnabled: true,
              vadThreshold: 0.5,
            },
          },
        },
      })
      const result = await getConfig()
      expect(result.omni?.enabled).toBe(true)
      expect(result.omni?.dashscopeApiKeyConfigured).toBe(true)
      expect(result.omni?.microphoneDisabled).toBe(false)
      expect(result.omni?.model).toBe("qwen3.5-omni-flash-realtime")
      expect(result.omni?.endpoint).toBe("wss://dashscope.aliyuncs.com/api-ws/v1/realtime")
    })

    test("getConfig voice defaults to undefined if not present", async () => {
      invoke.configure({
        successResults: {
          get_config: {
            schemaVersion: 1,
            path: ".",
            server: { bind: "127.0.0.1:7331" },
            auth: { token: "" },
            tmux: { path: "tmux" },
            connections: [],
            ui: {
              theme: "dark",
              windowTheme: "dark",
              fontSize: 14,
              terminalFontSize: 14,
              terminalFontWeight: "normal",
            },
            intelligence: {
              enabled: false,
              providers: [],
              maxBytes: 12000,
              timeoutSec: 8,
              minSessionIntervalSec: 60,
              maxConcurrency: 3,
              cacheTTLSec: 300,
            },
          },
        },
      })
      const result = await getConfig()
      expect(result.omni).toBeUndefined()
    })
  })

  describe("ai logs", () => {
    test("listAiLogs returns data array", async () => {
      invoke.configure({
        successResults: {
          list_ai_logs: {
            data: [
              {
                id: "log1",
                conversationId: "conv1",
                eventKind: "tool_call",
                model: "gpt-4",
                status: "success",
                durationMs: 120,
                createdAt: "2024-01-01T00:00:00Z",
              },
            ],
            nextCursor: null,
          },
        },
      })
      const result = await listAiLogs()
      expect(result.data).toHaveLength(1)
      expect(result.data[0]!.id).toBe("log1")
      expect(result.data[0]!.conversationId).toBe("conv1")
      expect(result.nextCursor).toBeNull()
    })

    test("listAiLogs sends limit and before params", async () => {
      invoke.configure({
        successResults: { list_ai_logs: { data: [], nextCursor: null } },
      })
      await listAiLogs({
        limit: 50,
        before: "2024-01-01T00:00:00Z",
      })

      expect(invoke.mockFn).toHaveBeenCalledWith("list_ai_logs", {
        limit: 50,
        before: "2024-01-01T00:00:00Z",
      })
    })

    test("listAiLogs omits undefined params", async () => {
      invoke.configure({
        successResults: { list_ai_logs: { data: [], nextCursor: null } },
      })
      await listAiLogs({})

      expect(invoke.mockFn).toHaveBeenCalledWith("list_ai_logs", {
        limit: undefined,
        before: undefined,
      })
    })

    test("listAiLogs sends before param", async () => {
      invoke.configure({
        successResults: { list_ai_logs: { data: [], nextCursor: null } },
      })
      await listAiLogs({
        before: "2024-01-01T10:00:00+08:00",
      })

      expect(invoke.mockFn).toHaveBeenCalledWith("list_ai_logs", {
        limit: undefined,
        before: "2024-01-01T10:00:00+08:00",
      })
    })

    test("clearAiLogs sends DELETE request", async () => {
      invoke.configure({
        successResults: { clear_ai_logs: undefined },
      })
      await clearAiLogs()

      expect(invoke.mockFn).toHaveBeenCalledWith("clear_ai_logs", undefined)
    })

    test("clearAiLogs does not throw", async () => {
      invoke.configure({
        successResults: { clear_ai_logs: undefined },
      })
      await expect(clearAiLogs()).resolves.toBeUndefined()
    })
  })
})
