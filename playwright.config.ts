// @ts-nocheck
import { defineConfig } from "./web/node_modules/@playwright/test/index.js";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const shouldInitialize = !process.env.WMUX_PLAYWRIGHT_PORT;
const tempDir = process.env.WMUX_PLAYWRIGHT_TEMP_DIR ?? mkdtempSync(join(tmpdir(), "wmux-playwright-"));
const configPath = process.env.WMUX_PLAYWRIGHT_CONFIG_PATH ?? join(tempDir, "config.jsonc");
const port = Number(process.env.WMUX_PLAYWRIGHT_PORT ?? 22733);
const sessionName = process.env.WMUX_PLAYWRIGHT_SESSION ?? `wmux-playwright-${process.pid}`;
const windowName = "playwright";
const derivedFakeLLMPort = 38000 + (process.pid % 10000);

function waitForFakeLLM(port: number) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const result = spawnSync("curl", ["-sf", `http://127.0.0.1:${port}/health`], {
			stdio: "ignore",
		});
		if (result.status === 0) {
			return;
		}
		spawnSync("sleep", ["0.2"]);
	}
	throw new Error(`fake LLM server did not become ready on port ${port}`);
}

process.env.WMUX_PLAYWRIGHT_TEMP_DIR = tempDir;
process.env.WMUX_PLAYWRIGHT_CONFIG_PATH = configPath;
process.env.WMUX_PLAYWRIGHT_PORT = String(port);
process.env.WMUX_PLAYWRIGHT_SESSION = sessionName;
process.env.WMUX_PLAYWRIGHT_WINDOW = windowName;

if (shouldInitialize) {
	const fakeLLMPort = Number(process.env.WMUX_FAKE_LLM_PORT ?? derivedFakeLLMPort);
	process.env.WMUX_FAKE_KEY = "playwright-fake-key";
	process.env.WMUX_FAKE_LLM_PORT = String(fakeLLMPort);
	const fakeLLMProc = spawn("bun", [join(process.cwd(), "tests/e2e/helpers/fake-llm-server.ts")], {
		env: { ...process.env },
		stdio: "ignore",
		detached: false,
	});
	waitForFakeLLM(fakeLLMPort);
	process.on("exit", () => {
		try {
			fakeLLMProc.kill();
		} catch {
			// Ignore fake LLM cleanup errors.
		}
	});

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
				intelligence: {
					enabled: true,
					provider: "openai",
					model: "fake-model",
					apiKey: "playwright-fake-key",
					baseURL: `http://127.0.0.1:${fakeLLMPort}`,
					maxBytes: 4096,
					timeoutSec: 5,
					minSessionIntervalSec: 2,
					maxConcurrency: 3,
					cacheTTLSec: 10,
				},
			},
			null,
			2,
		) + "\n",
	);
}

export default defineConfig({
	testDir: "./tests/e2e",
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
		command: `./bin/wmux -c "${configPath}"`,
		url: `http://127.0.0.1:${port}/api/health`,
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},
});
