// @ts-nocheck
import { expect, test } from "../../web/node_modules/@playwright/test/index.js";
import { execFileSync } from "node:child_process";

const baseSessionName = process.env.WMUX_PLAYWRIGHT_SESSION ?? "wmux-playwright";
const extraSessions = [
	{ name: `${baseSessionName}-rand-1`, marker: "SESSION_1_READY" },
	{ name: `${baseSessionName}-rand-2`, marker: "SESSION_2_READY" },
	{ name: `${baseSessionName}-rand-3`, marker: "SESSION_3_READY" },
];
const allSessions = [
	{ name: baseSessionName, marker: "WMUX_READY" },
	...extraSessions,
];

async function createLocalConnection(request: any) {
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

// Seeded PRNG for deterministic randomness (Park-Miller)
function createSeededRNG(seed: number) {
	return function () {
		seed = (seed * 16807) % 2147483647;
		return (seed - 1) / 2147483646;
	};
}

function shuffleArray<T>(array: T[], rng: () => number): T[] {
	const arr = [...array];
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

test.describe("random session switching", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
	});

	test.beforeAll(() => {
		for (const session of extraSessions) {
			try {
				execFileSync("tmux", ["kill-session", "-t", session.name], { stdio: "ignore" });
			} catch {}
			execFileSync("tmux", [
				"new-session",
				"-d",
				"-s",
				session.name,
				"-n",
				"playwright",
				`printf '${session.marker}\n'; exec $SHELL -i`,
			]);
		}
	});

	test.afterAll(() => {
		for (const session of extraSessions) {
			try {
				execFileSync("tmux", ["kill-session", "-t", session.name], { stdio: "ignore" });
			} catch {}
		}
	});

	test("randomly switch between all sessions and verify pane output", async ({ page, request }) => {
		await createLocalConnection(request);
		await page.goto("/");

		for (const session of allSessions) {
			await expect(page.locator(`[data-testid="session-card-${session.name}"]`)).toBeVisible({
				timeout: 10000,
			});
		}

		for (const session of allSessions) {
			const sessionCard = page.locator(`[data-testid="session-card-${session.name}"]`);
			await sessionCard.getByTestId(`session-open-${session.name}`).click();

			await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 10000 });
			await expect(page.getByTestId("terminal")).toContainText(session.marker, {
				timeout: 10000,
			});
			await expect(page.getByTestId("main-title")).toContainText(session.name, {
				timeout: 5000,
			});
			await expect(page.locator("[data-testid='terminal-disconnected']")).toHaveCount(0);
			await expect(page.locator("[data-testid='error-banner']")).toHaveCount(0);
		}

		const seed = 42;
		const rng = createSeededRNG(seed);
		const extraSwitchCount = 11;
		const switchLog: string[] = [];

		const shuffled = shuffleArray([...allSessions], rng);
		for (const session of shuffled) {
			switchLog.push(session.name);
		}

		for (let i = 0; i < extraSwitchCount; i++) {
			const targetSession = allSessions[Math.floor(rng() * allSessions.length)];
			switchLog.push(targetSession.name);
		}

		for (const targetSession of switchLog) {
			const session = allSessions.find((s) => s.name === targetSession)!;
			const sessionCard = page.locator(`[data-testid="session-card-${session.name}"]`);
			await sessionCard.getByTestId(`session-open-${session.name}`).click();

			await expect(page.getByTestId("terminal")).toBeVisible({ timeout: 10000 });
			await expect(page.getByTestId("terminal")).toContainText(session.marker, {
				timeout: 10000,
			});
			await expect(page.getByTestId("main-title")).toContainText(session.name, {
				timeout: 5000,
			});
			await expect(page.locator("[data-testid='terminal-disconnected']")).toHaveCount(0);
			await expect(page.locator("[data-testid='error-banner']")).toHaveCount(0);
		}

		for (const session of allSessions) {
			expect(
				switchLog.some((name) => name === session.name),
				`Session ${session.name} was never visited during random switches. Log: ${switchLog.join(", ")}`,
			).toBe(true);
		}
	});
});
