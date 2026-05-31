import { Typography, Box, TextField } from "@mui/material";

interface VoiceSettingsTabProps {
	omniVoice: string;
	updateField: (key: "omniVoice", value: string) => void;
}

export function VoiceSettingsTab({ omniVoice, updateField }: VoiceSettingsTabProps) {
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
			</Box>
		</Box>
	);
}