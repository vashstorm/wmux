import { useState, useEffect, useCallback, useRef } from "react"
import {
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  Stack,
  Tooltip,
  Chip,
} from "@mui/material"
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep"
import RefreshIcon from "@mui/icons-material/Refresh"
import { cleanupAiStats, listAiStats } from "../../api/client.js"
import type { AiUsageEvent, AiUsageSummary } from "../../api/client.js"
import { ApiError } from "../../api/errors.js"
import { useAppState } from "../../state/store.js"
import {
  getAiUsageKindLabel,
  getAiUsageSubtitle,
  getAiUsageTitle,
  parseAiUsageResponse,
  formatDuration,
} from "../aiUsagePresentation.js"

const DEFAULT_REFRESH_INTERVAL_MS = 30000
const STATS_FONT_SIZE = {
  title: "var(--font-size-sm)",
  body: "var(--font-size-sm)",
  meta: "var(--font-size-xs)",
}

type StatusFilter = "error" | null

function formatTimestampShort(timestamp: string): string {
  try {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return timestamp
  }
}

export function StatsView() {
  const { selectedAiEvent, setSelectedAiEvent, showConfirm } = useAppState()
  const [events, setEvents] = useState<AiUsageEvent[]>([])
  const [summary, setSummary] = useState<AiUsageSummary | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null)
  const [loading, setLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null)
  const autoRefresh = true
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const intervalRef = useRef<number | null>(null)

  const loadStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await listAiStats({
        limit: statusFilter ? 200 : 50,
        status: statusFilter ?? undefined,
      })
      setEvents(response.data)
      setSummary(response.summary)
      setLastRefreshedAt(new Date())
      return response
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load stats")
      return null
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  const resetInterval = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (autoRefresh) {
      intervalRef.current = window.setInterval(() => {
        void loadStats()
      }, DEFAULT_REFRESH_INTERVAL_MS)
    }
  }, [autoRefresh, loadStats])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  useEffect(() => {
    resetInterval()
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [resetInterval])

  const handleManualRefresh = useCallback(() => {
    setCleanupMessage(null)
    void loadStats()
    resetInterval()
  }, [loadStats, resetInterval])

  const handleToggleErrorFilter = useCallback(() => {
    setCleanupMessage(null)
    setSelectedAiEvent(null)
    setStatusFilter((current) => (current === "error" ? null : "error"))
  }, [setSelectedAiEvent])

  const performCleanup = useCallback(async () => {
    setCleaning(true)
    setError(null)
    setCleanupMessage(null)
    try {
      const result = await cleanupAiStats()
      if (result.deleted > 0) {
        setSelectedAiEvent(null)
      }
      await loadStats()
      setCleanupMessage(
        result.deleted > 0 ? `Cleaned ${result.deleted} old records` : "Already latest per window",
      )
      resetInterval()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to clean stats")
    } finally {
      setCleaning(false)
    }
  }, [loadStats, resetInterval, setSelectedAiEvent])

  const handleCleanup = useCallback(() => {
    showConfirm({
      title: "Clean Window Analysis Logs",
      message:
        "This will delete all Window analysis records older than 5 minutes. Records within the last 5 minutes will be kept.",
      confirmText: "Clean",
      confirmVariant: "danger",
      onConfirm: () => {
        void performCleanup()
      },
    })
  }, [performCleanup, showConfirm])

  return (
    <Box data-testid="stats-view" sx={{ minHeight: 1 }}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 0.5 }}
      >
        <Typography
          variant="subtitle2"
          sx={{ fontSize: STATS_FONT_SIZE.title, fontWeight: "var(--font-weight-semibold)" }}
        >
          Window Analysis
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <IconButton
            size="small"
            onClick={handleManualRefresh}
            data-testid="stats-refresh-button"
            aria-label="Refresh stats"
            disabled={loading}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
          <Tooltip title="Delete records older than 5 min">
            <span>
              <IconButton
                size="small"
                onClick={handleCleanup}
                data-testid="stats-cleanup-button"
                aria-label="Clean Window analysis logs"
                disabled={loading || cleaning || events.length === 0}
              >
                <DeleteSweepIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      {lastRefreshedAt && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: STATS_FONT_SIZE.body, mb: 1.5, display: "block" }}
          data-testid="stats-last-refreshed"
        >
          Last updated: {lastRefreshedAt.toLocaleTimeString()}
        </Typography>
      )}
      {cleanupMessage && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: STATS_FONT_SIZE.body, mb: 1, display: "block" }}
          data-testid="stats-cleanup-message"
        >
          {cleanupMessage}
        </Typography>
      )}

      {error && (
        <Box
          data-testid="stats-error"
          sx={{
            mb: 1,
            p: 1,
            bgcolor: "error.main",
            color: "error.contrastText",
            borderRadius: "var(--radius-sm)",
            fontSize: STATS_FONT_SIZE.body,
          }}
        >
          <Typography variant="caption">{error}</Typography>
          <IconButton
            size="small"
            onClick={handleManualRefresh}
            data-testid="stats-retry-button"
            sx={{ color: "inherit", ml: 0.5 }}
            aria-label="Retry"
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {summary && (
        <Box data-testid="stats-summary" sx={{ mb: 1.5 }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 1,
            }}
          >
            <Box
              sx={{
                p: 2,
                borderRadius: "var(--radius-md)",
                bgcolor: (theme) =>
                  theme.palette.mode === "dark"
                    ? "rgba(16, 185, 129, 0.06)"
                    : "rgba(16, 185, 129, 0.04)",
                border: "1px solid",
                borderColor: (theme) =>
                  theme.palette.mode === "dark"
                    ? "rgba(16, 185, 129, 0.2)"
                    : "rgba(16, 185, 129, 0.15)",
                textAlign: "center",
                boxShadow: (theme) =>
                  theme.palette.mode === "dark"
                    ? "0 4px 20px rgba(0, 0, 0, 0.25)"
                    : "0 4px 20px rgba(0, 0, 0, 0.05)",
                backdropFilter: "blur(8px)",
                transition: "all var(--transition-base)",
                "&:hover": {
                  borderColor: "success.main",
                  boxShadow: "var(--glow-success)",
                  transform: "translateY(-1px)",
                },
              }}
            >
              <Typography
                sx={{
                  fontSize: "var(--font-size-xl)",
                  fontWeight: 700,
                  color: "success.main",
                  lineHeight: 1,
                }}
              >
                {summary.totalSuccess}
              </Typography>
              <Typography
                sx={{ fontSize: "var(--font-size-xs)", color: "text.secondary", mt: 0.25 }}
              >
                Success
              </Typography>
            </Box>
            <Box
              component="button"
              type="button"
              onClick={handleToggleErrorFilter}
              data-testid="stats-filter-errors"
              aria-pressed={statusFilter === "error"}
              aria-label={
                statusFilter === "error"
                  ? "Show all Window analysis logs"
                  : "Show error Window analysis logs"
              }
              sx={{
                p: 2,
                borderRadius: "var(--radius-md)",
                bgcolor: (theme) =>
                  theme.palette.mode === "dark"
                    ? "rgba(239, 68, 68, 0.06)"
                    : "rgba(239, 68, 68, 0.04)",
                border: "1px solid",
                borderColor:
                  statusFilter === "error"
                    ? "error.main"
                    : (theme) =>
                        theme.palette.mode === "dark"
                          ? "rgba(239, 68, 68, 0.2)"
                          : "rgba(239, 68, 68, 0.15)",
                textAlign: "center",
                width: "100%",
                font: "inherit",
                appearance: "none",
                cursor: "pointer",
                boxShadow: (theme) =>
                  theme.palette.mode === "dark"
                    ? "0 4px 20px rgba(0, 0, 0, 0.25)"
                    : "0 4px 20px rgba(0, 0, 0, 0.05)",
                backdropFilter: "blur(8px)",
                transition: "all var(--transition-base)",
                outline: "none",
                "&:hover": {
                  borderColor: "error.main",
                  boxShadow: "var(--glow-danger)",
                  transform: "translateY(-1px)",
                },
                "&:focus-visible": {
                  borderColor: "error.main",
                  boxShadow: "0 0 0 3px rgba(239, 68, 68, 0.22)",
                },
              }}
            >
              <Typography
                sx={{
                  fontSize: "var(--font-size-xl)",
                  fontWeight: 700,
                  color: "error.main",
                  lineHeight: 1,
                }}
              >
                {summary.totalError}
              </Typography>
              <Typography
                sx={{ fontSize: "var(--font-size-xs)", color: "text.secondary", mt: 0.25 }}
              >
                Errors
              </Typography>
            </Box>
          </Box>
        </Box>
      )}

      {loading && events.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 2 }}>
          Loading...
        </Typography>
      ) : error && events.length === 0 ? null : events.length === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="stats-empty"
          sx={{ textAlign: "center", py: 2 }}
        >
          {statusFilter === "error" ? "No error logs found" : "No Window analysis events yet"}
        </Typography>
      ) : (
        <List disablePadding dense>
          {events.map((event) => {
            const parsed = parseAiUsageResponse(event.responseJson)
            const kindLabel = getAiUsageKindLabel(event, parsed)
            const title = getAiUsageTitle(event, parsed)
            const subtitle = getAiUsageSubtitle(event, parsed)
            const isSelected = selectedAiEvent?.id === event.id
            return (
              <ListItem
                key={event.id}
                onClick={() => setSelectedAiEvent(event)}
                data-testid={`stats-event-${event.id}`}
                sx={{
                  px: 1.5,
                  py: 1.25,
                  my: 0.75,
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  bgcolor: isSelected
                    ? "var(--color-accent-subtle)"
                    : "var(--color-panel)",
                  border: "1px solid",
                  borderColor: isSelected
                    ? "var(--color-accent)"
                    : event.status === "error"
                      ? "rgba(239, 68, 68, 0.25)"
                      : "var(--color-panel-border)",
                  "&:hover": {
                    bgcolor: isSelected
                      ? "var(--color-accent-subtle)"
                      : "var(--color-surface-hover)",
                    borderColor: isSelected
                      ? "var(--color-accent)"
                      : event.status === "error"
                        ? "rgba(239, 68, 68, 0.45)"
                        : "var(--color-surface-border-hover)",
                    transform: "translateY(-1px)",
                    boxShadow: "var(--shadow-sm)",
                  },
                  transition: "all var(--transition-base)",
                  overflow: "hidden",
                  boxShadow: event.status === "error"
                    ? "var(--glow-danger)"
                    : "none",
                }}
              >
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: "center", width: "100%", minWidth: 0 }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flexShrink: 0,
                      backgroundColor:
                        event.status === "success"
                          ? "success.main"
                          : event.status === "error"
                            ? "error.main"
                            : "text.disabled",
                      boxShadow:
                        event.status === "success"
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
                        borderColor:
                          event.status === "success"
                            ? "success.main"
                            : event.status === "error"
                              ? "error.main"
                              : "transparent",
                        opacity: 0.4,
                        animation:
                          event.status === "success" || event.status === "error"
                            ? "pulse 2s infinite ease-in-out"
                            : "none",
                      },
                    }}
                  />
                  <Stack direction="column" sx={{ flex: 1, minWidth: 0, gap: 0.25 }}>
                    <Stack
                      direction="row"
                      sx={{ justifyContent: "space-between", alignItems: "center", gap: 1 }}
                    >
                      <Stack direction="row" spacing={0.5} sx={{ minWidth: 0, alignItems: "center" }}>
                        {kindLabel !== "Window Analysis" && (
                          <Chip
                            label={kindLabel}
                            size="small"
                            color={kindLabel === "Project HTML" ? "secondary" : "default"}
                            variant="outlined"
                            sx={{ fontSize: "var(--font-size-2xs)", height: 18, px: 0.5 }}
                          />
                        )}
                        {event.status === "error" && (
                          <Chip
                            label="error"
                            size="small"
                            color="error"
                            sx={{ fontSize: "var(--font-size-2xs)", height: 18, px: 0.5 }}
                          />
                        )}
                        {event.windowNumber != null && (
                          <Chip
                            label={`W${event.windowNumber}`}
                            size="small"
                            sx={{
                              fontSize: "var(--font-size-2xs)",
                              height: 18,
                              px: 0.5,
                              bgcolor: (theme) =>
                                theme.palette.mode === "dark"
                                  ? "rgba(255, 255, 255, 0.08)"
                                  : "rgba(0, 0, 0, 0.04)",
                              color: "text.secondary",
                              border: "none",
                              fontWeight: "var(--font-weight-medium)",
                            }}
                          />
                        )}
                      </Stack>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontSize: "var(--font-size-2xs)", whiteSpace: "nowrap" }}
                      >
                        {formatTimestampShort(event.createdAt)}
                      </Typography>
                    </Stack>
                    <Stack
                      direction="row"
                      sx={{ justifyContent: "space-between", alignItems: "center", gap: 1 }}
                    >
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
                        title={`${kindLabel}: ${title} ${subtitle}`}
                      >
                        {title}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontSize: "var(--font-size-2xs)" }}
                      >
                        {formatDuration(event.durationMs)}
                      </Typography>
                    </Stack>
                  </Stack>
                </Stack>
              </ListItem>
            )
          })}
        </List>
      )}
    </Box>
  )
}
