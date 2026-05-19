import { useMemo } from "react";
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

	if (panes.length === 0) {
		return (
			<div className="pane-canvas-empty" data-testid="pane-canvas-empty">
				<p className="pane-canvas-empty-text">No panes loaded</p>
			</div>
		);
	}

	return (
		<div
			className={`pane-canvas${selectedPane ? " has-terminal" : ""}`}
			data-testid="pane-canvas"
		>
			<div className="pane-canvas-stage">
				{selectedPane && (
					<div className="pane-canvas-terminal" data-testid="pane-canvas-terminal">
						<Terminal
							selectedPane={selectedPane}
							windowTheme={windowTheme}
						/>
					</div>
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
						<div
							key={pane.id}
							className={`pane-box${isActive ? " is-active" : ""}${isAttentionExplicit ? " is-attention-explicit" : ""}${isAttention && !isAttentionExplicit ? " is-attention" : ""}`}
							data-testid={isActive ? "pane-box-active" : "pane-box"}
							style={{
								position: "absolute",
								left,
								top,
								width,
								height,
							}}
							onClick={() => onSelectPane(pane.id)}
							title={pane.title}
						>
							{(isAttention || isAttentionExplicit) && (
								<div className="pane-box-attention-indicator">
									<span className="attention-badge" />
								</div>
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
									{pane.title}
								</button>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
