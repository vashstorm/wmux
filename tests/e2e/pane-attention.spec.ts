import { expect, test } from "../../web/node_modules/@playwright/test/index.js";
import type { APIRequestContext } from "../../web/node_modules/@playwright/test/index.js";
import { execFileSync } from "node:child_process";

const sessionName = process.env.WMUX_PLAYWRIGHT_SESSION ?? "wmux-playwright";
const windowName = process.env.WMUX_PLAYWRIGHT_WINDOW ?? "playwright";

async function createLocalConnection(request: APIRequestContext) {
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

test.describe("pane attention indicator", () => {
	test.beforeEach(async () => {
		// Enter copy-mode BEFORE creating connection so the initial page load already has attention data
		execFileSync("tmux", ["copy-mode", "-t", `${sessionName}:${windowName}`]);
	});

	test.afterEach(async () => {
		// Exit copy-mode to prevent leaking into other tests
		try {
			execFileSync("tmux", ["send-keys", "-t", `${sessionName}:${windowName}`, "q", ""]);
		} catch {
			// Ignore cleanup errors
		}
	});

	test("displays attention indicators on all three UI layers when pane is in copy-mode", async ({ page, request }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});

		await createLocalConnection(request);
		await page.goto("/");

		// Assert session card has is-attention class
		const sessionCard = page.locator(`[data-testid="session-card-${sessionName}"]`);
		await expect(sessionCard).toBeVisible({ timeout: 5000 });
		await expect(sessionCard).toHaveClass(/is-attention/, { timeout: 5000 });

		// Assert session card has attention-badge in meta area
		const sessionCardMeta = sessionCard.locator(".session-card-meta");
		await expect(sessionCardMeta.locator(".attention-badge")).toBeVisible({ timeout: 5000 });

		// Click to open session
		await sessionCard.getByTestId(`session-open-${sessionName}`).click();

		// Wait for window tabs
		await expect(page.locator(".window-tabs")).toBeVisible({ timeout: 5000 });

		// Assert window tab has is-attention class
		const windowTabWithAttention = page.locator(".window-tab.is-attention");
		await expect(windowTabWithAttention).toBeVisible({ timeout: 5000 });

		// Assert window tab has attention-badge
		await expect(page.locator(".window-tab .attention-badge")).toBeVisible({ timeout: 5000 });

		// Assert pane box has is-attention class
		const paneBoxWithAttention = page.locator(".pane-box.is-attention");
		await expect(paneBoxWithAttention).toBeVisible({ timeout: 5000 });

		// Assert pane box has attention indicator
		await expect(page.locator(".pane-box-attention-indicator")).toBeVisible({ timeout: 5000 });
	});
});
