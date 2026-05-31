import { useState, useEffect, useCallback, Fragment } from "react";
import {
	Box,
	Typography,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableRow,
	Button,
	CircularProgress,
	Chip,
	Alert,
	Collapse,
	IconButton,
	Stack,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { listAiLogs, clearAiLogs } from "../../api/client.js";
import type { AiLogEntry } from "../../api/client.js";
import { useAppState } from "../../state/store.js";

const AI_LOGS_FONT_SIZE = {
	title: "var(--font-size-sm)",
	body: "var(--font-size-sm)",
	meta: "var(--font-size-xs)",
	code: "var(--font-size-xs)",
};

const PAGE_LIMIT = 50;

function getEventKindColor(eventKind: string): "primary" | "secondary" | "success" | "warning" | "error" | "info" | "default" {
	switch (eventKind) {
		case "llm_call":
			return "primary";
		case "tool_call":
			return "secondary";
		case "tool_result":
			return "info";
		case "conversation_start":
			return "success";
		case "conversation_end":
			return "warning";
		default:
			return "default";
	}
}

function getStatusColor(status: string): "success" | "error" | "warning" | "default" {
	switch (status) {
		case "success":
			return "success";
		case "error":
			return "error";
		case "pending":
			return "warning";
		default:
			return "default";
	}
}

function formatTimestamp(timestamp: string): string {
	try {
		const date = new Date(timestamp);
		return date.toLocaleString();
	} catch {
		return timestamp;
	}
}

function formatJson(jsonStr: string | null | undefined): string {
	if (!jsonStr) return "";
	try {
		const parsed = JSON.parse(jsonStr);
		return JSON.stringify(parsed, null, 2);
	} catch {
		return jsonStr;
	}
}

export function AiLogsView() {
	const { showConfirm } = useAppState();
	const [logs, setLogs] = useState<AiLogEntry[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

	const loadLogs = useCallback(async (replace = true) => {
		if (replace) {
			setLoading(true);
		} else {
			setLoadingMore(true);
		}
		setError(null);
		try {
			const response = await listAiLogs({ limit: PAGE_LIMIT });
			if (replace) {
				setLogs(response.data);
			} else {
				setLogs((prev) => [...prev, ...response.data]);
			}
			setNextCursor(response.nextCursor);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to load AI logs";
			setError(message);
		} finally {
			setLoading(false);
			setLoadingMore(false);
		}
	}, []);

	const loadMore = useCallback(async () => {
		if (!nextCursor) return;
		setLoadingMore(true);
		setError(null);
		try {
			const response = await listAiLogs({ limit: PAGE_LIMIT, before: nextCursor });
			setLogs((prev) => [...prev, ...response.data]);
			setNextCursor(response.nextCursor);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to load more AI logs";
			setError(message);
		} finally {
			setLoadingMore(false);
		}
	}, [nextCursor]);

	const refresh = useCallback(() => {
		setExpandedIds(new Set());
		void loadLogs(true);
	}, [loadLogs]);

	const handleClear = useCallback(() => {
		showConfirm({
			title: "Clear AI Logs",
			message: "Are you sure you want to clear all AI logs? This action cannot be undone.",
			confirmText: "Clear",
			confirmVariant: "danger",
			onConfirm: async () => {
				try {
					await clearAiLogs();
					setLogs([]);
					setNextCursor(null);
					setExpandedIds(new Set());
					void loadLogs(true);
				} catch (err) {
					const message = err instanceof Error ? err.message : "Failed to clear AI logs";
					setError(message);
				}
			},
		});
	}, [showConfirm, loadLogs]);

	const toggleExpand = useCallback((id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}, []);

	useEffect(() => {
		void loadLogs(true);
	}, [loadLogs]);

	const renderExpandedDetails = (entry: AiLogEntry) => {
		return (
			<Box sx={{ p: 2, bgcolor: "action.hover", borderRadius: "var(--radius-sm)" }}>
				{entry.promptText && (
					<Box sx={{ mb: 1.5 }}>
						<Typography variant="subtitle2" sx={{ fontSize: AI_LOGS_FONT_SIZE.meta, fontWeight: 600, mb: 0.5 }}>
							Prompt
						</Typography>
						<Box
							sx={{
								p: 1,
								bgcolor: "background.paper",
								borderRadius: "var(--radius-sm)",
								fontFamily: "var(--font-mono)",
								fontSize: AI_LOGS_FONT_SIZE.code,
								whiteSpace: "pre-wrap",
								wordBreak: "break-word",
								maxHeight: 150,
								overflow: "auto",
							}}
						>
							{entry.promptText}
						</Box>
					</Box>
				)}

				{entry.toolName && (
					<Box sx={{ mb: 1.5 }}>
						<Typography variant="subtitle2" sx={{ fontSize: AI_LOGS_FONT_SIZE.meta, fontWeight: 600, mb: 0.5 }}>
							Tool: {entry.toolName}
						</Typography>
						{entry.toolCallId && (
							<Typography sx={{ fontSize: AI_LOGS_FONT_SIZE.meta, color: "text.secondary", mb: 0.5 }}>
								Call ID: {entry.toolCallId}
							</Typography>
						)}
						{entry.toolArgumentsJson && (
							<Box sx={{ mb: 0.5 }}>
								<Typography sx={{ fontSize: AI_LOGS_FONT_SIZE.meta, color: "text.secondary", mb: 0.25 }}>
									Arguments:
								</Typography>
								<Box
									sx={{
										p: 1,
										bgcolor: "background.paper",
										borderRadius: "var(--radius-sm)",
										fontFamily: "var(--font-mono)",
										fontSize: AI_LOGS_FONT_SIZE.code,
										whiteSpace: "pre-wrap",
										maxHeight: 100,
										overflow: "auto",
									}}
								>
									{formatJson(entry.toolArgumentsJson)}
								</Box>
							</Box>
						)}
						{entry.toolResultJson && (
							<Box>
								<Typography sx={{ fontSize: AI_LOGS_FONT_SIZE.meta, color: "text.secondary", mb: 0.25 }}>
									Result:
								</Typography>
								<Box
									sx={{
										p: 1,
										bgcolor: "background.paper",
										borderRadius: "var(--radius-sm)",
										fontFamily: "var(--font-mono)",
										fontSize: AI_LOGS_FONT_SIZE.code,
										whiteSpace: "pre-wrap",
										maxHeight: 150,
										overflow: "auto",
									}}
								>
									{formatJson(entry.toolResultJson)}
								</Box>
							</Box>
						)}
					</Box>
				)}

				{entry.metricsJson && (
					<Box sx={{ mb: 1.5 }}>
						<Typography variant="subtitle2" sx={{ fontSize: AI_LOGS_FONT_SIZE.meta, fontWeight: 600, mb: 0.5 }}>
							Metrics
						</Typography>
						<Box
							sx={{
								p: 1,
								bgcolor: "background.paper",
								borderRadius: "var(--radius-sm)",
								fontFamily: "var(--font-mono)",
								fontSize: AI_LOGS_FONT_SIZE.code,
								whiteSpace: "pre-wrap",
							}}
						>
							{formatJson(entry.metricsJson)}
						</Box>
					</Box>
				)}

				{entry.errorMessage && (
					<Box sx={{ mb: 1.5 }}>
						<Typography variant="subtitle2" sx={{ fontSize: AI_LOGS_FONT_SIZE.meta, fontWeight: 600, mb: 0.5, color: "error.main" }}>
							Error
						</Typography>
						<Alert severity="error" sx={{ fontSize: AI_LOGS_FONT_SIZE.body }}>
							{entry.errorMessage}
						</Alert>
					</Box>
				)}

				{entry.rawEventJson && (
					<Box>
						<Typography variant="subtitle2" sx={{ fontSize: AI_LOGS_FONT_SIZE.meta, fontWeight: 600, mb: 0.5 }}>
							Raw Event
						</Typography>
						<Box
							sx={{
								p: 1,
								bgcolor: "background.paper",
								borderRadius: "var(--radius-sm)",
								fontFamily: "var(--font-mono)",
								fontSize: AI_LOGS_FONT_SIZE.code,
								whiteSpace: "pre-wrap",
								maxHeight: 200,
								overflow: "auto",
							}}
						>
							{formatJson(entry.rawEventJson)}
						</Box>
					</Box>
				)}
			</Box>
		);
	};

	return (
		<Box data-testid="ai-logs-view" sx={{ minHeight: 1, p: 2 }}>
			<Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
				<Typography variant="subtitle2" sx={{ fontSize: AI_LOGS_FONT_SIZE.title, fontWeight: 600 }}>
					AI Logs
				</Typography>
				<Stack direction="row" spacing={0.5}>
					<Button
						size="small"
						startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
						onClick={refresh}
						disabled={loading || loadingMore}
						data-testid="ai-logs-refresh"
					>
						{loading ? "Loading..." : "Refresh"}
					</Button>
					<Button
						size="small"
						startIcon={<DeleteIcon />}
						onClick={handleClear}
						disabled={logs.length === 0 || loading || loadingMore}
						color="error"
						variant="outlined"
						data-testid="ai-logs-clear"
					>
						Clear
					</Button>
				</Stack>
			</Stack>

			{error && (
				<Alert severity="error" sx={{ mb: 1.5 }} data-testid="ai-logs-error">
					{error}
				</Alert>
			)}

			{loading && logs.length === 0 ? (
				<Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 4 }}>
					<CircularProgress size={24} />
					<Typography sx={{ ml: 1, fontSize: AI_LOGS_FONT_SIZE.body }}>Loading AI logs...</Typography>
				</Box>
			) : !error && logs.length === 0 ? (
				<Box data-testid="ai-logs-empty" sx={{ py: 4, textAlign: "center" }}>
					<Typography color="text.secondary" sx={{ fontSize: AI_LOGS_FONT_SIZE.body }}>
						No AI logs found.
					</Typography>
				</Box>
			) : (
				<Box sx={{ overflow: "auto" }}>
					<Table size="small">
						<TableHead>
							<TableRow>
								<TableCell sx={{ fontSize: AI_LOGS_FONT_SIZE.meta, width: 40 }}></TableCell>
								<TableCell sx={{ fontSize: AI_LOGS_FONT_SIZE.meta }}>Event</TableCell>
								<TableCell sx={{ fontSize: AI_LOGS_FONT_SIZE.meta }}>Model</TableCell>
								<TableCell sx={{ fontSize: AI_LOGS_FONT_SIZE.meta }}>Status</TableCell>
								<TableCell sx={{ fontSize: AI_LOGS_FONT_SIZE.meta }}>Duration</TableCell>
								<TableCell sx={{ fontSize: AI_LOGS_FONT_SIZE.meta }}>Time</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{logs.map((entry) => (
								<Fragment key={entry.id}>
									<TableRow data-testid={`ai-log-row-${entry.id}`}>
										<TableCell sx={{ width: 40 }}>
											<IconButton
												size="small"
												onClick={() => toggleExpand(entry.id)}
												data-testid={`ai-log-expand-${entry.id}`}
												aria-label={expandedIds.has(entry.id) ? "Collapse" : "Expand"}
											>
												{expandedIds.has(entry.id) ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
											</IconButton>
										</TableCell>
										<TableCell>
											<Chip
												label={entry.eventKind}
												size="small"
												color={getEventKindColor(entry.eventKind)}
												sx={{ fontSize: AI_LOGS_FONT_SIZE.meta }}
											/>
										</TableCell>
										<TableCell sx={{ fontSize: AI_LOGS_FONT_SIZE.body }}>{entry.model}</TableCell>
										<TableCell>
											<Chip
												label={entry.status}
												size="small"
												color={getStatusColor(entry.status)}
												sx={{ fontSize: AI_LOGS_FONT_SIZE.meta }}
											/>
										</TableCell>
										<TableCell sx={{ fontSize: AI_LOGS_FONT_SIZE.body }}>{entry.durationMs}ms</TableCell>
										<TableCell sx={{ fontSize: AI_LOGS_FONT_SIZE.meta }}>{formatTimestamp(entry.createdAt)}</TableCell>
									</TableRow>
									<TableRow key={`${entry.id}-details`}>
										<TableCell sx={{ p: 0 }} colSpan={6}>
											<Collapse in={expandedIds.has(entry.id)}>
												<Box data-testid={`ai-log-details-${entry.id}`}>
													{renderExpandedDetails(entry)}
												</Box>
											</Collapse>
										</TableCell>
									</TableRow>
								</Fragment>
							))}
						</TableBody>
					</Table>

					{nextCursor && (
						<Box sx={{ mt: 2, textAlign: "center" }}>
							<Button
								size="small"
								onClick={loadMore}
								disabled={loadingMore}
								data-testid="ai-logs-load-more"
								startIcon={loadingMore ? <CircularProgress size={16} /> : undefined}
							>
								{loadingMore ? "Loading..." : "Load More"}
							</Button>
						</Box>
					)}
				</Box>
			)}
		</Box>
	);
}