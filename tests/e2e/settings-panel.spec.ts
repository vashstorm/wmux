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
		expect(initialTerminalFontSize).toBe("17px");

		await page.getByTestId("settings-scale-increase").click();
		await page.getByTestId("settings-scale-increase").click();

		const scaledTerminalFontSize = await terminalText.evaluate((el) =>
			window.getComputedStyle(el).fontSize
		);
		expect(scaledTerminalFontSize).toBe("19px");
	});

	test("voice settings persist after save", async ({ page, request }) => {
		await page.goto("/");

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();

		await page.getByTestId("settings-tab-voice").click();
		await expect(page.getByTestId("voice-enabled-toggle")).toBeVisible();

		await page.getByTestId("voice-base-url-input").fill("wss://dashscope.aliyuncs.com/api-ws/v1/realtime");
		await page.getByTestId("voice-model-input").fill("qwen3.5-omni-plus-realtime");
		await page.getByTestId("voice-voice-input").fill("TestVoice");

		const saveButton = page.getByRole("button", { name: /^Save$/i });
		await expect(saveButton).not.toBeDisabled();

		const [saveResponse] = await Promise.all([
			page.waitForResponse((resp) => resp.url().includes("/api/config") && resp.request().method() === "PUT"),
			saveButton.click(),
		]);

		expect(saveResponse.ok()).toBeTruthy();

		const configResponse = await request.get("/api/config", {
			headers: { Authorization: "Bearer playwright-token" },
		});
		expect(configResponse.ok()).toBeTruthy();
		const config = await configResponse.json();

		expect(config.voice?.endpoint).toBe("wss://dashscope.aliyuncs.com/api-ws/v1/realtime");
		expect(config.voice?.model).toBe("qwen3.5-omni-plus-realtime");
		expect(config.voice?.voice).toBe("TestVoice");
	});

	test("microphone disabled toggle persists after refresh", async ({ page }) => {
		await page.goto("/");

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();

		await page.getByTestId("settings-tab-voice").click();
		await expect(page.getByTestId("voice-microphone-disabled-toggle")).toBeVisible();

		const toggle = page.getByTestId("voice-microphone-disabled-toggle");
		await expect(toggle).not.toBeChecked();

		await toggle.click();
		await expect(toggle).toBeChecked();

		await page.getByRole("button", { name: /Save/i }).click();
		await expect(page.getByTestId("settings-panel")).not.toBeVisible({ timeout: 5000 });

		await page.reload();

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();
		await page.getByTestId("settings-tab-voice").click();

		await expect(page.getByTestId("voice-microphone-disabled-toggle")).toBeChecked();

		// Toggle back to enabled for cleanup
		await page.getByTestId("voice-microphone-disabled-toggle").click();
		await expect(page.getByTestId("voice-microphone-disabled-toggle")).not.toBeChecked();
		await page.getByRole("button", { name: /Save/i }).click();
		await expect(page.getByTestId("settings-panel")).not.toBeVisible({ timeout: 5000 });
	});

	test("microphone disabled blocks voice start button", async ({ page }) => {
		await page.goto("/");

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();

		await page.getByTestId("settings-tab-voice").click();
		await expect(page.getByTestId("voice-microphone-disabled-toggle")).toBeVisible();

		const toggle = page.getByTestId("voice-microphone-disabled-toggle");
		await toggle.click();
		await expect(toggle).toBeChecked();

		await page.getByRole("button", { name: /Save/i }).click();
		await expect(page.getByTestId("settings-panel")).not.toBeVisible({ timeout: 5000 });

		await page.goto("/");

		const voiceControl = page.locator("[data-ai-assistant-state]");
		await expect(voiceControl).toBeVisible();

		const disabledIndicator = page.locator(".voice-disabled-indicator");
		await expect(disabledIndicator).toBeVisible();
		await expect(disabledIndicator).toContainText("Microphone disabled");

		const startButton = page.getByRole("button", { name: "Start listening" });
		await expect(startButton).toBeDisabled();

		await page.evaluate(() => {
			const getUserMediaCalls = (window as unknown as { __getUserMediaCalls?: number }).__getUserMediaCalls ?? 0;
			(window as unknown as { __getUserMediaCalls: number }).__getUserMediaCalls = getUserMediaCalls;
		});

		const initialCalls = await page.evaluate(() => (window as unknown as { __getUserMediaCalls?: number }).__getUserMediaCalls ?? 0);
		expect(initialCalls).toBe(0);

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();
		await page.getByTestId("settings-tab-voice").click();
		await page.getByTestId("voice-microphone-disabled-toggle").click();
		await page.getByRole("button", { name: /Save/i }).click();
		await expect(page.getByTestId("settings-panel")).not.toBeVisible({ timeout: 5000 });
	});
});
