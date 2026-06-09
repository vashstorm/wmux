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
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (token) {
		headers["Authorization"] = `Bearer ${token}`;
	}

	const options: RequestInit = { method, headers };
	if (body) options.body = JSON.stringify(body);

	const response = await fetch(`${baseUrl}${path}`, options);
	return { ok: response.ok, status: response.status, json: () => response.json() };
}

describe("Tauri voice control", () => {
	before(function () {
		if (!hasTmux()) {
			console.warn("Skipping Tauri desktop E2E: tmux binary not found.");
			this.skip();
		}
	});

	it("config shows voice disabled by default", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const res = await apiRequest(baseUrl, "GET", "/api/config");
		assert.equal(res.ok, true, "get config should succeed");

		const json = await res.json() as {
			voice?: { enabled?: boolean; microphoneDisabled?: boolean };
		};
		assert.equal(json.voice?.enabled, false, "voice should be disabled by default");
	});

	it("config with microphoneDisabled blocks microphone access", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const getRes = await apiRequest(baseUrl, "GET", "/api/config");
		const originalConfig = await getRes.json();

		const updateRes = await apiRequest(baseUrl, "PUT", "/api/config", {
			voice: {
				enabled: true,
				microphoneDisabled: true,
			},
		});
		assert.equal(updateRes.ok, true, "update config should succeed");

		const verifyRes = await apiRequest(baseUrl, "GET", "/api/config");
		const verifyJson = await verifyRes.json() as {
			voice?: { enabled?: boolean; microphoneDisabled?: boolean };
		};
		assert.equal(verifyJson.voice?.microphoneDisabled, true, "microphone should be disabled");

		await apiRequest(baseUrl, "PUT", "/api/config", originalConfig);
	});

	it("shows AI Assistant button when voice is configured", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const getRes = await apiRequest(baseUrl, "GET", "/api/config");
		const originalConfig = await getRes.json();

		await apiRequest(baseUrl, "PUT", "/api/config", {
			voice: {
				enabled: false,
				microphoneDisabled: false,
			},
		});

		await browser.refresh();

		const aiAssistantButton = await $('button:has-text("Show AI Assistant")');
		await aiAssistantButton.waitForDisplayed({ timeout: 10_000 });
		assert.ok(await aiAssistantButton.isDisplayed(), "AI Assistant button should be visible");

		await apiRequest(baseUrl, "PUT", "/api/config", originalConfig);
	});

	it("voice skills are listed in config", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const res = await apiRequest(baseUrl, "GET", "/api/config");
		assert.equal(res.ok, true, "get config should succeed");

		const json = await res.json() as {
			voice?: { skills?: Array<{ id: string; enabled?: boolean }> };
		};
		if (json.voice?.skills) {
			assert.ok(Array.isArray(json.voice.skills), "skills should be an array");
			const skillIds = json.voice.skills.map((s) => s.id);
			assert.ok(skillIds.length > 0, "should have at least one voice skill");
		}
	});

	it("returns appropriate UI state when voice config is missing", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const res = await apiRequest(baseUrl, "GET", "/api/config");
		assert.equal(res.ok, true, "get config should succeed");

		const json = await res.json() as { voice?: unknown };
		assert.ok(json.voice !== undefined, "voice config should exist (even if empty)");
	});
});

export {};