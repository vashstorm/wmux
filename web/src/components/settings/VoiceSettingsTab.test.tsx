import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VoiceSettingsTab } from "./VoiceSettingsTab.js";

describe("VoiceSettingsTab", () => {
	test("renders voice/timbre input field", () => {
		const updateField = vi.fn();
		render(
			<VoiceSettingsTab
				omniVoice="Chelsie"
				updateField={updateField}
			/>
		);

		const voiceInput = screen.getByTestId("omni-voice-input");
		expect(voiceInput).toBeInTheDocument();
		expect(voiceInput).toHaveValue("Chelsie");
	});

	test("calls updateField when voice input changes", () => {
		const updateField = vi.fn();
		render(
			<VoiceSettingsTab
				omniVoice=""
				updateField={updateField}
			/>
		);

		const voiceInput = screen.getByTestId("omni-voice-input");
		fireEvent.change(voiceInput, { target: { value: "Zhichu" } });

		expect(updateField).toHaveBeenCalledWith("omniVoice", "Zhichu");
	});

	test("shows Voice Settings section header", () => {
		const updateField = vi.fn();
		render(
			<VoiceSettingsTab
				omniVoice=""
				updateField={updateField}
			/>
		);

		expect(screen.getByText("Voice Settings")).toBeInTheDocument();
	});

	test("displays placeholder for voice input when empty", () => {
		const updateField = vi.fn();
		render(
			<VoiceSettingsTab
				omniVoice=""
				updateField={updateField}
			/>
		);

		const voiceInput = screen.getByTestId("omni-voice-input");
		expect(voiceInput).toHaveAttribute("placeholder", "Chelsie");
	});
});