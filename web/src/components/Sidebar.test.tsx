import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Sidebar } from "./Sidebar.js";
import { AppProvider, useAppState } from "../state/store.js";
import * as client from "../api/client.js";

vi.mock("../api/client.js", () => ({
	listConnections: vi.fn(),
	listConnectionHealth: vi.fn(),
	listSessions: vi.fn(),
	listWindows: vi.fn(),
	listPanes: vi.fn(),
	createSession: vi.fn(),
	killSession: vi.fn(),
	renameSession: vi.fn(),
}));

const mockListConnections = vi.mocked(client.listConnections);
const mockListConnectionHealth = vi.mocked(client.listConnectionHealth);
const mockListSessions = vi.mocked(client.listSessions);
const mockListWindows = vi.mocked(client.listWindows);
const mockListPanes = vi.mocked(client.listPanes);

function TestWrapper({ children }: { children: React.ReactNode }) {
	return <AppProvider>{children}</AppProvider>;
}

describe("Sidebar session loading", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		mockListConnections.mockResolvedValue([
			{ id: "conn1", type: "local" },
		]);
		mockListConnectionHealth.mockResolvedValue([]);
	});

	describe("handleOpenSession happy path", () => {
		test("periodically refreshes sessions for external tmux changes", async () => {
			mockListSessions
				.mockResolvedValueOnce({
					connectionId: "conn1",
					mode: "local",
					data: [{ name: "session1", attached: false }],
				})
				.mockResolvedValueOnce({
					connectionId: "conn1",
					mode: "local",
					data: [
						{ name: "session1", attached: false },
						{ name: "session2", attached: false },
					],
				});

			render(
				<TestWrapper>
					<Sidebar />
				</TestWrapper>,
			);

			await waitFor(() => {
				expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
			});

			await waitFor(() => {
				expect(screen.getByTestId("session-card-session2")).toBeInTheDocument();
			}, { timeout: 3000 });
		}, 4000);

		test("loads windows and panes, sets selectedPane with active IDs", async () => {
			mockListSessions.mockResolvedValue({
				connectionId: "conn1",
				mode: "local",
				data: [{ name: "session1", attached: false }],
			});

			mockListWindows.mockResolvedValue({
				connectionId: "conn1",
				session: "session1",
				mode: "local",
				data: [
					{ ID: "@1", Name: "editor", Index: 0, Active: false, PaneCount: 1, ActivePaneID: "%1", ActivePaneTitle: "bash" },
					{ ID: "@2", Name: "terminal", Index: 1, Active: true, PaneCount: 2, ActivePaneID: "%3", ActivePaneTitle: "vim" },
				],
			});

			mockListPanes.mockResolvedValue({
				connectionId: "conn1",
				session: "session1",
				window: "@2",
				mode: "local",
				data: [
					{ ID: "%3", Title: "vim", Index: 0, Active: true, Width: 80, Height: 24, Left: 0, Top: 0 },
					{ ID: "%4", Title: "bash", Index: 1, Active: false, Width: 80, Height: 24, Left: 0, Top: 25 },
				],
			});

			render(
				<TestWrapper>
					<Sidebar />
				</TestWrapper>,
			);

			await waitFor(() => {
				expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
			});

			fireEvent.click(screen.getByTestId("session-open-session1"));

			await waitFor(() => {
				expect(mockListWindows).toHaveBeenCalledWith("conn1", "session1");
			});

			await waitFor(() => {
				expect(mockListPanes).toHaveBeenCalledWith("conn1", "session1", "@2");
			});
		});

		test("falls back to first window when no active window", async () => {
			mockListSessions.mockResolvedValue({
				connectionId: "conn1",
				mode: "local",
				data: [{ name: "session1", attached: false }],
			});

			mockListWindows.mockResolvedValue({
				connectionId: "conn1",
				session: "session1",
				mode: "local",
				data: [
					{ ID: "@1", Name: "editor", Index: 0, Active: false, PaneCount: 1, ActivePaneID: "%1", ActivePaneTitle: "bash" },
				],
			});

			mockListPanes.mockResolvedValue({
				connectionId: "conn1",
				session: "session1",
				window: "@1",
				mode: "local",
				data: [
					{ ID: "%1", Title: "bash", Index: 0, Active: false, Width: 80, Height: 24, Left: 0, Top: 0 },
				],
			});

			render(
				<TestWrapper>
					<Sidebar />
				</TestWrapper>,
			);

			await waitFor(() => {
				expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
			});

			fireEvent.click(screen.getByTestId("session-open-session1"));

			await waitFor(() => {
				expect(mockListPanes).toHaveBeenCalledWith("conn1", "session1", "@1");
			});
		});

		test("sets session only when no windows exist", async () => {
			mockListSessions.mockResolvedValue({
				connectionId: "conn1",
				mode: "local",
				data: [{ name: "session1", attached: false }],
			});

			mockListWindows.mockResolvedValue({
				connectionId: "conn1",
				session: "session1",
				mode: "local",
				data: [],
			});

			render(
				<TestWrapper>
					<Sidebar />
				</TestWrapper>,
			);

			await waitFor(() => {
				expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
			});

			fireEvent.click(screen.getByTestId("session-open-session1"));

			await waitFor(() => {
				expect(mockListWindows).toHaveBeenCalledWith("conn1", "session1");
			});

			expect(mockListPanes).not.toHaveBeenCalled();
		});
	});

	describe("handleOpenSession error path", () => {
		test("listWindows failure sets error in store", async () => {
			mockListSessions.mockResolvedValue({
				connectionId: "conn1",
				mode: "local",
				data: [{ name: "session1", attached: false }],
			});

			const apiError = new Error("connection failed") as Error & { code: string };
			apiError.code = "connection_failed";
			mockListWindows.mockRejectedValue(apiError);

			function ErrorChecker() {
				const { error } = useAppState();
				return <span data-testid="error-state">{error ? `${error.code}` : "no-error"}</span>;
			}

			render(
				<TestWrapper>
					<Sidebar />
					<ErrorChecker />
				</TestWrapper>,
			);

			await waitFor(() => {
				expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
			});

			fireEvent.click(screen.getByTestId("session-open-session1"));

			await waitFor(() => {
				expect(mockListWindows).toHaveBeenCalledWith("conn1", "session1");
			});

			await waitFor(() => {
				expect(screen.getByTestId("error-state").textContent).toBe("connection_failed");
			});
		});

		test("listPanes failure sets error in store", async () => {
			mockListSessions.mockResolvedValue({
				connectionId: "conn1",
				mode: "local",
				data: [{ name: "session1", attached: false }],
			});

			mockListWindows.mockResolvedValue({
				connectionId: "conn1",
				session: "session1",
				mode: "local",
				data: [
					{ ID: "@1", Name: "editor", Index: 0, Active: true, PaneCount: 1, ActivePaneID: "%1", ActivePaneTitle: "bash" },
				],
			});

			const apiError = new Error("pane error") as Error & { code: string };
			apiError.code = "internal_error";
			mockListPanes.mockRejectedValue(apiError);

			function ErrorChecker() {
				const { error } = useAppState();
				return <span data-testid="error-state">{error ? `${error.code}` : "no-error"}</span>;
			}

			render(
				<TestWrapper>
					<Sidebar />
					<ErrorChecker />
				</TestWrapper>,
			);

			await waitFor(() => {
				expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
			});

			fireEvent.click(screen.getByTestId("session-open-session1"));

			await waitFor(() => {
				expect(screen.getByTestId("error-state").textContent).toBe("internal_error");
			});
		});
	});
});

describe("session card attention rendering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListConnections.mockResolvedValue([{ id: "conn1", type: "local" }]);
		mockListConnectionHealth.mockResolvedValue([]);
	});

	test("session card with attention state gets is-attention class", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", attached: false, attentionState: "attention", attentionCount: 1 }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		expect(screen.getByTestId("session-card-session1")).toHaveClass("is-attention");
		expect(screen.getByTestId("session-card-session1")).not.toHaveClass("is-attention-explicit");
	});

	test("session card with explicit attention state gets is-attention-explicit class", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", attached: false, attentionState: "explicit", attentionCount: 1 }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		expect(screen.getByTestId("session-card-session1")).toHaveClass("is-attention-explicit");
		expect(screen.getByTestId("session-card-session1")).not.toHaveClass("is-attention");
	});

	test("session card with attention shows badge count", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", attached: false, attentionState: "attention", attentionCount: 2 }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		const badge = document.querySelector(".attention-badge");
		expect(badge).toBeInTheDocument();
		expect(badge?.textContent).toBe("2");
	});
});

describe("session card semantic badge rendering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListConnections.mockResolvedValue([{ id: "conn1", type: "local" }]);
		mockListConnectionHealth.mockResolvedValue([]);
	});

	test("session card with semanticEventCount shows AI badge", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", attached: false, semanticEventType: "choice_required", semanticEventCount: 3 }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		const badge = document.querySelector(".semantic-badge");
		expect(badge).toBeInTheDocument();
		expect(badge?.textContent).toContain("AI");
		expect(badge?.textContent).toContain("3");
	});

	test("session card with zero semanticEventCount shows no badge", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", attached: false, semanticEventType: "none", semanticEventCount: 0 }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		expect(document.querySelector(".semantic-badge")).toBeNull();
	});

	test("session card with no semantic fields shows no badge", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", attached: false }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		expect(document.querySelector(".semantic-badge")).toBeNull();
	});
});
