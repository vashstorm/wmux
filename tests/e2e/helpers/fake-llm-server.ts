// @ts-nocheck
// Fake OpenAI-compatible LLM server for E2E testing.
// Handles any POST request; parses message content; returns deterministic intelligence JSON.
import { serve } from "bun";

const port = Number(process.env.WMUX_FAKE_LLM_PORT ?? 19876);

interface ChatMessage {
	role?: string;
	content?: unknown;
}

interface ChatRequest {
	messages?: ChatMessage[];
}

function stringifyContent(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "string") return part;
				if (part && typeof part === "object" && "text" in part) {
					const text = (part as { text?: unknown }).text;
					return typeof text === "string" ? text : "";
				}
				return "";
			})
			.join("\n");
	}
	return "";
}

function getUserContent(body: unknown): string {
	if (!body || typeof body !== "object" || !("messages" in body)) {
		return "";
	}

	const { messages } = body as ChatRequest;
	if (!Array.isArray(messages)) {
		return "";
	}

	const userMessage = [...messages].reverse().find((message) => message.role === "user");
	return stringifyContent(userMessage?.content);
}

function buildIntelligence(content: string): string {
	const lowerContent = content.toLowerCase();
	if (content.includes("WMUX_ERROR_TEST")) {
		return JSON.stringify({ application: "bad_enum", status: "bad_enum", summary: "test error" });
	}
	if (lowerContent.includes("claude")) {
		return JSON.stringify({ application: "claude", status: "running", summary: "Claude is processing", confidence: 0.9 });
	}
	if (lowerContent.includes("opencode")) {
		return JSON.stringify({ application: "opencode", status: "waiting", summary: "OpenCode waiting for input", confidence: 0.9 });
	}
	return JSON.stringify({ application: "zsh", status: "waiting", summary: "Waiting for user input", confidence: 0.9 });
}

function chatCompletionResponse(content: string) {
	return {
		id: "chatcmpl-wmux-e2e",
		object: "chat.completion",
		model: "fake-model",
		created: Math.floor(Date.now() / 1000),
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content,
				},
				finish_reason: "stop",
			},
		],
		usage: {
			prompt_tokens: 10,
			completion_tokens: 20,
			total_tokens: 30,
		},
	};
}

serve({
	port,
	async fetch(request) {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/health") {
			return new Response("OK", { status: 200 });
		}

		if (request.method !== "POST") {
			return new Response("Not Found", { status: 404 });
		}

		let body: unknown;
		try {
			body = await request.json();
		} catch {
			body = {};
		}

		const userContent = getUserContent(body);
		const content = buildIntelligence(userContent);
		return Response.json(chatCompletionResponse(content));
	},
});

console.log("FAKE_LLM_READY");
