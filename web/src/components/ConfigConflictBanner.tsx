import { useState } from "react";
import { useAppState } from "../state/store.js";

export function ConfigConflictBanner() {
	const { configConflict, setConfigConflict } = useAppState();
	const [loadingAction, setLoadingAction] = useState<"reload" | "retry" | null>(null);

	if (!configConflict) {
		return null;
	}

	const runAction = async (action: "reload" | "retry", callback: () => Promise<void>) => {
		setLoadingAction(action);
		try {
			await callback();
		} finally {
			setLoadingAction(null);
		}
	};

	return (
		<div className="config-conflict-banner" data-testid="config-conflict" role="alert">
			<div className="config-conflict-copy">
				<strong>Configuration conflict</strong>
				<span>
					The config file changed on disk before your save completed. Reload the latest config or retry after reviewing your pending changes.
				</span>
			</div>
			<div className="config-conflict-actions">
				<button
					type="button"
					className="form-button form-button-secondary"
					onClick={() => runAction("reload", configConflict.onReload)}
					disabled={loadingAction !== null}
				>
					{loadingAction === "reload" ? "Reloading..." : "Reload"}
				</button>
				<button
					type="button"
					className="form-button form-button-primary"
					onClick={() => runAction("retry", configConflict.onRetry)}
					disabled={loadingAction !== null}
				>
					{loadingAction === "retry" ? "Retrying..." : "Retry"}
				</button>
				<button
					type="button"
					className="error-banner-dismiss"
					onClick={() => setConfigConflict(null)}
					aria-label="Dismiss config conflict"
					title="Dismiss"
				>
					×
				</button>
			</div>
		</div>
	);
}
