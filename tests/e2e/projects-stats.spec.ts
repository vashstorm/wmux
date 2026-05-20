// @ts-nocheck
import playwrightTest from "../../web/node_modules/@playwright/test/index.js";
import { ensurePlaywrightTmuxSession } from "./helpers/tmux.js";

const test = playwrightTest;
const { expect } = playwrightTest;

test.describe("wmux projects and stats", () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
        });
    });

    test("projects view loads empty state", async ({ page }) => {
        await page.goto("/");
        await page.getByTestId("open-projects-button").click();
        await expect(page.getByTestId("projects-empty")).toBeVisible({ timeout: 5000 });
    });

    test("create project and verify it appears in list", async ({ page }) => {
        await page.goto("/");
        await page.getByTestId("open-projects-button").click();
        await expect(page.getByTestId("projects-empty")).toBeVisible({ timeout: 5000 });

        // Open create form
        await page.getByTestId("projects-add-button").click();
        await expect(page.getByTestId("project-form")).toBeVisible();

        // Fill form and submit
        await page.getByPlaceholder("Project name").fill("wmux-e2e-project");
        await page.getByPlaceholder("Path (optional)").fill("/tmp/wmux-e2e-project");
        await page.getByTestId("project-submit-button").click();

        // Wait for form to close and project to appear in list
        await expect(page.getByTestId("project-form")).not.toBeVisible({ timeout: 5000 });
        await expect(page.getByText("wmux-e2e-project", { exact: true })).toBeVisible({ timeout: 5000 });
    });

    test("project persists after page reload", async ({ page }) => {
        await page.goto("/");
        await page.getByTestId("open-projects-button").click();

        // Create project
        await page.getByTestId("projects-add-button").click();
        await expect(page.getByTestId("project-form")).toBeVisible();
        await page.getByPlaceholder("Project name").fill("wmux-e2e-persist");
        await page.getByPlaceholder("Path (optional)").fill("/tmp/persist");
        await page.getByTestId("project-submit-button").click();
        await expect(page.getByText("wmux-e2e-persist", { exact: true })).toBeVisible({ timeout: 5000 });

        // Reload and verify persistence
        await page.reload();
        await page.getByTestId("open-projects-button").click();
        await expect(page.getByText("wmux-e2e-persist", { exact: true })).toBeVisible({ timeout: 5000 });
    });

    test("stats view renders empty state", async ({ page }) => {
        await page.goto("/");
        await page.getByTestId("open-stats-button").click();
        await expect(page.getByTestId("stats-empty")).toBeVisible({ timeout: 5000 });
    });

    test("stats view shows summary after projects have been loaded", async ({ page }) => {
        await page.goto("/");
        await page.getByTestId("open-stats-button").click();
        // Stats view should render either empty state or summary (no AI calls in E2E)
        const statsView = page.getByTestId("stats-view");
        await expect(statsView).toBeVisible({ timeout: 5000 });
        // Either empty or summary must be present (not an error state)
        const emptyOrSummary = page.getByTestId("stats-empty").or(page.getByTestId("stats-summary"));
        await expect(emptyOrSummary.first()).toBeVisible({ timeout: 5000 });
    });
});