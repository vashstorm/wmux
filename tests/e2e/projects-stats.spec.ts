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
        await expect(page.getByTestId("projects-view")).toBeVisible({ timeout: 5000 });
    });

    test("create project and verify it appears in list", async ({ page }) => {
        await page.goto("/");
        await page.getByTestId("open-projects-button").click();
        await expect(page.getByTestId("projects-view")).toBeVisible({ timeout: 5000 });

        await page.getByTestId("projects-add-button").click();
        await expect(page.getByTestId("project-form")).toBeVisible();

        await page.getByPlaceholder("Project name").fill("wmux-e2e-project");
        await page.getByPlaceholder("Path (optional)").fill("/tmp/wmux-e2e-project");
        await page.getByTestId("project-submit-button").click();

        await expect(page.getByTestId("project-form")).not.toBeVisible({ timeout: 5000 });
        const projectInList = page.getByTestId("projects-view").getByText("wmux-e2e-project", { exact: true });
        await expect(projectInList).toBeVisible({ timeout: 5000 });
    });

    test("project persists after page reload", async ({ page }) => {
        await page.goto("/");
        await page.getByTestId("open-projects-button").click();
        await expect(page.getByTestId("projects-view")).toBeVisible({ timeout: 5000 });

        await page.getByTestId("projects-add-button").click();
        await expect(page.getByTestId("project-form")).toBeVisible();
        await page.getByPlaceholder("Project name").fill("wmux-e2e-persist");
        await page.getByPlaceholder("Path (optional)").fill("/tmp/persist");
        await page.getByTestId("project-submit-button").click();
        await expect(page.getByTestId("project-form")).not.toBeVisible({ timeout: 5000 });
        const projectInList = page.getByTestId("projects-view").getByText("wmux-e2e-persist", { exact: true });
        await expect(projectInList).toBeVisible({ timeout: 5000 });

        await page.reload();
        await page.getByTestId("open-projects-button").click();
        const projectAfterReload = page.getByTestId("projects-view").getByText("wmux-e2e-persist", { exact: true });
        await expect(projectAfterReload).toBeVisible({ timeout: 5000 });
    });

});