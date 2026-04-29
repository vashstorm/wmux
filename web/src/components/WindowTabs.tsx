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
				const isAttentionExplicit = window.attentionState === "explicit";
				const isAttention = window.attentionState === "attention";
				return (
					<button
						key={window.id}
						type="button"
						className={`window-tab${isActive ? " is-active" : ""}${isAttentionExplicit ? " is-attention-explicit" : ""}${isAttention && !isAttentionExplicit ? " is-attention" : ""}`}
						data-testid={isActive ? "window-tab-active" : "window-tab"}
						onClick={() => onSelectWindow(window.id, window.activePaneID)}
						title={window.name}
					>
						<span className="window-tab-index">{window.index}</span>
						<span className="window-tab-name">{window.name}</span>
						<span className="window-tab-badge">{window.paneCount}</span>
						{(isAttention || isAttentionExplicit) && typeof window.attentionCount === "number" && window.attentionCount > 0 && (
							<span className={`attention-badge${isAttention && !isAttentionExplicit ? " is-soft" : ""}`}>
								{window.attentionCount}
							</span>
						)}
						{window.semanticEventType !== "none" && window.semanticEventType !== "" && window.semanticEventCount > 0 && (
							<span className="semantic-badge" title={window.semanticEventType}>
								AI {window.semanticEventCount}
							</span>
						)}
						{window.activePaneTitle && (
							<span className="window-tab-pane-title">{window.activePaneTitle}</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
