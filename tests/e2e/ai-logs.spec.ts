// @ts-nocheck
import playwrightTest from "../../web/node_modules/@playwright/test/index.js";

const test = playwrightTest;
const { expect } = playwrightTest;

test.describe("AI Logs", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("AI Logs tab is present and clickable", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByTestId("sidebar")).toBeVisible();

		const aiLogsButton = page.getByTestId("open-ai-logs-button");
		await expect(aiLogsButton).toBeVisible();
		await aiLogsButton.click();

		await expect(page.getByTestId("ai-logs-view")).toBeVisible({ timeout: 5000 });
	});

	test("AI Logs shows empty state", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByTestId("sidebar")).toBeVisible();
		await page.getByTestId("open-ai-logs-button").click();

		await expect(page.getByTestId("ai-logs-view")).toBeVisible({ timeout: 5000 });

		// Wait for loading to complete and verify empty state appears
		await expect(page.getByTestId("ai-logs-empty")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("ai-logs-empty")).toContainText("No AI logs found");
	});

	test("Clear button is disabled when no logs exist", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByTestId("sidebar")).toBeVisible();
		await page.getByTestId("open-ai-logs-button").click();

		await expect(page.getByTestId("ai-logs-view")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("ai-logs-empty")).toBeVisible({ timeout: 5000 });

		// Clear button should be disabled when no logs exist
		const clearButton = page.getByTestId("ai-logs-clear");
		await expect(clearButton).toBeVisible();
		await expect(clearButton).toBeDisabled();
	});

	test("Refresh button reloads view and preserves empty state", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByTestId("sidebar")).toBeVisible();
		await page.getByTestId("open-ai-logs-button").click();

		await expect(page.getByTestId("ai-logs-view")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("ai-logs-empty")).toBeVisible({ timeout: 5000 });

		// Click refresh button
		const refreshButton = page.getByTestId("ai-logs-refresh");
		await expect(refreshButton).toBeVisible();
		await expect(refreshButton).not.toBeDisabled();

		await refreshButton.click();

		// After refresh, empty state should still be visible
		await expect(page.getByTestId("ai-logs-empty")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("ai-logs-view")).toBeVisible();
	});
});