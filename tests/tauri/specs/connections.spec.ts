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

async function cleanupLocalConnection(baseUrl: string): Promise<void> {
	const res = await apiRequest(baseUrl, "GET", "/api/connections");
	if (res.ok) {
		const json = await res.json() as { data?: Array<{ targetName: string; type: string }> };
		const connections = json.data ?? [];
		for (const conn of connections) {
			if (conn.targetName === "local" || conn.type === "local") {
				await apiRequest(baseUrl, "DELETE", `/api/connections/${conn.targetName}`);
			}
		}
	}
}

describe("Tauri connections management", () => {
	before(function () {
		if (!hasTmux()) {
			console.warn("Skipping Tauri desktop E2E: tmux binary not found.");
			this.skip();
		}
	});

	it("creates local connection via API and shows in sidebar", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		await cleanupLocalConnection(baseUrl);

		const res = await apiRequest(baseUrl, "POST", "/api/connections", { type: "local" });
		assert.equal(res.ok, true, "create connection should succeed");

		const sidebar = await $('[data-testid="sidebar"]');
		await sidebar.waitForDisplayed({ timeout: 10_000 });

		const sessionCards = await $$(".session-card").getElements();
		assert.ok(sessionCards.length > 0, "at least one session card should be visible");
	});

	it("connection health shows online for local", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		await cleanupLocalConnection(baseUrl);

		const createRes = await apiRequest(baseUrl, "POST", "/api/connections", { type: "local" });
		assert.equal(createRes.ok, true, "create connection should succeed");

		const sidebar = await $('[data-testid="sidebar"]');
		await sidebar.waitForDisplayed({ timeout: 10_000 });

		const healthRes = await apiRequest(baseUrl, "GET", "/api/connections/local/health");
		assert.equal(healthRes.ok, true, "health endpoint should succeed");
		const healthJson = await healthRes.json() as { status: string };
		assert.equal(healthJson.status, "online", "local connection health should be online");
	});

	it("lists all connections via API", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const res = await apiRequest(baseUrl, "GET", "/api/connections");
		assert.equal(res.ok, true, "list connections should succeed");
		const json = await res.json() as { data?: Array<unknown> };
		assert.ok(Array.isArray(json.data), "response should have data array");
	});

	it("deletes connection via API", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		await cleanupLocalConnection(baseUrl);

		const createRes = await apiRequest(baseUrl, "POST", "/api/connections", { type: "local" });
		assert.equal(createRes.ok, true, "create connection should succeed");

		const deleteRes = await apiRequest(baseUrl, "DELETE", "/api/connections/local");
		assert.equal(deleteRes.ok, true, "delete connection should succeed");

		const listRes = await apiRequest(baseUrl, "GET", "/api/connections");
		const listJson = await listRes.json() as { data?: Array<{ targetName: string }> };
		const hasLocal = (listJson.data ?? []).some((c) => c.targetName === "local");
		assert.equal(hasLocal, false, "local connection should be deleted");
	});
});

export {};