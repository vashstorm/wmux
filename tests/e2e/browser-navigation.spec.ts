// @ts-nocheck
/// <reference types="node" />

import playwrightTest from "../../web/node_modules/@playwright/test/index.js";
import type { APIRequestContext, Page } from "../../web/node_modules/@playwright/test/index.js";
import { ensurePlaywrightTmuxSession } from "./helpers/tmux.js";

const test = playwrightTest;
const { expect } = playwrightTest;

const terminalSessionName = process.env.WMUX_PLAYWRIGHT_SESSION ?? "wmux-playwright";
const terminalWindowName = process.env.WMUX_PLAYWRIGHT_WINDOW ?? "playwright";

async function createLocalConnection(request: APIRequestContext) {
	ensurePlaywrightTmuxSession();

	const getResponse = await request.get("/api/connections", {
		headers: {
			Authorization: "Bearer playwright-token",
		},
	});
	if (getResponse.ok()) {
		const result = await getResponse.json();
		const connections = result.data || [];
		for (const conn of connections) {
			if (conn.targetName === "local" || conn.type === "local") {
				await request.delete(`/api/connections/${conn.targetName}`, {
					headers: {
						Authorization: "Bearer playwright-token",
					},
				});
			}
		}
	}

	const response = await request.post("/api/connections", {
		headers: {
			Authorization: "Bearer playwright-token",
		},
		data: {
			type: "local",
		},
	});

	expect(response.ok()).toBeTruthy();
	return response.json();
}

function getSessionCardLocator(page: Page, sessionName: string) {
	return page.locator(`[data-testid="session-card-${sessionName}"]`);
}

async function openSession(page: Page, sessionName: string) {
	const sessionCard = getSessionCardLocator(page, sessionName);
	await expect(sessionCard).toBeVisible();
	await sessionCard.getByTestId(`session-open-${sessionName}`).click();
	await expect(page.locator(".window-tabs")).toBeVisible({ timeout: 5000 });
}

test.describe("browser navigation", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("deep link opens workspace via URL params", async ({ page, request }) => {
		await createLocalConnection(request);

		const sessionName = terminalSessionName;
		const windowsResponse = await request.get(`/api/connections/local/sessions/${encodeURIComponent(sessionName)}/windows`, {
			headers: { Authorization: "Bearer playwright-token" },
		});
		expect(windowsResponse.ok()).toBeTruthy();
		const windowsData = await windowsResponse.json();
		const firstWindow = windowsData.data?.[0];
		expect(firstWindow).toBeDefined();

		const windowId = firstWindow.id;
		const activePaneId = firstWindow.activePaneId;

		await page.goto(`/?connection=local&session=${encodeURIComponent(sessionName)}&window=${encodeURIComponent(windowId)}&pane=${encodeURIComponent(activePaneId)}`);

		await expect(page.locator(".window-tabs")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 10000 });

		const url = new URL(page.url());
		expect(url.searchParams.get("session")).toBe(sessionName);
		expect(url.searchParams.get("connection")).toBe("local");
		expect(url.searchParams.get("window")).toBe(windowId);
		expect(url.searchParams.get("pane")).toBe(activePaneId);
	});

	test("refresh restores selected workspace", async ({ page, request }) => {
		await createLocalConnection(request);
		await page.goto("/");

		await openSession(page, terminalSessionName);

		// Verify URL was updated
		const urlBefore = new URL(page.url());
		expect(urlBefore.searchParams.get("session")).toBe(terminalSessionName);
		expect(urlBefore.searchParams.get("connection")).toBe("local");

		// Reload page
		await page.reload();

		// Same workspace should be restored
		await expect(page.locator(".window-tabs")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 10000 });

		// URL params should still be present
		const urlAfter = new URL(page.url());
		expect(urlAfter.searchParams.get("session")).toBe(terminalSessionName);
		expect(urlAfter.searchParams.get("connection")).toBe("local");
	});

	test("browser back/forward restores session state", async ({ page, request }) => {
		await createLocalConnection(request);
		await page.goto("/");

		// Initial state: empty state visible
		await expect(page.getByTestId("empty-state")).toBeVisible();

		// Open session
		await openSession(page, terminalSessionName);

		// Verify workspace is visible
		await expect(page.locator(".window-tabs")).toBeVisible();
		await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 10000 });

		// Go back
		await page.goBack();

		// Should return to empty state (no session selected)
		await expect(page.getByTestId("empty-state")).toBeVisible();

		// Go forward
		await page.goForward();

		// Session should be restored
		await expect(page.locator(".window-tabs")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 10000 });

		// URL params should be restored
		const url = new URL(page.url());
		expect(url.searchParams.get("session")).toBe(terminalSessionName);
		expect(url.searchParams.get("connection")).toBe("local");
	});

	test("pane clicks use replaceState not pushState", async ({ page, request }) => {
		await createLocalConnection(request);
		await page.goto("/");

		await openSession(page, terminalSessionName);

		// Get history length after opening session (includes the pushState from opening)
		const historyLengthAfterSessionOpen = await page.evaluate(() => window.history.length);

		// Check how many panes exist
		const paneBoxes = page.locator(".pane-box");
		let paneCount = await paneBoxes.count();

		// If only one pane, create a second pane via tmux split-window
		if (paneCount <= 1) {
			const sessionName = process.env.WMUX_PLAYWRIGHT_SESSION ?? "wmux-playwright";
			const windowName = process.env.WMUX_PLAYWRIGHT_WINDOW ?? "playwright";

			// Use tmux to split the window horizontally
			const { execFileSync } = await import("node:child_process");
			execFileSync("tmux", ["split-window", "-t", `${sessionName}:${windowName}`, "-h"], { stdio: "ignore" });

			// Wait for UI to update with new pane
			await page.waitForTimeout(500);
			await expect(paneBoxes).toHaveCount(2, { timeout: 5000 });
			paneCount = 2;
		}

		// Click multiple panes (pane clicks should use replaceState)
		for (let i = 0; i < Math.min(3, paneCount); i++) {
			await paneBoxes.nth(i).click({ force: true });
			// Small pause to ensure state updates
			await page.waitForTimeout(100);
		}

		// History length should not have increased from pane clicks
		// (replaceState doesn't add new history entries)
		const finalHistoryLength = await page.evaluate(() => window.history.length);

		// Pane clicks use replaceState, so history should stay the same
		expect(finalHistoryLength).toBe(historyLengthAfterSessionOpen);

		// Go back should return to pre-session state (empty state), NOT previous pane
		await page.goBack();

		// Should return to empty state because opening session was a pushState
		await expect(page.getByTestId("empty-state")).toBeVisible({ timeout: 5000 });

		// URL should be clean (no session params)
		const url = new URL(page.url());
		expect(url.searchParams.get("session")).toBeNull();
	});
});