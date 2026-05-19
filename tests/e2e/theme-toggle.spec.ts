// @ts-nocheck
import playwrightTest from "../../web/node_modules/@playwright/test/index.js";

const test = playwrightTest;
const { expect } = playwrightTest;

test.describe("theme toggle", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("theme toggle switches light/dark and persists", async ({ page }) => {
		await page.goto("/");

		const toggle = page.getByTestId("theme-toggle");
		await expect(toggle).toBeVisible();

		const initialLabel = await toggle.getAttribute("aria-label");
		await toggle.click();
		await page.waitForTimeout(300);

		const newLabel = await toggle.getAttribute("aria-label");
		expect(newLabel).not.toBe(initialLabel);

		await page.reload();
		await page.waitForTimeout(500);
		const afterReload = page.getByTestId("theme-toggle");
		await expect(afterReload).toBeVisible();
		const persistedLabel = await afterReload.getAttribute("aria-label");
		expect(persistedLabel).toBe(newLabel);
	});
});
