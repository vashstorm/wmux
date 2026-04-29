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

test.describe("terminal", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("terminal renders after selecting pane", async ({ page, request }) => {
		const connectionName = "Terminal Test Local";
		await createLocalConnection(request, connectionName);
		await page.goto("/");

		const sessionItem = page
			.locator(".sidebar-session-item")
			.filter({ has: page.getByText(connectionName) })
			.filter({ has: page.getByTestId(`session-label-${terminalSessionName}`) })
			.first();

		await expect(sessionItem.getByTestId(`session-label-${terminalSessionName}`)).toBeVisible();
		await sessionItem.getByTestId(`session-toggle-${terminalSessionName}`).click();

		await expect(sessionItem.locator("[data-testid^='window-toggle-']").first()).toBeVisible();
		await sessionItem.locator("[data-testid^='window-toggle-']").first().click();

		await expect(sessionItem.locator("[data-testid^='pane-']").first()).toBeVisible();
		await sessionItem.locator("[data-testid^='pane-']").first().click();

		await expect(page.getByTestId("terminal")).toBeVisible();
	});

	test("terminal shows ready signal", async ({ page, request }) => {
		const connectionName = "Ready Signal Test";
		await createLocalConnection(request, connectionName);
		await page.goto("/");

		const sessionItem = page
			.locator(".sidebar-session-item")
			.filter({ has: page.getByText(connectionName) })
			.filter({ has: page.getByTestId(`session-label-${terminalSessionName}`) })
			.first();

		await sessionItem.getByTestId(`session-toggle-${terminalSessionName}`).click();
		await sessionItem.locator("[data-testid^='window-toggle-']").first().click();
		await sessionItem.locator("[data-testid^='pane-']").first().click();

		await expect(page.getByTestId("terminal")).toContainText("WMUX_READY", {
			timeout: 10000,
		});
	});

	test("main title updates with session name", async ({ page, request }) => {
		const connectionName = "Title Update Test";
		await createLocalConnection(request, connectionName);
		await page.goto("/");

		const sessionItem = page
			.locator(".sidebar-session-item")
			.filter({ has: page.getByText(connectionName) })
			.filter({ has: page.getByTestId(`session-label-${terminalSessionName}`) })
			.first();

		await sessionItem.getByTestId(`session-toggle-${terminalSessionName}`).click();
		await sessionItem.locator("[data-testid^='window-toggle-']").first().click();
		await sessionItem.locator("[data-testid^='pane-']").first().click();

		await expect(page.getByTestId("main-title")).toContainText(terminalSessionName);
	});
});
