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

	test("typography scale increase twice increases font-size-base", async ({ page }) => {
		await page.goto("/");

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();

		await page.getByTestId("settings-nav").getByText("Typography", { exact: true }).click();

		await expect(page.getByTestId("settings-typography-preview")).toBeVisible();
		await expect(page.getByTestId("settings-scale-value")).toBeVisible();

		const initialFontSize = await page.evaluate(() =>
			document.documentElement.style.getPropertyValue("--font-size-base")
		);
		expect(initialFontSize).toBe("16px");

		await page.getByTestId("settings-scale-increase").click();
		await page.getByTestId("settings-scale-increase").click();

		await expect(page.getByTestId("settings-scale-value")).toContainText("+2");

		const increasedFontSize = await page.evaluate(() =>
			document.documentElement.style.getPropertyValue("--font-size-base")
		);
		expect(increasedFontSize).toBe("18px");
	});

	test("typography scale reset returns to default", async ({ page }) => {
		await page.goto("/");

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();

		await page.getByTestId("settings-nav").getByText("Typography", { exact: true }).click();

		await expect(page.getByTestId("settings-typography-preview")).toBeVisible();
		await expect(page.getByTestId("settings-scale-value")).toBeVisible();

		await page.getByTestId("settings-scale-increase").click();
		await page.getByTestId("settings-scale-increase").click();
		await expect(page.getByTestId("settings-scale-value")).toContainText("+2");

		await page.getByTestId("settings-scale-reset").click();

		await expect(page.getByTestId("settings-scale-value")).toContainText("0");

		const resetFontSize = await page.evaluate(() =>
			document.documentElement.style.getPropertyValue("--font-size-base")
		);
		expect(resetFontSize).toBe("16px");
	});

	test("typography scale persists after page refresh", async ({ page }) => {
		await page.goto("/");

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();

		await page.getByTestId("settings-nav").getByText("Typography", { exact: true }).click();

		await expect(page.getByTestId("settings-typography-preview")).toBeVisible();

		await page.getByTestId("settings-scale-increase").click();
		await expect(page.getByTestId("settings-scale-value")).toContainText("+1");

		await page.getByRole("button", { name: /Save/i }).click();
		await expect(page.getByTestId("settings-panel")).not.toBeVisible({ timeout: 5000 });

		await page.reload();

		const persistedFontSize = await page.evaluate(() =>
			document.documentElement.style.getPropertyValue("--font-size-base")
		);
		expect(persistedFontSize).toBe("17px");

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();
		await page.getByTestId("settings-nav").getByText("Typography", { exact: true }).click();
		await expect(page.getByTestId("settings-scale-value")).toContainText("+1");
	});

	test("terminal preview responds to global scale", async ({ page }) => {
		await page.goto("/");

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();

		await page.getByTestId("settings-nav").getByText("Typography", { exact: true }).click();

		const preview = page.getByTestId("settings-typography-preview");
		await expect(preview).toBeVisible();

		await page.getByTestId("settings-scale-reset").click();
		await expect(page.getByTestId("settings-scale-value")).toContainText("0");

		const terminalText = preview.locator("div").filter({ hasText: "$ tmux ls" });
		await expect(terminalText).toBeVisible();

		const initialTerminalFontSize = await terminalText.evaluate((el) =>
			window.getComputedStyle(el).fontSize
		);
		expect(initialTerminalFontSize).toBe("14px");

		await page.getByTestId("settings-scale-increase").click();
		await page.getByTestId("settings-scale-increase").click();

		const scaledTerminalFontSize = await terminalText.evaluate((el) =>
			window.getComputedStyle(el).fontSize
		);
		expect(scaledTerminalFontSize).toBe("15px");
	});
});
