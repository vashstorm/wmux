import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

declare global {
	interface Window {
		__WMUX_RUNTIME__?: {
			baseUrl: string;
			token: string;
		};
	}
}

const sessionName = process.env.WMUX_TAURI_SESSION ?? "wmux-tauri-e2e";

function hasTmux(): boolean {
	return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
}

async function getRuntimeBaseUrl(): Promise<string> {
	const baseUrl = await browser.execute(() => window.__WMUX_RUNTIME__?.baseUrl ?? "");
	assert.ok(baseUrl, "Tauri runtime baseUrl should be injected");
	return baseUrl;
}

async function getToken(): Promise<string> {
	const token = await browser.execute(() => window.__WMUX_RUNTIME__?.token ?? "");
	return token;
}

async function apiRequest(
	baseUrl: string,
	method: string,
	path: string,
	body?: unknown,
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
	const token = await getToken();
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (token) {
		headers["Authorization"] = `Bearer ${token}`;
	}

	const options: RequestInit = { method, headers };
	if (body) {
		options.body = JSON.stringify(body);
	}

	const response = await fetch(`${baseUrl}${path}`, options);
	return {
		ok: response.ok,
		status: response.status,
		json: () => response.json(),
	};
}

async function ensureLocalConnection(baseUrl: string): Promise<void> {
	const res = await apiRequest(baseUrl, "GET", "/api/connections");
	if (res.ok) {
		const json = await res.json() as { data?: Array<{ targetName: string; type: string }> };
		const connections = json.data ?? [];
		const hasLocal = connections.some((c) => c.targetName === "local" || c.type === "local");
		if (!hasLocal) {
			await apiRequest(baseUrl, "POST", "/api/connections", { type: "local" });
		}
	}
}

async function deleteSessionIfExists(baseUrl: string, sessionNameToDelete: string): Promise<void> {
	await apiRequest(
		baseUrl,
		"DELETE",
		`/api/targets/local/sessions/${encodeURIComponent(sessionNameToDelete)}`,
	).catch(() => undefined);
}

describe("Tauri sessions management", () => {
	before(async function () {
		if (!hasTmux()) {
			console.warn("Skipping Tauri desktop E2E: tmux binary not found.");
			this.skip();
		}
		const baseUrl = await getRuntimeBaseUrl();
		await ensureLocalConnection(baseUrl);
	});

	after(async function () {
		if (!hasTmux()) return;
		const baseUrl = await getRuntimeBaseUrl();
		await deleteSessionIfExists(baseUrl, "wmux-tauri-test-session-1");
		await deleteSessionIfExists(baseUrl, "wmux-tauri-test-session-2");
	});

	it("creates a session via API", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		await deleteSessionIfExists(baseUrl, "wmux-tauri-test-session-1");

		const res = await apiRequest(baseUrl, "POST", "/api/targets/local/sessions", {
			name: "wmux-tauri-test-session-1",
		});
		assert.equal(res.ok, true, "create session should succeed");

		const listRes = await apiRequest(baseUrl, "GET", "/api/targets/local/sessions");
		const listJson = await listRes.json() as { data?: Array<{ name: string }> };
		const sessionNames = (listJson.data ?? []).map((s) => s.name);
		assert.ok(sessionNames.includes("wmux-tauri-test-session-1"), "session should be created");
	});

	it("lists sessions via API", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const res = await apiRequest(baseUrl, "GET", "/api/targets/local/sessions");
		assert.equal(res.ok, true, "list sessions should succeed");
		const json = await res.json() as { data?: Array<unknown> };
		assert.ok(Array.isArray(json.data), "response should have data array");
	});

	it("deletes a session via API", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		await deleteSessionIfExists(baseUrl, "wmux-tauri-test-session-2");

		const createRes = await apiRequest(baseUrl, "POST", "/api/targets/local/sessions", {
			name: "wmux-tauri-test-session-2",
		});
		assert.equal(createRes.ok, true, "create session should succeed");

		const deleteRes = await apiRequest(
			baseUrl,
			"DELETE",
			`/api/targets/local/sessions/${encodeURIComponent("wmux-tauri-test-session-2")}`,
		);
		assert.equal(deleteRes.ok, true, "delete session should succeed");
	});

	it("lists windows for a session", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const res = await apiRequest(baseUrl, "GET", `/api/targets/local/sessions/${encodeURIComponent(sessionName)}/windows`);
		assert.equal(res.ok, true, "list windows should succeed");
		const json = await res.json() as { data?: Array<unknown> };
		assert.ok(Array.isArray(json.data), "response should have data array");
		assert.ok((json.data?.length ?? 0) > 0, "should have at least one window");
	});

	it("lists panes for the first window", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const windowsRes = await apiRequest(baseUrl, "GET", `/api/targets/local/sessions/${encodeURIComponent(sessionName)}/windows`);
		const windowsJson = await windowsRes.json() as { data?: Array<{ id: string }> };
		const firstWindow = (windowsJson.data ?? [])[0];
		assert.ok(firstWindow, "should have at least one window");

		const panesRes = await apiRequest(
			baseUrl,
			"GET",
			`/api/targets/local/sessions/${encodeURIComponent(sessionName)}/windows/${encodeURIComponent(firstWindow.id)}/panes`,
		);
		assert.equal(panesRes.ok, true, "list panes should succeed");
		const panesJson = await panesRes.json() as { data?: Array<unknown> };
		assert.ok(Array.isArray(panesJson.data), "response should have data array");
		assert.ok((panesJson.data?.length ?? 0) > 0, "should have at least one pane");
	});

	it("UI shows window tabs when session is opened", async () => {
		const sessionCard = await $(`[data-testid="session-card-${sessionName}"]`);
		await sessionCard.waitForDisplayed({ timeout: 15_000 });

		const openButton = await $(`[data-testid="session-open-${sessionName}"]`);
		await openButton.click();

		const windowTabs = await $(".window-tabs");
		await windowTabs.waitForDisplayed({ timeout: 10_000 });
		assert.ok(await windowTabs.isDisplayed(), "window tabs should be visible");

		const windowTabList = await $$(".window-tab").getElements();
		assert.ok(windowTabList.length > 0, "should have at least one window tab");
	});

	it("UI shows pane box when session is opened", async () => {
		const sessionCard = await $(`[data-testid="session-card-${sessionName}"]`);
		await sessionCard.waitForDisplayed({ timeout: 15_000 });

		const openButton = await $(`[data-testid="session-open-${sessionName}"]`);
		await openButton.click();

		const paneBox = await $(".pane-box");
		await paneBox.waitForDisplayed({ timeout: 10_000 });
		assert.ok(await paneBox.isDisplayed(), "pane box should be visible");
	});

	it("clicking pane box activates pane and shows terminal", async () => {
		const sessionCard = await $(`[data-testid="session-card-${sessionName}"]`);
		await sessionCard.waitForDisplayed({ timeout: 15_000 });

		const openButton = await $(`[data-testid="session-open-${sessionName}"]`);
		await openButton.click();

		const paneBox = await $(".pane-box");
		await paneBox.waitForDisplayed({ timeout: 10_000 });
		await paneBox.click();

		const terminal = await $('[data-testid="terminal"]');
		await terminal.waitForDisplayed({ timeout: 10_000 });
		assert.ok(await terminal.isDisplayed(), "terminal should be visible");
	});
});

export {};