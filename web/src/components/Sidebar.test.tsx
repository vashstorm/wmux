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
	fetchErrorLogs: vi.fn(),
}));

const mockListConnections = vi.mocked(client.listConnections);
const mockListConnectionHealth = vi.mocked(client.listConnectionHealth);
const mockListSessions = vi.mocked(client.listSessions);
const mockListWindows = vi.mocked(client.listWindows);
const mockListPanes = vi.mocked(client.listPanes);
const mockFetchErrorLogs = vi.mocked(client.fetchErrorLogs);

function TestWrapper({ children }: { children: React.ReactNode }) {
	return <AppProvider>{children}</AppProvider>;
}

describe("Sidebar session loading", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		mockListConnections.mockResolvedValue([
			{ targetName: "conn1", type: "local" },
		]);
		mockListConnectionHealth.mockResolvedValue([]);
		mockFetchErrorLogs.mockResolvedValue({ enabled: true, path: "/tmp/wmux-error.log", lines: [], truncated: false, maxLines: 1000 });
	});

	describe("handleOpenSession happy path", () => {
		test("periodically refreshes sessions for external tmux changes", async () => {
			mockListSessions
				.mockResolvedValueOnce({
					targetName: "conn1",
					mode: "local",
					data: [{ name: "session1" }],
				})
				.mockResolvedValueOnce({
					targetName: "conn1",
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

		test("loads the first window and first pane without following external tmux active state", async () => {
			mockListSessions.mockResolvedValue({
				targetName: "conn1",
				mode: "local",
				data: [{ name: "session1" }],
			});

			mockListWindows.mockResolvedValue({
				targetName: "conn1",
				session: "session1",
				mode: "local",
				data: [
					{ ID: "@1", Name: "editor", Index: 0, Active: false, PaneCount: 1, ActivePaneID: "%1", ActivePaneTitle: "bash" },
					{ ID: "@2", Name: "terminal", Index: 1, Active: true, PaneCount: 2, ActivePaneID: "%3", ActivePaneTitle: "vim" },
				],
			});

			mockListPanes.mockResolvedValue({
				targetName: "conn1",
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
				expect(mockListWindows).toHaveBeenCalledWith("conn1", "session1");
			});

			await waitFor(() => {
				expect(mockListPanes).toHaveBeenCalledWith("conn1", "session1", "@1");
			});
		});

		test("falls back to first window when no active window", async () => {
			mockListSessions.mockResolvedValue({
				targetName: "conn1",
				mode: "local",
				data: [{ name: "session1" }],
			});

			mockListWindows.mockResolvedValue({
				targetName: "conn1",
				session: "session1",
				mode: "local",
				data: [
					{ ID: "@1", Name: "editor", Index: 0, Active: false, PaneCount: 1, ActivePaneID: "%1", ActivePaneTitle: "bash" },
				],
			});

			mockListPanes.mockResolvedValue({
				targetName: "conn1",
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
				targetName: "conn1",
				mode: "local",
				data: [{ name: "session1" }],
			});

			mockListWindows.mockResolvedValue({
				targetName: "conn1",
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
				targetName: "conn1",
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
				targetName: "conn1",
				mode: "local",
				data: [{ name: "session1" }],
			});

			mockListWindows.mockResolvedValue({
				targetName: "conn1",
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
		mockListConnections.mockResolvedValue([{ targetName: "conn1", type: "local" }]);
		mockListConnectionHealth.mockResolvedValue([]);
	});

	test("session card with attention state gets is-attention class", async () => {
		mockListSessions.mockResolvedValue({
			targetName: "conn1",
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
			targetName: "conn1",
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
			targetName: "conn1",
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

describe("intelligence badge and summary rendering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListConnections.mockResolvedValue([{ targetName: "conn1", type: "local" }]);
		mockListConnectionHealth.mockResolvedValue([]);
		mockListWindows.mockResolvedValue({
			targetName: "conn1",
			session: "session1",
			mode: "local",
			data: [],
		});
		mockListPanes.mockResolvedValue({
			targetName: "conn1",
			session: "session1",
			window: "@1",
			mode: "local",
			data: [],
		});
	});

	test("session with intelligenceStatus waiting renders badge with text Waiting", async () => {
		mockListSessions.mockResolvedValue({
			targetName: "conn1",
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
			targetName: "conn1",
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
			targetName: "conn1",
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
			targetName: "conn1",
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
			targetName: "conn1",
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
			targetName: "conn1",
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
			targetName: "conn1",
			mode: "local",
			data: [{ name: "session1", intelligenceStatus: "waiting", intelligenceSummary: "Waiting", intelligenceStale: true }],
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
			targetName: "conn1",
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

	test("error logs button shows badge when error entries exist", async () => {
		mockFetchErrorLogs.mockResolvedValue({
			enabled: true,
			path: "/tmp/wmux-error.log",
			lines: ["ERROR one", "ERROR two"],
			truncated: false,
			maxLines: 1000,
		});
		mockListSessions.mockResolvedValue({
			targetName: "conn1",
			mode: "local",
			data: [{ name: "session1" }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("error-logs-badge")).toHaveTextContent("2");
		});
		expect(screen.getByTestId("open-error-logs-button")).toHaveAttribute("aria-label", "Logs (2)");
	});

	test("sidebar header switches between placeholder projects, sessions, and stats views", async () => {
		mockListSessions.mockResolvedValue({
			targetName: "conn1",
			mode: "local",
			data: [{ name: "session1" }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTestId("open-projects-button"));
		expect(screen.getByTestId("projects-view")).toBeInTheDocument();
		expect(screen.queryByTestId("session-card-session1")).not.toBeInTheDocument();

		fireEvent.click(screen.getByTestId("open-stats-button"));
		expect(screen.getByTestId("stats-view")).toBeInTheDocument();
		expect(screen.queryByTestId("session-card-session1")).not.toBeInTheDocument();

		fireEvent.click(screen.getByTestId("open-session-button"));
		expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
	});

	test("sidebar icon controls use consistent sizing classes", async () => {
		mockListSessions.mockResolvedValue({
			targetName: "conn1",
			mode: "local",
			data: [{ name: "session1" }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		for (const testId of ["open-projects-button", "open-session-button", "open-stats-button", "open-settings-button", "open-error-logs-button"]) {
			const button = screen.getByTestId(testId);
			expect(button).toHaveClass("sidebar-icon-button", "sidebar-icon-button-nav");
			expect(button.querySelector(".sidebar-icon")).toBeInTheDocument();
		}

		const newSessionButton = screen.getByTestId("new-session-button");
		expect(newSessionButton).toHaveClass("sidebar-icon-button", "sidebar-icon-button-compact");
		expect(newSessionButton.querySelector(".sidebar-icon")).toBeInTheDocument();

		for (const testId of ["rename-session-session1", "kill-session-session1"]) {
			const button = screen.getByTestId(testId);
			expect(button).toHaveClass("sidebar-icon-button", "sidebar-icon-button-row");
			expect(button.querySelector(".sidebar-icon")).toBeInTheDocument();
		}
	});
});
