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
} from "./client.js";
import { ApiError } from "./errors.js";

describe("api client", () => {
	beforeEach(() => {
		sessionStorage.setItem("wmux-auth-token", "test-token");
	});

	afterEach(() => {
		vi.restoreAllMocks();
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
		mockJsonResponse(200, { data: [{ id: "1", type: "local" }] });
		const result = await listConnections();
		expect(result).toHaveLength(1);
		expect(result[0]!.type).toBe("local");
	});

	test("createConnection POSTs payload", async () => {
		mockJsonResponse(201, { id: "2", type: "ssh" });
		const result = await createConnection({ type: "ssh" });
		expect(result.type).toBe("ssh");

		const call = vi.mocked(fetch).mock.calls[0]!;
		expect(call[1]?.method).toBe("POST");
		expect(JSON.parse(call[1]?.body as string)).toEqual({ type: "ssh" });
	});

	test("getConnection fetches by id", async () => {
		mockJsonResponse(200, { id: "1", type: "local" });
		const result = await getConnection("1");
		expect(result.id).toBe("1");
	});

	test("updateConnection PUTs payload", async () => {
		mockJsonResponse(200, { id: "1", type: "local" });
		const result = await updateConnection("1", { id: "1", type: "local" });
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
			connectionId: "1",
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
			connectionId: "1",
			session: "dev",
			mode: "local",
			data: [{ ID: "@1", Name: "editor", Index: 0, Active: true }],
		});
		const result = await listWindows("1", "dev");
		expect(result.data[0]!.Name).toBe("editor");
	});

	test("listPanes returns panes", async () => {
		mockJsonResponse(200, {
			connectionId: "1",
			session: "dev",
			window: "@1",
			mode: "local",
			data: [{ ID: "%1", Title: "shell", Index: 0, Active: true, Width: 80, Height: 24 }],
		});
		const result = await listPanes("1", "dev", "@1");
		expect(result.data[0]!.Title).toBe("shell");
	});

	test("createSession POSTs name", async () => {
		mockJsonResponse(200, { connectionId: "1", operation: "create_session", mode: "local", status: "ok" });
		await createSession("1", "new-session");

		const call = vi.mocked(fetch).mock.calls[0]!;
		expect(JSON.parse(call[1]?.body as string)).toEqual({ name: "new-session" });
	});

	test("getConfig returns config", async () => {
		mockJsonResponse(200, { schemaVersion: 1, server: { bind: "127.0.0.1:7331" }, auth: { token: "" }, tmux: { path: "tmux" }, connections: [], ui: { theme: "dark", fontSize: 14, terminalFontSize: 14 } });
		const result = await getConfig();
		expect(result.schemaVersion).toBe(1);
	});

	test("updateConfig PUTs payload", async () => {
		mockJsonResponse(200, { schemaVersion: 1, server: { bind: "127.0.0.1:7331" }, auth: { token: "" }, tmux: { path: "tmux" }, connections: [], ui: { theme: "light", fontSize: 14, terminalFontSize: 14 } });
		const result = await updateConfig({ schemaVersion: 1, server: { bind: "127.0.0.1:7331" }, auth: { token: "" }, tmux: { path: "tmux" }, connections: [], ui: { theme: "light", fontSize: 14, terminalFontSize: 14 } });
		expect(result.ui.theme).toBe("light");
	});

	test("listConnectionHealth returns health data", async () => {
		mockJsonResponse(200, { data: [{ connectionId: "1", status: "online", checkedAt: "2024-01-01T00:00:00Z" }] });
		const result = await listConnectionHealth();
		expect(result[0]!.status).toBe("online");
	});

	test("getConnectionHealth returns single health", async () => {
		mockJsonResponse(200, { connectionId: "1", status: "online", checkedAt: "2024-01-01T00:00:00Z" });
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

	test("URL encodes path parameters", async () => {
		mockJsonResponse(200, { id: "conn#1", type: "local" });
		await getConnection("conn#1");

		const call = vi.mocked(fetch).mock.calls[0]!;
		expect(call[0]).toContain(encodeURIComponent("conn#1"));
	});
});
