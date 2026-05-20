import { useState, useEffect, useCallback } from "react";
import { Box, Typography, IconButton, List, ListItem, Chip, Stack } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { listAiStats } from "../../api/client.js";
import type { AiUsageEvent, AiUsageSummary } from "../../api/client.js";
import { ApiError } from "../../api/errors.js";

export function StatsView() {
	const [events, setEvents] = useState<AiUsageEvent[]>([]);
	const [summary, setSummary] = useState<AiUsageSummary | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadStats = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await listAiStats({ limit: 50 });
			setEvents(response.data);
			setSummary(response.summary);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to load stats");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { loadStats(); }, [loadStats]);

	const statusColor = (status: string) => status === "success" ? "success" : status === "error" ? "error" : "default";

	return (
		<Box data-testid="stats-view" sx={{ minHeight: 1 }}>
			<Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
				<Typography variant="subtitle2" sx={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)" }}>
					AI Usage Stats
				</Typography>
				<IconButton size="small" onClick={loadStats} data-testid="stats-refresh-button" aria-label="Refresh stats" disabled={loading}>
					<RefreshIcon fontSize="small" />
				</IconButton>
			</Stack>

			{error && (
				<Box data-testid="stats-error" sx={{ mb: 1, p: 1, bgcolor: "error.main", color: "error.contrastText", borderRadius: "var(--radius-sm)", fontSize: "var(--font-size-xs)" }}>
					<Typography variant="caption">{error}</Typography>
					<IconButton size="small" onClick={loadStats} data-testid="stats-retry-button" sx={{ color: "inherit", ml: 0.5 }} aria-label="Retry">
						<RefreshIcon fontSize="small" />
					</IconButton>
				</Box>
			)}

			{summary && (
				<Box data-testid="stats-summary" sx={{ mb: 1, p: 1, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
					<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 0.5 }}>
						<Chip label={`${summary.totalEvents} total`} size="small" variant="outlined" />
						<Chip label={`${summary.totalSuccess} \u2713`} size="small" color="success" variant="outlined" />
						<Chip label={`${summary.totalError} \u2717`} size="small" color="error" variant="outlined" />
						<Chip label={`${summary.totalDurationMs}ms`} size="small" variant="outlined" />
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
						<ListItem key={event.id} sx={{ px: 1, py: 0.5, borderRadius: "var(--radius-sm)", flexDirection: "column", alignItems: "flex-start" }}>
							<Stack direction="row" spacing={0.5} sx={{ alignItems: "center", width: "100%" }}>
								<Chip label={event.status} size="small" color={statusColor(event.status) as "success" | "error" | "default"} variant="filled" sx={{ fontSize: "10px", height: 18 }} />
								<Typography variant="caption" sx={{ fontWeight: "medium" }}>{event.provider}/{event.model}</Typography>
								<Box sx={{ flex: 1 }} />
								<Typography variant="caption" color="text.secondary">{event.durationMs}ms</Typography>
							</Stack>
							<Typography variant="caption" color="text.secondary" sx={{ fontSize: "10px", mt: 0.25 }}>
								{event.targetName} / {event.sessionName}
							</Typography>
							{event.errorMessage && (
								<Typography variant="caption" color="error" sx={{ fontSize: "10px" }}>
									{event.errorMessage}
								</Typography>
							)}
							<Box sx={{ display: "flex", gap: 0.5, mt: 0.25, flexWrap: "wrap" }}>
								{event.promptTokens != null && <Typography variant="caption" color="text.disabled" sx={{ fontSize: "10px" }}>prompt: {event.promptTokens}</Typography>}
								{event.completionTokens != null && <Typography variant="caption" color="text.disabled" sx={{ fontSize: "10px" }}>comp: {event.completionTokens}</Typography>}
								{event.estimatedCost != null && <Typography variant="caption" color="text.disabled" sx={{ fontSize: "10px" }}>${event.estimatedCost.toFixed(4)}</Typography>}
							</Box>
						</ListItem>
					))}
				</List>
			)}
		</Box>
	);
}
