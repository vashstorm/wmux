// @ts-nocheck
import { expect, test } from "../../web/node_modules/@playwright/test/index.js";

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

		await page.locator("[title='New Connection']").click();
		await expect(page.getByTestId("new-connection-form")).toBeVisible();

		await page.getByTestId("connection-type-select").selectOption("local");
		await page.getByTestId("save-connection").click();

		await expect(page.getByTestId("settings-panel")).toContainText("local");
	});

	test("edits existing connection", async ({ page, request }) => {
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

		await expect(page.getByTestId("settings-panel")).toContainText("local");

		await page.getByTestId(`settings-edit-connection-${connection.id}`).click();

		await expect(page.getByTestId("new-connection-form")).toBeVisible();
		await expect(page.getByTestId("computed-connection-name")).toContainText("local");

		await page.getByTestId("connection-type-select").selectOption("ssh");
		await page.getByTestId("connection-host-input").fill("example.com");
		await page.getByTestId("connection-user-input").fill("root");
		await page.getByTestId("save-connection").click();

		await expect(page.getByTestId("settings-panel")).toContainText("example.com");
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

		await expect(page.getByTestId("settings-panel")).toContainText("local");

		await page.getByTestId(`settings-delete-connection-${connection.id}`).press("Enter");

		await expect(page.getByTestId("confirm-dialog")).toBeVisible();
		await expect(page.getByTestId("confirm-dialog")).toContainText("Delete Connection");

		await page.getByTestId("confirm-dialog-confirm").press("Enter");

		await expect(page.getByTestId(`settings-delete-connection-${connection.id}`)).toHaveCount(0, {
			timeout: 5000,
		});
	});
});
