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
		// Slow down the mock to ensure loading state is visible
		mockListAiLogs.mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
			return { data: [], nextCursor: null };
		});

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		// Should show loading initially - check for the loading spinner in the main content area
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

		// Retry button should be visible
		expect(screen.getByTestId("ai-logs-refresh")).toBeInTheDocument();
	});

	test("renders table with log entries", async () => {
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

		// Check summary columns (use getAllByText since there are 2 entries with same values)
		expect(screen.getAllByText("llm_call")).toHaveLength(2);
		expect(screen.getAllByText("gpt-4")).toHaveLength(2);
		expect(screen.getAllByText("success")).toHaveLength(2);
		expect(screen.getAllByText("1500ms")).toHaveLength(2);
	});

	test("expands row to show details", async () => {
		const entry = createMockLogEntry("log-expand");
		mockListAiLogs.mockResolvedValue({ data: [entry], nextCursor: null });

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-row-log-expand")).toBeInTheDocument();
		});

		// Click expand button
		fireEvent.click(screen.getByTestId("ai-log-expand-log-expand"));

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-details-log-expand")).toBeInTheDocument();
		});

		// Should show prompt text
		expect(screen.getByText(/Prompt for log-expand/i)).toBeInTheDocument();
	});

	test("shows tool info when toolName exists", async () => {
		const entry: client.AiLogEntry = {
			id: "log-tool",
			conversationId: "conv-tool",
			eventKind: "tool_call",
			model: "gpt-4",
			status: "success",
			promptText: null,
			toolName: "bash",
			toolCallId: "call-123",
			toolArgumentsJson: JSON.stringify({ command: "ls" }),
			toolResultJson: JSON.stringify({ output: "file1 file2" }),
			metricsJson: null,
			durationMs: 500,
			rawEventJson: null,
			errorMessage: null,
			createdAt: new Date().toISOString(),
		};
		mockListAiLogs.mockResolvedValue({ data: [entry], nextCursor: null });

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-row-log-tool")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTestId("ai-log-expand-log-tool"));

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-details-log-tool")).toBeInTheDocument();
		});

		// Tool name appears in "Tool: bash" heading
		expect(screen.getByText(/Tool: bash/)).toBeInTheDocument();
	});

	test("shows error message in red when errorMessage exists", async () => {
		const entry: client.AiLogEntry = {
			id: "log-err",
			conversationId: "conv-err",
			eventKind: "llm_call",
			model: "gpt-4",
			status: "error",
			promptText: null,
			toolName: null,
			toolCallId: null,
			toolArgumentsJson: null,
			toolResultJson: null,
			metricsJson: null,
			durationMs: 200,
			rawEventJson: null,
			errorMessage: "API rate limit exceeded",
			createdAt: new Date().toISOString(),
		};
		mockListAiLogs.mockResolvedValue({ data: [entry], nextCursor: null });

		render(<TestWrapper><AiLogsView /></TestWrapper>);

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-row-log-err")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTestId("ai-log-expand-log-err"));

		await waitFor(() => {
			expect(screen.getByTestId("ai-log-details-log-err")).toBeInTheDocument();
		});

		expect(screen.getByText("API rate limit exceeded")).toBeInTheDocument();
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

		// Chip should be present with eventKind text
		const chip = screen.getByText("tool_call");
		expect(chip).toBeInTheDocument();
	});
});