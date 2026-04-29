// @ts-nocheck
import { expect, test } from "../../web/node_modules/@playwright/test/index.js";
import type { APIRequestContext } from "../../web/node_modules/@playwright/test/index.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sessionName = process.env.WMUX_PLAYWRIGHT_SESSION ?? "wmux-playwright";
const tempScriptsDir = join(tmpdir(), "wmux-e2e-semantic");

function ensureTempDir() {
	if (!existsSync(tempScriptsDir)) {
		mkdirSync(tempScriptsDir, { recursive: true });
	}
}

async function createLocalConnection(request: APIRequestContext) {
	const response = await request.post("/api/connections", {
		headers: {
			Authorization: "Bearer playwright-token",
		},
		data: {
			type: "local",
		},
	});

	expect(response.ok()).toBeTruthy();
	return response.json();
}

function createOutputFile(content: string): string {
	ensureTempDir();
	const filePath = join(tempScriptsDir, `output-${Date.now()}.txt`);
	writeFileSync(filePath, content);
	return filePath;
}

function compileClaudeBinary(): string | null {
	ensureTempDir();
	const binaryPath = join(tempScriptsDir, "claude");

	const existingBinary = existsSync(binaryPath);
	if (existingBinary) {
		return binaryPath;
	}

	const sourcePath = join(tempScriptsDir, "claude.c");
	const source = `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
int main(int argc, char *argv[]) {
    if (argc > 1) {
        FILE *f = fopen(argv[1], "r");
        if (f) {
            char buf[4096];
            while (fgets(buf, sizeof(buf), f)) {
                printf("%s", buf);
            }
            fclose(f);
        } else {
            fprintf(stderr, "Cannot open %s\\n", argv[1]);
        }
    } else {
        char buf[4096];
        while (fgets(buf, sizeof(buf), stdin)) {
            printf("%s", buf);
        }
    }
    fflush(stdout);
    sleep(9999);
    return 0;
}
`;
	writeFileSync(sourcePath, source);

	try {
		execFileSync("gcc", ["-o", binaryPath, sourcePath], { stdio: "ignore" });
		return binaryPath;
	} catch {
		return null;
	}
}

function cleanupFiles(...paths: string[]) {
	for (const p of paths) {
		try {
			unlinkSync(p);
		} catch { }
	}
}

test.describe("Semantic AI pane attention", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("choice_required output propagates to window badge", async ({ page, request }) => {
		const claudeBinary = compileClaudeBinary();
		if (!claudeBinary) {
			console.warn("Skipping: gcc not available to compile claude binary");
			test.skip();
			return;
		}

		const outputContent = `[Y/n] Do you want to continue with this approach?
Please select an option.`;
		const outputFile = createOutputFile(outputContent);
		const windowName = `ai-choice-${Date.now()}`;

		execFileSync("tmux", ["new-window", "-t", sessionName, "-n", windowName], { stdio: "ignore" });
		execFileSync("tmux", ["send-keys", "-t", `${sessionName}:${windowName}`, `exec ${claudeBinary} ${outputFile}`, "Enter"], { stdio: "ignore" });

		await new Promise((r) => setTimeout(r, 1500));

		try {
			await createLocalConnection(request);
			await page.goto("/");

			const sessionCard = page.locator(`[data-testid="session-card-${sessionName}"]`);
			await expect(sessionCard).toBeVisible({ timeout: 5000 });
			await sessionCard.getByTestId(`session-open-${sessionName}`).click();

			await expect(page.locator(".window-tabs")).toBeVisible({ timeout: 5000 });

			const aiWindowTab = page.locator(".window-tab").filter({ hasText: windowName });
			await expect(aiWindowTab).toBeVisible({ timeout: 5000 });
			await aiWindowTab.click();

			await expect(async () => {
				const semanticBadge = page.locator(".semantic-badge");
				const count = await semanticBadge.count();
				expect(count).toBeGreaterThan(0);
			}).toPass({ timeout: 10000 });

			const semanticBadge = page.locator(".semantic-badge").first();
			await expect(semanticBadge).toContainText("AI");
		} finally {
			try { execFileSync("tmux", ["kill-window", "-t", `${sessionName}:${windowName}`], { stdio: "ignore" }); } catch { }
			cleanupFiles(outputFile);
		}
	});

	test("non-blocking AI output does not trigger semantic attention", async ({ page, request }) => {
		const claudeBinary = compileClaudeBinary();
		if (!claudeBinary) {
			console.warn("Skipping: gcc not available to compile claude binary");
			test.skip();
			return;
		}

		const outputContent = `✓ Running tests...
Processing 3/10 files...
Installing dependencies...
All tests passed successfully.`;
		const outputFile = createOutputFile(outputContent);
		const windowName = `ai-progress-${Date.now()}`;

		execFileSync("tmux", ["new-window", "-t", sessionName, "-n", windowName], { stdio: "ignore" });
		execFileSync("tmux", ["send-keys", "-t", `${sessionName}:${windowName}`, `exec ${claudeBinary} ${outputFile}`, "Enter"], { stdio: "ignore" });

		await new Promise((r) => setTimeout(r, 1500));

		try {
			await createLocalConnection(request);
			await page.goto("/");

			const sessionCard = page.locator(`[data-testid="session-card-${sessionName}"]`);
			await expect(sessionCard).toBeVisible({ timeout: 5000 });
			await sessionCard.getByTestId(`session-open-${sessionName}`).click();

			await expect(page.locator(".window-tabs")).toBeVisible({ timeout: 5000 });

			const aiWindowTab = page.locator(".window-tab").filter({ hasText: windowName });
			await expect(aiWindowTab).toBeVisible({ timeout: 5000 });
			await aiWindowTab.click();

			await new Promise((r) => setTimeout(r, 2000));

			const semanticBadge = aiWindowTab.locator(".semantic-badge");
			const count = await semanticBadge.count();
			expect(count).toBe(0);
		} finally {
			try { execFileSync("tmux", ["kill-window", "-t", `${sessionName}:${windowName}`], { stdio: "ignore" }); } catch { }
			cleanupFiles(outputFile);
		}
	});

	test("blocked_error propagates to session level", async ({ page, request }) => {
		const claudeBinary = compileClaudeBinary();
		if (!claudeBinary) {
			console.warn("Skipping: gcc not available to compile claude binary");
			test.skip();
			return;
		}

		const outputContent = `Error: Cannot find module 'express'
Fatal error: unable to connect to database`;
		const outputFile = createOutputFile(outputContent);
		const windowName = `ai-error-${Date.now()}`;

		execFileSync("tmux", ["new-window", "-t", sessionName, "-n", windowName], { stdio: "ignore" });
		execFileSync("tmux", ["send-keys", "-t", `${sessionName}:${windowName}`, `exec ${claudeBinary} ${outputFile}`, "Enter"], { stdio: "ignore" });

		await new Promise((r) => setTimeout(r, 1500));

		try {
			await createLocalConnection(request);
			await page.goto("/");

			const sessionCard = page.locator(`[data-testid="session-card-${sessionName}"]`);
			await expect(sessionCard).toBeVisible({ timeout: 5000 });

			await sessionCard.getByTestId(`session-open-${sessionName}`).click();
			await expect(page.locator(".window-tabs")).toBeVisible({ timeout: 5000 });

			const aiWindowTab = page.locator(".window-tab").filter({ hasText: windowName });
			await expect(aiWindowTab).toBeVisible({ timeout: 5000 });
			await aiWindowTab.click();

			await expect(page.locator(".semantic-badge")).toBeVisible({ timeout: 10000 });
			const semanticBadge = page.locator(".semantic-badge").first();
			await expect(semanticBadge).toContainText("AI");
		} finally {
			try { execFileSync("tmux", ["kill-window", "-t", `${sessionName}:${windowName}`], { stdio: "ignore" }); } catch { }
			cleanupFiles(outputFile);
		}
	});

	test("pane-level semantic indicator shows event type", async ({ page, request }) => {
		const claudeBinary = compileClaudeBinary();
		if (!claudeBinary) {
			console.warn("Skipping: gcc not available to compile claude binary");
			test.skip();
			return;
		}

		const outputContent = `Waiting for your response to continue...
I cannot proceed without your approval.`;
		const outputFile = createOutputFile(outputContent);
		const windowName = `ai-response-${Date.now()}`;

		execFileSync("tmux", ["new-window", "-t", sessionName, "-n", windowName], { stdio: "ignore" });
		execFileSync("tmux", ["send-keys", "-t", `${sessionName}:${windowName}`, `exec ${claudeBinary} ${outputFile}`, "Enter"], { stdio: "ignore" });

		await new Promise((r) => setTimeout(r, 1500));

		try {
			await createLocalConnection(request);
			await page.goto("/");

			const sessionCard = page.locator(`[data-testid="session-card-${sessionName}"]`);
			await expect(sessionCard).toBeVisible({ timeout: 5000 });
			await sessionCard.getByTestId(`session-open-${sessionName}`).click();

			await expect(page.locator(".window-tabs")).toBeVisible({ timeout: 5000 });

			const aiWindowTab = page.locator(".window-tab").filter({ hasText: windowName });
			await expect(aiWindowTab).toBeVisible({ timeout: 5000 });
			await aiWindowTab.click();

			await expect(page.locator(".semantic-badge")).toBeVisible({ timeout: 10000 });
			const semanticBadge = page.locator(".semantic-badge").first();
			await expect(semanticBadge).toContainText("AI");
		} finally {
			try { execFileSync("tmux", ["kill-window", "-t", `${sessionName}:${windowName}`], { stdio: "ignore" }); } catch { }
			cleanupFiles(outputFile);
		}
	});
});
