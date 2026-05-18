import { execFileSync } from "node:child_process";

export default function globalTeardown() {
	const sessionName = process.env.WMUX_PLAYWRIGHT_SESSION;
	if (!sessionName) return;

	try {
		execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
	} catch {
		// Ignore cleanup errors.
	}
}
