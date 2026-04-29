// @ts-nocheck
import { defineConfig } from "./web/node_modules/@playwright/test/index.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const shouldInitialize = !process.env.WMUX_PLAYWRIGHT_PORT;
const tempDir = process.env.WMUX_PLAYWRIGHT_TEMP_DIR ?? mkdtempSync(join(tmpdir(), "wmux-playwright-"));
const configPath = process.env.WMUX_PLAYWRIGHT_CONFIG_PATH ?? join(tempDir, "config.jsonc");
const port = Number(process.env.WMUX_PLAYWRIGHT_PORT ?? 22733);
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

	const cleanupTmuxSession = () => {
		try {
			execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
		} catch {
			// Ignore cleanup errors.
		}
	};

	process.on("exit", cleanupTmuxSession);
	process.on("SIGINT", () => {
		cleanupTmuxSession();
		process.exit(130);
	});
	process.on("SIGTERM", () => {
		cleanupTmuxSession();
		process.exit(143);
	});

	writeFileSync(
		configPath,
		JSON.stringify(
			{
				schemaVersion: 1,
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
			},
			null,
			2,
		) + "\n",
	);
}

export default defineConfig({
	testDir: "./tests/e2e",
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
		command: `./bin/wmux -c "${configPath}"`,
		url: `http://127.0.0.1:${port}/api/health`,
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},
});
