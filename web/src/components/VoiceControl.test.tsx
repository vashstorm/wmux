import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VoiceControl } from "./VoiceControl.js";
import { AppProvider, useAppState } from "../state/store.js";
import { useEffect } from "react";

function renderWithProvider() {
	return render(
		<AppProvider>
			<VoiceControl />
		</AppProvider>,
	);
}

function setupStateSetup(effectFn: (ctx: ReturnType<typeof useAppState>) => void) {
	return function Component() {
		const ctx = useAppState();
		useEffect(() => { effectFn(ctx); }, []);
		return null;
	};
}

function renderWithStateSetup(effectFn: (ctx: ReturnType<typeof useAppState>) => void) {
	const Setup = setupStateSetup(effectFn);
	return render(
		<AppProvider>
			<Setup />
			<VoiceControl />
		</AppProvider>,
	);
}

describe("VoiceControl", () => {
	test("shows disabled state by default", () => {
		renderWithProvider();
		const el = document.querySelector("[data-voice-state]");
		expect(el?.getAttribute("data-voice-state")).toBe("disabled");
	});

	test("shows start button when idle", () => {
		renderWithStateSetup((ctx) => {
			ctx.setVoiceStatus("idle");
		});

		const el = document.querySelector("[data-voice-state]");
		expect(el?.getAttribute("data-voice-state")).toBe("idle");
	});

	test("shows transcript when present", () => {
		renderWithStateSetup((ctx) => {
			ctx.setVoiceTranscript("hello world");
		});

		expect(screen.getByText("hello world")).toBeInTheDocument();
	});

	test("shows error message when voiceError is set", () => {
		renderWithStateSetup((ctx) => {
			ctx.setVoiceStatus("error");
			ctx.setVoiceError("Microphone access denied");
		});

		expect(screen.getByText("Microphone access denied")).toBeInTheDocument();
	});

	test("shows confirmation prompt when voicePendingConfirmation is set", () => {
		renderWithStateSetup((ctx) => {
			ctx.setVoiceStatus("confirming");
			ctx.setVoiceConfirmation({ confirmationId: "c1", skill: "send_to_pane" });
		});

		expect(screen.getByText(/Confirm action:/)).toBeInTheDocument();
		expect(screen.getByText("send_to_pane")).toBeInTheDocument();
		expect(screen.getByText("Confirm")).toBeInTheDocument();
		expect(screen.getByText("Cancel")).toBeInTheDocument();
	});

	test("shows disabled indicator when voice is disabled", () => {
		renderWithProvider();
		expect(screen.getByText("Voice is disabled")).toBeInTheDocument();
	});

	test("shows status label matching voiceStatus", () => {
		renderWithStateSetup((ctx) => {
			ctx.setVoiceStatus("listening");
		});

		expect(screen.getByText("listening")).toBeInTheDocument();
	});
});
