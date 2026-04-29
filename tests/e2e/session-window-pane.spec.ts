// @ts-nocheck
import { expect, test } from "../../web/node_modules/@playwright/test/index.js";

const terminalSessionName = process.env.WMUX_PLAYWRIGHT_SESSION ?? "wmux-playwright";

async function createLocalConnection(request: any, name: string) {
	const response = await request.post("/api/connections", {
		headers: {
			Authorization: "Bearer playwright-token",
		},
		data: {
			name,
			type: "local",
		},
	});

	expect(response.ok()).toBeTruthy();
	return response.json();
}

test.describe("session window pane navigation", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("clicking session loads window tabs in main panel", async ({ page, request }) => {
		const connectionName = "Session Load Test";
		await createLocalConnection(request, connectionName);
		await page.goto("/");

		const sessionItem = page
			.locator(".sidebar-session-item")
			.filter({ has: page.getByText(connectionName) })
			.filter({ has: page.getByTestId(`session-label-${terminalSessionName}`) })
			.first();

		await expect(sessionItem.getByTestId(`session-label-${terminalSessionName}`)).toBeVisible();
		await sessionItem.getByTestId(`session-open-${terminalSessionName}`).click();

		await expect(page.locator(".window-tabs")).toBeVisible();
		await expect(page.locator(".window-tab")).toHaveCount(1, { timeout: 5000 });
	});

	test("active window tab is highlighted by default", async ({ page, request }) => {
		const connectionName = "Active Tab Test";
		await createLocalConnection(request, connectionName);
		await page.goto("/");

		const sessionItem = page
			.locator(".sidebar-session-item")
			.filter({ has: page.getByText(connectionName) })
			.filter({ has: page.getByTestId(`session-label-${terminalSessionName}`) })
			.first();

		await sessionItem.getByTestId(`session-open-${terminalSessionName}`).click();

		const activeTab = page.locator(".window-tab.active");
		await expect(activeTab).toBeVisible({ timeout: 5000 });
	});

	test("clicking pane box updates selected pane", async ({ page, request }) => {
		const connectionName = "Pane Click Test";
		await createLocalConnection(request, connectionName);
		await page.goto("/");

		const sessionItem = page
			.locator(".sidebar-session-item")
			.filter({ has: page.getByText(connectionName) })
			.filter({ has: page.getByTestId(`session-label-${terminalSessionName}`) })
			.first();

		await sessionItem.getByTestId(`session-open-${terminalSessionName}`).click();

		await expect(page.locator(".pane-box")).toBeVisible({ timeout: 5000 });

		const firstPane = page.locator(".pane-box").first();
		await firstPane.click();

		await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 10000 });
	});

	test("main title shows human-readable names", async ({ page, request }) => {
		const connectionName = "Title Names Test";
		await createLocalConnection(request, connectionName);
		await page.goto("/");

		const sessionItem = page
			.locator(".sidebar-session-item")
			.filter({ has: page.getByText(connectionName) })
			.filter({ has: page.getByTestId(`session-label-${terminalSessionName}`) })
			.first();

		await sessionItem.getByTestId(`session-open-${terminalSessionName}`).click();

		await expect(page.getByTestId("main-title")).toContainText(terminalSessionName, { timeout: 5000 });
		await expect(page.getByTestId("main-title")).toContainText("/", { timeout: 5000 });
	});
});
