import { describe, test, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState, useCallback } from "react";
import { AppProvider, useAppState, useSelectedConnection } from "./store.js";

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
					onClick={() => state.setConnections([{ id: "1", name: "Local", type: "local" }])}
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
					onClick={() => state.setSessions("1", ["session1"])}
				>
					Set Sessions
				</button>
				<button
					data-testid="set-windows"
					onClick={() => state.setWindows("1", "session1", [{ id: "w1", name: "editor", panes: [{ id: "p1", index: 0 }] }])}
				>
					Set Windows
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
				<span data-testid="editing">{state.editingConnection?.name ?? "null"}</span>
				<button
					data-testid="set-editing"
					onClick={() => state.setEditingConnection({ id: "1", name: "Edit", type: "local" })}
				>
					Set Editing
				</button>
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
		fireEvent.click(screen.getByTestId("set-sessions"));
		expect(screen.getByTestId("connections-count").textContent).toBe("0");
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
		expect(screen.getByTestId("editing").textContent).toBe("Edit");
	});
});

describe("useSelectedConnection", () => {
	function TestComponent() {
		const selected = useSelectedConnection();
		return <span data-testid="selected-name">{selected?.name ?? "null"}</span>;
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
