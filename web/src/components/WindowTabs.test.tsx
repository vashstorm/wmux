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
	},
	{
		id: "@2",
		name: "server",
		index: 1,
		active: false,
		paneCount: 1,
		activePaneID: "%3",
		activePaneTitle: "node",
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
		expect(screen.queryByText("bash")).not.toBeInTheDocument();
		expect(screen.queryByText("node")).not.toBeInTheDocument();
		expect(screen.queryByText(/·/)).not.toBeInTheDocument();
	});

	test("does not render pane count badges after the app name", () => {
		render(
			<WindowTabs
				windows={mockWindows}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		expect(document.querySelector(".window-tab-badge")).toBeNull();
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

	test("does not render active pane title in the tab label", () => {
		render(
			<WindowTabs
				windows={mockWindows}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		expect(screen.queryByText("bash")).not.toBeInTheDocument();
		expect(screen.queryByText("node")).not.toBeInTheDocument();
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

	test("uses the computed app label for the tab title attribute", () => {
		const windowsWithLongTitle: WindowSummary[] = [
			{
				id: "@1",
				name: "editor",
				index: 0,
				active: true,
				paneCount: 1,
				activePaneID: "%1",
				activePaneTitle: "very-long-title-that-might-overflow",
				intelligenceApp: "claude",
			},
		];

		render(
			<WindowTabs
				windows={windowsWithLongTitle}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		expect(screen.getByTestId("window-tab-active")).toHaveAttribute("title", "claude");
	});

	test("prefers the primary AI app over zsh in the tab name", () => {
		const windowsWithApps: WindowSummary[] = [
			{
				id: "@1",
				name: "editor",
				index: 0,
				active: true,
				paneCount: 2,
				activePaneID: "%1",
				activePaneTitle: "bash",
				intelligenceApp: "claude",
				intelligenceAppCounts: {
					claude: 1,
					zsh: 1,
				},
			},
		];

		render(
			<WindowTabs
				windows={windowsWithApps}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		expect(screen.getByText("claude")).toBeInTheDocument();
		expect(screen.queryByText("editor")).not.toBeInTheDocument();
	});

	test("shows AI CLI when a window contains multiple AI apps", () => {
		const windowsWithApps: WindowSummary[] = [
			{
				id: "@1",
				name: "editor",
				index: 0,
				active: true,
				paneCount: 2,
				activePaneID: "%1",
				activePaneTitle: "bash",
				intelligenceApp: "claude",
				intelligenceAppCounts: {
					claude: 1,
					opencode: 1,
				},
			},
		];

		render(
			<WindowTabs
				windows={windowsWithApps}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		expect(screen.getByText("AI CLI")).toBeInTheDocument();
		expect(screen.queryByText("claude")).not.toBeInTheDocument();
	});

	test("prefers loaded pane intelligence app over raw window name", () => {
		const windowsWithRawName: WindowSummary[] = [
			{
				id: "@1",
				name: "ocx[omo]:wmux/main",
				index: 0,
				active: true,
				paneCount: 1,
				activePaneID: "%1",
				activePaneTitle: "OpenCode",
			},
		];

		render(
			<WindowTabs
				windows={windowsWithRawName}
				loadedPanesByWindow={{
					"@1": [{
						id: "%1",
						title: "OpenCode",
						index: 0,
						active: true,
						width: 80,
						height: 24,
						left: 0,
						top: 0,
						intelligenceApp: "opencode",
					}],
				}}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		expect(screen.getByText("opencode")).toBeInTheDocument();
		expect(screen.queryByText("ocx[omo]:wmux/main")).not.toBeInTheDocument();
		expect(screen.queryByText("OpenCode")).not.toBeInTheDocument();
	});

	test("keeps per-window labels when there is no window-level app data", () => {
		const windowsWithRawName: WindowSummary[] = [
			{
				id: "@1",
				name: "ocx[omo]:wmux/main",
				index: 0,
				active: true,
				paneCount: 1,
				activePaneID: "%1",
				activePaneTitle: "OpenCode",
			},
			{
				id: "@2",
				name: "make",
				index: 1,
				active: false,
				paneCount: 1,
				activePaneID: "%2",
				activePaneTitle: "zsh",
			},
		];

		render(
			<WindowTabs
				windows={windowsWithRawName}
				selectedWindowId="@1"
				onSelectWindow={() => {}}
			/>,
		);

		expect(screen.getByText("ocx[omo]:wmux/main")).toBeInTheDocument();
		expect(screen.getByText("zsh")).toBeInTheDocument();
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
