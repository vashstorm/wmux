// @ts-nocheck
import playwrightTest from "../../web/node_modules/@playwright/test/index.js";

const test = playwrightTest;
const { expect } = playwrightTest;

test.describe("settings panel", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("opens settings panel", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByTestId("sidebar")).toBeVisible();
		await page.getByTestId("open-settings-button").click();

		await expect(page.getByTestId("settings-panel")).toBeVisible();
		await expect(page.getByTestId("settings-panel")).toContainText("Settings");
	});

	test("creates local connection in settings", async ({ page }) => {
		await page.goto("/");

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();
		await page.getByRole("button", { name: /Connections/i }).click();

		await page.getByRole("button", { name: /NEW/i }).first().click();
		await expect(page.getByTestId("new-connection-form")).toBeVisible();

		await page.getByTestId("connection-type-select").click();
		await page.getByRole("option", { name: "Local" }).click();
		await page.getByTestId("save-connection").click();

		await expect(page.getByTestId("settings-panel")).toContainText("local");
	});

	test("deletes connection with confirm", async ({ page, request }) => {
		const response = await request.post("/api/connections", {
			headers: {
				Authorization: "Bearer playwright-token",
			},
			data: {
				type: "local",
			},
		});
		expect(response.ok()).toBeTruthy();
		const connection = await response.json();

		await page.goto("/");

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();
		await page.getByRole("button", { name: /Connections/i }).click();

		await expect(page.getByTestId("settings-panel")).toContainText("local");

		await page.locator(".connection-delete-btn").first().click();

		await expect(page.getByTestId("confirm-dialog")).toBeVisible();
		await expect(page.getByTestId("confirm-dialog")).toContainText("Delete Connection");

		await page.getByTestId("confirm-dialog-confirm").press("Enter");

		await expect(page.getByTestId("confirm-dialog")).not.toBeVisible({ timeout: 5000 });
	});
});
