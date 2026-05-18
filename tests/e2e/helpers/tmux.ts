import { execFileSync } from "node:child_process";

export function ensurePlaywrightTmuxSession() {
	const sessionName = process.env.WMUX_PLAYWRIGHT_SESSION ?? "wmux-playwright";
	const windowName = process.env.WMUX_PLAYWRIGHT_WINDOW ?? "playwright";

	try {
		execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
	} catch {
		// Ignore missing session cleanup.
	}
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);

	execFileSync("tmux", [
		"new-session",
		"-d",
		"-s",
		sessionName,
		"-n",
		windowName,
		"printf 'WMUX_READY\\n'; exec $SHELL -i",
	]);
	execFileSync("tmux", ["set-option", "-t", sessionName, "destroy-unattached", "off"], { stdio: "ignore" });
}
