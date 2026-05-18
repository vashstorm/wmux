import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { getAuthToken, getBaseUrl, getWebSocketUrl } from "./runtime.js";

describe("runtime", () => {
	beforeEach(() => {
		delete window.__WMUX_RUNTIME__;
		sessionStorage.clear();
	});

	afterEach(() => {
		delete window.__WMUX_RUNTIME__;
		sessionStorage.clear();
	});

	test("uses same-origin defaults in web mode", () => {
		sessionStorage.setItem("wmux-auth-token", "web-token");
		const query = new URLSearchParams({ token: "web-token" });

		expect(getBaseUrl()).toBe("");
		expect(getAuthToken()).toBe("web-token");
		expect(getWebSocketUrl("/api/terminal", query)).toBe(`ws://${window.location.host}/api/terminal?token=web-token`);
	});

	test("uses injected Tauri runtime for API, auth, and WebSocket URL", () => {
		window.__WMUX_RUNTIME__ = {
			baseUrl: "http://127.0.0.1:7331",
			token: "runtime-token",
		};
		const query = new URLSearchParams({ token: "runtime-token" });

		expect(getBaseUrl()).toBe("http://127.0.0.1:7331");
		expect(getAuthToken()).toBe("runtime-token");
		expect(getWebSocketUrl("/api/terminal", query)).toBe("ws://127.0.0.1:7331/api/terminal?token=runtime-token");
	});

	test("derives secure WebSocket protocol from HTTPS base URL", () => {
		window.__WMUX_RUNTIME__ = {
			baseUrl: "https://wmux.local:7443",
			token: "runtime-token",
		};

		expect(getWebSocketUrl("/api/terminal", new URLSearchParams())).toBe("wss://wmux.local:7443/api/terminal?");
	});

	test("falls back to session storage when runtime token is empty", () => {
		window.__WMUX_RUNTIME__ = {
			baseUrl: "http://127.0.0.1:7331",
			token: "",
		};
		sessionStorage.setItem("wmux-auth-token", "fallback-token");

		expect(getAuthToken()).toBe("fallback-token");
	});
});
