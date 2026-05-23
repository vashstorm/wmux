import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import TerminalIcon from "@mui/icons-material/Terminal";
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
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				padding: "var(--spacing-xl)",
				minHeight: 280,
				height: "100%",
				background: "var(--color-background)",
			}}>
				<Box className="pane-canvas-empty-card" sx={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					padding: "var(--spacing-xl)",
					borderRadius: "var(--radius-lg)",
					background: "var(--color-glass-surface)",
					border: "1px solid var(--color-panel-border)",
					backdropFilter: "var(--color-glass-blur)",
					WebkitBackdropFilter: "var(--color-glass-blur)",
					boxShadow: "var(--shadow-md)",
					maxWidth: 400,
					textAlign: "center",
					transition: "transform var(--transition-base), box-shadow var(--transition-base)",
					"&:hover": {
						transform: "translateY(-2px)",
						boxShadow: "var(--shadow-lg), var(--color-accent-glow)",
						borderColor: "var(--color-accent-subtle)",
					}
				}}>
					<Box sx={{
						width: 56,
						height: 56,
						borderRadius: "50%",
						background: "var(--color-accent-subtle)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						marginBottom: "var(--spacing-md)",
						boxShadow: "0 0 16px var(--color-accent-subtle)",
						color: "var(--color-accent)",
					}}>
						<TerminalIcon sx={{ fontSize: 28 }} />
					</Box>
					<Typography variant="h6" className="pane-canvas-empty-title" sx={{
						fontWeight: "var(--font-weight-semibold)",
						color: "var(--color-text)",
						marginBottom: "var(--spacing-xs)",
						fontSize: "var(--font-size-md)",
					}}>
						No Active Panes
					</Typography>
					<Typography className="pane-canvas-empty-text" sx={{
						color: "var(--color-text-muted)",
						fontWeight: "var(--font-weight-medium)",
						fontSize: "var(--font-size-sm)",
						lineHeight: "var(--line-height-normal)",
					}}>
						No panes loaded
					</Typography>
					<Typography className="pane-canvas-empty-subtext" sx={{
						color: "var(--color-text-disabled)",
						fontSize: "var(--font-size-xs)",
						lineHeight: "var(--line-height-normal)",
						marginTop: "var(--spacing-xs)",
					}}>
						Select a tmux window or session to view active terminal layouts.
					</Typography>
				</Box>
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
