import { describe, test, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState, useCallback } from "react";
import { AppProvider, useAppState, useSelectedConnection, type SessionWindowState } from "./store.js";

describe("AppProvider", () => {
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
				<span data-testid="selected-id">{state.selectedConnectionId ?? "null"}</span>
				<span data-testid="loading-connections">{state.loading.connections ? "true" : "false"}</span>
				<span data-testid="error">{state.error ? `${state.error.code}:${state.error.message}` : "null"}</span>
				<span data-testid="show-form">{state.showNewConnectionForm ? "true" : "false"}</span>
				<span data-testid="show-settings">{state.showSettingsPanel ? "true" : "false"}</span>
				<button
					data-testid="set-connections"
					onClick={() => state.setConnections([{ id: "1", type: "local" }])}
				>
					Set Connections
				</button>
				<button
					data-testid="set-selected"
					onClick={() => state.setSelectedConnectionId("1")}
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
				<button data-testid="set-pane" onClick={() => state.setSelectedPane({ connectionId: "1", session: "s1", window: "w1", pane: "p1" })}>
					Set Pane
				</button>
				<button
					data-testid="set-health"
					onClick={() => state.setConnectionHealth({ "1": { connectionId: "1", status: "online", checkedAt: "2024-01-01T00:00:00Z" } })}
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
					{state.selectedPane ? `${state.selectedPane.connectionId}:${state.selectedPane.pane}` : "null"}
				</span>
				<span data-testid="health-status">{state.connectionHealth["1"]?.status ?? "null"}</span>
				<span data-testid="editing">{state.editingConnection?.type ?? "null"}</span>
				<span data-testid="sessions-count">{(state.sessions["1"] ?? []).length}</span>
				<button
					data-testid="set-editing"
					onClick={() => state.setEditingConnection({ id: "1", type: "local" })}
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

	test("setSelectedConnectionId updates selection", () => {
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
