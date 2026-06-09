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

async function isBackendReachable(baseUrl: string): Promise<boolean> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 500);
	try {
		const response = await fetch(`${baseUrl}/api/health`, {
			signal: controller.signal,
		});
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

describe("Tauri app launch", () => {
	before(function () {
		if (!hasTmux()) {
			console.warn("Skipping Tauri desktop E2E: tmux binary not found.");
			this.skip();
		}
	});

	it("renders sidebar and main title", async () => {
		const sidebar = await $('[data-testid="sidebar"]');
		await sidebar.waitForDisplayed({ timeout: 15_000 });

		const mainTitle = await $('[data-testid="main-title"]');
		assert.equal(await mainTitle.getText(), "Wmux");
	});

	it("shows empty state when no session selected", async () => {
		const emptyState = await $('[data-testid="empty-state"]');
		await emptyState.waitForDisplayed({ timeout: 10_000 });
		const text = await emptyState.getText();
		assert.ok(text.includes("Select a session"), `Expected "Select a session" in empty state, got: ${text}`);
	});

	it("shows settings button", async () => {
		const settingsButton = await $('[data-testid="open-settings-button"]');
		await settingsButton.waitForDisplayed({ timeout: 10_000 });
		assert.ok(await settingsButton.isDisplayed());
	});

	it("backend health endpoint returns ok", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const response = await fetch(`${baseUrl}/api/health`);
		assert.equal(response.ok, true, "health endpoint should return 200");
		const json = await response.json() as { status: string };
		assert.equal(json.status, "ok");
	});

	it("returns 401 without auth token", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		const response = await fetch(`${baseUrl}/api/connections`);
		assert.equal(response.status, 401, "unauthenticated request should return 401");
		const json = await response.json() as { error: { code: string; message: string } };
		assert.equal(json.error.code, "unauthorized");
	});

	it("closes window and releases backend port", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		await browser.closeWindow();
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline) {
			if (!(await isBackendReachable(baseUrl))) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		assert.fail(`backend port was still reachable at ${baseUrl}`);
	});
});

export {};