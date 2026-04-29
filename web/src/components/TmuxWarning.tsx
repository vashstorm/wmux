import { useAppState } from "../state/store.js";

export function TmuxWarning() {
	const { error, selectedConnectionId, connections } = useAppState();

	if (error?.code !== "tmux_not_found" || !selectedConnectionId) {
		return null;
	}

	const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId);
	if (selectedConnection?.type !== "local") {
		return null;
	}

	return (
		<div className="inline-warning-banner" data-testid="tmux-warning" role="alert">
			<strong>Local tmux unavailable.</strong>
			<span>Install tmux or update the tmux path in Settings before using local connections.</span>
		</div>
	);
}
