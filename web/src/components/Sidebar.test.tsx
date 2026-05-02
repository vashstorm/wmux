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
	analyzeSession: vi.fn(),
}));

const mockListConnections = vi.mocked(client.listConnections);
const mockListConnectionHealth = vi.mocked(client.listConnectionHealth);
const mockListSessions = vi.mocked(client.listSessions);
const mockListWindows = vi.mocked(client.listWindows);
const mockListPanes = vi.mocked(client.listPanes);
const mockAnalyzeSession = vi.mocked(client.analyzeSession);

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
					data: [{ name: "session1" }],
				})
				.mockResolvedValueOnce({
					connectionId: "conn1",
					mode: "local",
					data: [
						{ name: "session1" },
						{ name: "session2" },
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
				data: [{ name: "session1" }],
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
				data: [{ name: "session1" }],
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
				data: [{ name: "session1" }],
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
				data: [{ name: "session1" }],
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
				data: [{ name: "session1" }],
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
			data: [{ name: "session1", attentionState: "attention", attentionCount: 1 }],
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
			data: [{ name: "session1", attentionState: "explicit", attentionCount: 1 }],
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
			data: [{ name: "session1", attentionState: "attention", attentionCount: 2 }],
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

describe("async analyze trigger", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListConnections.mockResolvedValue([{ id: "conn1", type: "local" }]);
		mockListConnectionHealth.mockResolvedValue([]);
	});

	test("triggers analyze for stale local sessions", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [
				{ name: "session1", intelligenceStale: true },
				{ name: "session2", intelligenceStatus: "running", intelligenceStale: false },
			],
		});

		mockAnalyzeSession.mockResolvedValue({
			connectionId: "conn1",
			session: "session1",
			status: "ok",
			updated: 1,
			skipped: 0,
			errors: 0,
			intelligence: {
				app: "claude",
				status: "waiting",
				summary: "Waiting for input",
				source: "anthropic/claude-3",
				confidence: 0.9,
				stale: false,
				updatedAt: "2026-04-30T10:00:00Z",
			},
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
			expect(mockAnalyzeSession).toHaveBeenCalledWith("conn1", "session1");
		});

		await waitFor(() => {
			expect(mockAnalyzeSession).not.toHaveBeenCalledWith("conn1", "session2");
		});
	});

	test("does not trigger analyze for SSH connections", async () => {
		mockListConnections.mockResolvedValue([{ id: "conn1", type: "ssh" }]);
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "ssh",
			data: [{ name: "session1", intelligenceStale: true }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		expect(mockAnalyzeSession).not.toHaveBeenCalled();
	});

	test("updates only analyzed session when analyzeSession resolves", async () => {
		function SessionStatusChecker() {
			const { sessions } = useAppState();
			const session1 = sessions["conn1"]?.find(s => s.name === "session1");
			const session2 = sessions["conn1"]?.find(s => s.name === "session2");
			return (
				<div>
					<span data-testid="session1-status">{session1?.intelligenceStatus ?? "null"}</span>
					<span data-testid="session2-status">{session2?.intelligenceStatus ?? "null"}</span>
				</div>
			);
		}

		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [
				{ name: "session1", intelligenceStale: true },
				{ name: "session2", intelligenceStatus: "running", intelligenceStale: false },
			],
		});

		mockAnalyzeSession.mockResolvedValue({
			connectionId: "conn1",
			session: "session1",
			status: "ok",
			updated: 1,
			skipped: 0,
			errors: 0,
			intelligence: {
				app: "claude",
				status: "waiting",
				summary: "Waiting",
				source: "test",
				confidence: 0.9,
				stale: false,
				updatedAt: "2026-04-30T10:00:00Z",
			},
		});

		render(
			<TestWrapper>
				<Sidebar />
				<SessionStatusChecker />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		await waitFor(() => {
			expect(screen.getByTestId("session1-status").textContent).toBe("waiting");
		});

		expect(screen.getByTestId("session2-status").textContent).toBe("running");
	});
});

describe("intelligence badge and summary rendering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListConnections.mockResolvedValue([{ id: "conn1", type: "local" }]);
		mockListConnectionHealth.mockResolvedValue([]);
	});

	test("session with intelligenceStatus waiting renders badge with text Waiting", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", intelligenceStatus: "waiting" }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		const badge = document.querySelector(".intelligence-badge.is-waiting");
		expect(badge).toBeInTheDocument();
		expect(badge?.textContent).toBe("Waiting");
	});

	test("session with intelligenceStatus dead_loop renders badge with text Loop", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", intelligenceStatus: "dead_loop" }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		const badge = document.querySelector(".intelligence-badge.is-dead_loop");
		expect(badge).toBeInTheDocument();
		expect(badge?.textContent).toBe("Loop");
	});

	test("session with intelligenceStatus blocked renders badge with text Blocked", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", intelligenceStatus: "blocked" }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		const badge = document.querySelector(".intelligence-badge.is-blocked");
		expect(badge).toBeInTheDocument();
		expect(badge?.textContent).toBe("Blocked");
	});

	test("session with intelligenceStatus running renders badge with text Running", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", intelligenceStatus: "running" }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		const badge = document.querySelector(".intelligence-badge.is-running");
		expect(badge).toBeInTheDocument();
		expect(badge?.textContent).toBe("Running");
	});

	test("session with intelligenceStatus none does NOT render intelligence badge", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", intelligenceStatus: "none" }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		const badge = document.querySelector(".intelligence-badge");
		expect(badge).not.toBeInTheDocument();
	});

	test("session with intelligenceSummary renders one-line summary text in the card", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", intelligenceStatus: "waiting", intelligenceSummary: "Waiting for input" }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		const summary = document.querySelector(".session-intelligence-summary");
		expect(summary).toBeInTheDocument();
		expect(summary?.textContent).toBe("Waiting for input");
	});

	test("session with intelligenceStale true has title that includes stale", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", intelligenceStatus: "waiting", intelligenceSummary: "Waiting", intelligenceStale: true }],
		});

		mockAnalyzeSession.mockResolvedValue({
			connectionId: "conn1",
			session: "session1",
			status: "ok",
			updated: 1,
			skipped: 0,
			errors: 0,
			intelligence: {
				app: "claude",
				status: "waiting",
				summary: "Waiting",
				source: "test-source",
				confidence: 0.9,
				stale: true,
				updatedAt: "2026-04-30T10:00:00Z",
			},
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
			const summary = document.querySelector(".session-intelligence-summary");
			expect(summary).toBeInTheDocument();
			expect(summary?.getAttribute("title")).toContain("stale");
		});
	});

	test("session with intelligenceError has error indicator in title not raw error text", async () => {
		mockListSessions.mockResolvedValue({
			connectionId: "conn1",
			mode: "local",
			data: [{ name: "session1", intelligenceStatus: "none", intelligenceSummary: "Failed", intelligenceError: "API timeout" }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		const summary = document.querySelector(".session-intelligence-summary");
		expect(summary).toBeInTheDocument();
		const title = summary?.getAttribute("title") ?? "";
		expect(title).toContain("[error]");
		expect(title).not.toContain("API timeout");

		const badge = document.querySelector(".intelligence-badge.is-error");
		expect(badge).toBeInTheDocument();
	});
});
