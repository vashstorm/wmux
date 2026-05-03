import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MainPanel } from "./MainPanel.js";
import { listPanes, listWindows } from "../api/client.js";
import { useAppState } from "../state/store.js";
import type { PaneData, SelectedPane, WindowSummary } from "../state/store.js";
import type { PaneInfo, WindowInfo } from "../api/client.js";

vi.mock("./WindowTabs.js", () => ({
	WindowTabs: vi.fn(({
		windows,
		selectedWindowId,
		onSelectWindow,
	}: {
		windows: WindowSummary[];
		selectedWindowId: string | null;
		onSelectWindow: (windowId: string, activePaneId: string) => void;
	}) => (
		<div data-testid="mock-window-tabs" data-selected-window={selectedWindowId ?? ""}>
			{windows.map((window) => (
				<button
					key={window.id}
					type="button"
					onClick={() => onSelectWindow(window.id, window.activePaneID)}
				>
					{window.name}
				</button>
			))}
		</div>
	)),
}));

vi.mock("./PaneCanvas.js", () => ({
	PaneCanvas: vi.fn(({
		panes,
		selectedPaneId,
	}: {
		panes: PaneData[];
		selectedPaneId: string | null;
	}) => (
		<div data-testid="mock-pane-canvas" data-selected-pane={selectedPaneId ?? ""}>
			{panes.map((pane) => pane.title).join(",")}
		</div>
	)),
}));

vi.mock("../api/client.js", () => ({
	listPanes: vi.fn(),
	listWindows: vi.fn(),
}));

vi.mock("../state/store.js", () => ({
	useAppState: vi.fn(),
}));

const selectedPane: SelectedPane = {
	connectionId: "conn-1",
	session: "dev",
	window: "@1",
	pane: "%1",
};

const windowOne: WindowSummary = {
	id: "@1",
	name: "editor",
	index: 0,
	active: true,
	paneCount: 1,
	activePaneID: "%1",
	activePaneTitle: "bash",
};

const windowTwo: WindowSummary = {
	id: "@2",
	name: "server",
	index: 1,
	active: false,
	paneCount: 1,
	activePaneID: "%3",
	activePaneTitle: "node",
};

const activeWindowTwo: WindowInfo = {
	ID: "@2",
	Name: "server",
	Index: 1,
	Active: true,
	PaneCount: 1,
	ActivePaneID: "%3",
	ActivePaneTitle: "node",
};

const activePaneThree: PaneInfo = {
	ID: "%3",
	Title: "node",
	Index: 0,
	Active: true,
	Width: 80,
	Height: 24,
	Left: 0,
	Top: 0,
};

describe("MainPanel", () => {
	const setSelectedPane = vi.fn();
	const setWindows = vi.fn();
	const setPanes = vi.fn();
	const setError = vi.fn();

	beforeEach(() => {
		vi.useFakeTimers();
		setSelectedPane.mockClear();
		setWindows.mockClear();
		setPanes.mockClear();
		setError.mockClear();
		vi.mocked(listWindows).mockReset();
		vi.mocked(listPanes).mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	test("syncs the selected window tab when tmux active window changes", async () => {
		vi.mocked(useAppState).mockReturnValue({
			selectedPane,
			windows: {
				"conn-1:dev": {
					windows: [windowOne, windowTwo],
					loadedPanes: {
						"@1": [{
							id: "%1",
							title: "bash",
							index: 0,
							active: true,
							width: 80,
							height: 24,
							left: 0,
							top: 0,
						}],
					},
					panesLoaded: true,
				},
			},
			setSelectedPane,
			setWindows,
			setPanes,
			setError,
			uiSettings: {
				theme: "dark",
				windowTheme: "dark",
				fontSize: 16,
				terminalFontSize: 14,
				terminalFontWeight: "normal",
			},
		} as unknown as ReturnType<typeof useAppState>);

		vi.mocked(listWindows).mockResolvedValue({
			connectionId: "conn-1",
			session: "dev",
			mode: "local",
			data: [
				{
					...activeWindowTwo,
					ID: "@1",
					Name: "editor",
					Index: 0,
					Active: false,
					ActivePaneID: "%1",
					ActivePaneTitle: "bash",
				},
				activeWindowTwo,
			],
		});
		vi.mocked(listPanes).mockResolvedValue({
			connectionId: "conn-1",
			session: "dev",
			window: "@2",
			mode: "local",
			data: [activePaneThree],
		});

		render(<MainPanel />);

		expect(screen.getByTestId("mock-window-tabs")).toHaveAttribute("data-selected-window", "@1");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(listWindows).toHaveBeenCalledWith("conn-1", "dev");
		expect(setWindows).toHaveBeenCalledWith("conn-1", "dev", expect.arrayContaining([activeWindowTwo]));
		expect(listPanes).toHaveBeenCalledWith("conn-1", "dev", "@2");
		expect(setPanes).toHaveBeenCalledWith("conn-1", "dev", "@2", [activePaneThree]);
		expect(setSelectedPane).toHaveBeenCalledWith({
			connectionId: "conn-1",
			session: "dev",
			window: "@2",
			pane: "%3",
		});
	});
});
