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
			title: "Clean Tmux Analysis Logs",
			message: "This will delete all Tmux analysis records older than 5 minutes. Records within the last 5 minutes will be kept.",
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
					Tmux Analysis
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
					<Tooltip title="Delete records older than 5 min">
						<span>
							<IconButton
								size="small"
								onClick={handleCleanup}
								data-testid="stats-cleanup-button"
								aria-label="Clean Tmux analysis logs"
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
							p: 2,
							borderRadius: "var(--radius-md)",
							bgcolor: (theme) => theme.palette.mode === "dark" ? "rgba(16, 185, 129, 0.06)" : "rgba(16, 185, 129, 0.04)",
							border: "1px solid",
							borderColor: (theme) => theme.palette.mode === "dark" ? "rgba(16, 185, 129, 0.2)" : "rgba(16, 185, 129, 0.15)",
							textAlign: "center",
							boxShadow: (theme) => theme.palette.mode === "dark" ? "0 4px 20px rgba(0, 0, 0, 0.25)" : "0 4px 20px rgba(0, 0, 0, 0.05)",
							backdropFilter: "blur(8px)",
							transition: "all var(--transition-base)",
							"&:hover": {
								borderColor: "success.main",
								boxShadow: "var(--glow-success)",
								transform: "translateY(-1px)",
							}
						}}>
							<Typography sx={{ fontSize: "var(--font-size-xl)", fontWeight: 700, color: "success.main", lineHeight: 1 }}>
								{summary.totalSuccess}
							</Typography>
							<Typography sx={{ fontSize: "var(--font-size-xs)", color: "text.secondary", mt: 0.25 }}>Success</Typography>
						</Box>
						<Box sx={{
							p: 2,
							borderRadius: "var(--radius-md)",
							bgcolor: (theme) => theme.palette.mode === "dark" ? "rgba(239, 68, 68, 0.06)" : "rgba(239, 68, 68, 0.04)",
							border: "1px solid",
							borderColor: (theme) => theme.palette.mode === "dark" ? "rgba(239, 68, 68, 0.2)" : "rgba(239, 68, 68, 0.15)",
							textAlign: "center",
							boxShadow: (theme) => theme.palette.mode === "dark" ? "0 4px 20px rgba(0, 0, 0, 0.25)" : "0 4px 20px rgba(0, 0, 0, 0.05)",
							backdropFilter: "blur(8px)",
							transition: "all var(--transition-base)",
							"&:hover": {
								borderColor: "error.main",
								boxShadow: "var(--glow-danger)",
								transform: "translateY(-1px)",
							}
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
				<Typography variant="body2" color="text.secondary" data-testid="stats-empty" sx={{ textAlign: "center", py: 2 }}>No Tmux analysis events yet</Typography>
			) : (
				<List disablePadding dense>
					{events.map((event) => (
						<ListItem
							key={event.id}
							onClick={() => setSelectedAiEvent(event)}
							data-testid={`stats-event-${event.id}`}
							sx={{
								px: 1,
								py: 1,
								my: 0.5,
								borderRadius: "var(--radius-sm)",
								cursor: "pointer",
								bgcolor: selectedAiEvent?.id === event.id ? "action.selected" : "transparent",
								"&:hover": { bgcolor: "action.hover" },
								transition: "background-color 0.15s",
								overflow: "hidden",
							}}
						>
							<Stack direction="row" spacing={1.5} sx={{ alignItems: "center", width: "100%", minWidth: 0 }}>
								{/* Glowing status dot */}
								<Box
									sx={{
										width: 8,
										height: 8,
										borderRadius: "50%",
										flexShrink: 0,
										backgroundColor: event.status === "success" ? "success.main" : event.status === "error" ? "error.main" : "text.disabled",
										boxShadow: event.status === "success" 
											? "0 0 8px var(--color-success)" 
											: event.status === "error" 
												? "0 0 8px var(--color-danger)" 
												: "none",
										position: "relative",
										"&::after": {
											content: '""',
											position: "absolute",
											top: -2,
											left: -2,
											right: -2,
											bottom: -2,
											borderRadius: "50%",
											border: "1px solid",
											borderColor: event.status === "success" ? "success.main" : event.status === "error" ? "error.main" : "transparent",
											opacity: 0.4,
											animation: event.status === "success" || event.status === "error" ? "pulse 2s infinite ease-in-out" : "none",
										}
									}}
								/>
								<Stack
									direction="row"
									sx={{
										flex: 1,
										minWidth: 0,
										alignItems: "center",
										justifyContent: "space-between",
										py: 0.25,
										pr: 1,
									}}
								>
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
										<Typography
											variant="caption"
											color="text.secondary"
											sx={{
												fontSize: STATS_FONT_SIZE.meta,
												fontWeight: "var(--font-weight-medium)",
												bgcolor: (theme) => theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.04)",
												px: 0.75,
												py: 0.1,
												borderRadius: "var(--radius-sm)",
												flexShrink: 0,
												ml: 1,
											}}
										>
											W{event.windowNumber}
										</Typography>
									)}
								</Stack>
							</Stack>
						</ListItem>
					))}
				</List>
			)}
		</Box>
	);
}
