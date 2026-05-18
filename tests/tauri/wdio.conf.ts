import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Capabilities, Options } from "@wdio/types";

type WdioTestrunnerConfig = Options.Testrunner & {
	capabilities: Capabilities.TestrunnerCapabilities;
};

const rootDir = resolve(new URL("../..", import.meta.url).pathname);
const configPath = resolve(rootDir, "config.jsonc");
const applicationPath = process.env.WMUX_TAURI_APP_PATH
	?? resolve(rootDir, "target/release/bundle/macos/Wmux.app");
const sessionName = process.env.WMUX_TAURI_SESSION ?? "wmux-tauri-e2e";
const windowName = process.env.WMUX_TAURI_WINDOW ?? "tauri";

let originalConfig: string | null = null;
let hadConfig = false;
let prepared = false;

function hasTmux(): boolean {
	return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
}

function cleanupTmuxSession(): void {
	try {
		execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
	} catch {
		// Ignore missing session cleanup errors.
	}
}

function prepareRuntimeConfig(): void {
	hadConfig = existsSync(configPath);
	originalConfig = hadConfig ? readFileSync(configPath, "utf8") : null;

	writeFileSync(
		configPath,
		JSON.stringify(
			{
				schemaVersion: 1,
				server: {
					bind: "127.0.0.1:7331",
				},
				auth: {
					token: "tauri-e2e-token",
				},
				tmux: {
					path: "tmux",
				},
				connections: [
					{
						id: "tauri-local",
						type: "local",
					},
				],
				ui: {
					theme: "dark",
					windowTheme: "dark",
					fontSize: 16,
					terminalFontSize: 14,
					terminalFontWeight: "normal",
				},
				intelligence: {
					enabled: false,
					providers: [],
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
	prepared = true;
}

function restoreRuntimeConfig(): void {
	if (!prepared) return;
	if (hadConfig && originalConfig !== null) {
		writeFileSync(configPath, originalConfig);
	} else {
		rmSync(configPath, { force: true });
	}
	prepared = false;
}

function prepareTmuxSession(): void {
	cleanupTmuxSession();
	execFileSync("tmux", [
		"new-session",
		"-d",
		"-s",
		sessionName,
		"-n",
		windowName,
		"printf 'TAURI_READY\\n'; exec $SHELL -i",
	]);
}

function onShutdown(): void {
	cleanupTmuxSession();
	restoreRuntimeConfig();
}

const tauriCapabilities = [
	{
		browserName: "wmux",
		maxInstances: 1,
		"tauri:options": {
			application: applicationPath,
		},
	},
] as unknown as Capabilities.TestrunnerCapabilities;

process.once("exit", onShutdown);
process.once("SIGINT", () => {
	onShutdown();
	process.exit(130);
});
process.once("SIGTERM", () => {
	onShutdown();
	process.exit(143);
});

export const config = {
	runner: "local",
	protocol: "http",
	hostname: "127.0.0.1",
	port: 4444,
	path: "/",
	specs: ["tests/tauri/specs/**/*.spec.ts"],
	maxInstances: 1,
	capabilities: tauriCapabilities,
	logLevel: "info",
	waitforTimeout: 10_000,
	connectionRetryTimeout: 120_000,
	connectionRetryCount: 3,
	reporters: ["spec"],
	framework: "mocha",
	mochaOpts: {
		ui: "bdd",
		timeout: 60_000,
	},
	onPrepare: () => {
		if (!hasTmux()) {
			console.warn("Skipping Tauri E2E setup: tmux binary not found.");
			return;
		}

		process.env.WMUX_TAURI_SESSION = sessionName;
		process.env.WMUX_TAURI_WINDOW = windowName;
		prepareRuntimeConfig();
		prepareTmuxSession();
	},
	onComplete: () => {
		onShutdown();
	},
} satisfies WdioTestrunnerConfig;
