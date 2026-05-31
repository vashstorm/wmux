import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VoiceSettingsTab } from "./VoiceSettingsTab.js";

describe("VoiceSettingsTab", () => {
	test("renders voice/timbre input field", () => {
		const updateField = vi.fn();
		render(
			<VoiceSettingsTab
				omniVoice="Chelsie"
				omniMicrophoneDisabled={false}
				updateField={updateField}
			/>
		);

		const voiceInput = screen.getByTestId("omni-voice-input");
		expect(voiceInput).toBeInTheDocument();
		expect(voiceInput).toHaveValue("Chelsie");
	});

	test("renders microphone disabled toggle", () => {
		const updateField = vi.fn();
		render(
			<VoiceSettingsTab
				omniVoice=""
				omniMicrophoneDisabled={true}
				updateField={updateField}
			/>
		);

		const micToggle = screen.getByRole("switch");
		expect(micToggle).toBeInTheDocument();
		expect(micToggle).toBeChecked();
	});

	test("calls updateField when voice input changes", () => {
		const updateField = vi.fn();
		render(
			<VoiceSettingsTab
				omniVoice=""
				omniMicrophoneDisabled={false}
				updateField={updateField}
			/>
		);

		const voiceInput = screen.getByTestId("omni-voice-input");
		fireEvent.change(voiceInput, { target: { value: "Zhichu" } });

		expect(updateField).toHaveBeenCalledWith("omniVoice", "Zhichu");
	});

	test("calls updateField when microphone toggle changes", () => {
		const updateField = vi.fn();
		render(
			<VoiceSettingsTab
				omniVoice=""
				omniMicrophoneDisabled={false}
				updateField={updateField}
			/>
		);

		const micToggle = screen.getByRole("switch");
		fireEvent.click(micToggle);

		expect(updateField).toHaveBeenCalledWith("omniMicrophoneDisabled", true);
	});

	test("shows Voice Settings section header", () => {
		const updateField = vi.fn();
		render(
			<VoiceSettingsTab
				omniVoice=""
				omniMicrophoneDisabled={false}
				updateField={updateField}
			/>
		);

		expect(screen.getByText("Voice Settings")).toBeInTheDocument();
	});

	test("shows Disable Microphone label", () => {
		const updateField = vi.fn();
		render(
			<VoiceSettingsTab
				omniVoice=""
				omniMicrophoneDisabled={false}
				updateField={updateField}
			/>
		);

		expect(screen.getByText("Disable Microphone")).toBeInTheDocument();
	});

	test("displays placeholder for voice input when empty", () => {
		const updateField = vi.fn();
		render(
			<VoiceSettingsTab
				omniVoice=""
				omniMicrophoneDisabled={false}
				updateField={updateField}
			/>
		);

		const voiceInput = screen.getByTestId("omni-voice-input");
		expect(voiceInput).toHaveAttribute("placeholder", "Chelsie");
	});

	test("toggles microphone disabled from true to false", () => {
		const updateField = vi.fn();
		render(
			<VoiceSettingsTab
				omniVoice=""
				omniMicrophoneDisabled={true}
				updateField={updateField}
			/>
		);

		const micToggle = screen.getByRole("switch");
		fireEvent.click(micToggle);

		expect(updateField).toHaveBeenCalledWith("omniMicrophoneDisabled", false);
	});
});