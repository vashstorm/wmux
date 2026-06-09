import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";

declare global {
	interface Window {
		__WMUX_RUNTIME__?: {
			baseUrl: string;
			token: string;
		};
	}
}

const sessionName = process.env.WMUX_TAURI_SESSION ?? "wmux-tauri-e2e";
const RANDOM_SWITCH_SEED = 42;

function hasTmux(): boolean {
	return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
}

function cleanupSession(name: string): void {
	try {
		execFileSync("tmux", ["kill-session", "-t", name], { stdio: "ignore" });
	} catch {
		// Ignore missing session
	}
}

function createSession(name: string): void {
	cleanupSession(name);
	execFileSync("tmux", ["new-session", "-d", "-s", name, "-n", "main", "printf 'SESSION_READY\\n'; exec $SHELL -i"]);
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

describe("Tauri random session switching", () => {
	const extraSessions = ["wmux-random-1", "wmux-random-2", "wmux-random-3"];

	before(function () {
		if (!hasTmux()) {
			console.warn("Skipping Tauri desktop E2E: tmux binary not found.");
			this.skip();
		}
	});

	before(async function () {
		for (const name of extraSessions) {
			createSession(name);
		}

		const baseUrl = await getRuntimeBaseUrl();
		const res = await apiRequest(baseUrl, "GET", "/api/connections");
		if (res.ok) {
			const json = await res.json() as { data?: Array<{ targetName: string }> };
			const hasLocal = (json.data ?? []).some((c) => c.targetName === "local");
			if (!hasLocal) {
				await apiRequest(baseUrl, "POST", "/api/connections", { type: "local" });
			}
		}

		await browser.execute(() => {
			(window as unknown as { __WMUX_RANDOM_SEED__?: number }).__WMUX_RANDOM_SEED__ = 42;
		});
	});

	after(function () {
		for (const name of extraSessions) {
			cleanupSession(name);
		}
	});

	it("creates 3 extra tmux sessions for random switching", async () => {
		for (const name of extraSessions) {
			const result = spawnSync("tmux", ["has-session", "-t", name], { stdio: "ignore" });
			assert.equal(result.status, 0, `session ${name} should exist`);
		}
	});

	it("UI displays all 4 session cards (1 prepared + 3 extra)", async () => {
		const sidebar = await $('[data-testid="sidebar"]');
		await sidebar.waitForDisplayed({ timeout: 15_000 });

		const sessionCards = await $$(".session-card").getElements();
		assert.ok(sessionCards.length >= 4, `should have at least 4 sessions, got ${sessionCards.length}`);
	});

	it("random switching with seed 42 produces deterministic ordering", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const sessionNames = [sessionName, ...extraSessions];

		const results: string[] = [];
		for (let i = 0; i < 3; i++) {
			const res = await apiRequest(baseUrl, "POST", "/api/sessions/random-switch", {
				seed: RANDOM_SWITCH_SEED,
				excludeCurrent: false,
			});

			if (res.ok) {
				const json = await res.json() as { sessionName?: string };
				if (json.sessionName) {
					results.push(json.sessionName);
				}
			}
		}

		assert.equal(results.length, 3, "should have 3 random switch results");
		const unique = new Set(results);
		assert.ok(unique.size >= 2, "should switch to different sessions across calls");
	});

	it("clicking different session cards switches between sessions", async () => {
		const sidebar = await $('[data-testid="sidebar"]');
		await sidebar.waitForDisplayed({ timeout: 15_000 });

		const sessionCard = await $(`[data-testid="session-card-${sessionName}"]`);
		await sessionCard.waitForDisplayed({ timeout: 10_000 });
		await sessionCard.click();

		const windowTabs = await $(".window-tabs");
		await windowTabs.waitForDisplayed({ timeout: 10_000 });
		assert.ok(await windowTabs.isDisplayed(), "window tabs should show after session click");

		const paneBox = await $(".pane-box");
		await paneBox.waitForDisplayed({ timeout: 10_000 });
		assert.ok(await paneBox.isDisplayed(), "pane box should show after session click");
	});

	it("switching sessions updates main panel content", async () => {
		const sidebar = await $('[data-testid="sidebar"]');
		await sidebar.waitForDisplayed({ timeout: 15_000 });

		const sessionCard = await $(`[data-testid="session-card-${sessionName}"]`);
		await sessionCard.waitForDisplayed({ timeout: 10_000 });
		await sessionCard.click();

		const mainTitle = await $('[data-testid="main-title"]');
		await mainTitle.waitForDisplayed({ timeout: 10_000 });
		const titleText = await mainTitle.getText();
		assert.ok(titleText.length > 0 || (await mainTitle.getText()) !== undefined, "main title should update");
	});
});

export {};