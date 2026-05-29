import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import playwrightTest from "../../web/node_modules/@playwright/test/index.js";
import type { APIRequestContext, BrowserContext, Page, TestInfo } from "../../web/node_modules/@playwright/test/index.js";
import { ensurePlaywrightTmuxSession } from "./helpers/tmux.js";
import { emitVoiceEvent, getVoiceClientMessages, installVoiceMock, waitForVoiceClientMessage } from "./helpers/voice-mock.js";

const test = playwrightTest;
const { expect } = playwrightTest;

const authHeaders = { Authorization: "Bearer playwright-token" };
const voiceSessionName = "voice-e2e-session";
const renamedVoiceSessionName = "voice-e2e-renamed";
const evidenceDir = join(process.cwd(), ".omo", "evidence");

function evidenceName(testInfo: TestInfo) {
	return testInfo.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

async function createLocalConnection(request: APIRequestContext) {
	ensurePlaywrightTmuxSession();

	const getResponse = await request.get("/api/connections", { headers: authHeaders });
	if (getResponse.ok()) {
		const result = await getResponse.json();
		const connections = Array.isArray(result.data) ? result.data : [];
		for (const conn of connections) {
			if (conn.targetName === "local" || conn.type === "local") {
				await request.delete(`/api/connections/${conn.targetName}`, { headers: authHeaders });
			}
		}
	}

	const response = await request.post("/api/connections", {
		headers: authHeaders,
		data: { type: "local" },
	});
	expect(response.ok()).toBeTruthy();
}

async function deleteSessionIfExists(request: APIRequestContext, sessionName: string) {
	await request.delete(`/api/targets/local/sessions/${encodeURIComponent(sessionName)}`, { headers: authHeaders }).catch(() => undefined);
}

async function resetVoiceSessions(request: APIRequestContext) {
	await deleteSessionIfExists(request, voiceSessionName);
	await deleteSessionIfExists(request, renamedVoiceSessionName);
}

async function createSession(request: APIRequestContext, sessionName: string) {
	const response = await request.post("/api/targets/local/sessions", {
		headers: authHeaders,
		data: { name: sessionName },
	});
	expect(response.ok()).toBeTruthy();
}

async function renameSession(request: APIRequestContext, oldName: string, newName: string) {
	const response = await request.patch(`/api/targets/local/sessions/${encodeURIComponent(oldName)}`, {
		headers: authHeaders,
		data: { name: newName },
	});
	expect(response.ok()).toBeTruthy();
}

async function deleteSession(request: APIRequestContext, sessionName: string) {
	const response = await request.delete(`/api/targets/local/sessions/${encodeURIComponent(sessionName)}`, { headers: authHeaders });
	expect(response.ok()).toBeTruthy();
}

async function listFirstPane(request: APIRequestContext, sessionName: string) {
	const windowsResponse = await request.get(`/api/targets/local/sessions/${encodeURIComponent(sessionName)}/windows`, { headers: authHeaders });
	expect(windowsResponse.ok()).toBeTruthy();
	const windows = (await windowsResponse.json()).data ?? [];
	const firstWindow = windows[0];
	expect(firstWindow).toBeTruthy();

	const panesResponse = await request.get(`/api/targets/local/sessions/${encodeURIComponent(sessionName)}/windows/${encodeURIComponent(firstWindow.id)}/panes`, { headers: authHeaders });
	expect(panesResponse.ok()).toBeTruthy();
	const panes = (await panesResponse.json()).data ?? [];
	const firstPane = panes[0];
	expect(firstPane).toBeTruthy();

	return { windowId: firstWindow.id as string, paneId: firstPane.id as string };
}

async function startVoice(page: Page) {
	const voiceControl = page.locator("[data-ai-assistant-state]");
	await expect(voiceControl).toHaveAttribute("data-ai-assistant-state", "idle");
	await page.getByRole("button", { name: "Start listening" }).click();
	await expect(voiceControl).toHaveAttribute("data-ai-assistant-state", "listening");
}

async function emitIntent(page: Page, skill: string, params: Record<string, unknown>, confirmationId?: string) {
	await emitVoiceEvent(page, {
		type: "intent_received",
		skill,
		params,
		confirmationRequired: Boolean(confirmationId),
		confirmationId,
	});
}

async function emitActionResult(page: Page, skill: string) {
	await emitVoiceEvent(page, { type: "action_result", skill, success: true });
}

async function waitForSessionRefresh(page: Page) {
	await page.waitForResponse((response) =>
		response.url().includes("/api/targets/local/sessions") && response.request().method() === "GET" && response.ok()
	);
}

async function startEvidence(context: BrowserContext) {
	await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
}

async function stopEvidence(page: Page, context: BrowserContext, testInfo: TestInfo) {
	mkdirSync(evidenceDir, { recursive: true });
	const name = evidenceName(testInfo);
	await page.screenshot({ path: join(evidenceDir, `${name}.png`), fullPage: true }).catch(() => undefined);
	await context.tracing.stop({ path: join(evidenceDir, `${name}.zip`) }).catch(() => undefined);
}

test.use({ trace: "off", screenshot: "off" });

test.describe("voice skills", () => {
	test.beforeEach(async ({ page, context }) => {
		await startEvidence(context);
		await page.addInitScript(() => {
			window.sessionStorage.setItem("wmux-auth-token", "playwright-token");
		});
		await installVoiceMock(page);
	});

	test.afterEach(async ({ page, context }, testInfo) => {
		await stopEvidence(page, context, testInfo);
	});

	test("renders AiAssistant with voice state when voice is enabled", async ({ page }) => {
		await page.goto("/");

		const voiceControl = page.locator("[data-ai-assistant-state]");
		await expect(voiceControl).toBeVisible();
		await expect(voiceControl).toHaveAttribute("data-ai-assistant-state", "idle");

		await startVoice(page);
	});

	test("navigates to settings from navigate_frontend voice event", async ({ page }) => {
		await page.goto("/");
		await startVoice(page);

		await emitVoiceEvent(page, { type: "transcript_done", text: "open settings" });
		await emitIntent(page, "navigate_frontend", { route: "settings" });

		await expect(page.getByTestId("settings-panel")).toBeVisible();
		await expect(page).toHaveURL(/view=settings/);
	});

	test("creates and renames a session from voice function calls", async ({ page, request }) => {
		await createLocalConnection(request);
		await resetVoiceSessions(request);
		await page.goto("/");
		await expect(page.getByTestId("sidebar")).toBeVisible();
		await startVoice(page);

		await emitIntent(page, "create_session", { target_name: "local", session_name: voiceSessionName });
		const createRefresh = waitForSessionRefresh(page);
		await createSession(request, voiceSessionName);
		await emitActionResult(page, "create_session");
		await createRefresh;
		await expect(page.getByTestId(`session-card-${voiceSessionName}`)).toBeVisible();

		await emitIntent(page, "rename_session", { target_name: "local", session: voiceSessionName, new_name: renamedVoiceSessionName });
		const renameRefresh = waitForSessionRefresh(page);
		await renameSession(request, voiceSessionName, renamedVoiceSessionName);
		await emitActionResult(page, "rename_session");
		await renameRefresh;
		await expect(page.getByTestId(`session-card-${renamedVoiceSessionName}`)).toBeVisible();
		await expect(page.getByTestId(`session-card-${voiceSessionName}`)).not.toBeVisible();
	});

	test("confirms dangerous delete_session and removes the session", async ({ page, request }) => {
		await createLocalConnection(request);
		await resetVoiceSessions(request);
		await createSession(request, voiceSessionName);
		await page.goto("/");
		await expect(page.getByTestId(`session-card-${voiceSessionName}`)).toBeVisible();
		await startVoice(page);

		const confirmationId = "11111111-1111-4111-8111-111111111111";
		await emitIntent(page, "delete_session", { target_name: "local", session: voiceSessionName }, confirmationId);
		await expect(page.locator("[data-ai-assistant-state]")).toHaveAttribute("data-ai-assistant-state", "confirming");
		await page.getByRole("button", { name: "Confirm" }).click();
		await waitForVoiceClientMessage(page, "confirm_action");
		const messages = await getVoiceClientMessages(page);
		expect(messages.some((message) => message.type === "confirm_action" && message.confirmationId === confirmationId)).toBeTruthy();

		const deleteRefresh = waitForSessionRefresh(page);
		await deleteSession(request, voiceSessionName);
		await emitActionResult(page, "delete_session");
		await deleteRefresh;
		await expect(page.getByTestId(`session-card-${voiceSessionName}`)).not.toBeVisible();
	});

	test("executes a command in the specified pane after voice confirmation", async ({ page, request }) => {
		await createLocalConnection(request);
		await resetVoiceSessions(request);
		await createSession(request, voiceSessionName);
		const paneTarget = await listFirstPane(request, voiceSessionName);

		await page.goto("/");
		await expect(page.getByTestId(`session-card-${voiceSessionName}`)).toBeVisible();
		await page.getByTestId(`session-open-${voiceSessionName}`).click();
		await expect(page.locator(".pane-box")).toBeVisible();
		await page.locator(".pane-box").first().click({ force: true });
		await expect(page.getByTestId("terminal")).toBeVisible();
		await startVoice(page);

		const confirmationId = "22222222-2222-4222-8222-222222222222";
		await emitIntent(page, "send_to_pane", {
			targetName: "local",
			session: voiceSessionName,
			window: paneTarget.windowId,
			pane: paneTarget.paneId,
			text: "echo VOICE_E2E_OK",
			execute: true,
		}, confirmationId);
		await page.getByRole("button", { name: "Confirm" }).click();
		await waitForVoiceClientMessage(page, "confirm_action");

		execFileSync("tmux", ["send-keys", "-t", paneTarget.paneId, "echo VOICE_E2E_OK", "Enter"]);
		await emitActionResult(page, "send_to_pane");

		await expect(page.getByTestId("terminal")).toContainText("VOICE_E2E_OK");
	});

	test("voice skills toggle and description persist after refresh", async ({ page }) => {
		await page.goto("/");

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();

		await page.getByTestId("settings-tab-voice-skills").click();

		const navigateToggle = page.getByTestId("voice-skill-navigate_frontend-enabled");
		await expect(navigateToggle).toBeVisible();
		await expect(navigateToggle).toBeChecked();

		await navigateToggle.click();
		await expect(navigateToggle).not.toBeChecked();

		const descriptionInput = page.getByTestId("voice-skill-navigate_frontend-description");
		await descriptionInput.fill("Navigate to frontend pages with custom routes");

		await page.getByRole("button", { name: /Save/i }).click();
		await expect(page.getByTestId("settings-panel")).not.toBeVisible({ timeout: 5000 });

		await page.reload();

		await page.getByTestId("open-settings-button").click();
		await expect(page.getByTestId("settings-panel")).toBeVisible();
		await page.getByTestId("settings-tab-voice-skills").click();

		await expect(page.getByTestId("voice-skill-navigate_frontend-enabled")).not.toBeChecked();
		await expect(page.getByTestId("voice-skill-navigate_frontend-description")).toHaveValue("Navigate to frontend pages with custom routes");

		await page.getByTestId("voice-skill-navigate_frontend-enabled").click();
		await expect(page.getByTestId("voice-skill-navigate_frontend-enabled")).toBeChecked();
		await page.getByRole("button", { name: /Save/i }).click();
		await expect(page.getByTestId("settings-panel")).not.toBeVisible({ timeout: 5000 });
	});

	test("voice history displays after transcript event", async ({ page, request }) => {
		await createLocalConnection(request);
		await resetVoiceSessions(request);
		await page.goto("/");
		await startVoice(page);

		await emitVoiceEvent(page, { type: "transcript_done", text: "test history transcript" });
		await emitIntent(page, "navigate_frontend", { route: "settings" });
		await emitActionResult(page, "navigate_frontend");

		await expect(page.locator(".voice-history")).toBeVisible({ timeout: 5000 });
		await expect(page.locator(".voice-history")).toContainText("test history transcript");
		await expect(page.locator(".voice-history")).toContainText("Executed: navigate_frontend");
	});
});
