import { Box, Tabs, Tab } from "@mui/material";
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

	const selectedIndex = windows.findIndex((w) => w.id === selectedWindowId);

	const handleTabChange = (_event: React.SyntheticEvent, newValue: number | boolean) => {
		if (typeof newValue === "number") {
			const w = windows[newValue];
			if (w) {
				onSelectWindow(w.id, w.activePaneID);
			}
		}
	};

	const tabSxBase = {
		minHeight: 36,
		height: 36,
		padding: "0 12px",
		textTransform: "none" as const,
		borderRadius: 2,
		gap: 1,
		flexDirection: "row" as const,
	};

	return (
		<Box className="window-tabs" data-testid="window-tabs" sx={{
			display: "flex",
			alignItems: "center",
			gap: 1,
			paddingX: 2,
			paddingY: 1,
			backgroundColor: "background.default",
			borderBottom: "1px solid",
			borderColor: "divider",
			overflowX: "hidden",
			flexShrink: 0,
		}}>
			<Tabs
				value={selectedIndex >= 0 ? selectedIndex : false}
				onChange={handleTabChange}
				sx={{
					minHeight: "unset",
					"& .MuiTabs-indicator": {
						display: "none",
					},
					"& .MuiTabs-flexContainer": {
						gap: 1,
					},
				}}
			>
				{windows.map((window) => {
					const isActive = window.id === selectedWindowId;
					const isAttentionExplicit = window.attentionState === "explicit";
					const isAttention = window.attentionState === "attention";
					const displayName = getWindowDisplayName(
						window,
						loadedPanesByWindow?.[window.id],
					);
					const tabClasses = [
						"window-tab",
						isActive && "is-active",
						isAttentionExplicit && "is-attention-explicit",
						isAttention && !isAttentionExplicit && "is-attention",
					].filter(Boolean).join(" ");

					const hasAttentionBadge = (isAttention || isAttentionExplicit)
						&& typeof window.attentionCount === "number"
						&& window.attentionCount > 0;

					return (
						<Tab
							key={window.id}
							data-testid={isActive ? "window-tab-active" : "window-tab"}
							className={tabClasses}
							title={displayName}
							disableRipple
							sx={{
								...tabSxBase,
								backgroundColor: "background.paper",
								border: "1px solid",
								borderColor: isActive ? "primary.main" : "divider",
								color: isActive ? "primary.main" : "text.secondary",
								fontWeight: isActive ? 600 : 500,
								"boxShadow": isActive ? "0 -2px 12px rgba(245, 158, 11, 0.12)" : "none",
								"&:hover": {
									backgroundColor: "action.hover",
									borderColor: "action.hover",
								},
							}}
							label={
								<Box sx={{ display: "flex", alignItems: "center", gap: 1 }} data-testid={`window-tab-content-${window.id}`}>
									<Box
										component="span"
										className="window-tab-index"
										sx={{
											fontSize: "var(--font-size-xs)",
											fontWeight: 600,
											color: isActive ? "primary.main" : "text.disabled",
											minWidth: 16,
											textAlign: "center",
										}}
									>
										{window.index}
									</Box>
									<Box
										component="span"
										className="window-tab-name"
										sx={{
											fontWeight: 500,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										{displayName}
										{isActive && window.activePaneTitle && (
											<Box
												component="span"
												className="window-tab-pane-title"
												sx={{
													fontSize: "var(--font-size-xs)",
													color: "text.disabled",
													opacity: 0.6,
													marginLeft: 0.75,
												}}
											>
												&middot; {window.activePaneTitle}
											</Box>
										)}
									</Box>
									{hasAttentionBadge && (
										<Box
											component="span"
											className={`attention-badge${isAttention && !isAttentionExplicit ? " is-soft" : ""}`}
											sx={{
												display: "inline-flex",
												alignItems: "center",
												justifyContent: "center",
												minWidth: 18,
												height: 18,
												padding: "0 4px",
												borderRadius: "50%",
												fontSize: 10,
												fontWeight: 600,
												lineHeight: 1,
												color: "#fff",
												backgroundColor: "var(--color-attention-explicit)",
												flexShrink: 0,
											}}
										>
											{window.attentionCount}
										</Box>
									)}
								</Box>
							}
						/>
					);
				})}
			</Tabs>
		</Box>
	);
}
