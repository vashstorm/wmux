import { Alert, AlertTitle } from "@mui/material";
import { useAppState } from "../state/store.js";

export function ErrorBanner() {
	const { error, setError } = useAppState();

	if (error && ["conflict", "tmux_not_found", "ssh_unknown_host"].includes(error.code)) {
		return null;
	}

	if (!error) return null;

	return (
		<Alert
			severity="error"
			onClose={() => setError(null)}
			data-testid="error-banner"
			sx={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", zIndex: 9999 }}
		>
			<AlertTitle>Error: {error.code}</AlertTitle>
			{error.message}
		</Alert>
	);
}
