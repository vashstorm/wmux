import type { WindowSummary } from "../state/store.js";

interface WindowTabsProps {
	windows: WindowSummary[];
	selectedWindowId: string | null;
	onSelectWindow: (windowId: string, activePaneId: string) => void;
}

export function WindowTabs({ windows, selectedWindowId, onSelectWindow }: WindowTabsProps) {
	if (windows.length === 0) {
		return null;
	}

	return (
		<div className="window-tabs" data-testid="window-tabs">
			{windows.map((window) => {
				const isActive = window.id === selectedWindowId;
				return (
					<button
						key={window.id}
						type="button"
						className={`window-tab${isActive ? " is-active" : ""}`}
						data-testid={isActive ? "window-tab-active" : "window-tab"}
						onClick={() => onSelectWindow(window.id, window.activePaneID)}
						title={window.name}
					>
						<span className="window-tab-index">{window.index}</span>
						<span className="window-tab-name">{window.name}</span>
						<span className="window-tab-badge">{window.paneCount}</span>
						{window.activePaneTitle && (
							<span className="window-tab-pane-title">{window.activePaneTitle}</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
