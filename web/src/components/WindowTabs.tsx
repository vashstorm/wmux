import type { PaneData, WindowSummary } from "../state/store.js";

interface WindowTabsProps {
	windows: WindowSummary[];
	loadedPanesByWindow?: Record<string, PaneData[]>;
	selectedWindowId: string | null;
	onSelectWindow: (windowId: string, activePaneId: string) => void;
}

function inferAppNameFromText(value: string | undefined): string | null {
	const normalized = value?.trim().toLowerCase() ?? "";
	if (!normalized) {
		return null;
	}
	if (normalized.includes("claude")) {
		return "claude";
	}
	if (normalized.includes("codex")) {
		return "codex";
	}
	if (normalized === "zsh" || normalized.includes(" zsh") || normalized.startsWith("zsh ")) {
		return "zsh";
	}
	return null;
}

function getAppCountsFromPanes(panes: PaneData[] | undefined): Record<string, number> {
	if (!panes || panes.length === 0) {
		return {};
	}

	const counts: Record<string, number> = {};
	for (const pane of panes) {
		const app = pane.intelligenceApp?.trim().toLowerCase() ?? inferAppNameFromText(pane.title);
		if (!app) {
			continue;
		}
		counts[app] = (counts[app] ?? 0) + 1;
	}
	return counts;
}

function getWindowDisplayName(
	window: WindowSummary,
	panes: PaneData[] | undefined,
): string {
	const paneAppCounts = getAppCountsFromPanes(panes);
	const appCounts = Object.keys(paneAppCounts).length > 0
		? paneAppCounts
		: (window.intelligenceAppCounts ?? {});
	const rankedApps = Object.entries(appCounts)
		.filter(([, count]) => typeof count === "number" && count > 0)
		.sort((left, right) => right[1] - left[1]);
	const aiApps = rankedApps
		.map(([app]) => app)
		.filter((app) => app !== "zsh");

	if (aiApps.length >= 2) {
		return "AI CLI";
	}
	if (aiApps.length === 1) {
		return aiApps[0] ?? window.name;
	}
	if ((appCounts.zsh ?? 0) > 0) {
		return "zsh";
	}

	if (window.intelligenceApp && window.intelligenceApp !== "zsh") {
		return window.intelligenceApp;
	}
	if (window.intelligenceApp === "zsh") {
		return "zsh";
	}
	const inferredActivePaneApp = inferAppNameFromText(window.activePaneTitle);
	if (inferredActivePaneApp) {
		return inferredActivePaneApp;
	}
	return window.name;
}

export function WindowTabs({
	windows,
	loadedPanesByWindow,
	selectedWindowId,
	onSelectWindow,
}: WindowTabsProps) {
	if (windows.length === 0) {
		return null;
	}

	return (
		<div className="window-tabs" data-testid="window-tabs">
			{windows.map((window) => {
				const isActive = window.id === selectedWindowId;
				const isAttentionExplicit = window.attentionState === "explicit";
				const isAttention = window.attentionState === "attention";
				const displayName = getWindowDisplayName(
					window,
					loadedPanesByWindow?.[window.id],
				);
				return (
					<button
						key={window.id}
						type="button"
						className={`window-tab${isActive ? " is-active" : ""}${isAttentionExplicit ? " is-attention-explicit" : ""}${isAttention && !isAttentionExplicit ? " is-attention" : ""}`}
						data-testid={isActive ? "window-tab-active" : "window-tab"}
						onClick={() => onSelectWindow(window.id, window.activePaneID)}
						title={displayName}
					>
						<span className="window-tab-index">{window.index}</span>
						<span className="window-tab-name">{displayName}</span>
						{(isAttention || isAttentionExplicit) && typeof window.attentionCount === "number" && window.attentionCount > 0 && (
							<span className={`attention-badge${isAttention && !isAttentionExplicit ? " is-soft" : ""}`}>
								{window.attentionCount}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
