import { useMemo } from "react";
import { Terminal } from "./Terminal.js";
import type { PaneData, SelectedPane } from "../state/store.js";

interface PaneCanvasProps {
	panes: PaneData[];
	selectedPaneId: string | null;
	onSelectPane: (paneId: string) => void;
	selectedPane: SelectedPane | null;
}

function computeBounds(panes: PaneData[]) {
	let maxRight = 0;
	let maxBottom = 0;
	for (const pane of panes) {
		const right = pane.left + pane.width;
		const bottom = pane.top + pane.height;
		if (right > maxRight) maxRight = right;
		if (bottom > maxBottom) maxBottom = bottom;
	}
	return { maxRight, maxBottom };
}

function scaleToPercent(value: number, max: number): string {
	if (max <= 0) return "0%";
	return `${(value / max) * 100}%`;
}

export function PaneCanvas({ panes, selectedPaneId, onSelectPane, selectedPane }: PaneCanvasProps) {
	const bounds = useMemo(() => computeBounds(panes), [panes]);

	if (panes.length === 0) {
		return (
			<div className="pane-canvas-empty" data-testid="pane-canvas-empty">
				<p className="pane-canvas-empty-text">No panes loaded</p>
			</div>
		);
	}

	return (
		<div className="pane-canvas" data-testid="pane-canvas">
			{panes.map((pane) => {
				const isActive = pane.id === selectedPaneId;
				const left = scaleToPercent(pane.left, bounds.maxRight);
				const top = scaleToPercent(pane.top, bounds.maxBottom);
				const width = scaleToPercent(pane.width, bounds.maxRight);
				const height = scaleToPercent(pane.height, bounds.maxBottom);

				return (
					<div
						key={pane.id}
						className={`pane-box${isActive ? " is-active" : ""}`}
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
						<div className="pane-box-label">{pane.title}</div>
						{isActive && selectedPane && (
							<div className="pane-box-terminal">
								<Terminal selectedPane={selectedPane} />
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
