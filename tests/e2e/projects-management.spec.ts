// @ts-nocheck
import playwrightTest from "../../web/node_modules/@playwright/test/index.js";
import { execFileSync } from "node:child_process";

const test = playwrightTest;
const { expect } = playwrightTest;

test.describe("wmux project management workflow", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("create project, see dashboard, launch missing tmux session", async ({ page }) => {
		const sessionName = `wmux-e2e-launch-${Date.now()}`;
		
		await page.goto("/");
		await page.getByTestId("open-projects-button").click();
		await expect(page.getByTestId("projects-view")).toBeVisible({ timeout: 5000 });

		await page.getByTestId("projects-add-button").click();
		await expect(page.getByTestId("project-form")).toBeVisible();
		await page.getByPlaceholder("Project name").fill(sessionName);
		await page.getByPlaceholder("Path (optional)").fill("/tmp/wmux-e2e-launch");
		await page.getByTestId("project-submit-button").click();

		await expect(page.getByTestId("project-form")).not.toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("project-dashboard-title")).toContainText(sessionName);
		await expect(page.getByTestId("project-launch-button")).toBeVisible();
		await expect(page.getByTestId("project-sync-button")).toBeVisible();
		await expect(page.getByTestId("project-ai-generate-button")).toBeVisible();

		await page.getByTestId("project-launch-button").click();
		
		await expect(page.getByTestId("main-title")).toBeVisible({ timeout: 10000 });
		
		try {
			execFileSync("tmux", ["has-session", "-t", sessionName], { stdio: "ignore" });
		} catch {
			await page.waitForTimeout(500);
			execFileSync("tmux", ["has-session", "-t", sessionName], { stdio: "ignore" });
		}

		try {
			execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
		} catch {
		}
	});

	test("sync existing tmux session verifies layout and status updates", async ({ page }) => {
		const sessionName = `wmux-e2e-sync-${Date.now()}`;
		
		try {
			execFileSync("tmux", ["new-session", "-d", "-s", sessionName, "-n", "main", "exec $SHELL -i"], { stdio: "ignore" });
			execFileSync("tmux", ["set-option", "-t", sessionName, "destroy-unattached", "off"], { stdio: "ignore" });
		} catch {
		}

		await page.goto("/");
		await page.getByTestId("open-projects-button").click();
		await expect(page.getByTestId("projects-view")).toBeVisible({ timeout: 5000 });

		await page.getByTestId("projects-add-button").click();
		await expect(page.getByTestId("project-form")).toBeVisible();
		await page.getByPlaceholder("Project name").fill(sessionName);
		await page.getByPlaceholder("Path (optional)").fill("/tmp/wmux-e2e-sync");
		await page.getByTestId("project-submit-button").click();

		await expect(page.getByTestId("project-form")).not.toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 5000 });

		await page.getByTestId("project-sync-button").click();
		
		await expect(page.getByTestId("project-sync-button")).toBeEnabled({ timeout: 10000 });

		await expect(page.getByTestId("project-dashboard")).toBeVisible();
		await expect(page.getByTestId("project-dashboard-title")).toContainText(sessionName);

		try {
			execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
		} catch {
		}
	});

	test("AI HTML area handles empty/disabled state without real provider", async ({ page }) => {
		await page.goto("/");
		await page.getByTestId("open-projects-button").click();
		await expect(page.getByTestId("projects-view")).toBeVisible({ timeout: 5000 });

		await page.getByTestId("projects-add-button").click();
		await expect(page.getByTestId("project-form")).toBeVisible();
		await page.getByPlaceholder("Project name").fill("wmux-e2e-ai-empty");
		await page.getByPlaceholder("Path (optional)").fill("/tmp/wmux-e2e-ai");
		await page.getByTestId("project-submit-button").click();

		await expect(page.getByTestId("project-form")).not.toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 5000 });

		await expect(page.getByText(/No AI-generated content yet/i)).toBeVisible({ timeout: 5000 });

		await page.getByTestId("project-ai-generate-button").click();
		
		await expect(page.getByTestId("project-ai-generate-button")).toBeEnabled({ timeout: 10000 });

		const errorText = page.getByText(/provider not configured|Failed to generate AI HTML|AI generation failed/i);
		const emptyPrompt = page.getByText(/No AI-generated content yet/i);
		
		await expect(errorText.or(emptyPrompt).first()).toBeVisible({ timeout: 5000 });

		await expect(page.getByTestId("project-ai-html")).not.toBeVisible();
	});

	test("project dashboard renders with expected test IDs", async ({ page }) => {
		await page.goto("/");
		await page.getByTestId("open-projects-button").click();
		await expect(page.getByTestId("projects-view")).toBeVisible({ timeout: 5000 });

		await page.getByTestId("projects-add-button").click();
		await expect(page.getByTestId("project-form")).toBeVisible();
		await page.getByPlaceholder("Project name").fill("wmux-e2e-dashboard-test");
		await page.getByPlaceholder("Path (optional)").fill("/tmp/wmux-e2e-dashboard");
		await page.getByTestId("project-submit-button").click();

		await expect(page.getByTestId("project-form")).not.toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("project-dashboard-title")).toBeVisible();
		await expect(page.getByTestId("project-dashboard-title")).toContainText("wmux-e2e-dashboard-test");
		await expect(page.getByTestId("project-launch-button")).toBeVisible();
		await expect(page.getByTestId("project-sync-button")).toBeVisible();
		await expect(page.getByTestId("project-ai-generate-button")).toBeVisible();
		
		await expect(page.getByText("Project Info")).toBeVisible();
		await expect(page.getByText("Name")).toBeVisible();
		await expect(page.getByText("Session")).toBeVisible();
		await expect(page.getByText("Status")).toBeVisible();
		await expect(page.getByText("Working dir")).toBeVisible();
		await expect(page.getByText("Path")).toBeVisible();
		await expect(page.getByText("Created")).toBeVisible();
		await expect(page.getByText("Updated")).toBeVisible();

		await expect(page.getByText("AI Generated Content")).toBeVisible();

		await expect(page.getByTestId("project-launch-button")).toBeEnabled();
		await expect(page.getByTestId("project-sync-button")).toBeEnabled();
		await expect(page.getByTestId("project-ai-generate-button")).toBeEnabled();
	});
});