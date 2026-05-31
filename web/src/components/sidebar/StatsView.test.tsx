import { describe, expect, test, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppProvider } from "../../state/store.js";
import type { AiStatsResponse } from "../../api/client.js";
import { StatsView } from "./StatsView.js";
import * as client from "../../api/client.js";

vi.mock("../../api/client.js", () => ({
	listAiStats: vi.fn(),
	cleanupAiStats: vi.fn(),
}));

const mockListAiStats = vi.mocked(client.listAiStats);

function renderStatsView() {
	return render(
		<AppProvider>
			<StatsView />
		</AppProvider>,
	);
}

function response(): AiStatsResponse {
	return {
		data: [
			{
				id: "project-html-1",
				projectId: "proj-1",
				provider: "openai",
				model: "gpt-4",
				targetName: "project",
				sessionName: "wmux",
				status: "success",
				durationMs: 1000,
				responseJson: JSON.stringify({
					operation: "generate_ai_html",
					summary: "Project AI HTML generated",
					projectName: "Wmux",
				}),
				createdAt: "2026-05-31T10:00:00Z",
			},
			{
				id: "analysis-1",
				provider: "openai",
				model: "gpt-4",
				targetName: "local",
				sessionName: "dev",
				status: "success",
				durationMs: 900,
				windowNumber: 2,
				responseJson: JSON.stringify({
					content: JSON.stringify({ summary: "Window is running tests" }),
				}),
				createdAt: "2026-05-31T10:01:00Z",
			},
		],
		summary: {
			totalEvents: 2,
			totalSuccess: 2,
			totalError: 0,
			totalDurationMs: 1900,
			totalPromptTokens: 0,
			totalCompletionTokens: 0,
			totalTokens: 0,
			totalEstimatedCost: 0,
		},
	};
}

describe("StatsView", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListAiStats.mockResolvedValue(response());
	});

	test("distinguishes project HTML logs from window analysis logs", async () => {
		renderStatsView();

		await waitFor(() => {
			expect(screen.getByTestId("stats-event-project-html-1")).toBeInTheDocument();
		});

		expect(screen.getByText("Wmux")).toBeInTheDocument();
		expect(screen.getByText("Project HTML")).toBeInTheDocument();
		expect(screen.getByText("dev")).toBeInTheDocument();
		expect(screen.getByText("Window Analysis")).toBeInTheDocument();
	});

	test("clicking Errors reloads stats with an error status filter", async () => {
		const errorResponse: AiStatsResponse = {
			data: [
				{
					id: "analysis-error-1",
					provider: "openai",
					model: "gpt-4",
					targetName: "local",
					sessionName: "dev",
					status: "error",
					durationMs: 250,
					errorMessage: "Analysis failed",
					createdAt: "2026-05-31T10:02:00Z",
				},
			],
			summary: {
				...response().summary,
				totalEvents: 3,
				totalSuccess: 2,
				totalError: 1,
			},
		};
		mockListAiStats
			.mockResolvedValueOnce(response())
			.mockResolvedValueOnce(errorResponse);

		renderStatsView();

		await waitFor(() => {
			expect(screen.getByTestId("stats-event-project-html-1")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTestId("stats-filter-errors"));

		await waitFor(() => {
			expect(mockListAiStats).toHaveBeenLastCalledWith({ limit: 200, status: "error" });
		});
		expect(screen.getByTestId("stats-event-analysis-error-1")).toBeInTheDocument();
		expect(screen.queryByTestId("stats-event-project-html-1")).not.toBeInTheDocument();
	});
});
