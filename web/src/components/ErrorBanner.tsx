import { useAppState } from "../state/store.js";

export function ErrorBanner() {
	const { error, setError } = useAppState();

	if (error && ["conflict", "tmux_not_found", "ssh_unknown_host"].includes(error.code)) {
		return null;
	}

	if (!error) return null;

	return (
		<div className="error-banner" data-testid="error-banner" role="alert">
			<span className="error-banner-code">{error.code}</span>
			<span className="error-banner-message">{error.message}</span>
			<button
				type="button"
				className="error-banner-dismiss"
				onClick={() => setError(null)}
				aria-label="Dismiss error"
				title="Dismiss"
			>
				×
			</button>
		</div>
	);
}
