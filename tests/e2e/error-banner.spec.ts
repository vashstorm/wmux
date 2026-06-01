// @ts-nocheck
import playwrightTest from "../../web/node_modules/@playwright/test/index.js";

const test = playwrightTest;
const { expect } = playwrightTest;

test.describe("error banner", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("shows unauthorized error on 401", async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.removeItem("wmux-auth-token");
		});

		await page.goto("/");

		await expect(page.getByTestId("sidebar")).toBeVisible();

		await page.getByTestId("open-settings-button").click();

		await expect(page.getByTestId("error-banner")).toBeVisible();
		await expect(page.getByTestId("error-banner")).toContainText("unauthorized");
	});

	test("dismisses error banner", async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.removeItem("wmux-auth-token");
		});

		// 1. Set up promise to wait for the initial page-load config fetch
		const initConfigPromise = page.waitForResponse(response => response.url().includes("/api/config"));
		await page.goto("/");
		await initConfigPromise;

		// 2. Set up promise to wait for the SettingsPanel's config fetch
		const configResponsePromise = page.waitForResponse(response => response.url().includes("/api/config"));
		await page.getByTestId("open-settings-button").click();
		await configResponsePromise;

		await expect(page.getByTestId("error-banner")).toBeVisible();

		await page.getByTestId("error-banner").getByLabel("Dismiss error").click();

		await expect(page.getByTestId("error-banner")).not.toBeVisible();
	});
});
