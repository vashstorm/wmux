// @ts-nocheck
import { defineConfig } from "./web/node_modules/@playwright/test/index.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "wmux-playwright-"));
const configPath = join(tempDir, "config.jsonc");

writeFileSync(
	configPath,
	JSON.stringify(
		{
			schemaVersion: 1,
			server: {
				bind: "127.0.0.1:7331",
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

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 30_000,
	expect: {
		timeout: 5_000,
	},
	use: {
		baseURL: "http://127.0.0.1:7331",
		headless: true,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: `./bin/wmux -c "${configPath}"`,
		url: "http://127.0.0.1:7331/api/health",
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},
});
