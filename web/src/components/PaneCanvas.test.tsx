import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PaneCanvas } from "./PaneCanvas.js";
import type { PaneData, SelectedPane } from "../state/store.js";

vi.mock("./Terminal.js", () => ({
	Terminal: vi.fn(({ selectedPane }: { selectedPane: SelectedPane }) => (
		<div data-testid="mock-terminal">{selectedPane.pane}</div>
	)),
}));

const mockPanes: PaneData[] = [
	{
		id: "%1",
		title: "bash",
		index: 0,
		active: true,
		width: 80,
		height: 24,
		left: 0,
		top: 0,
	},
	{
		id: "%2",
		title: "node",
		index: 1,
		active: false,
		width: 80,
		height: 24,
		left: 0,
		top: 25,
	},
];

const mockSelectedPane: SelectedPane = {
	connectionId: "1",
	session: "session1",
	window: "@1",
	pane: "%1",
};

describe("PaneCanvas", () => {
	test("renders pane boxes with correct geometry", () => {
		render(
			<PaneCanvas
				panes={mockPanes}
				selectedPaneId="%1"
				onSelectPane={() => {}}
				selectedPane={mockSelectedPane}
			/>,
		);

		const boxes = screen.getAllByTestId(/pane-box/);
		expect(boxes).toHaveLength(2);

		const box1 = boxes[0]!;
		expect(box1.style.position).toBe("absolute");
		expect(box1.style.left).toBe("0%");
		expect(box1.style.top).toBe("0%");
		expect(box1.style.width).toBe("100%");
		expect(box1.style.height).toBe(`${(24 / 49) * 100}%`);

		const box2 = boxes[1]!;
		expect(box2.style.left).toBe("0%");
		expect(box2.style.top).toBe(`${(25 / 49) * 100}%`);
		expect(box2.style.width).toBe("100%");
		expect(box2.style.height).toBe(`${(24 / 49) * 100}%`);
	});

	test("highlights active pane", () => {
		render(
			<PaneCanvas
				panes={mockPanes}
				selectedPaneId="%1"
				onSelectPane={() => {}}
				selectedPane={mockSelectedPane}
			/>,
		);

		const activeBox = screen.getByTestId("pane-box-active");
		expect(activeBox).toHaveClass("is-active");
		expect(activeBox).toHaveTextContent("bash");
	});

	test("clicking a pane fires onSelectPane with pane ID", () => {
		const handleSelect = vi.fn();
		render(
			<PaneCanvas
				panes={mockPanes}
				selectedPaneId="%1"
				onSelectPane={handleSelect}
				selectedPane={mockSelectedPane}
			/>,
		);

		const boxes = screen.getAllByTestId(/pane-box/);
		fireEvent.click(boxes[1]!);

		expect(handleSelect).toHaveBeenCalledTimes(1);
		expect(handleSelect).toHaveBeenCalledWith("%2");
	});

	test("shows empty state when no panes", () => {
		render(
			<PaneCanvas
				panes={[]}
				selectedPaneId={null}
				onSelectPane={() => {}}
				selectedPane={null}
			/>,
		);

		expect(screen.getByTestId("pane-canvas-empty")).toBeInTheDocument();
		expect(screen.getByText("No panes loaded")).toBeInTheDocument();
	});

	test("renders Terminal only in active pane", () => {
		render(
			<PaneCanvas
				panes={mockPanes}
				selectedPaneId="%1"
				onSelectPane={() => {}}
				selectedPane={mockSelectedPane}
			/>,
		);

		const terminals = screen.getAllByTestId("mock-terminal");
		expect(terminals).toHaveLength(1);
		expect(terminals[0]).toHaveTextContent("%1");
	});

	test("does not render Terminal when selectedPane is null", () => {
		render(
			<PaneCanvas
				panes={mockPanes}
				selectedPaneId="%1"
				onSelectPane={() => {}}
				selectedPane={null}
			/>,
		);

		expect(screen.queryByTestId("mock-terminal")).not.toBeInTheDocument();
	});

	test("scales geometry correctly with multiple columns", () => {
		const multiColPanes: PaneData[] = [
			{
				id: "%1",
				title: "left",
				index: 0,
				active: true,
				width: 80,
				height: 24,
				left: 0,
				top: 0,
			},
			{
				id: "%2",
				title: "right",
				index: 1,
				active: false,
				width: 80,
				height: 24,
				left: 81,
				top: 0,
			},
		];

		render(
			<PaneCanvas
				panes={multiColPanes}
				selectedPaneId="%1"
				onSelectPane={() => {}}
				selectedPane={mockSelectedPane}
			/>,
		);

		const boxes = screen.getAllByTestId(/pane-box/);
		expect(boxes[0]!.style.width).toBe(`${(80 / 161) * 100}%`);
		expect(boxes[1]!.style.left).toBe(`${(81 / 161) * 100}%`);
		expect(boxes[1]!.style.width).toBe(`${(80 / 161) * 100}%`);
	});

	test("normalizes pane geometry when tmux reports a non-zero origin", () => {
		const offsetPanes: PaneData[] = [
			{
				id: "%1",
				title: "top",
				index: 0,
				active: true,
				width: 100,
				height: 20,
				left: 4,
				top: 2,
			},
			{
				id: "%2",
				title: "bottom",
				index: 1,
				active: false,
				width: 100,
				height: 20,
				left: 4,
				top: 22,
			},
		];

		render(
			<PaneCanvas
				panes={offsetPanes}
				selectedPaneId="%1"
				onSelectPane={() => {}}
				selectedPane={mockSelectedPane}
			/>,
		);

		const boxes = screen.getAllByTestId(/pane-box/);
		expect(boxes[0]!.style.left).toBe("0%");
		expect(boxes[0]!.style.top).toBe("0%");
		expect(boxes[0]!.style.width).toBe("100%");
		expect(boxes[0]!.style.height).toBe("50%");
		expect(boxes[1]!.style.top).toBe("50%");
	});
});
