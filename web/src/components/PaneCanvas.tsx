import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import { Terminal } from "./Terminal.js";
import type { PaneData, SelectedPane } from "../state/store.js";

interface PaneCanvasProps {
	panes: PaneData[];
	selectedPaneId: string | null;
	onSelectPane: (paneId: string) => void;
	selectedPane: SelectedPane | null;
	windowTheme?: string;
}

function computeBounds(panes: PaneData[]) {
	let minLeft = Infinity;
	let minTop = Infinity;
	let maxRight = 0;
	let maxBottom = 0;
	for (const pane of panes) {
		const right = pane.left + pane.width;
		const bottom = pane.top + pane.height;
		if (pane.left < minLeft) minLeft = pane.left;
		if (pane.top < minTop) minTop = pane.top;
		if (right > maxRight) maxRight = right;
		if (bottom > maxBottom) maxBottom = bottom;
	}
	if (!Number.isFinite(minLeft)) minLeft = 0;
	if (!Number.isFinite(minTop)) minTop = 0;
	return {
		minLeft,
		minTop,
		width: maxRight - minLeft,
		height: maxBottom - minTop,
	};
}

function scaleToPercent(value: number, max: number): string {
	if (max <= 0) return "0%";
	return `${(value / max) * 100}%`;
}

export function PaneCanvas({ panes, selectedPaneId, onSelectPane, selectedPane, windowTheme }: PaneCanvasProps) {
	const bounds = useMemo(() => computeBounds(panes), [panes]);
	const selectedPaneData = selectedPane?.pane
		? panes.find((pane) => pane.id === selectedPane.pane)
		: null;
	const selectedPaneSourceSize = useMemo(() => {
		const cols = selectedPaneData?.sourceCols ?? selectedPaneData?.width;
		const rows = selectedPaneData?.sourceRows ?? selectedPaneData?.height;
		if (!cols || !rows || cols <= 0 || rows <= 0) {
			return null;
		}
		return { cols, rows };
	}, [selectedPaneData]);

	if (panes.length === 0) {
		return (
			<Box className="pane-canvas-empty" data-testid="pane-canvas-empty" sx={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: 3,
				minHeight: 120,
			}}>
				<Typography className="pane-canvas-empty-text" sx={{
					color: "text.disabled",
					fontSize: "var(--font-size-sm)",
				}}>
					No panes loaded
				</Typography>
			</Box>
		);
	}

	return (
		<Box
			className={`pane-canvas${selectedPane ? " has-terminal" : ""}`}
			data-testid="pane-canvas"
			sx={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
		>
			<Box className="pane-canvas-stage" sx={{ position: "relative", width: "100%", height: "100%" }}>
				{selectedPane && (
					<Box className="pane-canvas-terminal" data-testid="pane-canvas-terminal" sx={{
						position: "absolute",
						inset: 0,
						zIndex: 1,
						borderRadius: 1,
						overflow: "hidden",
					}}>
						<Terminal
							selectedPane={selectedPane}
							windowTheme={windowTheme}
							sourceSize={selectedPaneSourceSize}
						/>
					</Box>
				)}
				{panes.map((pane) => {
					const isActive = pane.id === selectedPaneId;
					const isAttentionExplicit = pane.attentionState === "explicit";
					const isAttention = pane.attentionState === "attention";
					const left = scaleToPercent(pane.left - bounds.minLeft, bounds.width);
					const top = scaleToPercent(pane.top - bounds.minTop, bounds.height);
					const width = scaleToPercent(pane.width, bounds.width);
					const height = scaleToPercent(pane.height, bounds.height);

					return (
						<Box
							key={pane.id}
							className={`pane-box${isActive ? " is-active" : ""}${isAttentionExplicit ? " is-attention-explicit" : ""}${isAttention && !isAttentionExplicit ? " is-attention" : ""}`}
							data-testid={isActive ? "pane-box-active" : "pane-box"}
							style={{
								position: "absolute",
								left,
								top,
								width,
								height,
								backgroundColor: selectedPane ? "transparent" : undefined,
							}}
							sx={{
								border: "1.5px solid",
								borderColor: isActive ? "primary.main" : "divider",
								borderRadius: 1.5,
								backgroundColor: isActive ? "action.selected" : "background.paper",
								cursor: "pointer",
								overflow: "hidden",
								transition: "all var(--transition-base)",
								boxShadow: isActive
									? (theme) => `0 0 0 1px ${theme.palette.primary.main}22, inset 0 0 20px ${theme.palette.primary.main}08`
									: "none",
								"&:hover": {
								borderColor: isActive ? "primary.main" : "primary.light",
								backgroundColor: isActive ? "action.selected" : "action.hover",
								transform: "translateY(-1px)",
								boxShadow: isActive
									? (theme) => `0 0 0 1px ${theme.palette.primary.main}22, inset 0 0 20px ${theme.palette.primary.main}08, var(--shadow-md)`
									: "var(--shadow-sm)",
								},
							}}
							onClick={() => onSelectPane(pane.id)}
							title={pane.title}
						>
							{(isAttention || isAttentionExplicit) && (
								<Box className="pane-box-attention-indicator" sx={{
									position: "absolute",
									top: 6,
									right: 6,
									zIndex: 2,
								}}>
									<Box
										component="span"
										className="attention-badge"
										sx={{
											display: "block",
											width: 8,
											height: 8,
											borderRadius: "50%",
											backgroundColor: isAttentionExplicit ? "var(--color-attention-explicit)" : "var(--color-attention)",
											animation: "pulseDot 1.5s ease-in-out infinite",
											boxShadow: isAttentionExplicit ? "0 0 6px var(--color-attention-explicit)" : "0 0 6px var(--color-attention)",
										}}
									/>
								</Box>
							)}
							{!isActive && (
								<button
									type="button"
									className="pane-box-label"
								onClick={(event) => {
									event.stopPropagation();
									onSelectPane(pane.id);
									}}
								>
									<span className="pane-box-label-text">{pane.title}</span>
								</button>
							)}
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
