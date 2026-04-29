// @ts-nocheck
import { expect, test } from "../../web/node_modules/@playwright/test/index.js";

test.describe("wmux smoke", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("page loads and empty state renders", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByTestId("sidebar")).toBeVisible();
		await expect(page.getByTestId("main-title")).toHaveText("Select a session");
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
			const response = await request.get("/api/connections", {
			});

			expect(response.status()).toBe(401);
			expect(await response.json()).toEqual({
				error: {
					code: "unauthorized",
					message: "missing or invalid authentication token",
			},
		});
	});

		test("create local connection via ui", async ({ page }) => {
			await page.goto("/");

			await page.getByTestId("new-connection-button").click();
			await expect(page.getByTestId("new-connection-form")).toBeVisible();
			await page.getByTestId("connection-name-input").fill("Local Demo");
			await page.getByTestId("save-connection").click();

			await expect(page.getByText("Local Demo")).toBeVisible();
			await page.getByText("Local Demo").click();
			await expect(page.getByTestId("main-title")).toHaveText("Sessions");
			await expect(page.getByTestId("session-list")).toContainText("No sessions yet");
		});

	test("settings panel opens and shows fields", async ({ page }) => {
		await page.goto("/");

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();
		await expect(page.getByTestId("settings-bind-input")).toBeVisible();
		await expect(page.getByTestId("settings-token-input")).toBeVisible();
		await expect(page.getByTestId("settings-tmux-path-input")).toBeVisible();
		await expect(page.getByTestId("settings-theme-toggle")).toBeVisible();
	});
});
