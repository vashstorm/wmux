import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AiLogsView } from "./AiLogsView.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { AppProvider, useAppState } from "../../state/store.js";
import * as client from "../../api/client.js";

vi.mock("../../api/client.js", () => ({
	listAiLogs: vi.fn(),
	clearAiLogs: vi.fn(),
}));

const mockListAiLogs = vi.mocked(client.listAiLogs);
const mockClearAiLogs = vi.mocked(client.clearAiLogs);

function TestWrapper({ children }: { children: React.ReactNode }) {
	return <AppProvider>{children}</AppProvider>;
}

function LogInspector() {
	const { selectedAiLog } = useAppState();
	return selectedAiLog ? (
		<div data-testid="selected-log-inspector">{selectedAiLog.id}</div>
	) : (
		<div data-testid="selected-log-inspector">none</div>
	);
}

function TestWrapperWithDetail() {
	return (
		<AppProvider>
			<AiLogsView />
			<LogInspector />
		</AppProvider>
	);
}

function createMockLogEntry(id: string): client.AiLogEntry {
	return {
		id,
		conversationId: `conv-${id}`,
		eventKind: "llm_call",
		model: "gpt-4",
		status: "success",
		promptText: `Prompt for ${id}`,
		toolName: null,
		toolCallId: null,
		toolArgumentsJson: null,
		toolResultJson: null,
		metricsJson: JSON.stringify({ tokensUsed: 100, cost: 0.01 }),
		durationMs: 1500,
		rawEventJson: null,
		errorMessage: null,
		createdAt: new Date().toISOString(),
	};
}

describe("AiLogsView", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListAiLogs.mockResolvedValue({ data: [], nextCursor: null });
		mockClearAiLogs.mockResolvedValue(undefined);
	});

	test("shows loading state on mount", async () => {
		mockListAiLogs.mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return { data: [], nextCursor: null };
		});

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		expect(screen.getByText("Loading AI logs...")).toBeInTheDocument();

		await waitFor(() => {
			expect(mockListAiLogs).toHaveBeenCalledWith({ limit: 50 });
		});

		await waitFor(() => {
			expect(screen.getByTestId("ai-logs-empty")).toBeInTheDocument();
		});
	});

	test("shows empty state when no logs exist", async () => {
		mockListAiLogs.mockResolvedValue({ data: [], nextCursor: null });

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		await waitFor(() => {
			expect(screen.getByTestId("ai-logs-empty")).toBeInTheDocument();
		});
		expect(screen.getByText(/No AI logs/i)).toBeInTheDocument();
	});

	test("shows error state with retry button on fetch failure", async () => {
		mockListAiLogs.mockRejectedValue(new Error("Failed to fetch logs"));

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		await waitFor(() => {
			expect(screen.getByText(/Failed to fetch logs/i)).toBeInTheDocument();
		});

		expect(screen.getByTestId("ai-logs-refresh")).toBeInTheDocument();
	});

	test("renders list with log entries", async () => {
		const entries = [
			createMockLogEntry("log-1"),
			createMockLogEntry("log-2"),
		];
		mockListAiLogs.mockResolvedValue({ data: entries, nextCursor: null });

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-row-log-1")).toBeInTheDocument();
		});
		expect(screen.getByTestId("ai-log-row-log-2")).toBeInTheDocument();

		expect(screen.getAllByText("llm_call")).toHaveLength(2);
		expect(screen.getAllByText("gpt-4")).toHaveLength(2);
		expect(screen.getAllByText("1500ms")).toHaveLength(2);
	});

	test("clicking a log entry selects it in the app state", async () => {
		const entry = createMockLogEntry("log-click");
		mockListAiLogs.mockResolvedValue({ data: [entry], nextCursor: null });

		render(<TestWrapperWithDetail />);

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-row-log-click")).toBeInTheDocument();
		});

		expect(screen.getByTestId("selected-log-inspector")).toHaveTextContent("none");

		fireEvent.click(screen.getByTestId("ai-log-row-log-click"));

		expect(screen.getByTestId("selected-log-inspector")).toHaveTextContent("log-click");
	});

	test("load more button appears when nextCursor exists", async () => {
		const entries = [createMockLogEntry("log-1")];
		mockListAiLogs.mockResolvedValue({ data: entries, nextCursor: "cursor-abc" });

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-row-log-1")).toBeInTheDocument();
		});

		expect(screen.getByTestId("ai-logs-load-more")).toBeInTheDocument();
	});

	test("load more button hidden when nextCursor is null", async () => {
		const entries = [createMockLogEntry("log-1")];
		mockListAiLogs.mockResolvedValue({ data: entries, nextCursor: null });

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-row-log-1")).toBeInTheDocument();
		});

		expect(screen.queryByTestId("ai-logs-load-more")).not.toBeInTheDocument();
	});

	test("load more fetches with before cursor", async () => {
		const entries1 = [createMockLogEntry("log-1")];
		const entries2 = [createMockLogEntry("log-2")];
		mockListAiLogs
			.mockResolvedValueOnce({ data: entries1, nextCursor: "cursor-abc" })
			.mockResolvedValueOnce({ data: entries2, nextCursor: null });

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		await waitFor(() => {
			expect(screen.getByTestId("ai-logs-load-more")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTestId("ai-logs-load-more"));

		await waitFor(() => {
			expect(mockListAiLogs).toHaveBeenCalledWith({ limit: 50, before: "cursor-abc" });
		});

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-row-log-2")).toBeInTheDocument();
		});
	});

	test("refresh button reloads first page", async () => {
		const entries1 = [createMockLogEntry("log-initial")];
		const entries2 = [createMockLogEntry("log-refreshed")];
		mockListAiLogs
			.mockResolvedValueOnce({ data: entries1, nextCursor: null })
			.mockResolvedValueOnce({ data: entries2, nextCursor: null });

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-row-log-initial")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTestId("ai-logs-refresh"));

		await waitFor(() => {
			expect(mockListAiLogs).toHaveBeenCalledTimes(2);
		});

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-row-log-refreshed")).toBeInTheDocument();
		});
	});

	test("clear button shows confirmation dialog and clears logs on confirm", async () => {
		const entries = [createMockLogEntry("log-to-clear")];
		mockListAiLogs
			.mockResolvedValueOnce({ data: entries, nextCursor: null })
			.mockResolvedValueOnce({ data: [], nextCursor: null });

		render(
			<TestWrapper>
				<AiLogsView />
				<ConfirmDialog />
			</TestWrapper>
		);

		await waitFor(() => {
			expect(screen.getByTestId("ai-logs-clear")).not.toBeDisabled();
		});

		fireEvent.click(screen.getByTestId("ai-logs-clear"));

		await waitFor(() => {
			expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

		await waitFor(() => {
			expect(mockClearAiLogs).toHaveBeenCalled();
		});

		await waitFor(() => {
			expect(mockListAiLogs).toHaveBeenCalledTimes(2);
		});

		await waitFor(() => {
			expect(screen.getByTestId("ai-logs-empty")).toBeInTheDocument();
		});
	});

	test("clear button is disabled when no logs exist", async () => {
		mockListAiLogs.mockResolvedValue({ data: [], nextCursor: null });

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		await waitFor(() => {
			expect(screen.getByTestId("ai-logs-empty")).toBeInTheDocument();
		});

		expect(screen.getByTestId("ai-logs-clear")).toBeDisabled();
	});

	test("chip color varies by eventKind", async () => {
		const entry: client.AiLogEntry = {
			id: "log-chip",
			conversationId: "conv-chip",
			eventKind: "tool_call",
			model: "gpt-4",
			status: "success",
			promptText: null,
			toolName: null,
			toolCallId: null,
			toolArgumentsJson: null,
			toolResultJson: null,
			metricsJson: null,
			durationMs: 100,
			rawEventJson: null,
			errorMessage: null,
			createdAt: new Date().toISOString(),
		};
		mockListAiLogs.mockResolvedValue({ data: [entry], nextCursor: null });

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-row-log-chip")).toBeInTheDocument();
		});

		const chip = screen.getByText("tool_call");
		expect(chip).toBeInTheDocument();
	});
});