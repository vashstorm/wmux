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
		<Dialog open={showErrorLogsPanel} onClose={closePanel} fullWidth maxWidth="md" data-testid="error-logs-panel">
			<DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 2 }}>
				<Box>
					<Typography variant="h6" component="span" id="error-logs-title">Error Logs</Typography>
					<Typography variant="body2" color="text.secondary" sx={{ display: "block" }}>Recent backend error entries</Typography>
				</Box>
				<IconButton onClick={closePanel} aria-label="Close error logs" size="small">
					<CloseIcon />
				</IconButton>
			</DialogTitle>
			<DialogContent dividers sx={{ minHeight: 300, maxHeight: 600, overflow: "auto" }}>
				{logEnabled && logPath && (
					<Typography variant="body2" color="text.secondary" sx={{ mb: 1 }} data-testid="error-logs-path">
						Reading from <code>{logPath}</code>
					</Typography>
				)}

				{isLoadingLogs || !hasLoadedLogs ? (
					<Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 4 }}>
						<Typography>Loading error logs...</Typography>
					</Box>
				) : !logEnabled ? (
					<Box sx={{ py: 2 }} data-testid="error-logs-not-configured">
						<Typography color="text.secondary">Error log file is not configured.</Typography>
					</Box>
				) : logLines.length === 0 ? (
					<Box sx={{ py: 2 }} data-testid="error-logs-empty">
						<Typography color="text.secondary">No error logs found.</Typography>
					</Box>
				) : (
					<>
						{logTruncated && (
							<Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
								Showing the last {maxLines} lines. Older entries have been truncated.
							</Typography>
						)}
						<Paper
							variant="outlined"
							sx={{ p: 1, maxHeight: 400, overflow: "auto", fontFamily: "monospace", fontSize: "var(--font-size-md)", bgcolor: "action.hover" }}
							data-testid="error-logs-content"
						>
							{logLines.map((line, index) => (
								<Box
									key={`${index}-${line}`}
									component="code"
									data-testid="error-log-entry"
									sx={{ display: "block", whiteSpace: "pre-wrap", wordBreak: "break-all", py: 0.25 }}
								>
									{line}
								</Box>
							))}
						</Paper>
					</>
				)}
			</DialogContent>
			<DialogActions>
				<Stack direction="row" spacing={1} sx={{ mr: "auto" }}>
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
