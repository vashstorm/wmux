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

describe("Tauri config", () => {
	before(function () {
		if (!hasTmux()) {
			console.warn("Skipping Tauri desktop E2E: tmux binary not found.");
			this.skip();
		}
	});

	it("GET /api/config returns current configuration", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const res = await apiRequest(baseUrl, "GET", "/api/config");
		assert.equal(res.ok, true, "get config should succeed");

		const json = await res.json() as { schemaVersion?: number; server?: { bind?: string } };
		assert.equal(json.schemaVersion, 1, "schema version should be 1");
		assert.ok(json.server?.bind, "server.bind should be present");
	});

	it("PUT /api/config updates configuration", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const getRes = await apiRequest(baseUrl, "GET", "/api/config");
		const originalConfig = await getRes.json();

		const updateRes = await apiRequest(baseUrl, "PUT", "/api/config", {
			ui: {
				theme: "dark",
				fontSize: 18,
			},
		});
		assert.equal(updateRes.ok, true, "update config should succeed");

		const verifyRes = await apiRequest(baseUrl, "GET", "/api/config");
		const verifyJson = await verifyRes.json() as { ui?: { fontSize?: number } };
		assert.equal(verifyJson.ui?.fontSize, 18, "font size should be updated");

		await apiRequest(baseUrl, "PUT", "/api/config", originalConfig);
	});

	it("GET /api/config includes server, auth, tmux, and connections", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const res = await apiRequest(baseUrl, "GET", "/api/config");
		assert.equal(res.ok, true, "get config should succeed");

		const json = await res.json() as {
			server?: { bind?: string };
			auth?: { token?: string };
			tmux?: { path?: string };
			connections?: unknown[];
		};
		assert.ok(json.server, "server config should be present");
		assert.ok(json.auth, "auth config should be present");
		assert.ok(json.tmux, "tmux config should be present");
		assert.ok(Array.isArray(json.connections), "connections should be an array");
	});

	it("returns 401 when accessing config without token", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const token = await getToken();

		const headers: Record<string, string> = { "Content-Type": "application/json" };
		const response = await fetch(`${baseUrl}/api/config`, {
			method: "GET",
			headers,
		});
		assert.equal(response.status, 401, "unauthenticated config request should return 401");
	});
});

export {};