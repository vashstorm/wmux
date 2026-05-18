import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { ErrorLogsPanel } from "./ErrorLogsPanel.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { AppProvider, useAppState } from "../state/store.js";
import * as client from "../api/client.js";

vi.mock("../api/client.js", () => ({
	fetchErrorLogs: vi.fn(),
	clearErrorLogs: vi.fn(),
}));

const mockFetchErrorLogs = vi.mocked(client.fetchErrorLogs);
const mockClearErrorLogs = vi.mocked(client.clearErrorLogs);

function TestWrapper({ children }: { children: React.ReactNode }) {
	return <AppProvider>{children}</AppProvider>;
}

function openErrorLogsPanel() {
	function Opener() {
		const { setShowErrorLogsPanel } = useAppState();
		useEffect(() => {
			setShowErrorLogsPanel(true);
		}, [setShowErrorLogsPanel]);
		return null;
	}
	return <Opener />;
}

describe("ErrorLogsPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchErrorLogs.mockResolvedValue({ enabled: true, path: "/tmp/wmux-error.log", lines: [], truncated: false, maxLines: 1000 });
		mockClearErrorLogs.mockResolvedValue(undefined);
	});

	async function renderOpenPanel() {
		render(
			<TestWrapper>
				{openErrorLogsPanel()}
				<ErrorLogsPanel />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("error-logs-panel")).toBeInTheDocument();
		});
	}

	test("displays error log lines when fetched", async () => {
		mockFetchErrorLogs.mockResolvedValue({
			enabled: true,
			path: "/tmp/wmux-error.log",
			lines: ["ERROR test line 1", "ERROR test line 2"],
			truncated: false,
			maxLines: 1000,
		});

		await renderOpenPanel();

		await waitFor(() => {
			expect(screen.getByTestId("error-logs-content")).toBeInTheDocument();
		});
		expect(screen.getByTestId("error-logs-content").textContent).toContain("ERROR test line 1");
		expect(screen.getByTestId("error-logs-content").textContent).toContain("ERROR test line 2");
		expect(screen.getAllByTestId("error-log-entry")).toHaveLength(2);
	});

	test("shows configured error log path", async () => {
		mockFetchErrorLogs.mockResolvedValue({
			enabled: true,
			path: "/var/log/wmux-error.log",
			lines: ["ERROR test line"],
			truncated: false,
			maxLines: 1000,
		});

		await renderOpenPanel();

		await waitFor(() => {
			expect(screen.getByTestId("error-logs-path")).toHaveTextContent("/var/log/wmux-error.log");
		});
	});

	test("shows empty state when no log lines", async () => {
		await renderOpenPanel();

		await waitFor(() => {
			expect(screen.getByTestId("error-logs-empty")).toBeInTheDocument();
		});
	});

	test("shows not configured state when error logging is disabled", async () => {
		mockFetchErrorLogs.mockResolvedValue({
			enabled: false,
			path: null,
			lines: [],
			truncated: false,
			maxLines: 1000,
		});

		await renderOpenPanel();

		await waitFor(() => {
			expect(screen.getByTestId("error-logs-not-configured")).toHaveTextContent("Error log file is not configured.");
		});
		expect(screen.queryByTestId("error-logs-empty")).not.toBeInTheDocument();
	});

	test("shows truncated notice when response is truncated", async () => {
		mockFetchErrorLogs.mockResolvedValue({
			enabled: true,
			path: "/tmp/wmux-error.log",
			lines: ["line1"],
			truncated: true,
			maxLines: 1000,
		});

		await renderOpenPanel();

		await waitFor(() => {
			expect(screen.getByText(/Showing the last 1000 lines/)).toBeInTheDocument();
		});
	});

	test("clear button opens confirm dialog and clears logs", async () => {
		mockFetchErrorLogs
			.mockResolvedValueOnce({
				enabled: true,
				path: "/tmp/wmux-error.log",
				lines: ["ERROR to clear"],
				truncated: false,
				maxLines: 1000,
			})
			.mockResolvedValueOnce({
				enabled: true,
				path: "/tmp/wmux-error.log",
				lines: [],
				truncated: false,
				maxLines: 1000,
			});

		render(
			<TestWrapper>
				{openErrorLogsPanel()}
				<ErrorLogsPanel />
				<ConfirmDialog />
			</TestWrapper>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("error-logs-panel")).toBeInTheDocument();
		});
		await waitFor(() => {
			expect(screen.getByTestId("error-logs-clear")).not.toBeDisabled();
		});

		fireEvent.click(screen.getByTestId("error-logs-clear"));

		await waitFor(() => {
			expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

		await waitFor(() => {
			expect(mockClearErrorLogs).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(mockFetchErrorLogs).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(screen.getByTestId("error-logs-empty")).toBeInTheDocument();
		});
	});

	test("refresh button re-fetches logs", async () => {
		mockFetchErrorLogs.mockResolvedValue({
			enabled: true,
			path: "/tmp/wmux-error.log",
			lines: ["first fetch"],
			truncated: false,
			maxLines: 1000,
		});

		await renderOpenPanel();

		fireEvent.click(screen.getByTestId("error-logs-refresh"));

		await waitFor(() => {
			expect(mockFetchErrorLogs).toHaveBeenCalledTimes(2);
		});
	});
});
