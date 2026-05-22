import { useState, useEffect, useCallback, useRef } from "react";
import { Box, Typography, IconButton, List, ListItem, Stack, Switch, FormControlLabel, Tooltip } from "@mui/material";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import RefreshIcon from "@mui/icons-material/Refresh";
import { cleanupAiStats, listAiStats } from "../../api/client.js";
import type { AiUsageEvent, AiUsageSummary } from "../../api/client.js";
import { ApiError } from "../../api/errors.js";
import { useAppState } from "../../state/store.js";

const DEFAULT_REFRESH_INTERVAL_MS = 30000;
const STATS_FONT_SIZE = {
	title: "var(--font-size-sm)",
	body: "var(--font-size-sm)",
	meta: "var(--font-size-xs)",
};

function getAiSummary(responseJson: string | null | undefined): string | undefined {
	if (!responseJson) return undefined;
	try {
		const parsed = JSON.parse(responseJson);
		return parsed.summary;
	} catch {
		return undefined;
	}
}

export function StatsView() {
	const { selectedAiEvent, setSelectedAiEvent, showConfirm } = useAppState();
	const [events, setEvents] = useState<AiUsageEvent[]>([]);
	const [summary, setSummary] = useState<AiUsageSummary | null>(null);
	const [loading, setLoading] = useState(false);
	const [cleaning, setCleaning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
	const [autoRefresh, setAutoRefresh] = useState(true);
	const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
	const intervalRef = useRef<number | null>(null);

	const loadStats = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await listAiStats({ limit: 50 });
			setEvents(response.data);
			setSummary(response.summary);
			setLastRefreshedAt(new Date());
			return response;
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to load stats");
			return null;
		} finally {
			setLoading(false);
		}
	}, []);

	const resetInterval = useCallback(() => {
		if (intervalRef.current) {
			window.clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
		if (autoRefresh) {
			intervalRef.current = window.setInterval(() => {
				void loadStats();
			}, DEFAULT_REFRESH_INTERVAL_MS);
		}
	}, [autoRefresh, loadStats]);

	useEffect(() => {
		void loadStats();
	}, [loadStats]);

	useEffect(() => {
		resetInterval();
		return () => {
			if (intervalRef.current) {
				window.clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [resetInterval]);

	const handleManualRefresh = useCallback(() => {
		setCleanupMessage(null);
		void loadStats();
		resetInterval();
	}, [loadStats, resetInterval]);

	const performCleanup = useCallback(async () => {
		setCleaning(true);
		setError(null);
		setCleanupMessage(null);
		try {
			const result = await cleanupAiStats();
			if (result.deleted > 0) {
				setSelectedAiEvent(null);
			}
			await loadStats();
			setCleanupMessage(result.deleted > 0 ? `Cleaned ${result.deleted} old records` : "Already latest per window");
			resetInterval();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to clean stats");
		} finally {
			setCleaning(false);
		}
	}, [loadStats, resetInterval, setSelectedAiEvent]);

	const handleCleanup = useCallback(() => {
		showConfirm({
			title: "Clean AI Usage Logs",
			message: "This will keep only the latest record for each target, session, and window. Older AI usage records will be permanently deleted.",
			confirmText: "Clean",
			confirmVariant: "danger",
			onConfirm: () => {
				void performCleanup();
			},
		});
	}, [performCleanup, showConfirm]);

	return (
		<Box data-testid="stats-view" sx={{ minHeight: 1 }}>
			<Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
				<Typography variant="subtitle2" sx={{ fontSize: STATS_FONT_SIZE.title, fontWeight: "var(--font-weight-semibold)" }}>
					AI Usage Stats
				</Typography>
				<Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
					<FormControlLabel
						control={
							<Switch
								size="small"
								checked={autoRefresh}
								onChange={(e) => setAutoRefresh(e.target.checked)}
								data-testid="stats-auto-refresh-switch"
							/>
						}
						label="Auto"
						sx={{ mr: 0, "& .MuiFormControlLabel-label": { fontSize: STATS_FONT_SIZE.body } }}
					/>
					<IconButton size="small" onClick={handleManualRefresh} data-testid="stats-refresh-button" aria-label="Refresh stats" disabled={loading}>
						<RefreshIcon fontSize="small" />
					</IconButton>
					<Tooltip title="Keep latest record per window">
						<span>
							<IconButton
								size="small"
								onClick={handleCleanup}
								data-testid="stats-cleanup-button"
								aria-label="Clean AI usage logs"
								disabled={loading || cleaning || events.length === 0}
							>
								<DeleteSweepIcon fontSize="small" />
							</IconButton>
						</span>
					</Tooltip>
				</Stack>
			</Stack>
			{lastRefreshedAt && (
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: STATS_FONT_SIZE.body, mb: 1.5, display: "block" }} data-testid="stats-last-refreshed">
					Last updated: {lastRefreshedAt.toLocaleTimeString()}
				</Typography>
			)}
			{cleanupMessage && (
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: STATS_FONT_SIZE.body, mb: 1, display: "block" }} data-testid="stats-cleanup-message">
					{cleanupMessage}
				</Typography>
			)}

			{error && (
				<Box data-testid="stats-error" sx={{ mb: 1, p: 1, bgcolor: "error.main", color: "error.contrastText", borderRadius: "var(--radius-sm)", fontSize: STATS_FONT_SIZE.body }}>
					<Typography variant="caption">{error}</Typography>
					<IconButton size="small" onClick={handleManualRefresh} data-testid="stats-retry-button" sx={{ color: "inherit", ml: 0.5 }} aria-label="Retry">
						<RefreshIcon fontSize="small" />
					</IconButton>
				</Box>
			)}

			{summary && (
				<Box data-testid="stats-summary" sx={{ mb: 1.5 }}>
					<Box sx={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: 1,
					}}>
						<Box sx={{
							p: 1.5,
							borderRadius: "var(--radius-md)",
							bgcolor: "background.default",
							border: "1px solid",
							borderColor: "success.main",
							borderLeftWidth: 3,
							textAlign: "center",
						}}>
							<Typography sx={{ fontSize: "var(--font-size-xl)", fontWeight: 700, color: "success.main", lineHeight: 1 }}>
								{summary.totalSuccess}
							</Typography>
							<Typography sx={{ fontSize: "var(--font-size-xs)", color: "text.secondary", mt: 0.25 }}>Success</Typography>
						</Box>
						<Box sx={{
							p: 1.5,
							borderRadius: "var(--radius-md)",
							bgcolor: "background.default",
							border: "1px solid",
							borderColor: "error.main",
							borderLeftWidth: 3,
							textAlign: "center",
						}}>
							<Typography sx={{ fontSize: "var(--font-size-xl)", fontWeight: 700, color: "error.main", lineHeight: 1 }}>
								{summary.totalError}
							</Typography>
							<Typography sx={{ fontSize: "var(--font-size-xs)", color: "text.secondary", mt: 0.25 }}>Errors</Typography>
						</Box>
					</Box>
				</Box>
			)}

			{loading && events.length === 0 ? (
				<Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 2 }}>Loading...</Typography>
			) : error && events.length === 0 ? null : events.length === 0 ? (
				<Typography variant="body2" color="text.secondary" data-testid="stats-empty" sx={{ textAlign: "center", py: 2 }}>No AI usage events yet</Typography>
			) : (
				<List disablePadding dense>
					{events.map((event) => (
						<ListItem
							key={event.id}
							onClick={() => setSelectedAiEvent(event)}
							data-testid={`stats-event-${event.id}`}
							sx={{
								px: 0,
								py: 0.5,
								borderRadius: "var(--radius-sm)",
								cursor: "pointer",
								bgcolor: selectedAiEvent?.id === event.id ? "action.selected" : "transparent",
								"&:hover": { bgcolor: "action.hover" },
								transition: "background-color 0.15s",
								overflow: "hidden",
							}}
						>
							<Stack direction="row" spacing={1} sx={{ alignItems: "center", width: "100%", minWidth: 0 }}>
								{/* Left accent bar */}
								<Box
									sx={{
										width: 3,
										borderRadius: "var(--radius-full)",
										alignSelf: "stretch",
										minHeight: 28,
										flexShrink: 0,
										backgroundColor: event.status === "success" ? "success.main" : event.status === "error" ? "error.main" : "text.disabled",
										opacity: 0.7,
									}}
								/>
								<Box sx={{ flex: 1, minWidth: 0, py: 0.25, pr: 1 }}>
									<Typography
										variant="body2"
										sx={{
											fontSize: STATS_FONT_SIZE.body,
											fontWeight: "var(--font-weight-medium)",
											whiteSpace: "nowrap",
											overflow: "hidden",
											textOverflow: "ellipsis",
										}}
										title={`${event.sessionName} ${getAiSummary(event.responseJson) ?? ""}`}
									>
										{event.sessionName}
									</Typography>
									{event.windowNumber != null && (
										<Typography variant="caption" color="text.secondary" sx={{ fontSize: STATS_FONT_SIZE.meta }}>
											W{event.windowNumber}
										</Typography>
									)}
								</Box>
							</Stack>
						</ListItem>
					))}
				</List>
			)}
		</Box>
	);
}
