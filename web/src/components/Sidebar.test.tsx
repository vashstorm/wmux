import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Sidebar } from "./Sidebar.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { AppProvider, useAppState } from "../state/store.js";
import * as client from "../api/client.js";
import { ApiError } from "../api/errors.js";

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
	listProjects: vi.fn(),
	createProject: vi.fn(),
	updateProject: vi.fn(),
	deleteProject: vi.fn(),
	listAiStats: vi.fn(),
	cleanupAiStats: vi.fn(),
}));

const mockListConnections = vi.mocked(client.listConnections);
const mockListConnectionHealth = vi.mocked(client.listConnectionHealth);
const mockListSessions = vi.mocked(client.listSessions);
const mockListWindows = vi.mocked(client.listWindows);
const mockListPanes = vi.mocked(client.listPanes);
const mockFetchErrorLogs = vi.mocked(client.fetchErrorLogs);
const mockListProjects = vi.mocked(client.listProjects);
const mockCreateProject = vi.mocked(client.createProject);
const mockUpdateProject = vi.mocked(client.updateProject);
const mockDeleteProject = vi.mocked(client.deleteProject);
const mockListAiStats = vi.mocked(client.listAiStats);
const mockCleanupAiStats = vi.mocked(client.cleanupAiStats);

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



	test("session card keeps action buttons in the absolute positioned floating element", async () => {
		mockListSessions.mockResolvedValue({
			targetName: "conn1",
			mode: "local",
			data: [{ name: "session1", windowCount: 3 }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		const cardBodyShell = screen.getByTestId("session-open-session1").parentElement;
		const actions = document.querySelector(".session-card-actions");

		expect(cardBodyShell).toHaveStyle({ width: "100%" });
		expect(actions).toHaveStyle({ position: "absolute" });
		expect(actions).toHaveStyle({
			right: "8px",
			transform: "translate(8px, -50%)",
			pointerEvents: "none",
		});
	});

	test("session card shows updated time on the session name row", async () => {
		mockListSessions.mockResolvedValue({
			targetName: "conn1",
			mode: "local",
			data: [{ name: "session1", intelligenceStatus: "running", intelligenceUpdatedAt: new Date().toISOString() }],
		});

		render(
			<TestWrapper>
				<Sidebar />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("session-card-session1")).toBeInTheDocument();
		});

		const time = document.querySelector(".session-card-time");
		expect(time).toBeInTheDocument();
	});
});

describe("sidebar navigation and logs features", () => {
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

describe("Projects view", () => {
	beforeEach(() => {
		mockListConnections.mockResolvedValue([{ targetName: "conn1", type: "local" }]);
		mockListConnectionHealth.mockResolvedValue([]);
		mockFetchErrorLogs.mockResolvedValue({ enabled: false, path: null, lines: [], truncated: false, maxLines: 1000 });
		vi.mocked(client.listProjects).mockReset().mockResolvedValue([]);
		vi.mocked(client.createProject).mockReset().mockResolvedValue({
			id: "p1",
			name: "new",
			path: "/tmp",
			description: "",
			createdAt: "",
			updatedAt: "",
			sessionName: "",
			status: "stopped",
			workdir: "",
			layoutJson: "{}",
			detailsJson: "{}",
			progressJson: "{}",
			aiHtml: "",
			aiStatus: "idle",
			aiError: "",
			lastSyncedAt: null,
			schemaVersion: 1,
		});
		vi.mocked(client.updateProject).mockReset().mockResolvedValue({
			id: "p1",
			name: "new",
			path: "/tmp",
			description: "",
			createdAt: "",
			updatedAt: "",
			sessionName: "",
			status: "stopped",
			workdir: "",
			layoutJson: "{}",
			detailsJson: "{}",
			progressJson: "{}",
			aiHtml: "",
			aiStatus: "idle",
			aiError: "",
			lastSyncedAt: null,
			schemaVersion: 1,
		});
		vi.mocked(client.deleteProject).mockReset().mockResolvedValue(undefined);
	});

	test("clicking Projects button loads projects and shows empty state", async () => {
		render(<TestWrapper><Sidebar /></TestWrapper>);
		fireEvent.click(screen.getByTestId("open-projects-button"));
		await waitFor(() => {
			expect(screen.getByTestId("projects-empty")).toBeInTheDocument();
		});
	});

	test("creates a project and shows it in list", async () => {
		vi.mocked(client.listProjects)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{
				id: "p1",
				name: "wmux-dev",
				path: "/tmp/wmux",
				description: "",
				createdAt: "",
				updatedAt: "",
				sessionName: "",
				status: "stopped",
				workdir: "",
				layoutJson: "{}",
				detailsJson: "{}",
				progressJson: "{}",
				aiHtml: "",
				aiStatus: "idle",
				aiError: "",
				lastSyncedAt: null,
				schemaVersion: 1,
			}]);

		render(<TestWrapper><Sidebar /></TestWrapper>);
		fireEvent.click(screen.getByTestId("open-projects-button"));
		await waitFor(() => expect(screen.getByTestId("projects-empty")).toBeInTheDocument());

		fireEvent.click(screen.getByTestId("projects-add-button"));
		const nameInput = screen.getByPlaceholderText("Project name");
		const pathInput = screen.getByPlaceholderText("Path (optional)");
		fireEvent.change(nameInput, { target: { value: "wmux-dev" } });
		fireEvent.change(pathInput, { target: { value: "/tmp/wmux" } });
		fireEvent.click(screen.getByTestId("project-submit-button"));

		await waitFor(() => {
			expect(screen.getByText("wmux-dev")).toBeInTheDocument();
		});
	});

	test("duplicate project name shows error", async () => {
		vi.mocked(client.createProject).mockRejectedValue(new ApiError("conflict", "project name already exists", 409));

		render(<TestWrapper><Sidebar /></TestWrapper>);
		fireEvent.click(screen.getByTestId("open-projects-button"));
		await waitFor(() => expect(screen.getByTestId("projects-empty")).toBeInTheDocument());

		fireEvent.click(screen.getByTestId("projects-add-button"));
		const nameInput = screen.getByPlaceholderText("Project name");
		fireEvent.change(nameInput, { target: { value: "dup" } });
		fireEvent.click(screen.getByTestId("project-submit-button"));

		await waitFor(() => {
			expect(screen.getByTestId("projects-error")).toBeInTheDocument();
		});
	});
});

	describe("Stats view", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		mockListConnections.mockResolvedValue([{ targetName: "conn1", type: "local" }]);
		mockListConnectionHealth.mockResolvedValue([]);
		mockFetchErrorLogs.mockResolvedValue({ enabled: false, path: null, lines: [], truncated: false, maxLines: 1000 });
	});

	test("clicking Stats button calls listAiStats and renders populated data", async () => {
		mockListAiStats.mockResolvedValue({
			data: [
				{ id: "e1", projectId: null, provider: "openai", model: "gpt-4", targetName: "target1", sessionName: "sess1", status: "success", durationMs: 150, promptTokens: 50, completionTokens: 30, totalTokens: 80, estimatedCost: 0.01, errorMessage: null, createdAt: "2024-01-01T00:00:00Z" },
			],
			summary: { totalEvents: 1, totalSuccess: 1, totalError: 0, totalDurationMs: 150, totalPromptTokens: 50, totalCompletionTokens: 30, totalTokens: 80, totalEstimatedCost: 0.01 },
		});

		render(<TestWrapper><Sidebar /></TestWrapper>);
		fireEvent.click(screen.getByTestId("open-stats-button"));
		await waitFor(() => {
			const statsView = screen.getByTestId("stats-view");
			expect(within(statsView).getByTestId("stats-event-e1")).toBeInTheDocument();
			expect(within(statsView).getByText("sess1")).toBeInTheDocument();
			expect(within(statsView).getByTestId("stats-summary")).toBeInTheDocument();
		});
	});

	test("stats cleanup keeps latest event per window and refreshes data", async () => {
		mockListAiStats
			.mockResolvedValueOnce({
				data: [
					{ id: "e1", projectId: null, provider: "openai", model: "gpt-4", targetName: "target1", sessionName: "sess1", status: "success", durationMs: 150, promptTokens: 50, completionTokens: 30, totalTokens: 80, estimatedCost: 0.01, errorMessage: null, windowNumber: 1, responseJson: null, createdAt: "2024-01-01T00:00:00Z" },
					{ id: "e2", projectId: null, provider: "openai", model: "gpt-4", targetName: "target1", sessionName: "sess1", status: "success", durationMs: 120, promptTokens: 45, completionTokens: 20, totalTokens: 65, estimatedCost: 0.008, errorMessage: null, windowNumber: 1, responseJson: null, createdAt: "2024-01-02T00:00:00Z" },
				],
				summary: { totalEvents: 2, totalSuccess: 2, totalError: 0, totalDurationMs: 270, totalPromptTokens: 95, totalCompletionTokens: 50, totalTokens: 145, totalEstimatedCost: 0.018 },
			})
			.mockResolvedValueOnce({
				data: [
					{ id: "e2", projectId: null, provider: "openai", model: "gpt-4", targetName: "target1", sessionName: "sess1", status: "success", durationMs: 120, promptTokens: 45, completionTokens: 20, totalTokens: 65, estimatedCost: 0.008, errorMessage: null, windowNumber: 1, responseJson: null, createdAt: "2024-01-02T00:00:00Z" },
				],
				summary: { totalEvents: 1, totalSuccess: 1, totalError: 0, totalDurationMs: 120, totalPromptTokens: 45, totalCompletionTokens: 20, totalTokens: 65, totalEstimatedCost: 0.008 },
			});
		mockCleanupAiStats.mockResolvedValue({ deleted: 1 });

		render(<TestWrapper><Sidebar /><ConfirmDialog /></TestWrapper>);
		fireEvent.click(screen.getByTestId("open-stats-button"));
		await waitFor(() => expect(screen.getByTestId("stats-event-e1")).toBeInTheDocument());

		fireEvent.click(screen.getByTestId("stats-cleanup-button"));
		fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

		await waitFor(() => {
			expect(mockCleanupAiStats).toHaveBeenCalledTimes(1);
			expect(screen.getByTestId("stats-cleanup-message")).toHaveTextContent("Cleaned 1 old records");
			expect(screen.queryByTestId("stats-event-e1")).not.toBeInTheDocument();
			expect(screen.getByTestId("stats-event-e2")).toBeInTheDocument();
		});
	});

	test("empty stats shows empty state", async () => {
		mockListAiStats.mockResolvedValue({
			data: [],
			summary: { totalEvents: 0, totalSuccess: 0, totalError: 0, totalDurationMs: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalEstimatedCost: 0 },
		});

		render(<TestWrapper><Sidebar /></TestWrapper>);
		fireEvent.click(screen.getByTestId("open-stats-button"));
		await waitFor(() => {
			expect(screen.getByTestId("stats-empty")).toBeInTheDocument();
		});
	});

	test("stats API error shows error state with retry", async () => {
		mockListAiStats.mockRejectedValue(new ApiError("internal_error", "db error", 500));

		render(<TestWrapper><Sidebar /></TestWrapper>);
		fireEvent.click(screen.getByTestId("open-stats-button"));
		await waitFor(() => {
			expect(screen.getByTestId("stats-error")).toBeInTheDocument();
		});

		mockListAiStats.mockResolvedValue({
			data: [],
			summary: { totalEvents: 0, totalSuccess: 0, totalError: 0, totalDurationMs: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalEstimatedCost: 0 },
		});
		fireEvent.click(screen.getByTestId("stats-retry-button"));
		await waitFor(() => {
			expect(screen.getByTestId("stats-empty")).toBeInTheDocument();
		});
	});

	test("auto-refreshes stats every 30 seconds by default", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		mockListAiStats.mockResolvedValue({
			data: [],
			summary: { totalEvents: 0, totalSuccess: 0, totalError: 0, totalDurationMs: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalEstimatedCost: 0 },
		});

		render(<TestWrapper><Sidebar /></TestWrapper>);
		fireEvent.click(screen.getByTestId("open-stats-button"));

		await waitFor(() => {
			expect(mockListAiStats).toHaveBeenCalledTimes(1);
		});

		mockListAiStats.mockClear();
		vi.advanceTimersByTime(30000);

		await waitFor(() => {
			expect(mockListAiStats).toHaveBeenCalledTimes(1);
		});

		vi.useRealTimers();
	});

	test("manual refresh resets the auto-refresh interval", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		mockListAiStats.mockResolvedValue({
			data: [],
			summary: { totalEvents: 0, totalSuccess: 0, totalError: 0, totalDurationMs: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalEstimatedCost: 0 },
		});

		render(<TestWrapper><Sidebar /></TestWrapper>);
		fireEvent.click(screen.getByTestId("open-stats-button"));

		await waitFor(() => {
			expect(mockListAiStats).toHaveBeenCalledTimes(1);
		});

		vi.advanceTimersByTime(15000);
		mockListAiStats.mockClear();

		fireEvent.click(screen.getByTestId("stats-refresh-button"));
		await waitFor(() => {
			expect(mockListAiStats).toHaveBeenCalledTimes(1);
		});

		mockListAiStats.mockClear();
		vi.advanceTimersByTime(15000);
		expect(mockListAiStats).not.toHaveBeenCalled();

		vi.advanceTimersByTime(15000);
		await waitFor(() => {
			expect(mockListAiStats).toHaveBeenCalledTimes(1);
		});

		vi.useRealTimers();
	});

	test("disabling auto-refresh stops the interval", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		mockListAiStats.mockResolvedValue({
			data: [],
			summary: { totalEvents: 0, totalSuccess: 0, totalError: 0, totalDurationMs: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalEstimatedCost: 0 },
		});

		render(<TestWrapper><Sidebar /></TestWrapper>);
		fireEvent.click(screen.getByTestId("open-stats-button"));

		await waitFor(() => {
			expect(mockListAiStats).toHaveBeenCalledTimes(1);
		});

		const autoRefreshSwitch = screen.getByTestId("stats-auto-refresh-switch").querySelector("input");
		expect(autoRefreshSwitch).not.toBeNull();
		fireEvent.click(autoRefreshSwitch!);

		mockListAiStats.mockClear();
		vi.advanceTimersByTime(30000);
		expect(mockListAiStats).not.toHaveBeenCalled();

		vi.useRealTimers();
	});

	test("shows last refreshed time after loading", async () => {
		mockListAiStats.mockResolvedValue({
			data: [],
			summary: { totalEvents: 0, totalSuccess: 0, totalError: 0, totalDurationMs: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalEstimatedCost: 0 },
		});

		render(<TestWrapper><Sidebar /></TestWrapper>);
		fireEvent.click(screen.getByTestId("open-stats-button"));

		await waitFor(() => {
			expect(screen.getByTestId("stats-last-refreshed")).toBeInTheDocument();
		});
	});
});
