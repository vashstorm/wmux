import type { Page } from "../../../web/node_modules/@playwright/test/index.js";
import type { VoiceClientMessage, VoiceServerEvent } from "../../../web/src/api/voiceTypes.js";

export async function installVoiceMock(page: Page) {
	await page.addInitScript({
		content: `
			(() => {
				const NativeWebSocket = window.WebSocket;
				const voiceSockets = [];
				const sentMessages = [];
				class AudioNodeMock {
					connect() { return this; }
					disconnect() {}
				}
				class AudioContextMock {
					constructor() {
						this.destination = new AudioNodeMock();
						this.sampleRate = 16000;
					}
					async resume() {}
					async close() {}
					createMediaStreamSource() { return new AudioNodeMock(); }
					createScriptProcessor() {
						const node = new AudioNodeMock();
						node.onaudioprocess = null;
						return node;
					}
					createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
					createBufferSource() {
						const node = new AudioNodeMock();
						node.buffer = null;
						node.onended = null;
						node.start = () => window.setTimeout(() => node.onended?.(), 0);
						node.stop = () => {};
						return node;
					}
				}
				Object.defineProperty(navigator, "mediaDevices", {
					configurable: true,
					value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
				});
				window.AudioContext = AudioContextMock;
				window.webkitAudioContext = AudioContextMock;
				class VoiceMockWebSocket extends EventTarget {
					static CONNECTING = 0;
					static OPEN = 1;
					static CLOSING = 2;
					static CLOSED = 3;
					constructor(url, protocols) {
						const targetUrl = String(url);
						if (!targetUrl.includes("/api/voice")) return new NativeWebSocket(url, protocols);
						super();
						this.url = targetUrl;
						this.readyState = VoiceMockWebSocket.CONNECTING;
						this.protocol = "";
						this.extensions = "";
						this.binaryType = "blob";
						this.bufferedAmount = 0;
						this.onopen = null;
						this.onmessage = null;
						this.onerror = null;
						this.onclose = null;
						voiceSockets.push(this);
						queueMicrotask(() => {
							this.readyState = VoiceMockWebSocket.OPEN;
							const event = new Event("open");
							this.onopen?.(event);
							this.dispatchEvent(event);
						});
					}
					send(data) {
						const text = typeof data === "string" ? data : String(data);
						try { sentMessages.push(JSON.parse(text)); } catch { sentMessages.push(text); }
					}
					close() {
						this.readyState = VoiceMockWebSocket.CLOSED;
						const event = new CloseEvent("close");
						this.onclose?.(event);
						this.dispatchEvent(event);
					}
					emit(event) {
						if (this.readyState !== VoiceMockWebSocket.OPEN) return;
						const messageEvent = new MessageEvent("message", { data: JSON.stringify(event) });
						this.onmessage?.(messageEvent);
						this.dispatchEvent(messageEvent);
					}
				}
				window.WebSocket = VoiceMockWebSocket;
				window.__wmuxVoiceMock = {
					emit(event) { voiceSockets[voiceSockets.length - 1]?.emit(event); },
					sentMessages() { return [...sentMessages]; },
					reset() { sentMessages.splice(0, sentMessages.length); },
				};
			})();
		`,
	});
}

export async function emitVoiceEvent(page: Page, event: VoiceServerEvent) {
	await page.evaluate((payload) => (window as unknown as { __wmuxVoiceMock: { emit: (event: VoiceServerEvent) => void } }).__wmuxVoiceMock.emit(payload), event);
}

export async function getVoiceClientMessages(page: Page): Promise<VoiceClientMessage[]> {
	return page.evaluate(() => (window as unknown as { __wmuxVoiceMock: { sentMessages: () => VoiceClientMessage[] } }).__wmuxVoiceMock.sentMessages());
}

export async function waitForVoiceClientMessage(page: Page, type: VoiceClientMessage["type"]) {
	await page.waitForFunction(
		(expectedType) => (window as unknown as { __wmuxVoiceMock: { sentMessages: () => VoiceClientMessage[] } }).__wmuxVoiceMock.sentMessages().some((message) => message?.type === expectedType),
		type,
	);
}
