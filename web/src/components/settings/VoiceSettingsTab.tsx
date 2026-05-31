import { Typography, Box, TextField, FormControlLabel, Switch } from "@mui/material";

interface VoiceSettingsTabProps {
	omniVoice: string;
	omniMicrophoneDisabled: boolean;
	updateField: (key: "omniVoice" | "omniMicrophoneDisabled", value: string | boolean) => void;
}

export function VoiceSettingsTab({ omniVoice, omniMicrophoneDisabled, updateField }: VoiceSettingsTabProps) {
	return (
		<Box>
			<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Voice Settings</Typography>
			<Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
				<TextField
					id="voice-voice"
					label="Voice / Timbre"
					type="text"
					value={omniVoice}
					onChange={(event) => updateField("omniVoice", event.target.value)}
					placeholder="Chelsie"
					fullWidth
					slotProps={{
						htmlInput: {
							"data-testid": "omni-voice-input",
						},
					}}
				/>
				<FormControlLabel
					control={
						<Switch
							id="omni-microphone-disabled"
							checked={omniMicrophoneDisabled}
							onChange={(event) => updateField("omniMicrophoneDisabled", event.target.checked)}
							data-testid="omni-microphone-disabled-toggle"
						/>
					}
					label="Disable Microphone"
				/>
			</Box>
		</Box>
	);
}