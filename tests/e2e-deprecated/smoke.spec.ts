// @ts-nocheck
import playwrightTest from "../../web/node_modules/@playwright/test/index.js";
import { ensurePlaywrightTmuxSession } from "./helpers/tmux.js";

const test = playwrightTest;
const { expect } = playwrightTest;

const terminalSessionName = process.env.WMUX_PLAYWRIGHT_SESSION ?? "wmux-playwright";

async function createLocalConnection(request: any) {
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

test.describe("wmux smoke", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("page loads and empty state renders", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByTestId("sidebar")).toBeVisible();
		await expect(page.getByTestId("main-title")).toHaveText("");
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
		await page.getByRole("button", { name: /Connections/i }).click();
		await page.getByRole("button", { name: /NEW/i }).first().click();
		await expect(page.getByTestId("new-connection-form")).toBeVisible();
		await page.getByTestId("connection-type-select").click();
		await page.getByRole("option", { name: "Local" }).click();
		await page.getByTestId("save-connection").click();

		await expect(page.getByTestId("settings-panel")).toContainText("local");
		await page.getByLabel("Close settings").click();

		await expect(page.getByTestId("sidebar")).toBeVisible();
	});

	test("local tmux session renders in terminal", async ({ page, request }) => {
		await createLocalConnection(request);
		await page.goto("/");

		const sessionCard = page.locator(`[data-testid="session-card-${terminalSessionName}"]`);
		await expect(sessionCard).toBeVisible();
		await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

		await expect(page.locator(".pane-box")).toBeVisible({ timeout: 5000 });
		await page.locator(".pane-box").first().click({ force: true });

		await expect(page.getByTestId("main-title")).toBeVisible();
		await expect(page.getByTestId("terminal")).toContainText("WMUX_READY", {
			timeout: 10000,
		});
	});
});
