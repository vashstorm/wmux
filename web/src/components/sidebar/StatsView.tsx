import { useState, useEffect, useCallback, useRef } from "react";
import { Box, Typography, IconButton, List, ListItem, Chip, Stack, Switch, FormControlLabel } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { listAiStats } from "../../api/client.js";
import type { AiUsageEvent, AiUsageSummary } from "../../api/client.js";
import { ApiError } from "../../api/errors.js";
import { useAppState } from "../../state/store.js";

const DEFAULT_REFRESH_INTERVAL_MS = 30000;
const STATS_FONT_SIZE = {
	title: "18px",
	body: "15px",
	meta: "13px",
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
	const { selectedAiEvent, setSelectedAiEvent } = useAppState();
	const [events, setEvents] = useState<AiUsageEvent[]>([]);
	const [summary, setSummary] = useState<AiUsageSummary | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
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
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to load stats");
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
		void loadStats();
		resetInterval();
	}, [loadStats, resetInterval]);

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
				</Stack>
			</Stack>
			{lastRefreshedAt && (
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: STATS_FONT_SIZE.body, mb: 1.5, display: "block" }} data-testid="stats-last-refreshed">
					Last updated: {lastRefreshedAt.toLocaleTimeString()}
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
				<Box data-testid="stats-summary" sx={{ mb: 1, p: 1, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
					<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 0.5 }}>
						<Chip label={`${summary.totalEvents} total`} size="small" variant="outlined" sx={{ fontSize: STATS_FONT_SIZE.body, height: 30 }} />
						<Chip label={`${summary.totalSuccess} ✓`} size="small" color="success" variant="outlined" sx={{ fontSize: STATS_FONT_SIZE.body, height: 30 }} />
						<Chip label={`${summary.totalError} ✗`} size="small" color="error" variant="outlined" sx={{ fontSize: STATS_FONT_SIZE.body, height: 30 }} />
						<Chip label={`${summary.totalDurationMs}ms`} size="small" variant="outlined" sx={{ fontSize: STATS_FONT_SIZE.body, height: 30 }} />
					</Stack>
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
								px: 1,
								py: 0.75,
								borderRadius: "var(--radius-sm)",
								cursor: "pointer",
								bgcolor: selectedAiEvent?.id === event.id ? "action.selected" : "transparent",
								"&:hover": { bgcolor: "action.hover" },
								transition: "background-color 0.15s",
							}}
						>
							<Stack direction="row" spacing={1} sx={{ alignItems: "center", width: "100%", minWidth: 0 }}>
								<Box
									sx={{
										width: 7,
										height: 7,
										borderRadius: "50%",
										bgcolor: event.status === "success" ? "success.main" : event.status === "error" ? "error.main" : "text.disabled",
										flexShrink: 0,
									}}
								/>
								<Typography
									variant="body2"
									sx={{
										fontSize: STATS_FONT_SIZE.body,
										fontWeight: "var(--font-weight-medium)",
										whiteSpace: "nowrap",
										overflow: "hidden",
										textOverflow: "ellipsis",
										minWidth: 0,
										flex: 1,
									}}
									title={`${event.provider}/${event.model} ${getAiSummary(event.responseJson) ?? ""}`}
								>
									{event.provider}/{event.model}
								</Typography>
								{event.windowNumber != null && (
									<Typography variant="caption" color="text.secondary" sx={{ fontSize: STATS_FONT_SIZE.meta, flexShrink: 0 }}>
										W{event.windowNumber}
									</Typography>
								)}
								{getAiSummary(event.responseJson) && (
									<Typography
										variant="caption"
										sx={{
											fontSize: STATS_FONT_SIZE.meta,
											flexShrink: 1,
											minWidth: 0,
											overflow: "hidden",
											textOverflow: "ellipsis",
											color: "text.secondary",
											ml: 0.5,
										}}
									>
										{getAiSummary(event.responseJson)}
									</Typography>
								)}
								<Typography variant="caption" color="text.secondary" sx={{ fontSize: STATS_FONT_SIZE.meta, flexShrink: 0 }}>
									{event.durationMs}ms
								</Typography>
								{event.totalTokens != null && (
									<Typography variant="caption" color="text.disabled" sx={{ fontSize: STATS_FONT_SIZE.meta, flexShrink: 0 }}>
										{event.totalTokens}t
									</Typography>
								)}
								{event.estimatedCost != null && (
									<Typography variant="caption" color="text.disabled" sx={{ fontSize: STATS_FONT_SIZE.meta, flexShrink: 0 }}>
										${event.estimatedCost.toFixed(4)}
									</Typography>
								)}
							</Stack>
						</ListItem>
					))}
				</List>
			)}
		</Box>
	);
}
