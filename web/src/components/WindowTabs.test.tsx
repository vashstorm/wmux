import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WindowTabs } from "./WindowTabs.js";
import type { WindowSummary } from "../state/store.js";

const mockWindows: WindowSummary[] = [
	{
		id: "@1",
		name: "editor",
		index: 0,
		active: true,
		paneCount: 2,
		activePaneID: "%1",
		activePaneTitle: "bash",
		semanticEventType: "none",
		semanticEventCount: 0,
	},
	{
		id: "@2",
		name: "server",
		index: 1,
		active: false,
		paneCount: 1,
		activePaneID: "%3",
		activePaneTitle: "node",
		semanticEventType: "none",
		semanticEventCount: 0,
	},
];

describe("WindowTabs", () => {
	test("renders tabs with correct labels", () => {
		render(
			<WindowTabs
				windows={mockWindows}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		const tabs = screen.getAllByTestId(/^window-tab$/);
		expect(tabs).toHaveLength(1);

		expect(screen.getByText("0")).toBeInTheDocument();
		expect(screen.getByText("editor")).toBeInTheDocument();
		expect(screen.getByText("server")).toBeInTheDocument();
		expect(screen.getByText("bash")).toBeInTheDocument();
		expect(screen.getByText("node")).toBeInTheDocument();
	});

	test("renders pane count badges", () => {
		render(
			<WindowTabs
				windows={mockWindows}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		expect(screen.getByText("2")).toBeInTheDocument();
		expect(screen.getAllByText("1")).toHaveLength(2);
	});

	test("highlights active tab", () => {
		render(
			<WindowTabs
				windows={mockWindows}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		const activeTab = screen.getByTestId("window-tab-active");
		expect(activeTab).toHaveClass("is-active");
		expect(activeTab).toHaveTextContent("editor");
	});

	test("clicking a tab fires onSelectWindow with window ID and active pane ID", () => {
		const handleSelect = vi.fn();
		render(
			<WindowTabs
				windows={mockWindows}
				selectedWindowId="@1"
				onSelectWindow={handleSelect}
			/>,
		);

		const inactiveTab = screen.getByTestId("window-tab");
		fireEvent.click(inactiveTab);

		expect(handleSelect).toHaveBeenCalledTimes(1);
		expect(handleSelect).toHaveBeenCalledWith("@2", "%3");
	});

	test("returns null when windows array is empty", () => {
		const { container } = render(
			<WindowTabs
				windows={[]}
				selectedWindowId={null}
				onSelectWindow={() => {}}
			/>,
		);

		expect(container.firstChild).toBeNull();
	});

	test("truncates long active pane titles", () => {
		const windowsWithLongTitle: WindowSummary[] = [
			{
				id: "@1",
				name: "editor",
				index: 0,
				active: true,
				paneCount: 1,
				activePaneID: "%1",
				activePaneTitle: "very-long-title-that-might-overflow",
				semanticEventType: "none",
				semanticEventCount: 0,
			},
		];

		render(
			<WindowTabs
				windows={windowsWithLongTitle}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		expect(screen.getByText("very-long-title-that-might-overflow")).toBeInTheDocument();
	});
});

describe("attention rendering", () => {
	test("window with attention state gets is-attention class", () => {
		const win: WindowSummary = {
			id: "@1",
			name: "editor",
			index: 0,
			active: true,
			paneCount: 2,
			activePaneID: "%1",
			activePaneTitle: "bash",
			attentionState: "attention",
			attentionCount: 1,
			semanticEventType: "none",
			semanticEventCount: 0,
		};

		render(
			<WindowTabs
				windows={[win]}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		const tab = screen.getByTestId("window-tab-active");
		expect(tab).toHaveClass("is-attention");
		expect(tab).not.toHaveClass("is-attention-explicit");
	});

	test("window with attention state and count shows attention badge", () => {
		const win: WindowSummary = {
			id: "@1",
			name: "editor",
			index: 0,
			active: true,
			paneCount: 2,
			activePaneID: "%1",
			activePaneTitle: "bash",
			attentionState: "attention",
			attentionCount: 1,
			semanticEventType: "none",
			semanticEventCount: 0,
		};

		render(
			<WindowTabs
				windows={[win]}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		const badge = document.querySelector(".attention-badge");
		expect(badge).toBeInTheDocument();
		expect(badge?.textContent).toBe("1");
	});

	test("window with explicit state gets is-attention-explicit class", () => {
		const win: WindowSummary = {
			id: "@1",
			name: "editor",
			index: 0,
			active: true,
			paneCount: 2,
			activePaneID: "%1",
			activePaneTitle: "bash",
			attentionState: "explicit",
			attentionCount: 2,
			semanticEventType: "none",
			semanticEventCount: 0,
		};

		render(
			<WindowTabs
				windows={[win]}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		const tab = screen.getByTestId("window-tab-active");
		expect(tab).toHaveClass("is-attention-explicit");
		const badge = document.querySelector(".attention-badge");
		expect(badge).toBeInTheDocument();
		expect(badge?.textContent).toBe("2");
	});

	test("window with no attention state shows no attention badge", () => {
		const win: WindowSummary = {
			id: "@1",
			name: "editor",
			index: 0,
			active: true,
			paneCount: 2,
			activePaneID: "%1",
			activePaneTitle: "bash",
			semanticEventType: "none",
			semanticEventCount: 0,
		};

		render(
			<WindowTabs
				windows={[win]}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		expect(document.querySelector(".attention-badge")).toBeNull();
	});
});

describe("semantic indicator rendering", () => {
	test("window with semanticEventType shows AI badge", () => {
		const win: WindowSummary = {
			id: "@1",
			name: "editor",
			index: 0,
			active: true,
			paneCount: 2,
			activePaneID: "%1",
			activePaneTitle: "bash",
			semanticEventType: "choice_required",
			semanticEventCount: 2,
		};

		render(
			<WindowTabs
				windows={[win]}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		const badge = document.querySelector(".semantic-badge");
		expect(badge).toBeInTheDocument();
		expect(badge?.textContent).toContain("AI");
		expect(badge?.textContent).toContain("2");
	});

	test("window with semanticEventType none shows no badge", () => {
		const win: WindowSummary = {
			id: "@1",
			name: "editor",
			index: 0,
			active: true,
			paneCount: 2,
			activePaneID: "%1",
			activePaneTitle: "bash",
			semanticEventType: "none",
			semanticEventCount: 0,
		};

		render(
			<WindowTabs
				windows={[win]}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		expect(document.querySelector(".semantic-badge")).toBeNull();
	});

	test("window with zero semanticEventCount shows no badge", () => {
		const win: WindowSummary = {
			id: "@1",
			name: "editor",
			index: 0,
			active: true,
			paneCount: 2,
			activePaneID: "%1",
			activePaneTitle: "bash",
			semanticEventType: "user_response_required",
			semanticEventCount: 0,
		};

		render(
			<WindowTabs
				windows={[win]}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		expect(document.querySelector(".semantic-badge")).toBeNull();
	});
});
