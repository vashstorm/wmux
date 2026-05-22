import { beforeEach, describe, test, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState, useCallback } from "react";
import { AppProvider, UI_SETTINGS_STORAGE_KEY, useAppState, useSelectedConnection, type SessionWindowState } from "./store.js";

beforeEach(() => {
	localStorage.removeItem(UI_SETTINGS_STORAGE_KEY);
});

describe("AppProvider", () => {
	test("initializes UI settings from the last saved theme", () => {
		localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify({ theme: "light", windowTheme: "light" }));

		function ThemeProbe() {
			const { uiSettings } = useAppState();
			return <span data-testid="theme">{uiSettings.theme}:{uiSettings.windowTheme}</span>;
		}

		render(
			<AppProvider>
				<ThemeProbe />
			</AppProvider>,
		);

		expect(screen.getByTestId("theme").textContent).toBe("light:light");
	});

	test("persists UI settings updates for the next refresh", () => {
		function ThemeWriter() {
			const { setUISettings } = useAppState();
			return (
				<button
					data-testid="set-theme"
					onClick={() => setUISettings({
						theme: "light",
						windowTheme: "light",
						uiScaleStep: 2,
						terminalFontSize: 15,
						terminalFontWeight: "bold",
					})}
				>
					Set Theme
				</button>
			);
		}

		render(
			<AppProvider>
				<ThemeWriter />
			</AppProvider>,
		);

		fireEvent.click(screen.getByTestId("set-theme"));

		expect(JSON.parse(localStorage.getItem(UI_SETTINGS_STORAGE_KEY) ?? "{}")).toEqual({
			theme: "light",
			windowTheme: "light",
			uiScaleStep: 2,
			terminalFontSize: 15,
			terminalFontWeight: "bold",
		});
	});

	test("renders children", () => {
		render(
			<AppProvider>
				<div data-testid="child">Child</div>
			</AppProvider>,
		);
		expect(screen.getByTestId("child")).toBeInTheDocument();
	});
});

describe("useAppState", () => {
	function TestComponent() {
		const state = useAppState();
		return (
			<div>
				<span data-testid="connections-count">{state.connections.length}</span>
				<span data-testid="selected-id">{state.selectedTargetName ?? "null"}</span>
				<span data-testid="loading-connections">{state.loading.connections ? "true" : "false"}</span>
				<span data-testid="error">{state.error ? `${state.error.code}:${state.error.message}` : "null"}</span>
				<span data-testid="show-form">{state.showNewConnectionForm ? "true" : "false"}</span>
				<span data-testid="show-settings">{state.showSettingsPanel ? "true" : "false"}</span>
				<button
					data-testid="set-connections"
					onClick={() => state.setConnections([{ targetName: "1", type: "local" }])}
				>
					Set Connections
				</button>
				<button
					data-testid="set-selected"
					onClick={() => state.setSelectedTargetName("1")}
				>
					Select
				</button>
				<button data-testid="set-loading" onClick={() => state.setLoading("connections", true)}>
					Set Loading
				</button>
				<button data-testid="set-error" onClick={() => state.setError({ code: "test", message: "error" })}>
					Set Error
				</button>
				<button data-testid="toggle-form" onClick={() => state.setShowNewConnectionForm(true)}>
					Show Form
				</button>
				<button data-testid="toggle-settings" onClick={() => state.setShowSettingsPanel(true)}>
					Show Settings
				</button>
				<button
					data-testid="set-sessions"
					onClick={() => state.setSessions("1", [{ name: "session1" }])}
				>
					Set Sessions
				</button>
				<button
					data-testid="set-windows"
					onClick={() => state.setWindows("1", "session1", [{ ID: "@1", Name: "editor", Index: 0, Active: true, PaneCount: 2, ActivePaneID: "%1", ActivePaneTitle: "bash" }])}
				>
					Set Windows
				</button>
				<button
					data-testid="set-panes"
					onClick={() => state.setPanes("1", "session1", "@1", [{ ID: "%1", Title: "bash", Index: 0, Active: true, Width: 80, Height: 24, Left: 0, Top: 0 }, { ID: "%2", Title: "node", Index: 1, Active: false, Width: 80, Height: 24, Left: 0, Top: 25 }])}
				>
					Set Panes
				</button>
				<button
					data-testid="set-panes-external-resize"
					onClick={() => state.setPanes("1", "session1", "@1", [{ ID: "%1", Title: "bash", Index: 0, Active: false, Width: 120, Height: 40, Left: 10, Top: 3 }, { ID: "%2", Title: "node", Index: 1, Active: true, Width: 120, Height: 40, Left: 10, Top: 44 }])}
				>
					Set Panes External Resize
				</button>
				<button data-testid="set-pane" onClick={() => state.setSelectedPane({ targetName: "1", session: "s1", window: "w1", pane: "p1" })}>
					Set Pane
				</button>
				<button
					data-testid="set-health"
					onClick={() => state.setConnectionHealth({ "1": { targetName: "1", status: "online", checkedAt: "2024-01-01T00:00:00Z" } })}
				>
					Set Health
				</button>
				<button
					data-testid="show-confirm"
				onClick={() =>
					state.showConfirm({
							title: "Confirm",
							message: "Are you sure?",
							confirmText: "Yes",
							confirmVariant: "danger",
							onConfirm: () => {},
						})
					}
				>
					Show Confirm
				</button>
				<span data-testid="confirm-title">{state.confirmDialog?.title ?? "null"}</span>
				<span data-testid="selected-pane">
					{state.selectedPane ? `${state.selectedPane.targetName}:${state.selectedPane.pane}` : "null"}
				</span>
				<span data-testid="health-status">{state.connectionHealth["1"]?.status ?? "null"}</span>
				<span data-testid="editing">{state.editingConnection?.type ?? "null"}</span>
				<span data-testid="sessions-count">{(state.sessions["1"] ?? []).length}</span>
				<button
					data-testid="set-editing"
					onClick={() => state.setEditingConnection({ targetName: "1", type: "local" })}
				>
					Set Editing
				</button>
				<span data-testid="windows-count">
					{(() => {
						const sessionState = state.windows["1:session1"];
						return sessionState ? String(sessionState.windows.length) : "null";
					})()}
				</span>
				<span data-testid="windows-pane-count">
					{(() => {
						const sessionState = state.windows["1:session1"];
						const first = sessionState?.windows[0];
						return first ? String(first.paneCount) : "null";
					})()}
				</span>
				<span data-testid="panes-loaded-count">
					{(() => {
						const sessionState = state.windows["1:session1"];
						return sessionState?.panesLoaded ? String(Object.keys(sessionState.loadedPanes).length) : "null";
					})()}
				</span>
				<span data-testid="pane-geometry">
					{(() => {
						const sessionState = state.windows["1:session1"];
						const first = sessionState?.loadedPanes["@1"]?.[0];
						return first ? `${first.left},${first.top}` : "null";
					})()}
				</span>
				<span data-testid="pane-size">
					{(() => {
						const sessionState = state.windows["1:session1"];
						const first = sessionState?.loadedPanes["@1"]?.[0];
						return first ? `${first.width}x${first.height}` : "null";
					})()}
				</span>
				<span data-testid="pane-source-size">
					{(() => {
						const sessionState = state.windows["1:session1"];
						const first = sessionState?.loadedPanes["@1"]?.[0];
						return first ? `${first.sourceCols}x${first.sourceRows}` : "null";
					})()}
				</span>
				<span data-testid="pane-active">
					{(() => {
						const sessionState = state.windows["1:session1"];
						const second = sessionState?.loadedPanes["@1"]?.[1];
						return second?.active ? "true" : "false";
					})()}
				</span>
			</div>
		);
	}

	function renderWithProvider() {
		return render(
			<AppProvider>
				<TestComponent />
			</AppProvider>,
		);
	}

	test("default state values", () => {
		renderWithProvider();
		expect(screen.getByTestId("connections-count").textContent).toBe("0");
		expect(screen.getByTestId("selected-id").textContent).toBe("null");
		expect(screen.getByTestId("loading-connections").textContent).toBe("false");
		expect(screen.getByTestId("error").textContent).toBe("null");
		expect(screen.getByTestId("show-form").textContent).toBe("false");
		expect(screen.getByTestId("show-settings").textContent).toBe("false");
	});

	test("setConnections updates connections", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-connections"));
		expect(screen.getByTestId("connections-count").textContent).toBe("1");
	});

	test("setSelectedTargetName updates selection", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-selected"));
		expect(screen.getByTestId("selected-id").textContent).toBe("1");
	});

	test("setLoading updates loading state", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-loading"));
		expect(screen.getByTestId("loading-connections").textContent).toBe("true");
	});

	test("setError updates error", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-error"));
		expect(screen.getByTestId("error").textContent).toBe("test:error");
	});

	test("setShowNewConnectionForm toggles form", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("toggle-form"));
		expect(screen.getByTestId("show-form").textContent).toBe("true");
	});

	test("setShowSettingsPanel toggles panel", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("toggle-settings"));
		expect(screen.getByTestId("show-settings").textContent).toBe("true");
	});

	test("setSessions stores keyed sessions", () => {
		renderWithProvider();
		expect(screen.getByTestId("sessions-count").textContent).toBe("0");
		fireEvent.click(screen.getByTestId("set-sessions"));
		expect(screen.getByTestId("sessions-count").textContent).toBe("1");
	});

	test("setSelectedPane updates pane", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-pane"));
		expect(screen.getByTestId("selected-pane").textContent).toBe("1:p1");
	});

	test("setConnectionHealth updates health", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-health"));
		expect(screen.getByTestId("health-status").textContent).toBe("online");
	});

	test("showConfirm sets dialog", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("show-confirm"));
		expect(screen.getByTestId("confirm-title").textContent).toBe("Confirm");
	});

	test("setEditingConnection updates editing", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-editing"));
		expect(screen.getByTestId("editing").textContent).toBe("local");
	});

	test("setWindows stores session windows with metadata", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-windows"));
		expect(screen.getByTestId("windows-count").textContent).toBe("1");
		expect(screen.getByTestId("windows-pane-count").textContent).toBe("2");
	});

	test("setPanes stores pane geometry with stable IDs", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-windows"));
		fireEvent.click(screen.getByTestId("set-panes"));
		expect(screen.getByTestId("panes-loaded-count").textContent).toBe("1");
		expect(screen.getByTestId("pane-geometry").textContent).toBe("0,0");
	});

	test("setPanes preserves wmux geometry when external tmux resize reports the same panes", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-windows"));
		fireEvent.click(screen.getByTestId("set-panes"));
		fireEvent.click(screen.getByTestId("set-panes-external-resize"));
		expect(screen.getByTestId("pane-geometry").textContent).toBe("0,0");
		expect(screen.getByTestId("pane-size").textContent).toBe("80x24");
		expect(screen.getByTestId("pane-source-size").textContent).toBe("120x40");
		expect(screen.getByTestId("pane-active").textContent).toBe("true");
	});

	test("setWindows preserves pane geometry when called again", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-windows"));
		fireEvent.click(screen.getByTestId("set-panes"));
		expect(screen.getByTestId("panes-loaded-count").textContent).toBe("1");
		fireEvent.click(screen.getByTestId("set-windows"));
		expect(screen.getByTestId("panes-loaded-count").textContent).toBe("1");
		expect(screen.getByTestId("windows-count").textContent).toBe("1");
	});

	test("selectedPane holds stable window and pane IDs", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-pane"));
		expect(screen.getByTestId("selected-pane").textContent).toBe("1:p1");
	});
});

describe("useSelectedConnection", () => {
	function TestComponent() {
		const selected = useSelectedConnection();
		return <span data-testid="selected-name">{selected?.type ?? "null"}</span>;
	}

	function renderWithProvider() {
		return render(
			<AppProvider>
				<TestComponent />
			</AppProvider>,
		);
	}

	test("returns null when no selection", () => {
		renderWithProvider();
		expect(screen.getByTestId("selected-name").textContent).toBe("null");
	});
});

describe("attention field mapping", () => {
	function TestAttentionComponent() {
		const state = useAppState();
		return (
			<div>
				<button
					data-testid="set-windows-attention"
					onClick={() => state.setWindows("1", "session1", [{ ID: "@1", Name: "editor", Index: 0, Active: true, PaneCount: 1, ActivePaneID: "%1", ActivePaneTitle: "bash", AttentionState: "attention", AttentionCount: 2 }])}
				>
					Set Windows Attention
				</button>
				<button
					data-testid="set-windows-explicit"
					onClick={() => state.setWindows("1", "session1", [{ ID: "@1", Name: "editor", Index: 0, Active: true, PaneCount: 1, ActivePaneID: "%1", ActivePaneTitle: "bash", AttentionState: "explicit", AttentionCount: 1 }])}
				>
					Set Windows Explicit
				</button>
				<button
					data-testid="set-panes-attention"
					onClick={() => state.setPanes("1", "session1", "@1", [{ ID: "%1", Title: "vim", Index: 0, Active: true, Width: 80, Height: 24, Left: 0, Top: 0, AttentionState: "attention" }])}
				>
					Set Panes Attention
				</button>
				<button
					data-testid="set-panes-explicit"
					onClick={() => state.setPanes("1", "session1", "@1", [{ ID: "%1", Title: "bash", Index: 0, Active: true, Width: 80, Height: 24, Left: 0, Top: 0, AttentionState: "explicit" }])}
				>
					Set Panes Explicit
				</button>
				<span data-testid="window-attention-state">
					{state.windows["1:session1"]?.windows[0]?.attentionState ?? "null"}
				</span>
				<span data-testid="window-attention-count">
					{state.windows["1:session1"]?.windows[0]?.attentionCount ?? "null"}
				</span>
				<span data-testid="pane-attention-state">
					{state.windows["1:session1"]?.loadedPanes["@1"]?.[0]?.attentionState ?? "null"}
				</span>
			</div>
		);
	}

	function renderWithProvider() {
		return render(
			<AppProvider>
				<TestAttentionComponent />
			</AppProvider>,
		);
	}

	test("setWindows maps AttentionState attention to window summary", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-windows-attention"));
		expect(screen.getByTestId("window-attention-state").textContent).toBe("attention");
	});

	test("setWindows maps AttentionCount to window summary", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-windows-attention"));
		expect(screen.getByTestId("window-attention-count").textContent).toBe("2");
	});

	test("setWindows maps AttentionState explicit to window summary", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-windows-explicit"));
		expect(screen.getByTestId("window-attention-state").textContent).toBe("explicit");
	});

	test("setPanes maps AttentionState attention to pane data", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-windows-attention"));
		fireEvent.click(screen.getByTestId("set-panes-attention"));
		expect(screen.getByTestId("pane-attention-state").textContent).toBe("attention");
	});

	test("setPanes maps AttentionState explicit to pane data", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-windows-attention"));
		fireEvent.click(screen.getByTestId("set-panes-explicit"));
		expect(screen.getByTestId("pane-attention-state").textContent).toBe("explicit");
	});
});

describe("updateSession", () => {
	function TestUpdateSessionComponent() {
		const state = useAppState();
		return (
			<div>
				<button
					data-testid="set-initial-sessions"
					onClick={() => state.setSessions("conn1", [
						{ name: "session1" },
						{ name: "session2" },
					])}
				>
					Set Initial Sessions
				</button>
				<button
					data-testid="update-session1"
					onClick={() => state.updateSession("conn1", "session1", {
						intelligenceApp: "claude",
						intelligenceStatus: "waiting",
						intelligenceSummary: "Waiting for input",
					})}
				>
					Update Session1
				</button>
				<span data-testid="session1-status">
					{state.sessions["conn1"]?.find(s => s.name === "session1")?.intelligenceStatus ?? "null"}
				</span>
				<span data-testid="sessions-count">
					{(state.sessions["conn1"] ?? []).length}
				</span>
			</div>
		);
	}

	function renderWithProvider() {
		return render(
			<AppProvider>
				<TestUpdateSessionComponent />
			</AppProvider>,
		);
	}

	test("updateSession updates only the target session", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-initial-sessions"));
		expect(screen.getByTestId("sessions-count").textContent).toBe("2");
		expect(screen.getByTestId("session1-status").textContent).toBe("null");

		fireEvent.click(screen.getByTestId("update-session1"));
		expect(screen.getByTestId("session1-status").textContent).toBe("waiting");
		expect(screen.getByTestId("sessions-count").textContent).toBe("2");
	});

	test("updateSession does not affect other connections", () => {
		function TestMultiConnectionComponent() {
			const state = useAppState();
			return (
				<div>
					<button
						data-testid="set-conn1-sessions"
						onClick={() => state.setSessions("conn1", [{ name: "s1" }])}
					>
						Set Conn1
					</button>
					<button
						data-testid="set-conn2-sessions"
						onClick={() => state.setSessions("conn2", [{ name: "s2" }])}
					>
						Set Conn2
					</button>
					<button
						data-testid="update-conn1"
						onClick={() => state.updateSession("conn1", "s1", { intelligenceStatus: "running" })}
					>
						Update Conn1
					</button>
					<span data-testid="conn1-status">
						{state.sessions["conn1"]?.[0]?.intelligenceStatus ?? "null"}
					</span>
				</div>
			);
		}

		render(
			<AppProvider>
				<TestMultiConnectionComponent />
			</AppProvider>,
		);

		fireEvent.click(screen.getByTestId("set-conn1-sessions"));
		fireEvent.click(screen.getByTestId("set-conn2-sessions"));
		fireEvent.click(screen.getByTestId("update-conn1"));

		expect(screen.getByTestId("conn1-status").textContent).toBe("running");
	});
});

describe("UISettings uiScaleStep", () => {
	test("uiScaleStep defaults to 0 when no localStorage", () => {
		function ScaleStepProbe() {
			const { uiSettings } = useAppState();
			return <span data-testid="scale-step">{uiSettings.uiScaleStep}</span>;
		}

		render(
			<AppProvider>
				<ScaleStepProbe />
			</AppProvider>,
		);

		expect(screen.getByTestId("scale-step").textContent).toBe("0");
	});

	test("reads uiScaleStep from localStorage", () => {
		localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify({
			theme: "dark",
			windowTheme: "dark",
			uiScaleStep: 2,
			terminalFontSize: 14,
			terminalFontWeight: "normal",
		}));

		function ScaleStepProbe() {
			const { uiSettings } = useAppState();
			return <span data-testid="scale-step">{uiSettings.uiScaleStep}</span>;
		}

		render(
			<AppProvider>
				<ScaleStepProbe />
			</AppProvider>,
		);

		expect(screen.getByTestId("scale-step").textContent).toBe("2");
	});

	test("migrates legacy fontSize to uiScaleStep: fontSize 18 maps to step 3", () => {
		localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify({
			theme: "dark",
			windowTheme: "dark",
			fontSize: 18,
			terminalFontSize: 14,
			terminalFontWeight: "normal",
		}));

		function ScaleStepProbe() {
			const { uiSettings } = useAppState();
			return <span data-testid="scale-step">{uiSettings.uiScaleStep}</span>;
		}

		render(
			<AppProvider>
				<ScaleStepProbe />
			</AppProvider>,
		);

		expect(screen.getByTestId("scale-step").textContent).toBe("3");
	});

	test("migrates legacy fontSize to uiScaleStep: fontSize 20 maps to step 4 (clamped)", () => {
		localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify({
			theme: "dark",
			windowTheme: "dark",
			fontSize: 20,
			terminalFontSize: 14,
			terminalFontWeight: "normal",
		}));

		function ScaleStepProbe() {
			const { uiSettings } = useAppState();
			return <span data-testid="scale-step">{uiSettings.uiScaleStep}</span>;
		}

		render(
			<AppProvider>
				<ScaleStepProbe />
			</AppProvider>,
		);

		expect(screen.getByTestId("scale-step").textContent).toBe("4");
	});

	test("migrates legacy fontSize to uiScaleStep: fontSize 16 maps to step 0", () => {
		localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify({
			theme: "dark",
			windowTheme: "dark",
			fontSize: 16,
			terminalFontSize: 14,
			terminalFontWeight: "normal",
		}));

		function ScaleStepProbe() {
			const { uiSettings } = useAppState();
			return <span data-testid="scale-step">{uiSettings.uiScaleStep}</span>;
		}

		render(
			<AppProvider>
				<ScaleStepProbe />
			</AppProvider>,
		);

		expect(screen.getByTestId("scale-step").textContent).toBe("0");
	});

	test("prefers uiScaleStep over legacy fontSize when both present", () => {
		localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify({
			theme: "dark",
			windowTheme: "dark",
			uiScaleStep: 1,
			fontSize: 18,
			terminalFontSize: 14,
			terminalFontWeight: "normal",
		}));

		function ScaleStepProbe() {
			const { uiSettings } = useAppState();
			return <span data-testid="scale-step">{uiSettings.uiScaleStep}</span>;
		}

		render(
			<AppProvider>
				<ScaleStepProbe />
			</AppProvider>,
		);

		expect(screen.getByTestId("scale-step").textContent).toBe("1");
	});

	test("persists uiScaleStep to localStorage", () => {
		function ScaleStepWriter() {
			const { setUISettings } = useAppState();
			return (
				<button
					data-testid="set-scale-step"
					onClick={() => setUISettings({
						theme: "dark",
						windowTheme: "dark",
						uiScaleStep: 3,
						terminalFontSize: 14,
						terminalFontWeight: "bold",
					})}
				>
					Set Scale Step
				</button>
			);
		}

		render(
			<AppProvider>
				<ScaleStepWriter />
			</AppProvider>,
		);

		fireEvent.click(screen.getByTestId("set-scale-step"));

		const stored = JSON.parse(localStorage.getItem(UI_SETTINGS_STORAGE_KEY) ?? "{}");
		expect(stored.uiScaleStep).toBe(3);
		expect(stored.terminalFontWeight).toBe("bold");
	});
});

describe("selection state exclusivity", () => {
	const mockProject = {
		id: "p1",
		name: "Test Project",
		path: "/tmp",
		description: "test",
		createdAt: "2024-01-01T00:00:00Z",
		updatedAt: "2024-01-01T00:00:00Z",
		sessionName: "test-project",
		status: "stopped",
		workdir: "/tmp",
		layoutJson: "{}",
		detailsJson: "{}",
		progressJson: "{}",
		aiHtml: "",
		aiStatus: "idle",
		aiError: "",
		lastSyncedAt: null,
		schemaVersion: 1,
	};

	const mockAiEvent = {
		id: "ai1",
		projectId: null,
		provider: "openai",
		model: "gpt-4",
		targetName: "conn1",
		sessionName: "session1",
		status: "success",
		durationMs: 1000,
		promptTokens: 100,
		completionTokens: 50,
		totalTokens: 150,
		estimatedCost: 0.01,
		errorMessage: null,
		windowNumber: null,
		responseJson: null,
		createdAt: "2024-01-01T00:00:00Z",
	};

	function TestSelectionComponent() {
		const state = useAppState();
		return (
			<div>
				<button
					data-testid="set-project"
					onClick={() => state.setSelectedProject(mockProject)}
				>
					Set Project
				</button>
				<button
					data-testid="set-pane"
					onClick={() => state.setSelectedPane({ targetName: "conn1", session: "s1", window: "w1", pane: "p1" })}
				>
					Set Pane
				</button>
				<button
					data-testid="set-ai-event"
					onClick={() => state.setSelectedAiEvent(mockAiEvent)}
				>
					Set AI Event
				</button>
				<button
					data-testid="clear-project"
					onClick={() => state.setSelectedProject(null)}
				>
					Clear Project
				</button>
				<span data-testid="selected-project">{state.selectedProject?.id ?? "null"}</span>
				<span data-testid="selected-pane">{state.selectedPane?.pane ?? "null"}</span>
				<span data-testid="selected-ai-event">{state.selectedAiEvent?.id ?? "null"}</span>
			</div>
		);
	}

	function renderWithProvider() {
		return render(
			<AppProvider>
				<TestSelectionComponent />
			</AppProvider>,
		);
	}

	test("setSelectedProject clears selectedPane and selectedAiEvent", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-pane"));
		expect(screen.getByTestId("selected-pane").textContent).toBe("p1");
		expect(screen.getByTestId("selected-ai-event").textContent).toBe("null");
		expect(screen.getByTestId("selected-project").textContent).toBe("null");

		fireEvent.click(screen.getByTestId("set-ai-event"));
		expect(screen.getByTestId("selected-ai-event").textContent).toBe("ai1");
		expect(screen.getByTestId("selected-pane").textContent).toBe("null");
		expect(screen.getByTestId("selected-project").textContent).toBe("null");

		fireEvent.click(screen.getByTestId("set-project"));
		expect(screen.getByTestId("selected-project").textContent).toBe("p1");
		expect(screen.getByTestId("selected-pane").textContent).toBe("null");
		expect(screen.getByTestId("selected-ai-event").textContent).toBe("null");
	});

	test("setSelectedPane clears selectedProject and selectedAiEvent", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-project"));
		expect(screen.getByTestId("selected-project").textContent).toBe("p1");
		expect(screen.getByTestId("selected-ai-event").textContent).toBe("null");
		expect(screen.getByTestId("selected-pane").textContent).toBe("null");

		fireEvent.click(screen.getByTestId("set-ai-event"));
		expect(screen.getByTestId("selected-ai-event").textContent).toBe("ai1");
		expect(screen.getByTestId("selected-project").textContent).toBe("null");
		expect(screen.getByTestId("selected-pane").textContent).toBe("null");

		fireEvent.click(screen.getByTestId("set-pane"));
		expect(screen.getByTestId("selected-pane").textContent).toBe("p1");
		expect(screen.getByTestId("selected-project").textContent).toBe("null");
		expect(screen.getByTestId("selected-ai-event").textContent).toBe("null");
	});

	test("setSelectedAiEvent clears selectedProject and selectedPane", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-project"));
		expect(screen.getByTestId("selected-project").textContent).toBe("p1");
		expect(screen.getByTestId("selected-pane").textContent).toBe("null");
		expect(screen.getByTestId("selected-ai-event").textContent).toBe("null");

		fireEvent.click(screen.getByTestId("set-pane"));
		expect(screen.getByTestId("selected-pane").textContent).toBe("p1");
		expect(screen.getByTestId("selected-project").textContent).toBe("null");
		expect(screen.getByTestId("selected-ai-event").textContent).toBe("null");

		fireEvent.click(screen.getByTestId("set-ai-event"));
		expect(screen.getByTestId("selected-ai-event").textContent).toBe("ai1");
		expect(screen.getByTestId("selected-project").textContent).toBe("null");
		expect(screen.getByTestId("selected-pane").textContent).toBe("null");
	});

	test("clearing selection with null does not affect other selections", () => {
		renderWithProvider();
		fireEvent.click(screen.getByTestId("set-pane"));
		expect(screen.getByTestId("selected-pane").textContent).toBe("p1");

		fireEvent.click(screen.getByTestId("clear-project"));
		expect(screen.getByTestId("selected-project").textContent).toBe("null");
		expect(screen.getByTestId("selected-pane").textContent).toBe("p1");
		expect(screen.getByTestId("selected-ai-event").textContent).toBe("null");
	});

	test("default state has null for all selections", () => {
		renderWithProvider();
		expect(screen.getByTestId("selected-project").textContent).toBe("null");
		expect(screen.getByTestId("selected-pane").textContent).toBe("null");
		expect(screen.getByTestId("selected-ai-event").textContent).toBe("null");
	});
});
