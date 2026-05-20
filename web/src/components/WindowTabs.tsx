import { Box, Tabs, Tab, Stack, Typography, Chip, keyframes } from "@mui/material";
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

const pulseAnimation = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
  70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
`;

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

	const tabValue = selectedWindowId && windows.some((window) => window.id === selectedWindowId)
		? selectedWindowId
		: false;

	const handleTabChange = (_event: React.SyntheticEvent, newValue: string | false) => {
		if (typeof newValue !== "string") {
			return;
		}

		const w = windows.find((window) => window.id === newValue);
		if (w) {
			onSelectWindow(w.id, w.activePaneID);
		}
	};

	const tabSxBase = {
		minHeight: 34,
		height: 34,
		padding: "0 12px",
		textTransform: "none" as const,
		borderRadius: "var(--radius-sm)",
		gap: 1,
		flexDirection: "row" as const,
		flexShrink: 0,
		minWidth: "auto",
		overflow: "hidden",
	};

	return (
		<Box className="window-tabs" data-testid="window-tabs" sx={{
			display: "flex",
			alignItems: "center",
			gap: 1.25,
			paddingX: 2,
			paddingTop: 1.25,
			paddingBottom: 1,
			backgroundColor: "background.default",
			borderBottom: "1px solid",
			borderColor: "divider",
			overflowX: "auto",
			flexShrink: 0,
		}}>
			<Tabs
				variant="scrollable"
				scrollButtons={false}
				value={tabValue}
				onChange={handleTabChange}
				sx={{
					minHeight: "unset",
					width: "100%",
					overflow: "hidden",
					"& .MuiTabs-scroller": {
						overflow: "auto hidden !important",
						paddingTop: 0.5,
						paddingBottom: 0.5,
					},
					"& .MuiTabs-indicator": {
						display: "none",
					},
					"& .MuiTabs-flexContainer": {
						gap: 1.75,
						alignItems: "center",
					},
				}}
			>
				{windows.map((window, index) => {
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
							value={window.id}
							data-testid={isActive ? "window-tab-active" : "window-tab"}
							className={tabClasses}
							title={displayName}
							disableRipple
							disableFocusRipple
							sx={{
								...tabSxBase,
								position: "relative",
								maxWidth: isActive ? 280 : 180,
								marginRight: index === windows.length - 1 ? 0 : 1,
								backgroundColor: isActive ? "action.selected" : "background.paper",
								border: "1px solid",
								borderColor: isActive ? "primary.main" : "divider",
								color: isActive ? "primary.main" : "text.secondary",
								fontWeight: isActive ? 600 : 500,
								boxShadow: isActive
									? (theme) => `0 0 0 1px ${theme.palette.primary.main}33, ${theme.palette.mode === "dark" ? "0 2px 8px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.06)"}`
									: "none",
								transition: "all 200ms cubic-bezier(0.4, 0, 0.2, 1)",
								"&:hover": {
									backgroundColor: isActive ? "action.selected" : "action.hover",
									borderColor: isActive ? "primary.main" : "primary.light",
								},
								"&::before": isActive
									? {
											content: "\"\"",
											position: "absolute",
											left: 0,
											top: "18%",
											bottom: "18%",
											width: "3px",
											borderRadius: "0 6px 6px 0",
											backgroundColor: "primary.main",
										}
									: {},
							}}
							label={
								<Stack
									direction="row"
									spacing={0.75}
									data-testid={`window-tab-content-${window.id}`}
									sx={{ alignItems: "center", minWidth: 0, maxWidth: "100%" }}
								>
									<Chip
										label={window.index}
										size="small"
										className="window-tab-index"
										sx={{
											height: 20,
											minWidth: 20,
											maxWidth: 20,
											fontSize: "0.68rem",
											fontWeight: 700,
											lineHeight: 1,
											borderRadius: "999px",
											backgroundColor: isActive ? "primary.main" : "action.hover",
											color: isActive ? "primary.contrastText" : "text.secondary",
											"& .MuiChip-label": {
												paddingLeft: "5px",
												paddingRight: "5px",
											},
										}}
									/>
									<Typography
										component="span"
										className="window-tab-name"
										variant="body2"
										sx={{
											fontWeight: 500,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
											minWidth: 0,
											flex: "1 1 auto",
										}}
									>
										{displayName}
									</Typography>
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
												backgroundColor: isAttentionExplicit ? "var(--color-attention-explicit)" : "var(--color-attention)",
													animation: isAttentionExplicit ? `${pulseAnimation} 2s infinite` : "none",
												flexShrink: 0,
											}}
										>
											{window.attentionCount}
										</Box>
									)}
								</Stack>
							}
						/>
					);
				})}
			</Tabs>
		</Box>
	);
}
