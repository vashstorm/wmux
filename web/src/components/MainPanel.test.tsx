import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
	targetName: "conn-1",
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

	const expectTitleSegments = (expected: {
		summary: string;
	}) => {
		expect(screen.queryByTestId("main-title-session")).not.toBeInTheDocument();
		expect(screen.queryByTestId("main-title-app")).not.toBeInTheDocument();
		expect(screen.getByTestId("main-title-summary").textContent).toBe(expected.summary);
	};

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

	test("keeps the selected window when tmux active window changes externally", async () => {
		vi.mocked(useAppState).mockReturnValue({
			selectedPane,
			selectedAiEvent: null,
			selectedProject: null,
			sessions: {
				"conn-1": [{ name: "dev", intelligenceApp: "claude", intelligenceSummary: "Waiting for input" }],
			},
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
			setSelectedAiEvent: vi.fn(),
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
			targetName: "conn-1",
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
			targetName: "conn-1",
			session: "dev",
			window: "@1",
			mode: "local",
			data: [{
				ID: "%1",
				Title: "bash",
				Index: 0,
				Active: true,
				Width: 80,
				Height: 24,
				Left: 0,
				Top: 0,
			}],
		});

		render(<MainPanel />);

		expect(screen.getByTestId("mock-window-tabs")).toHaveAttribute("data-selected-window", "@1");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(listWindows).toHaveBeenCalledWith("conn-1", "dev");
		expect(setWindows).toHaveBeenCalledWith("conn-1", "dev", expect.arrayContaining([activeWindowTwo]));
		expect(listPanes).toHaveBeenCalledWith("conn-1", "dev", "@1");
		expect(setPanes).toHaveBeenCalledWith("conn-1", "dev", "@1", [expect.objectContaining({ ID: "%1" })]);
		expect(setSelectedPane).not.toHaveBeenCalled();
	});

	test("keeps the selected pane when tmux active pane changes externally", async () => {
		vi.mocked(useAppState).mockReturnValue({
			selectedPane: {
				...selectedPane,
				pane: "%1",
			},
			selectedAiEvent: null,
			selectedProject: null,
			sessions: {
				"conn-1": [{ name: "dev", intelligenceApp: "claude", intelligenceSummary: "Waiting for input" }],
			},
			windows: {
				"conn-1:dev": {
					windows: [windowOne],
					loadedPanes: {
						"@1": [{
							id: "%1",
							title: "bash",
							index: 0,
							active: false,
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
			setSelectedAiEvent: vi.fn(),
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
			targetName: "conn-1",
			session: "dev",
			mode: "local",
			data: [{
				ID: "@1",
				Name: "editor",
				Index: 0,
				Active: true,
				PaneCount: 2,
				ActivePaneID: "%2",
				ActivePaneTitle: "vim",
			}],
		});
		vi.mocked(listPanes).mockResolvedValue({
			targetName: "conn-1",
			session: "dev",
			window: "@1",
			mode: "local",
			data: [
				{
					ID: "%1",
					Title: "bash",
					Index: 0,
					Active: false,
					Width: 80,
					Height: 24,
					Left: 0,
					Top: 0,
				},
				{
					ID: "%2",
					Title: "vim",
					Index: 1,
					Active: true,
					Width: 80,
					Height: 24,
					Left: 80,
					Top: 0,
				},
			],
		});

		render(<MainPanel />);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(setPanes).toHaveBeenCalledWith("conn-1", "dev", "@1", expect.arrayContaining([
			expect.objectContaining({ ID: "%2", Active: true }),
		]));
		expect(setSelectedPane).not.toHaveBeenCalled();
	});

	test("renders title as summary without session or app name", () => {
		vi.mocked(useAppState).mockReturnValue({
			selectedPane,
			selectedAiEvent: null,
			selectedProject: null,
			sessions: {
				"conn-1": [{ name: "dev", intelligenceApp: "claude", intelligenceSummary: "Session fallback" }],
			},
			windows: {
				"conn-1:dev": {
					windows: [{
						...windowOne,
						intelligenceApp: "copilot",
						intelligenceSummary: "Window summary",
					}],
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
							intelligenceApp: "cursor",
							intelligenceSummary: "Pane summary",
						}],
					},
					panesLoaded: true,
				},
			},
			setSelectedPane,
			setSelectedAiEvent: vi.fn(),
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

		render(<MainPanel />);

		expectTitleSegments({
			summary: "Window summary",
		});
	});

	test("renders the status segment without truncation", () => {
		vi.mocked(useAppState).mockReturnValue({
			selectedPane,
			selectedAiEvent: null,
			selectedProject: null,
			sessions: {
				"conn-1": [{ name: "dev", intelligenceApp: "claude", intelligenceSummary: "Session fallback" }],
			},
			windows: {
				"conn-1:dev": {
					windows: [{
						...windowOne,
						intelligenceStatus: "running",
						intelligenceSummary: "Window summary",
					}],
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
							intelligenceStatus: "running",
							intelligenceSummary: "Pane summary",
						}],
					},
					panesLoaded: true,
				},
			},
			setSelectedPane,
			setSelectedAiEvent: vi.fn(),
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

		render(<MainPanel />);

		expect(screen.getByTestId("main-title-status").textContent).toBe("running");
		expect(screen.getByTestId("main-title-summary").textContent).toBe("Window summary");
	});

	test("updates title when selected window changes", () => {
		const mockState = {
			selectedPane,
			selectedAiEvent: null,
			selectedProject: null,
			sessions: {
				"conn-1": [{ name: "dev", intelligenceApp: "claude", intelligenceSummary: "Session fallback" }],
			},
			windows: {
				"conn-1:dev": {
					windows: [
						{
							...windowOne,
							intelligenceApp: "editor-app",
							intelligenceSummary: "Editing files",
						},
						{
							...windowTwo,
							intelligenceApp: "server-app",
							intelligenceSummary: "Server running",
						},
					],
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
						"@2": [{
							id: "%3",
							title: "node",
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
			setSelectedAiEvent: vi.fn(),
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
		} as unknown as ReturnType<typeof useAppState>;

		vi.mocked(useAppState).mockImplementation(() => mockState);

		const { rerender } = render(<MainPanel />);

		expectTitleSegments({
			summary: "Editing files",
		});

		(mockState as { selectedPane: SelectedPane }).selectedPane = {
			...selectedPane,
			window: "@2",
			pane: "%3",
		};

		rerender(<MainPanel />);

		expectTitleSegments({
			summary: "Server running",
		});
	});

	test("switches title immediately when clicking a window tab before panes finish loading", async () => {
		let currentSelectedPane: SelectedPane = selectedPane;
		const pendingListPanes = new Promise<never>(() => {});
		const setSelectedPaneState = vi.fn((nextPane: SelectedPane | null) => {
			if (nextPane) {
				currentSelectedPane = nextPane;
			}
		});

		vi.mocked(listPanes).mockReturnValue(pendingListPanes);
		vi.mocked(useAppState).mockImplementation(() => ({
			selectedPane: currentSelectedPane,
			selectedAiEvent: null,
			selectedProject: null,
			sessions: {
				"conn-1": [{ name: "dev", intelligenceApp: "claude", intelligenceSummary: "Session fallback" }],
			},
			windows: {
				"conn-1:dev": {
					windows: [
						{
							...windowOne,
							intelligenceApp: "editor-app",
							intelligenceSummary: "Editing files",
						},
						{
							...windowTwo,
							intelligenceApp: "server-app",
							intelligenceSummary: "Server running",
						},
					],
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
			setSelectedPane: setSelectedPaneState,
			setSelectedAiEvent: vi.fn(),
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
		}) as unknown as ReturnType<typeof useAppState>);

		const { rerender } = render(<MainPanel />);

		expectTitleSegments({
			summary: "Editing files",
		});

		fireEvent.click(screen.getByText("server"));

		expect(setSelectedPaneState).toHaveBeenCalledWith({
			targetName: "conn-1",
			session: "dev",
			window: "@2",
			pane: "%3",
		});

		rerender(<MainPanel />);

		expectTitleSegments({
			summary: "Server running",
		});
	});

	test("falls back to window name and pane title when current window has no intelligence metadata", () => {
		vi.mocked(useAppState).mockReturnValue({
			selectedPane: {
				targetName: "conn-1",
				session: "wmux",
				window: "@2",
				pane: "%3",
			},
			selectedAiEvent: null,
			selectedProject: null,
			sessions: {
				"conn-1": [{ name: "wmux", intelligenceApp: "opencode", intelligenceSummary: "OpenCode CLI 已启动" }],
			},
			windows: {
				"conn-1:wmux": {
					windows: [
						windowOne,
						{
							...windowTwo,
							name: "make",
							activePaneTitle: "bun install",
						},
					],
					loadedPanes: {
						"@2": [{
							id: "%3",
							title: "bun install",
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
			setSelectedAiEvent: vi.fn(),
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

		render(<MainPanel />);

		expectTitleSegments({
			summary: "bun install",
		});
	});

	test("hides title segments when no summary data is available", () => {
		vi.mocked(useAppState).mockReturnValue({
			selectedPane: {
				targetName: "conn-1",
				session: "solo",
			},
			selectedAiEvent: null,
			selectedProject: null,
			sessions: {
				"conn-1": [{ name: "solo" }],
			},
			windows: {},
			setSelectedPane,
			setSelectedAiEvent: vi.fn(),
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

		render(<MainPanel />);

		expect(screen.queryByTestId("main-title-session")).not.toBeInTheDocument();
		expect(screen.queryByTestId("main-title-app")).not.toBeInTheDocument();
		expect(screen.queryByTestId("main-title-summary")).not.toBeInTheDocument();
		expect(screen.queryByText("Wmux")).not.toBeInTheDocument();
	});

	test("renders ProjectDashboard when selectedProject is active", () => {
		const mockProject = {
			id: "proj-1",
			name: "My Project",
			path: "/path/to/project",
			status: "idle",
			sessionName: "my-session",
			workdir: "/path/to/project",
			description: "A test project",
			createdAt: "2026-05-22T10:00:00Z",
			updatedAt: "2026-05-22T10:00:00Z",
			lastSyncedAt: null,
			aiHtml: null,
			aiStatus: null,
			aiError: null,
			layoutJson: null,
			detailsJson: null,
			progressJson: null,
			schemaVersion: null,
		};

		vi.mocked(useAppState).mockReturnValue({
			selectedPane: null,
			selectedAiEvent: null,
			selectedProject: mockProject,
			setSelectedAiEvent: vi.fn(),
			sessions: {},
			windows: {},
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

		render(<MainPanel />);

		expect(screen.getByTestId("project-dashboard")).toBeInTheDocument();
		expect(screen.getByTestId("project-dashboard-title").textContent).toBe("My Project");
		expect(screen.queryByTestId("project-launch-button")).not.toBeInTheDocument();
		expect(screen.getByTestId("project-sync-button")).toBeInTheDocument();
		expect(screen.getByTestId("project-ai-generate-button")).toBeInTheDocument();
	});
});
