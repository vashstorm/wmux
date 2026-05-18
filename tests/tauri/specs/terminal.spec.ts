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

async function getTerminalText(): Promise<string> {
	const rows = await $$(".xterm-rows").getElements();
	assert.ok(rows.length > 0, "terminal should render .xterm-rows");
	const rowTexts: string[] = [];
	for (const row of rows) {
		rowTexts.push(await row.getText());
	}
	return rowTexts.join("\n");
}

async function waitForTerminalText(expected: string): Promise<void> {
	await browser.waitUntil(
		async () => (await getTerminalText()).includes(expected),
		{
			timeout: 15_000,
			timeoutMsg: `terminal did not render ${expected}`,
		},
	);
}

async function openPreparedSession(): Promise<void> {
	const sessionCard = await $(`[data-testid="session-card-${sessionName}"]`);
	await sessionCard.waitForDisplayed({ timeout: 15_000 });

	const openButton = await $(`[data-testid="session-open-${sessionName}"]`);
	await openButton.click();

	const pane = await $(".pane-box");
	await pane.waitForDisplayed({ timeout: 10_000 });
	await pane.click();

	const terminal = await $('[data-testid="terminal"]');
	await terminal.waitForDisplayed({ timeout: 10_000 });
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

async function waitForBackendShutdown(baseUrl: string): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (!(await isBackendReachable(baseUrl))) {
			return;
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
	}
	assert.fail(`backend port was still reachable at ${baseUrl}`);
}

describe("Tauri terminal desktop E2E", () => {
	before(function () {
		if (!hasTmux()) {
			console.warn("Skipping Tauri desktop E2E: tmux binary not found.");
			this.skip();
		}
	});

	it("launches the app and renders the main window", async () => {
		const sidebar = await $('[data-testid="sidebar"]');
		await sidebar.waitForDisplayed({ timeout: 15_000 });

		const title = await $('[data-testid="main-title"]');
		assert.equal(await title.getText(), "Wmux");
		assert.ok(await isBackendReachable(await getRuntimeBaseUrl()), "runtime backend should be healthy");
	});

	it("connects to the prepared local tmux session", async () => {
		await openPreparedSession();

		const title = await $('[data-testid="main-title"]');
		await browser.waitUntil(
			async () => (await title.getText()).includes(sessionName),
			{
				timeout: 10_000,
				timeoutMsg: "main title did not include the tmux session name",
			},
		);
		await waitForTerminalText("TAURI_READY");
	});

	it("renders xterm rows and echoes typed input", async () => {
		await openPreparedSession();

		const terminal = await $('[data-testid="terminal"]');
		await terminal.click();
		await browser.keys(["e", "c", "h", "o", " ", "h", "e", "l", "l", "o", "Enter"]);

		await waitForTerminalText("hello");
	});

	it("keeps the terminal connected after resizing", async () => {
		await openPreparedSession();
		await waitForTerminalText("TAURI_READY");

		await browser.setWindowSize(980, 700);
		await waitForTerminalText("TAURI_READY");

		const overlays = await $$('[data-testid="terminal-disconnected"]').getElements();
		if (overlays.length > 0) {
			const overlay = overlays[0];
			assert.ok(overlay, "terminal disconnected overlay should exist when reported");
			assert.equal(await overlay.isDisplayed(), false, "terminal should not show disconnected overlay");
		}
	});

	it("releases the backend port when the app closes", async () => {
		const baseUrl = await getRuntimeBaseUrl();
		await browser.closeWindow();
		await waitForBackendShutdown(baseUrl);
	});
});

export {};
