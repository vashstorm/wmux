// @ts-nocheck
import playwrightTest from "../../web/node_modules/@playwright/test/index.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const test = playwrightTest;
const { expect } = playwrightTest;

test.describe("error logs", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("displays deterministic error log in standalone dialog", async ({ page }) => {
		const tempDir = process.env.WMUX_PLAYWRIGHT_TEMP_DIR!;
		const errorLogPath = join(tempDir, "logs", "wmux-error.log");
		writeFileSync(errorLogPath, "2026-05-18T00:00:00Z ERROR playwright deterministic error log\n");

		await page.goto("/");

		await expect(page.getByTestId("error-logs-badge")).toBeVisible({ timeout: 5000 });
		await page.getByTestId("open-error-logs-button").click();

		await expect(page.getByTestId("error-logs-panel")).toBeVisible();
		await expect(page.getByTestId("error-logs-content")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("error-logs-path")).toContainText(errorLogPath);

		await expect(page.getByTestId("error-logs-content")).toContainText(
			"ERROR playwright deterministic error log",
		);
	});

	test("clears error logs with confirmation", async ({ page }) => {
		const tempDir = process.env.WMUX_PLAYWRIGHT_TEMP_DIR!;
		const errorLogPath = join(tempDir, "logs", "wmux-error.log");
		writeFileSync(errorLogPath, "2026-05-18T00:00:00Z ERROR playwright deterministic error log\n");

		await page.goto("/");

		await expect(page.getByTestId("error-logs-badge")).toBeVisible({ timeout: 5000 });
		await page.getByTestId("open-error-logs-button").click();

		await expect(page.getByTestId("error-logs-content")).toBeVisible({ timeout: 5000 });

		await page.getByTestId("error-logs-clear").click();

		await expect(page.getByTestId("confirm-dialog")).toBeVisible();
		await expect(page.getByTestId("confirm-dialog")).toContainText("Clear Error Logs");

		await page.getByTestId("confirm-dialog-confirm").click();

		await expect(page.getByTestId("confirm-dialog")).not.toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("error-logs-empty")).toBeVisible({ timeout: 5000 });
	});
});
