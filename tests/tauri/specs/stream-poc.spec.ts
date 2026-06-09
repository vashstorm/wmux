import assert from "node:assert/strict";

declare global {
	interface Window {
		__WMUX_RUNTIME__?: {
			baseUrl: string;
			token: string;
		};
	}
}

/**
 * Stream PoC E2E Test
 * Verifies deterministic 10,000 line chunks reach frontend within 30s
 */
describe("Tauri stream-burst Channel PoC", () => {
	it("receives 10,000 deterministic line chunks via Channel", async () => {
		// Trigger stream_burst via browser.execute calling invoke
		const result = await browser.execute(async () => {
			const { invoke, Channel } = (window as unknown as { __TAURI__?: { core: typeof import("@tauri-apps/api/core") } }).__TAURI__?.core 
				|| await import("@tauri-apps/api/core");
			
			const lines: string[] = [];
			const channel = new Channel<string>();
			
			channel.onmessage = (msg: string) => {
				lines.push(msg);
			};
			
			await invoke("stream_burst", { count: 10000, onEvent: channel });
			
			// Wait for completion event
			return new Promise<{ lines: string[]; success: boolean }>((resolve) => {
				const { listen } = window.__TAURI__?.event || { listen: () => () => {} };
				
				const unlisten = listen("stream-burst-complete", () => {
					unlisten();
					setTimeout(() => resolve({ lines, success: true }), 100);
				});
				
				// Fallback timeout
				setTimeout(() => resolve({ lines, success: lines.length === 10000 }), 30000);
			});
		}, []);

		assert.ok(result.success || result.lines.length === 10000, 
			`Stream should complete with 10000 lines, got ${result.lines.length}`);
		
		// Verify deterministic order: line_0, line_1, ..., line_9999
		assert.equal(result.lines.length, 10000, "should receive exactly 10000 lines");
		assert.equal(result.lines[0], "line_0", "first line should be line_0");
		assert.equal(result.lines[9999], "line_9999", "last line should be line_9999");

		// Verify completion marker appears
		assert.equal(
			result.lines.includes("STREAM_POC_DONE"), 
			false, 
			"STREAM_POC_DONE marker should NOT appear (not sent in this test)"
		);
	});

	it("completes within 30 seconds", async () => {
		const startTime = Date.now();
		
		await browser.execute(async () => {
			const { invoke, Channel } = (window as unknown as { __TAURI__?: { core: typeof import("@tauri-apps/api/core") } }).__TAURI__?.core 
				|| await import("@tauri-apps/api/core");
			
			const channel = new Channel<string>();
			let lineCount = 0;
			
			channel.onmessage = () => {
				lineCount++;
			};
			
			await invoke("stream_burst", { count: 10000, onEvent: channel });
			
			return new Promise<void>((resolve) => {
				const { listen } = window.__TAURI__?.event || { listen: () => () => {} };
				
				listen("stream-burst-complete", () => {
					resolve();
				});
				
				setTimeout(resolve, 30000);
			});
		}, []);

		const elapsed = Date.now() - startTime;
		assert.ok(elapsed < 30000, `Stream should complete within 30s, took ${elapsed}ms`);
	});
});

export {};