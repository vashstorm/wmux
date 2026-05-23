import { useCallback, useEffect, useState } from "react";
import {
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Typography,
	Box,
	Paper,
	Button,
	IconButton,
	Stack,
} from "@mui/material";
import { Close as CloseIcon, Refresh as RefreshIcon } from "@mui/icons-material";
import { clearErrorLogs, fetchErrorLogs } from "../api/client.js";
import { ApiError, getErrorMessage } from "../api/errors.js";
import { useAppState } from "../state/store.js";

const ERROR_LOGS_FONT_SIZE = {
	title: "var(--font-size-lg)",
	subtitle: "var(--font-size-sm)",
	body: "var(--font-size-sm)",
	code: "var(--font-size-xs)",
};

export function ErrorLogsPanel() {
	const {
		showErrorLogsPanel,
		setShowErrorLogsPanel,
		setError,
		showConfirm,
		setErrorLogCount,
	} = useAppState();
	const [logEnabled, setLogEnabled] = useState(false);
	const [logPath, setLogPath] = useState<string | null>(null);
	const [logLines, setLogLines] = useState<string[]>([]);
	const [logTruncated, setLogTruncated] = useState(false);
	const [maxLines, setMaxLines] = useState(1000);
	const [isLoadingLogs, setIsLoadingLogs] = useState(false);
	const [hasLoadedLogs, setHasLoadedLogs] = useState(false);

	const fetchLogsf = useCallback(async () => {
		setIsLoadingLogs(true);
		try {
			const response = await fetchErrorLogs();
			setLogEnabled(response.enabled);
			setLogPath(response.path ?? null);
			setLogLines(response.lines);
			setLogTruncated(response.truncated);
			setMaxLines(response.maxLines);
			setErrorLogCount(response.enabled ? response.lines.length : 0);
		} catch (err) {
			if (err instanceof ApiError) {
				setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
			}
		} finally {
			setHasLoadedLogs(true);
			setIsLoadingLogs(false);
		}
	}, [setError, setErrorLogCount]);

	useEffect(() => {
		if (!showErrorLogsPanel) {
			return;
		}
		setHasLoadedLogs(false);
		void fetchLogsf();
	}, [showErrorLogsPanel, fetchLogsf]);

	const closePanel = () => {
		setShowErrorLogsPanel(false);
	};

	const handleClearLogs = () => {
		showConfirm({
			title: "Clear Error Logs",
			message: "This will permanently delete all error log entries. This cannot be undone.",
			confirmText: "Clear",
			confirmVariant: "danger",
			onConfirm: async () => {
				try {
					await clearErrorLogs();
					setLogLines([]);
					setErrorLogCount(0);
					await fetchLogsf();
				} catch (err) {
					if (err instanceof ApiError) {
						setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
					}
				}
			},
		});
	};

	return (
		<Dialog
			open={showErrorLogsPanel}
			onClose={closePanel}
			fullWidth
			maxWidth="md"
			data-testid="error-logs-panel"
			slotProps={{
				paper: {
					className: "error-logs-panel"
				}
			}}
		>
			<DialogTitle className="error-logs-panel-header" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 2 }}>
				<Box>
					<Typography variant="h6" component="span" id="error-logs-title" sx={{ fontSize: ERROR_LOGS_FONT_SIZE.title }}>Error Logs</Typography>
					<Typography variant="body2" color="text.secondary" sx={{ display: "block", fontSize: ERROR_LOGS_FONT_SIZE.subtitle }}>Recent backend error entries</Typography>
				</Box>
				<IconButton onClick={closePanel} aria-label="Close error logs" size="small">
					<CloseIcon />
				</IconButton>
			</DialogTitle>
			<DialogContent dividers className="error-logs-panel-body" sx={{ minHeight: 300, maxHeight: 600, overflow: "auto" }}>
				{logEnabled && logPath && (
					<Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontSize: ERROR_LOGS_FONT_SIZE.body }} data-testid="error-logs-path">
						Reading from <code>{logPath}</code>
					</Typography>
				)}

				{isLoadingLogs || !hasLoadedLogs ? (
					<Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 4 }}>
						<Typography sx={{ fontSize: ERROR_LOGS_FONT_SIZE.body }}>Loading error logs...</Typography>
					</Box>
				) : !logEnabled ? (
					<Box sx={{ py: 2 }} data-testid="error-logs-not-configured">
						<Typography color="text.secondary" sx={{ fontSize: ERROR_LOGS_FONT_SIZE.body }}>Error log file is not configured.</Typography>
					</Box>
				) : logLines.length === 0 ? (
					<Box sx={{ py: 2 }} data-testid="error-logs-empty">
						<Typography color="text.secondary" sx={{ fontSize: ERROR_LOGS_FONT_SIZE.body }}>No error logs found.</Typography>
					</Box>
				) : (
					<>
						{logTruncated && (
							<Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontSize: ERROR_LOGS_FONT_SIZE.body }}>
								Showing the last {maxLines} lines. Older entries have been truncated.
							</Typography>
						)}
						<Paper
							variant="outlined"
							className="error-logs-content"
							sx={{ p: 1, maxHeight: 400, overflow: "auto", fontFamily: "var(--font-mono)", fontSize: ERROR_LOGS_FONT_SIZE.code }}
							data-testid="error-logs-content"
						>
							{logLines.map((line, index) => (
								<Box
									key={`${index}-${line}`}
									component="code"
									data-testid="error-log-entry"
									sx={{ display: "block", fontSize: "inherit", fontFamily: "inherit", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all", py: 0.25 }}
								>
									{line}
								</Box>
							))}
						</Paper>
					</>
				)}
			</DialogContent>
			<DialogActions className="error-logs-panel-footer">
				<Stack direction="row" spacing={1} className="error-logs-toolbar" sx={{ mr: "auto" }}>
					<Button
						startIcon={<RefreshIcon />}
						onClick={() => void fetchLogsf()}
						disabled={isLoadingLogs}
						data-testid="error-logs-refresh"
						size="small"
					>
						{isLoadingLogs ? "Loading..." : "Refresh"}
					</Button>
					<Button
						onClick={handleClearLogs}
						disabled={logLines.length === 0 || isLoadingLogs}
						data-testid="error-logs-clear"
						size="small"
						color="error"
						variant="outlined"
					>
						Clear
					</Button>
				</Stack>
				<Button onClick={closePanel} size="small">Close</Button>
			</DialogActions>
		</Dialog>
	);
}
