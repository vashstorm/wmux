// @ts-nocheck
import { expect, test } from "../../web/node_modules/@playwright/test/index.js";

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

		await page.goto("/");
		await page.getByTestId("open-settings-button").click();

		await expect(page.getByTestId("error-banner")).toBeVisible();

		await page.getByTestId("error-banner").getByLabel("Dismiss error").click();

		await expect(page.getByTestId("error-banner")).not.toBeVisible();
	});
});
