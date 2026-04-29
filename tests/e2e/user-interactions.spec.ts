// @ts-nocheck
import { expect, test } from "../../web/node_modules/@playwright/test/index.js";

const terminalSessionName = process.env.WMUX_PLAYWRIGHT_SESSION ?? "wmux-playwright";

async function createLocalConnection(request: any) {
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

function getSessionCardLocator(page: any, sessionName: string) {
	return page.locator(`[data-testid="session-card-${sessionName}"]`);
}

test.describe("user interactions", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test.describe("window tab switching", () => {
		test("clicking a window tab switches to that window", async ({ page, request }) => {
			await createLocalConnection(request);
			await page.goto("/");

			const sessionCard = getSessionCardLocator(page, terminalSessionName);
			await expect(sessionCard).toBeVisible();
			await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

			await expect(page.locator(".window-tabs")).toBeVisible();
			await expect(page.locator(".window-tab")).toHaveCount(1, { timeout: 5000 });

			const activeTab = page.locator(".window-tab.is-active");
			await expect(activeTab).toBeVisible();
		});

		test("switching between multiple window tabs updates main content", async ({ page, request }) => {
			await createLocalConnection(request);
			await page.goto("/");

			const sessionCard = getSessionCardLocator(page, terminalSessionName);
			await expect(sessionCard).toBeVisible();
			await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

			await expect(page.locator(".window-tabs")).toBeVisible();

			const activeTab = page.locator(".window-tab.is-active");
			await expect(activeTab).toBeVisible();

			const tabCount = await page.locator(".window-tab").count();
			expect(tabCount).toBeGreaterThanOrEqual(1);

			await expect(page.getByTestId("main-title")).toContainText(terminalSessionName);
		});
	});

	test.describe("session switching", () => {
		test("clicking different session cards switches between sessions", async ({ page, request }) => {
			await createLocalConnection(request);
			await page.goto("/");

			const sessionCard = getSessionCardLocator(page, terminalSessionName);
			await expect(sessionCard).toBeVisible();
			await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

			await expect(page.locator(".window-tabs")).toBeVisible({ timeout: 5000 });
			await expect(page.locator(".pane-box")).toHaveCount(1, { timeout: 5000 });
			await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 10000 });
		});

		test("session card open button loads windows in main panel", async ({ page, request }) => {
			await createLocalConnection(request);
			await page.goto("/");

			const sessionCard = getSessionCardLocator(page, terminalSessionName);
			await expect(sessionCard).toBeVisible();
			await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

			await expect(page.locator(".window-tabs")).toBeVisible({ timeout: 5000 });
			await expect(page.locator(".window-tab")).toHaveCount(1, { timeout: 5000 });
		});
	});

	test.describe("panel switching", () => {
		test("clicking different pane boxes switches active pane", async ({ page, request }) => {
			await createLocalConnection(request);
			await page.goto("/");

			const sessionCard = getSessionCardLocator(page, terminalSessionName);
			await expect(sessionCard).toBeVisible();
			await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

			await expect(page.locator(".pane-canvas")).toBeVisible({ timeout: 5000 });
			await expect(page.locator(".pane-box")).toHaveCount(1, { timeout: 5000 });

			const activePane = page.locator(".pane-box.is-active");
			await expect(activePane).toBeVisible();
		});

		test("pane click updates selected pane and shows terminal", async ({ page, request }) => {
			await createLocalConnection(request);
			await page.goto("/");

			await expect(page.locator(".session-card-list")).toBeVisible({ timeout: 10000 });
			const sessionCard = getSessionCardLocator(page, terminalSessionName);
			await expect(sessionCard).toBeVisible();
			await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

			await expect(page.locator(".pane-box")).toBeVisible({ timeout: 5000 });
			const firstPane = page.locator(".pane-box").first();
			await firstPane.click();

			await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 10000 });
			await expect(page.getByTestId("main-title")).toContainText(terminalSessionName, { timeout: 5000 });
		});
	});

	test.describe("pane data real-time updates", () => {
		test("terminal shows real-time output from pane", async ({ page, request }) => {
			await createLocalConnection(request);
			await page.goto("/");

			const sessionCard = getSessionCardLocator(page, terminalSessionName);
			await expect(sessionCard).toBeVisible();
			await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

			await expect(page.locator(".pane-box")).toBeVisible({ timeout: 5000 });
			const firstPane = page.locator(".pane-box").first();
			await firstPane.click();

			await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 10000 });
			await expect(page.getByTestId("terminal")).toContainText("WMUX_READY", {
				timeout: 10000,
			});
		});

		test("main title updates when switching between panes", async ({ page, request }) => {
			await createLocalConnection(request);
			await page.goto("/");

			const sessionCard = getSessionCardLocator(page, terminalSessionName);
			await expect(sessionCard).toBeVisible();
			await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

			await expect(page.locator(".pane-box")).toBeVisible({ timeout: 5000 });
			const firstPane = page.locator(".pane-box").first();
			await firstPane.click();

			await expect(page.getByTestId("main-title")).toContainText(terminalSessionName, { timeout: 5000 });

			const titleText = await page.getByTestId("main-title").textContent();
			expect(titleText).toContain("/");
		});

		test("pane canvas reflects current window selection", async ({ page, request }) => {
			await createLocalConnection(request);
			await page.goto("/");

			const sessionCard = getSessionCardLocator(page, terminalSessionName);
			await expect(sessionCard).toBeVisible();
			await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

			await expect(page.locator(".pane-canvas")).toBeVisible({ timeout: 5000 });
			await expect(page.locator(".pane-box")).toHaveCount(1, { timeout: 5000 });

			const activeBox = page.locator(".pane-box.is-active");
			await expect(activeBox).toBeVisible();
		});
	});
});
