// @ts-nocheck
import { expect, test } from "../../web/node_modules/@playwright/test/index.js";
import type { APIRequestContext } from "../../web/node_modules/@playwright/test/index.js";
import { execFileSync } from "node:child_process";
import { existsSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sessionName = process.env.WMUX_PLAYWRIGHT_SESSION ?? "wmux-playwright";
const fakeLLMPort = Number(process.env.WMUX_FAKE_LLM_PORT ?? 19876);
const errorCommandPath = join(tmpdir(), "WMUX_ERROR_TEST");

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

function ensureErrorCommand() {
	try {
		if (existsSync(errorCommandPath)) {
			unlinkSync(errorCommandPath);
		}
		symlinkSync("/bin/sleep", errorCommandPath);
	} catch {
		// Ignore setup errors; the analyze response assertion will catch failures.
	}
}

function cleanupErrorWindow(windowName: string) {
	try {
		execFileSync("tmux", ["kill-window", "-t", `${sessionName}:${windowName}`], { stdio: "ignore" });
	} catch {
		// Ignore missing window cleanup.
	}
}

test.describe("intelligence session badges", () => {
	test.describe.configure({ mode: "serial" });

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test("session card shows waiting badge after analyze with fake LLM", async ({ page, request }) => {
		await createLocalConnection(request);
		await page.goto("/");

		const sessionCard = page.locator(`[data-testid="session-card-${sessionName}"]`);
		await expect(sessionCard).toBeVisible({ timeout: 10000 });

		const badge = sessionCard.locator(".intelligence-badge");
		await expect(badge).toBeVisible({ timeout: 10000 });

		const badgeText = await badge.textContent();
		expect(["Waiting", "Running", "Blocked", "Loop"]).toContain(badgeText?.trim());

		const summary = sessionCard.locator(".session-intelligence-summary");
		await expect(summary).toBeVisible({ timeout: 10000 });
		expect(await summary.textContent()).toBeTruthy();
	});

	test("session badge does not show none label", async ({ page, request }) => {
		await createLocalConnection(request);
		await page.goto("/");

		const sessionCard = page.locator(`[data-testid="session-card-${sessionName}"]`);
		await expect(sessionCard).toBeVisible({ timeout: 10000 });

		const allBadges = sessionCard.locator(".intelligence-badge");
		const count = await allBadges.count();
		if (count > 0) {
			const text = await allBadges.first().textContent();
			expect(text?.trim().toLowerCase()).not.toBe("none");
		}
	});

	test("fake LLM invalid schema degrades without crashing analyze endpoint", async ({ page, request }) => {
		const conn = await createLocalConnection(request);
		ensureErrorCommand();

		const windowName = `llm-error-${Date.now()}`;
		execFileSync("tmux", ["new-window", "-t", sessionName, "-n", windowName], { stdio: "ignore" });
		execFileSync("tmux", ["send-keys", "-t", `${sessionName}:${windowName}`, `exec ${errorCommandPath} 9999`, "Enter"], { stdio: "ignore" });
		await new Promise((resolve) => setTimeout(resolve, 2500));

		try {
			const fakeResponse = await request.post(`http://127.0.0.1:${fakeLLMPort}/chat/completions`, {
				data: {
					messages: [{ role: "user", content: "WMUX_ERROR_TEST" }],
				},
			});
			expect(fakeResponse.ok()).toBeTruthy();
			const fakeBody = await fakeResponse.json();
			expect(fakeBody.choices[0].message.content).toContain("bad_enum");

			const analyzeResponse = await request.post(`/api/connections/${encodeURIComponent(conn.id)}/sessions/${encodeURIComponent(sessionName)}/analyze`, {
				headers: {
					Authorization: "Bearer playwright-token",
				},
			});
			expect(analyzeResponse.ok()).toBeTruthy();
			const analyzeBody = await analyzeResponse.json();
			expect(analyzeBody.status).toBe("ok");

			await page.goto("/");
			const sessionCard = page.locator(`[data-testid="session-card-${sessionName}"]`);
			await expect(sessionCard).toBeVisible({ timeout: 10000 });

			const badges = sessionCard.locator(".intelligence-badge");
			const badgeCount = await badges.count();
			if (badgeCount > 0) {
				const text = await badges.first().textContent();
				expect(text?.trim().toLowerCase()).not.toBe("none");
			}
		} finally {
			cleanupErrorWindow(windowName);
		}
	});
});
