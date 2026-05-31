import { useState, useEffect, useCallback } from "react";
import {
	Box,
	Typography,
	Button,
	CircularProgress,
	Chip,
	Alert,
	Stack,
	List,
	ListItem,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";
import { listAiLogs, clearAiLogs } from "../../api/client.js";
import type { AiLogEntry } from "../../api/client.js";
import { useAppState } from "../../state/store.js";

const AI_LOGS_FONT_SIZE = {
	title: "var(--font-size-sm)",
	body: "var(--font-size-sm)",
	meta: "var(--font-size-xs)",
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

function formatTimestampShort(timestamp: string): string {
	try {
		const date = new Date(timestamp);
		return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
	} catch {
		return timestamp;
	}
}

export function AiLogsView() {
	const { showConfirm, selectedAiLog, setSelectedAiLog } = useAppState();
	const [logs, setLogs] = useState<AiLogEntry[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);

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
		setSelectedAiLog(null);
		void loadLogs(true);
	}, [loadLogs, setSelectedAiLog]);

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
					setSelectedAiLog(null);
					void loadLogs(true);
				} catch (err) {
					const message = err instanceof Error ? err.message : "Failed to clear AI logs";
					setError(message);
				}
			},
		});
	}, [showConfirm, loadLogs, setSelectedAiLog]);

	useEffect(() => {
		void loadLogs(true);
	}, [loadLogs]);

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
				<Box>
					<List disablePadding dense>
						{logs.map((entry) => (
							<ListItem
								key={entry.id}
								onClick={() => setSelectedAiLog(entry)}
								data-testid={`ai-log-row-${entry.id}`}
								sx={{
									px: 1,
									py: 1,
									my: 0.5,
									borderRadius: "var(--radius-sm)",
									cursor: "pointer",
									bgcolor: selectedAiLog?.id === entry.id ? "action.selected" : "transparent",
									"&:hover": { bgcolor: "action.hover" },
									transition: "background-color 0.15s",
									overflow: "hidden",
								}}
							>
								<Stack direction="row" spacing={1.5} sx={{ alignItems: "center", width: "100%", minWidth: 0 }}>
									<Box
										sx={{
											width: 8,
											height: 8,
											borderRadius: "50%",
											flexShrink: 0,
											backgroundColor: entry.status === "success" ? "success.main" : entry.status === "error" ? "error.main" : "text.disabled",
											boxShadow: entry.status === "success"
												? "0 0 8px var(--color-success)"
												: entry.status === "error"
													? "0 0 8px var(--color-danger)"
													: "none",
										}}
									/>
									<Stack direction="column" sx={{ flex: 1, minWidth: 0, gap: 0.25 }}>
										<Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", gap: 1 }}>
											<Chip
												label={entry.eventKind}
												size="small"
												color={getEventKindColor(entry.eventKind)}
												sx={{ fontSize: "10px", height: 18, px: 0.5 }}
											/>
											<Typography variant="caption" color="text.secondary" sx={{ fontSize: "10px", whiteSpace: "nowrap" }}>
												{formatTimestampShort(entry.createdAt)}
											</Typography>
										</Stack>
										<Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", gap: 1 }}>
											<Typography
												variant="body2"
												sx={{
													fontSize: "var(--font-size-xs)",
													fontWeight: 500,
													whiteSpace: "nowrap",
													overflow: "hidden",
													textOverflow: "ellipsis",
													color: "text.primary",
												}}
												title={entry.toolName ? `Tool: ${entry.toolName}` : entry.model}
											>
												{entry.toolName ? `Tool: ${entry.toolName}` : entry.model}
											</Typography>
											<Typography variant="caption" color="text.secondary" sx={{ fontSize: "10px" }}>
												{entry.durationMs}ms
											</Typography>
										</Stack>
									</Stack>
								</Stack>
							</ListItem>
						))}
					</List>

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