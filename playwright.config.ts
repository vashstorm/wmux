// @ts-nocheck
import playwrightTest from "./web/node_modules/@playwright/test/index.js";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { defineConfig } = playwrightTest;
const repoRoot = dirname(fileURLToPath(import.meta.url));
const wmuxBinary = join(repoRoot, "bin", "wmux");

const shouldInitialize = !process.env.WMUX_PLAYWRIGHT_PORT;
const tempDir = process.env.WMUX_PLAYWRIGHT_TEMP_DIR ?? mkdtempSync(join(tmpdir(), "wmux-playwright-"));
const configPath = process.env.WMUX_PLAYWRIGHT_CONFIG_PATH ?? join(tempDir, "config.jsonc");
const port = Number(process.env.WMUX_PLAYWRIGHT_PORT ?? 22000 + (process.pid % 10000));
const sessionName = process.env.WMUX_PLAYWRIGHT_SESSION ?? `wmux-playwright-${process.pid}`;
const windowName = "playwright";

process.env.WMUX_PLAYWRIGHT_TEMP_DIR = tempDir;
process.env.WMUX_PLAYWRIGHT_CONFIG_PATH = configPath;
process.env.WMUX_PLAYWRIGHT_PORT = String(port);
process.env.WMUX_PLAYWRIGHT_SESSION = sessionName;
process.env.WMUX_PLAYWRIGHT_WINDOW = windowName;

if (shouldInitialize) {
	try {
		execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
	} catch {
		// Ignore missing session cleanup.
	}

	execFileSync("tmux", [
		"new-session",
		"-d",
		"-s",
		sessionName,
		"-n",
		windowName,
		"printf 'WMUX_READY\\n'; exec $SHELL -i",
	]);
	execFileSync("tmux", ["set-option", "-t", sessionName, "destroy-unattached", "off"]);

	// Copy skills next to the temporary config file so the server can load them
	try {
		cpSync(join(repoRoot, "skills"), join(tempDir, "skills"), { recursive: true });
	} catch (err) {
		console.error("Failed to copy skills directory:", err);
	}

	writeFileSync(
		configPath,
		JSON.stringify(
			{
				schemaVersion: 1,
				path: tempDir,
				server: {
					bind: `127.0.0.1:${port}`,
				},
				auth: {
					token: "playwright-token",
				},
				tmux: {
					path: "tmux",
				},
				connections: [],
				ui: {
					theme: "dark",
				},
				logs: {
					level: "info",
				},
				omni: {
					enabled: true,
					dashscopeApiKey: "playwright-mock-key",
					microphoneDisabled: false,
					voice: "Cindy",
					model: "qwen3.5-omni-flash-realtime",
					endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
					continuousListening: true,
					storeRawAudio: false,
					vadEnabled: true,
					vadThreshold: 0.5,
				},
			},
			null,
			2,
		) + "\n",
	);
}

export default defineConfig({
	testDir: "./tests/e2e",
	globalTeardown: "./tests/e2e/helpers/global-teardown.ts",
	workers: 1,
	timeout: 30_000,
	expect: {
		timeout: 5_000,
	},
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		headless: true,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: `"${wmuxBinary}" -c "${configPath}"`,
		cwd: repoRoot,
		url: `http://127.0.0.1:${port}/api/health`,
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},
});
