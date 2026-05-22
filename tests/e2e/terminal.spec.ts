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

test.describe("terminal", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("terminal renders after selecting pane", async ({ page, request }) => {
		await createLocalConnection(request);
		await page.goto("/");

		const sessionCard = page.locator(`[data-testid="session-card-${terminalSessionName}"]`);
		await expect(sessionCard).toBeVisible();
		await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

		await expect(page.locator(".pane-box")).toBeVisible({ timeout: 5000 });
		await page.locator(".pane-box").first().click({ force: true });

		await expect(page.getByTestId("terminal")).toBeVisible();
	});

	test("terminal shows ready signal", async ({ page, request }) => {
		await createLocalConnection(request);
		await page.goto("/");

		const sessionCard = page.locator(`[data-testid="session-card-${terminalSessionName}"]`);
		await expect(sessionCard).toBeVisible();
		await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

		await expect(page.locator(".pane-box")).toBeVisible({ timeout: 5000 });
		await page.locator(".pane-box").first().click({ force: true });

		await expect(page.getByTestId("terminal")).toContainText("WMUX_READY", {
			timeout: 10000,
		});
	});

	test("main title updates with session name", async ({ page, request }) => {
		await createLocalConnection(request);
		await page.goto("/");

		const sessionCard = page.locator(`[data-testid="session-card-${terminalSessionName}"]`);
		await expect(sessionCard).toBeVisible();
		await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

		await expect(page.locator(".pane-box")).toBeVisible({ timeout: 5000 });
		await page.locator(".pane-box").first().click({ force: true });

		await expect(page.getByTestId("main-title")).toBeVisible();
	});

	test("terminal accepts input and displays command output", async ({ page, request }) => {
		await createLocalConnection(request);
		await page.goto("/");

		const sessionCard = page.locator(`[data-testid="session-card-${terminalSessionName}"]`);
		await expect(sessionCard).toBeVisible();
		await sessionCard.getByTestId(`session-open-${terminalSessionName}`).click();

		await expect(page.locator(".pane-box")).toBeVisible({ timeout: 5000 });
		await page.locator(".pane-box").first().click({ force: true });
		await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 10000 });

		const marker = `WMUX_E2E_HELLO_${Date.now()}`;
		await page.getByTestId("terminal").click();
		await page.keyboard.type(`echo ${marker}`);
		await page.keyboard.press("Enter");

		await expect(page.getByTestId("terminal")).toContainText(marker, {
			timeout: 10000,
		});
	});
});
