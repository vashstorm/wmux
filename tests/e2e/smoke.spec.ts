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

test.describe("wmux smoke", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("page loads and empty state renders", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByTestId("sidebar")).toBeVisible();
		await expect(page.getByTestId("main-title")).toHaveText("Wmux");
		await expect(page.getByTestId("empty-state")).toContainText("Select a session");
		await expect(page.getByTestId("open-settings-button")).toBeVisible();
	});

	test("health api returns ok", async ({ request }) => {
		const response = await request.get("/api/health", {
			headers: {
				Authorization: "Bearer playwright-token",
			},
		});
		expect(response.ok()).toBeTruthy();
		expect(await response.json()).toEqual({ status: "ok" });
	});

	test("token protected api returns 401 without token", async ({ request }) => {
		const response = await request.get("/api/connections");

		expect(response.status()).toBe(401);
		expect(await response.json()).toEqual({
			error: {
				code: "unauthorized",
				message: "missing or invalid authentication token",
			},
		});
	});

	test("create local connection via settings and expose first-session action", async ({ page }) => {
		await page.goto("/");

		await page.getByTestId("open-settings-button").click();
		await page.getByTestId("settings-new-connection-button").click();
		await expect(page.getByTestId("new-connection-form")).toBeVisible();
		await page.getByTestId("connection-name-input").fill("Local Demo");
		await page.getByTestId("save-connection").click();

		await expect(page.getByTestId("settings-panel")).toContainText("Local Demo");
		await page.getByLabel("Close settings").click();

		await expect(page.getByTestId("empty-connections")).toContainText("Local Demo");
		await expect(page.locator("[data-testid^='new-session-button-']").first()).toBeVisible();
	});

	test("local tmux session renders in terminal", async ({ page, request }) => {
		const connectionName = "Prepared Local";
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

		await expect(page.getByTestId("main-title")).toContainText(terminalSessionName);
		await expect(page.getByTestId("terminal")).toContainText("WMUX_READY", {
			timeout: 10000,
		});
	});
});
