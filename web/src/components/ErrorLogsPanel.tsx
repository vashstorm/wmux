import { useCallback, useEffect, useState, useRef } from "react";
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
	TextField,
	InputAdornment,
	Tooltip,
	FormControlLabel,
	Checkbox,
} from "@mui/material";
import {
	Close as CloseIcon,
	Refresh as RefreshIcon,
	ContentCopy as ContentCopyIcon,
	Check as CheckIcon,
	Search as SearchIcon,
	WrapText as WrapTextIcon,
	CheckCircle as CheckCircleIcon,
} from "@mui/icons-material";
import { clearErrorLogs, fetchErrorLogs } from "../api/client.js";
import { ApiError, getErrorMessage } from "../api/errors.js";
import { useAppState } from "../state/store.js";

const ERROR_LOGS_FONT_SIZE = {
	title: "var(--font-size-lg)",
	subtitle: "var(--font-size-sm)",
	body: "var(--font-size-sm)",
	code: "var(--font-size-xs)",
};

interface ParsedLog {
	raw: string;
	timestamp?: string;
	level?: "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE";
	target?: string;
	message: string;
	isParsed: boolean;
}

function parseLogLine(line: string): ParsedLog {
	// Pattern for standard tracing logs: e.g. 2026-05-31T06:46:12.345678Z ERROR wmux_server: failed to bind to 127.0.0.1:7331
	const strictMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(ERROR|WARN|INFO|DEBUG|TRACE)\s+([a-zA-Z0-9_::\-]+):\s+(.*)$/);
	if (strictMatch && strictMatch[1] && strictMatch[2] && strictMatch[3] && strictMatch[4]) {
		return {
			raw: line,
			timestamp: strictMatch[1],
			level: strictMatch[2] as ParsedLog["level"],
			target: strictMatch[3],
			message: strictMatch[4],
			isParsed: true,
		};
	}

	// Pattern for simplified logs: e.g. ERROR test line 1
	const simpleMatch = line.match(/^(\bERROR|WARN|INFO|DEBUG|TRACE\b)\s+(.*)$/);
	if (simpleMatch && simpleMatch[1] && simpleMatch[2]) {
		return {
			raw: line,
			level: simpleMatch[1] as ParsedLog["level"],
			message: simpleMatch[2],
			isParsed: true,
		};
	}

	return {
		raw: line,
		message: line,
		isParsed: false,
	};
}

function formatTimestamp(isoStr: string): string {
	try {
		const match = isoStr.match(/T(\d{2}:\d{2}:\d{2})/);
		if (match && match[1]) {
			return match[1];
		}
		return isoStr;
	} catch {
		return isoStr;
	}
}

function highlightText(text: string, query: string): React.ReactNode {
	if (!query.trim()) return text;
	const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const parts = text.split(new RegExp(`(${escapedQuery})`, "gi"));
	return parts.map((part, index) =>
		part.toLowerCase() === query.toLowerCase() ? (
			<mark key={index} className="error-log-highlight">
				{part}
			</mark>
		) : (
			part
		)
	);
}

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

	// New UX/UI states
	const [searchQuery, setSearchQuery] = useState("");
	const [wordWrap, setWordWrap] = useState(true);
	const [autoScroll, setAutoScroll] = useState(true);
	const [copiedPath, setCopiedPath] = useState(false);
	const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
	const logsContainerRef = useRef<HTMLDivElement>(null);

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

	// Autoscroll to bottom logic
	const scrollToBottom = useCallback(() => {
		if (logsContainerRef.current) {
			logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
		}
	}, []);

	useEffect(() => {
		if (autoScroll && logLines.length > 0 && !isLoadingLogs) {
			const timer = setTimeout(scrollToBottom, 50);
			return () => clearTimeout(timer);
		}
	}, [logLines, isLoadingLogs, autoScroll, scrollToBottom]);

	useEffect(() => {
		if (showErrorLogsPanel && autoScroll) {
			const timer = setTimeout(scrollToBottom, 100);
			return () => clearTimeout(timer);
		}
	}, [showErrorLogsPanel, autoScroll, scrollToBottom]);

	const closePanel = () => {
		setShowErrorLogsPanel(false);
	};

	const handleCopyPath = async () => {
		if (!logPath) return;
		try {
			await navigator.clipboard.writeText(logPath);
			setCopiedPath(true);
			setTimeout(() => setCopiedPath(false), 1500);
		} catch {}
	};

	const handleCopyText = async (text: string, index: number) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedIndex(index);
			setTimeout(() => setCopiedIndex(null), 1500);
		} catch {}
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

	// Parse and filter lines
	const parsedLines = logLines.map((line, idx) => ({ ...parseLogLine(line), originalIndex: idx }));
	const filteredLines = parsedLines.filter(parsed =>
		parsed.raw.toLowerCase().includes(searchQuery.toLowerCase())
	);

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
					<Typography variant="h6" component="span" id="error-logs-title" sx={{ fontSize: ERROR_LOGS_FONT_SIZE.title, fontWeight: 700 }}>Error Logs</Typography>
					<Typography variant="body2" color="text.secondary" sx={{ display: "block", fontSize: ERROR_LOGS_FONT_SIZE.subtitle }}>Recent backend error entries</Typography>
				</Box>
				<IconButton onClick={closePanel} aria-label="Close error logs" size="small">
					<CloseIcon />
				</IconButton>
			</DialogTitle>
			<DialogContent dividers className="error-logs-panel-body">
				{logEnabled && logPath && (
					<Box className="error-logs-toolbar">
						<Box className="error-logs-path-container">
							<Typography variant="body2" color="text.secondary" sx={{ fontSize: ERROR_LOGS_FONT_SIZE.body, display: "flex", alignItems: "center", gap: 0.5 }}>
								Reading from
							</Typography>
							<code className="error-logs-path" data-testid="error-logs-path">{logPath}</code>
							<Tooltip title={copiedPath ? "Copied!" : "Copy path"} arrow>
								<IconButton size="small" onClick={handleCopyPath} sx={{ p: 0.5 }}>
									{copiedPath ? <CheckIcon fontSize="small" sx={{ color: "var(--color-success)" }} /> : <ContentCopyIcon fontSize="small" />}
								</IconButton>
							</Tooltip>
						</Box>
						<Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
							<FormControlLabel
								control={
									<Checkbox
										size="small"
										checked={wordWrap}
										onChange={(e) => setWordWrap(e.target.checked)}
										icon={<WrapTextIcon fontSize="small" />}
										checkedIcon={<WrapTextIcon fontSize="small" color="primary" />}
									/>
								}
								label={<Typography variant="body2" sx={{ fontSize: "var(--font-size-xs)" }}>Wrap</Typography>}
								sx={{ m: 0, mr: 1 }}
							/>
							<FormControlLabel
								control={
									<Checkbox
										size="small"
										checked={autoScroll}
										onChange={(e) => setAutoScroll(e.target.checked)}
									/>
								}
								label={<Typography variant="body2" sx={{ fontSize: "var(--font-size-xs)" }}>Autoscroll</Typography>}
								sx={{ m: 0 }}
							/>
						</Stack>
					</Box>
				)}

				{isLoadingLogs || !hasLoadedLogs ? (
					<Box sx={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", py: 8 }}>
						<Typography sx={{ fontSize: ERROR_LOGS_FONT_SIZE.body, color: "text.secondary" }}>Loading error logs...</Typography>
					</Box>
				) : !logEnabled ? (
					<Box className="error-logs-empty-state" data-testid="error-logs-not-configured">
						<Typography color="text.secondary" sx={{ fontSize: ERROR_LOGS_FONT_SIZE.body }}>Error log file is not configured.</Typography>
					</Box>
				) : logLines.length === 0 ? (
					<Box className="error-logs-empty-state" data-testid="error-logs-empty">
						<Box className="error-logs-empty-icon-wrap">
							<CheckCircleIcon sx={{ fontSize: 32 }} />
						</Box>
						<Typography variant="body1" sx={{ fontWeight: 700 }}>System Healthy</Typography>
						<Typography variant="body2" color="text.secondary" sx={{ fontSize: ERROR_LOGS_FONT_SIZE.body }}>No error logs found. Everything is running smoothly.</Typography>
					</Box>
				) : (
					<Box className="error-logs-content-wrap">
						<TextField
							size="small"
							placeholder="Search logs..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							variant="outlined"
							fullWidth
							slotProps={{
								input: {
									startAdornment: (
										<InputAdornment position="start">
											<SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
										</InputAdornment>
									),
									sx: { height: 36, fontSize: "var(--font-size-sm)", borderRadius: "var(--radius-input)" }
								}
							}}
						/>
						
						<Box className="error-logs-meta-row">
							{logTruncated ? (
								<Typography variant="caption" className="error-logs-truncated">
									Showing the last {maxLines} lines. Older entries have been truncated.
								</Typography>
							) : <Box />}
							<Typography variant="caption" sx={{ color: "text.secondary", ml: "auto" }}>
								Showing {filteredLines.length} of {logLines.length} entries
							</Typography>
						</Box>

						<Paper
							variant="outlined"
							className="error-logs-content"
							ref={logsContainerRef}
							data-testid="error-logs-content"
						>
							{filteredLines.length === 0 ? (
								<Box sx={{ py: 4, textAlign: "center" }}>
									<Typography variant="body2" color="text.secondary">No matching log entries found.</Typography>
								</Box>
							) : (
								filteredLines.map((parsed, idx) => (
									<Box
										key={`${parsed.originalIndex}-${parsed.raw}`}
										component="code"
										data-testid="error-log-entry"
										className="error-log-entry"
										style={{
											borderLeftColor: parsed.level === "ERROR" 
												? "var(--color-danger)" 
												: parsed.level === "WARN" 
													? "var(--color-warning)" 
													: parsed.level === "INFO" 
														? "var(--color-success)" 
														: "var(--color-text-disabled)",
											whiteSpace: wordWrap ? "pre-wrap" : "pre",
											overflowX: wordWrap ? "visible" : "auto",
										}}
									>
										<div className="error-log-entry-row">
											{parsed.isParsed ? (
												<>
													<div className="error-log-entry-meta">
														<span className={`error-log-entry-level level-${parsed.level?.toLowerCase() ?? "other"}`}>
															{parsed.level}
														</span>
														{parsed.timestamp && (
															<>
																{" "}
																<Tooltip title={parsed.timestamp} arrow>
																	<span className="error-log-entry-timestamp">
																		{formatTimestamp(parsed.timestamp)}
																	</span>
																</Tooltip>
															</>
														)}
														{parsed.target && (
															<>
																{" "}
																<span className="error-log-entry-target">
																	{parsed.target}
																</span>
															</>
														)}
													</div>
													{" "}
													<span className="error-log-entry-message">
														{highlightText(parsed.message, searchQuery)}
													</span>
												</>
											) : (
												<span className="error-log-entry-message">
													{highlightText(parsed.raw, searchQuery)}
												</span>
											)}
										</div>
										<div className="error-log-entry-copy-btn">
											<Tooltip title={copiedIndex === parsed.originalIndex ? "Copied!" : "Copy entry"} arrow placement="left">
												<IconButton
													size="small"
													onClick={(e) => {
														e.stopPropagation();
														void handleCopyText(parsed.raw, parsed.originalIndex);
													}}
													sx={{ 
														p: 0.5, 
														backgroundColor: "var(--color-surface)", 
														border: "1px solid var(--color-panel-border)",
														"&:hover": { backgroundColor: "var(--color-surface-hover)" }
													}}
												>
													{copiedIndex === parsed.originalIndex 
														? <CheckIcon sx={{ fontSize: 13, color: "var(--color-success)" }} /> 
														: <ContentCopyIcon sx={{ fontSize: 13 }} />
													}
												</IconButton>
											</Tooltip>
										</div>
									</Box>
								))
							)}
						</Paper>
					</Box>
				)}
			</DialogContent>
			<DialogActions className="error-logs-panel-footer">
				<Stack direction="row" spacing={1} className="error-logs-toolbar-footer" sx={{ mr: "auto" }}>
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
