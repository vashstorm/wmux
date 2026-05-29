import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
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
} from "./client.js";
import { ApiError } from "./errors.js";

describe("api client", () => {
	beforeEach(() => {
		sessionStorage.setItem("wmux-auth-token", "test-token");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete window.__WMUX_RUNTIME__;
		sessionStorage.removeItem("wmux-auth-token");
	});

	function mockFetch(response: Response) {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
	}

	function mockJsonResponse(status: number, body: unknown) {
		mockFetch(
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
	}

	test("fetchHealth returns status", async () => {
		mockJsonResponse(200, { status: "ok" });
		const result = await fetchHealth();
		expect(result.status).toBe("ok");
	});

	test("listConnections returns data array", async () => {
		mockJsonResponse(200, { data: [{ targetName: "1", type: "local" }] });
		const result = await listConnections();
		expect(result).toHaveLength(1);
		expect(result[0]!.targetName).toBe("1");
		expect(result[0]!.type).toBe("local");
	});

	test("listConnections normalizes config-style ids", async () => {
		mockJsonResponse(200, { data: [{ id: "local-dev", type: "local" }] });
		const result = await listConnections();
		expect(result[0]!.targetName).toBe("local-dev");
		expect(result[0]!.id).toBe("local-dev");
	});

	test("createConnection POSTs payload", async () => {
		mockJsonResponse(201, { targetName: "2", type: "local" });
		const result = await createConnection({ type: "local" });
		expect(result.type).toBe("local");

		const call = vi.mocked(fetch).mock.calls[0]!;
		expect(call[1]?.method).toBe("POST");
		expect(JSON.parse(call[1]?.body as string)).toEqual({ type: "local" });
	});

	test("getConnection fetches by id", async () => {
		mockJsonResponse(200, { targetName: "1", type: "local" });
		const result = await getConnection("1");
		expect(result.targetName).toBe("1");
	});

	test("updateConnection PUTs payload", async () => {
		mockJsonResponse(200, { targetName: "1", type: "local" });
		const result = await updateConnection("1", { targetName: "1", type: "local" });
		expect(result.type).toBe("local");

		const call = vi.mocked(fetch).mock.calls[0]!;
		expect(call[1]?.method).toBe("PUT");
	});

	test("deleteConnection sends DELETE", async () => {
		mockFetch(new Response(null, { status: 204 }));
		await deleteConnection("1");

		const call = vi.mocked(fetch).mock.calls[0]!;
		expect(call[1]?.method).toBe("DELETE");
	});

	test("listSessions normalizes mixed formats", async () => {
		mockJsonResponse(200, {
			targetName: "1",
			mode: "local",
			data: ["session1", { name: "session2" }, { Name: "session3" }],
		});
		const result = await listSessions("1");
		expect(result.data).toHaveLength(3);
		expect(result.data[0]!.name).toBe("session1");
		expect(result.data[1]!.name).toBe("session2");
		expect(result.data[2]!.name).toBe("session3");
	});

	test("listWindows returns windows", async () => {
		mockJsonResponse(200, {
			targetName: "1",
			session: "dev",
			mode: "local",
			data: [{ ID: "@1", Name: "editor", Index: 0, Active: true }],
		});
		const result = await listWindows("1", "dev");
		expect(result.data[0]!.Name).toBe("editor");
	});

	test("listWindows normalizes Rust camelCase fields", async () => {
		mockJsonResponse(200, {
			targetName: "1",
			session: "dev",
			mode: "local",
			data: [{ id: "@1", name: "editor", index: 0, active: true, paneCount: 1, activePaneId: "%1", activePaneTitle: "shell", attentionState: "attention", attentionCount: 1, intelligenceSummary: "Window summary" }],
		});
		const result = await listWindows("1", "dev");
		expect(result.data[0]!.ID).toBe("@1");
		expect(result.data[0]!.Active).toBe(true);
		expect(result.data[0]!.ActivePaneID).toBe("%1");
		expect(result.data[0]!.AttentionState).toBe("attention");
		expect(result.data[0]!.IntelligenceSummary).toBe("Window summary");
	});

	test("listPanes returns panes", async () => {
		mockJsonResponse(200, {
			targetName: "1",
			session: "dev",
			window: "@1",
			mode: "local",
			data: [{ ID: "%1", Title: "shell", Index: 0, Active: true, Width: 80, Height: 24 }],
		});
		const result = await listPanes("1", "dev", "@1");
		expect(result.data[0]!.Title).toBe("shell");
	});

	test("listPanes normalizes Rust camelCase fields", async () => {
		mockJsonResponse(200, {
			targetName: "1",
			session: "dev",
			window: "@1",
			mode: "local",
			data: [{ id: "%1", title: "shell", index: 0, active: true, width: 80, height: 24, left: 0, top: 0, attentionState: "none" }],
		});
		const result = await listPanes("1", "dev", "@1");
		expect(result.data[0]!.ID).toBe("%1");
		expect(result.data[0]!.Active).toBe(true);
		expect(result.data[0]!.Width).toBe(80);
		expect(result.data[0]!.AttentionState).toBe("none");
	});

	test("createSession POSTs name", async () => {
		mockJsonResponse(200, { targetName: "1", operation: "create_session", mode: "local", status: "ok" });
		await createSession("1", "new-session");

		const call = vi.mocked(fetch).mock.calls[0]!;
		expect(JSON.parse(call[1]?.body as string)).toEqual({ name: "new-session" });
	});

	test("getConfig returns config", async () => {
		mockJsonResponse(200, { schemaVersion: 1, path: ".", server: { bind: "127.0.0.1:7331" }, auth: { token: "" }, tmux: { path: "tmux" }, connections: [], ui: { theme: "dark", windowTheme: "dark", fontSize: 14, terminalFontSize: 14, terminalFontWeight: "normal" }, intelligence: { enabled: false, providers: [], maxBytes: 12000, timeoutSec: 8, minSessionIntervalSec: 60, maxConcurrency: 3, cacheTTLSec: 300 } });
		const result = await getConfig();
		expect(result.schemaVersion).toBe(1);
	});

	test("getConfig normalizes config connection ids to targetName", async () => {
		mockJsonResponse(200, { schemaVersion: 1, path: ".", server: { bind: "127.0.0.1:7331" }, auth: { token: "" }, tmux: { path: "tmux" }, connections: [{ id: "local-dev", type: "local" }], ui: { theme: "dark", windowTheme: "dark", fontSize: 14, terminalFontSize: 14, terminalFontWeight: "normal" }, intelligence: { enabled: false, providers: [], maxBytes: 12000, timeoutSec: 8, minSessionIntervalSec: 60, maxConcurrency: 3, cacheTTLSec: 300 } });
		const result = await getConfig();
		expect(result.connections[0]!.targetName).toBe("local-dev");
		expect(result.connections[0]!.id).toBe("local-dev");
	});

	test("updateConfig PUTs payload", async () => {
		mockJsonResponse(200, { schemaVersion: 1, path: ".", server: { bind: "127.0.0.1:7331" }, auth: { token: "" }, tmux: { path: "tmux" }, connections: [], ui: { theme: "light", windowTheme: "light", fontSize: 14, terminalFontSize: 14, terminalFontWeight: "normal" }, intelligence: { enabled: false, providers: [], maxBytes: 12000, timeoutSec: 8, minSessionIntervalSec: 60, maxConcurrency: 3, cacheTTLSec: 300 } });
		const result = await updateConfig({ schemaVersion: 1, path: ".", server: { bind: "127.0.0.1:7331" }, auth: { token: "" }, tmux: { path: "tmux" }, connections: [], ui: { theme: "light", windowTheme: "light", fontSize: 14, terminalFontSize: 14, terminalFontWeight: "normal" }, intelligence: { enabled: false, providers: [], maxBytes: 12000, timeoutSec: 8, minSessionIntervalSec: 60, maxConcurrency: 3, cacheTTLSec: 300 } });
		expect(result.ui.theme).toBe("light");
	});

	test("updateConfig writes targetName connections as config ids", async () => {
		mockJsonResponse(200, { schemaVersion: 1, path: ".", server: { bind: "127.0.0.1:7331" }, auth: { token: "" }, tmux: { path: "tmux" }, connections: [{ id: "local-dev", type: "local" }], ui: { theme: "dark", windowTheme: "dark", fontSize: 14, terminalFontSize: 14, terminalFontWeight: "normal" }, intelligence: { enabled: false, providers: [], maxBytes: 12000, timeoutSec: 8, minSessionIntervalSec: 60, maxConcurrency: 3, cacheTTLSec: 300 } });
		await updateConfig({ schemaVersion: 1, path: ".", server: { bind: "127.0.0.1:7331" }, auth: { token: "" }, tmux: { path: "tmux" }, connections: [{ targetName: "local-dev", type: "local" }], ui: { theme: "dark", windowTheme: "dark", fontSize: 14, terminalFontSize: 14, terminalFontWeight: "normal" }, intelligence: { enabled: false, providers: [], maxBytes: 12000, timeoutSec: 8, minSessionIntervalSec: 60, maxConcurrency: 3, cacheTTLSec: 300 } });

		const call = vi.mocked(fetch).mock.calls[0]!;
		const body = JSON.parse(call[1]?.body as string);
		expect(body.connections).toEqual([{ id: "local-dev", type: "local" }]);
	});

	test("listConnectionHealth returns health data", async () => {
		mockJsonResponse(200, { data: [{ targetName: "1", status: "online", checkedAt: "2024-01-01T00:00:00Z" }] });
		const result = await listConnectionHealth();
		expect(result[0]!.status).toBe("online");
	});

	test("getConnectionHealth returns single health", async () => {
		mockJsonResponse(200, { targetName: "1", status: "online", checkedAt: "2024-01-01T00:00:00Z" });
		const result = await getConnectionHealth("1");
		expect(result.status).toBe("online");
	});

	test("throws ApiError with parsed code and message", async () => {
		mockJsonResponse(401, { error: { code: "unauthorized", message: "bad token" } });
		await expect(listConnections()).rejects.toMatchObject({ code: "unauthorized", message: "bad token", status: 401 });
	});

	test("throws ApiError with fallback for non-JSON error", async () => {
		mockFetch(new Response("plain text error", { status: 500, statusText: "Server Error" }));
		await expect(listConnections()).rejects.toMatchObject({ code: "internal_error", message: "Server Error", status: 500 });
	});

	test("includes auth header when token exists", async () => {
		mockJsonResponse(200, { data: [] });
		await listConnections();

		const call = vi.mocked(fetch).mock.calls[0]!;
		const headers = call[1]?.headers as Headers;
		expect(headers.get("Authorization")).toBe("Bearer test-token");
	});

	test("uses Tauri runtime base URL and token when injected", async () => {
		window.__WMUX_RUNTIME__ = {
			baseUrl: "http://127.0.0.1:7331",
			token: "runtime-token",
		};
		mockJsonResponse(200, { data: [] });

		await listConnections();

		const call = vi.mocked(fetch).mock.calls[0]!;
		const headers = call[1]?.headers as Headers;
		expect(call[0]).toBe("http://127.0.0.1:7331/api/connections");
		expect(headers.get("Authorization")).toBe("Bearer runtime-token");
	});

	test("URL encodes path parameters", async () => {
		mockJsonResponse(200, { targetName: "conn#1", type: "local" });
		await getConnection("conn#1");

		const call = vi.mocked(fetch).mock.calls[0]!;
		expect(call[0]).toContain(encodeURIComponent("conn#1"));
	});

	test("fetchErrorLogs returns error log lines", async () => {
		mockJsonResponse(200, { enabled: true, path: "/tmp/wmux-error.log", lines: ["ERROR test"], truncated: false, maxLines: 1000 });
		const result = await fetchErrorLogs();
		expect(result.enabled).toBe(true);
		expect(result.path).toBe("/tmp/wmux-error.log");
		expect(result.lines).toEqual(["ERROR test"]);
		expect(result.truncated).toBe(false);
		expect(result.maxLines).toBe(1000);

		const call = vi.mocked(fetch).mock.calls[0]!;
		expect(call[0]).toContain("/api/logs/errors");
	});

	test("clearErrorLogs sends DELETE request", async () => {
		mockFetch(new Response(null, { status: 204 }));
		await clearErrorLogs();

		const call = vi.mocked(fetch).mock.calls[0]!;
		expect(call[1]?.method).toBe("DELETE");
		expect(call[0]).toContain("/api/logs/errors");
	});

	test("fetchErrorLogs handles truncated response", async () => {
		mockJsonResponse(200, { enabled: true, path: "/tmp/wmux-error.log", lines: ["line1", "line2"], truncated: true, maxLines: 1000 });
		const result = await fetchErrorLogs();
		expect(result.truncated).toBe(true);
		expect(result.lines).toHaveLength(2);
	});

	test("fetchErrorLogs returns disabled state", async () => {
		mockJsonResponse(200, { enabled: false, path: null, lines: [], truncated: false, maxLines: 1000 });
		const result = await fetchErrorLogs();
		expect(result.enabled).toBe(false);
		expect(result.path).toBeNull();
		expect(result.lines).toEqual([]);
	});

	test("clearErrorLogs does not throw on 204", async () => {
		mockFetch(new Response(null, { status: 204 }));
		await expect(clearErrorLogs()).resolves.toBeUndefined();
	});

	describe("projects", () => {
		test("listProjects returns data array", async () => {
			mockJsonResponse(200, { data: [{ id: "a1", name: "proj", path: "/tmp", description: "", createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" }] });
			const result = await listProjects();
			expect(result).toHaveLength(1);
			expect(result[0]!.name).toBe("proj");
		});

		test("createProject POSTs payload and returns project", async () => {
			mockJsonResponse(201, { id: "a1", name: "proj", path: "/tmp", description: "", createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" });
			const result = await createProject({ name: "proj", path: "/tmp" });
			expect(result.name).toBe("proj");

			const call = vi.mocked(fetch).mock.calls[0]!;
			expect(call[1]?.method).toBe("POST");
			const body = JSON.parse(call[1]?.body as string);
			expect(body.name).toBe("proj");
			expect(body.path).toBe("/tmp");
		});

		test("getProject fetches by id", async () => {
			mockJsonResponse(200, { id: "a1", name: "proj", path: "", description: "", createdAt: "", updatedAt: "" });
			const result = await getProject("a1");
			expect(result.id).toBe("a1");
			expect(result.name).toBe("proj");
		});

		test("updateProject PUTs payload", async () => {
			mockJsonResponse(200, { id: "a1", name: "updated", path: "/new", description: "", createdAt: "", updatedAt: "" });
			const result = await updateProject("a1", { name: "updated", path: "/new" });
			expect(result.name).toBe("updated");

			const call = vi.mocked(fetch).mock.calls[0]!;
			expect(call[1]?.method).toBe("PUT");
		});

		test("deleteProject sends DELETE and handles 204", async () => {
			mockFetch(new Response(null, { status: 204 }));
			await expect(deleteProject("a1")).resolves.toBeUndefined();

			const call = vi.mocked(fetch).mock.calls[0]!;
			expect(call[1]?.method).toBe("DELETE");
		});

		test("project duplicate name throws ApiError with 409", async () => {
			mockFetch(
				new Response(JSON.stringify({ error: { code: "conflict", message: "project name already exists" } }), {
					status: 409,
					headers: { "Content-Type": "application/json" },
				}),
			);
			await expect(createProject({ name: "dup" })).rejects.toThrow(ApiError);
			try {
				await createProject({ name: "dup" });
			} catch (err) {
				expect(err).toBeInstanceOf(ApiError);
				expect((err as ApiError).status).toBe(409);
			}
		});

		test("launchProject POSTs to launch endpoint and returns ProjectActionResponse", async () => {
			mockJsonResponse(200, {
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
			});
			const result = await launchProject("a1");
			expect(result.project.id).toBe("a1");
			expect(result.operation).toBe("launch");

			const call = vi.mocked(fetch).mock.calls[0]!;
			expect(call[0]).toContain("/api/projects/a1/launch");
			expect(call[1]?.method).toBe("POST");
		});

		test("launchProject URL encodes id", async () => {
			mockJsonResponse(200, {
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
			});
			await launchProject("proj#1");

			const call = vi.mocked(fetch).mock.calls[0]!;
			expect(call[0]).toContain(encodeURIComponent("proj#1"));
		});

		test("syncProjectFromTmux POSTs to sync endpoint and returns ProjectActionResponse", async () => {
			mockJsonResponse(200, {
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
			});
			const result = await syncProjectFromTmux("a1");
			expect(result.project.id).toBe("a1");
			expect(result.operation).toBe("sync");

			const call = vi.mocked(fetch).mock.calls[0]!;
			expect(call[0]).toContain("/api/projects/a1/sync-from-tmux");
			expect(call[1]?.method).toBe("POST");
		});

		test("syncProjectFromTmux URL encodes id", async () => {
			mockJsonResponse(200, {
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
			});
			await syncProjectFromTmux("proj#1");

			const call = vi.mocked(fetch).mock.calls[0]!;
			expect(call[0]).toContain(encodeURIComponent("proj#1"));
		});

	});

	describe("voice history", () => {
		test("getOmniHistory returns data array", async () => {
			mockJsonResponse(200, {
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
			});
			const result = await getOmniHistory({ conversationId: "conv1" });
			expect(result).toHaveLength(1);
			expect(result[0]!.id).toBe("msg1");
			expect(result[0]!.conversationId).toBe("conv1");
			expect(result[0]!.role).toBe("user");
			expect(result[0]!.kind).toBe("transcript");
			expect(result[0]!.text).toBe("Hello");

			const call = vi.mocked(fetch).mock.calls[0]!;
			expect(call[0]).toContain("/api/voice/history");
			expect(call[0]).toContain("conversationId=conv1");
		});

		test("getOmniHistory sends limit and before params", async () => {
			mockJsonResponse(200, { data: [] });
			await getOmniHistory({
				conversationId: "conv1",
				limit: 50,
				before: "msg10",
			});

			const call = vi.mocked(fetch).mock.calls[0]!;
			expect(call[0]).toContain("conversationId=conv1");
			expect(call[0]).toContain("limit=50");
			expect(call[0]).toContain("before=msg10");
		});

		test("getOmniHistory returns empty array when data is null", async () => {
			mockJsonResponse(200, { data: null });
			const result = await getOmniHistory({ conversationId: "conv1" });
			expect(result).toEqual([]);
		});

		test("clearOmniHistory sends DELETE request", async () => {
			mockFetch(new Response(null, { status: 204 }));
			await clearOmniHistory();

			const call = vi.mocked(fetch).mock.calls[0]!;
			expect(call[1]?.method).toBe("DELETE");
			expect(call[0]).toContain("/api/voice/history");
		});

		test("clearOmniHistory does not throw on 204", async () => {
			mockFetch(new Response(null, { status: 204 }));
			await expect(clearOmniHistory()).resolves.toBeUndefined();
		});

		test("getConfig returns voice with dashscopeApiKeyConfigured", async () => {
			mockJsonResponse(200, {
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
				voice: {
					enabled: true,
					dashscopeApiKeyConfigured: true,
					microphoneDisabled: false,
					skills: [],
					model: "qwen3.5-omni-flash-realtime",
					endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
					continuousListening: false,
					storeRawAudio: false,
					vadEnabled: true,
					vadThreshold: 0.5,
				},
			});
			const result = await getConfig();
			expect(result.voice?.enabled).toBe(true);
			expect(result.voice?.dashscopeApiKeyConfigured).toBe(true);
			expect(result.voice?.microphoneDisabled).toBe(false);
			expect(result.voice?.model).toBe("qwen3.5-omni-flash-realtime");
			expect(result.voice?.endpoint).toBe(
				"wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
			);
		});

		test("getConfig voice defaults to undefined if not present", async () => {
			mockJsonResponse(200, {
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
			});
			const result = await getConfig();
			expect(result.voice).toBeUndefined();
		});
	});
});
