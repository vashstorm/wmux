import { useState, useEffect, useCallback } from "react"
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
  IconButton,
  Tooltip,
  Badge,
} from "@mui/material"
import RefreshIcon from "@mui/icons-material/Refresh"
import DeleteIcon from "@mui/icons-material/Delete"
import ReportProblemIcon from "@mui/icons-material/ReportProblem"
import { listAiLogs, clearAiLogs } from "../../api/client.js"
import type { AiLogEntry } from "../../api/client.js"
import { useAppState } from "../../state/store.js"

const AI_LOGS_FONT_SIZE = {
  title: "var(--font-size-sm)",
  body: "var(--font-size-sm)",
  meta: "var(--font-size-xs)",
}

const PAGE_LIMIT = 50

function isIssueLog(entry: AiLogEntry): boolean {
  return entry.status === "error" || entry.status === "blocked"
}

function getStatusColor(status: string): "success" | "error" | "warning" | "default" {
  switch (status) {
    case "success":
      return "success"
    case "error":
      return "error"
    case "blocked":
    case "pending":
      return "warning"
    default:
      return "default"
  }
}

function getEventKindColor(
  eventKind: string,
): "primary" | "secondary" | "success" | "warning" | "error" | "info" | "default" {
  switch (eventKind) {
    case "llm_call":
      return "primary"
    case "tool_call":
      return "secondary"
    case "tool_result":
      return "info"
    case "conversation_start":
      return "success"
    case "conversation_end":
      return "warning"
    default:
      return "default"
  }
}

function formatTimestampShort(timestamp: string): string {
  try {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return timestamp
  }
}

function formatDuration(durationMs: number | null | undefined): string {
  return typeof durationMs === "number" ? `${durationMs}ms` : "-"
}

function parseJsonObject(jsonStr: string | null | undefined): Record<string, unknown> | null {
  if (!jsonStr) return null
  try {
    const parsed = JSON.parse(jsonStr)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value === null || value === undefined) return ""
  return JSON.stringify(value)
}

function compactValue(value: unknown): string {
  const formatted = formatValue(value)
  return formatted.length > 28 ? `${formatted.slice(0, 25)}...` : formatted
}

function getArgValue(args: Record<string, unknown>, keys: string[]): unknown {
  return keys.map((key) => args[key]).find((value) => value !== undefined && value !== null)
}

function getToolCallSummary(entry: AiLogEntry): string {
  const parts: string[] = []
  if (entry.toolCallId) {
    parts.push(`call ${entry.toolCallId.slice(0, 12)}`)
  }

  const args = parseJsonObject(entry.toolArgumentsJson)
  if (!args) return parts.join(" · ")

  const target = getArgValue(args, ["target_name", "targetName", "target"])
  const session = getArgValue(args, ["session_name", "sessionName", "session"])
  const windowName = getArgValue(args, ["window_name", "windowName", "window"])
  const pane = getArgValue(args, ["pane_index", "paneIndex", "pane"])

  if (target !== undefined && target !== null) parts.push(`target ${compactValue(target)}`)
  if (session !== undefined && session !== null) parts.push(`session ${compactValue(session)}`)
  if (windowName !== undefined && windowName !== null) parts.push(`window ${compactValue(windowName)}`)
  if (pane !== undefined && pane !== null) parts.push(`pane ${compactValue(pane)}`)

  return parts.join(" · ")
}

function getArgumentPreview(entry: AiLogEntry): string {
  const args = parseJsonObject(entry.toolArgumentsJson)
  if (!args) return ""

  const skippedKeys = new Set([
    "target_name",
    "targetName",
    "target",
    "session_name",
    "sessionName",
    "session",
    "window_name",
    "windowName",
    "window",
    "pane_index",
    "paneIndex",
    "pane",
    "_skill",
    "_call_id",
  ])
  return Object.entries(args)
    .filter(([key, value]) => !skippedKeys.has(key) && value !== undefined && value !== null)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${compactValue(value)}`)
    .join(" · ")
}

export function AiLogsView() {
  const { showConfirm, selectedAiLog, setSelectedAiLog } = useAppState()
  const [logs, setLogs] = useState<AiLogEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issuesOnly, setIssuesOnly] = useState(false)

  const issueCount = logs.filter(isIssueLog).length
  const visibleLogs = issuesOnly ? logs.filter(isIssueLog) : logs

  const loadLogs = useCallback(async (replace = true) => {
    if (replace) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }
    setError(null)
    try {
      const response = await listAiLogs({ limit: PAGE_LIMIT })
      if (replace) {
        setLogs(response.data)
      } else {
        setLogs((prev) => [...prev, ...response.data])
      }
      setNextCursor(response.nextCursor)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load AI logs"
      setError(message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (!nextCursor) return
    setLoadingMore(true)
    setError(null)
    try {
      const response = await listAiLogs({ limit: PAGE_LIMIT, before: nextCursor })
      setLogs((prev) => [...prev, ...response.data])
      setNextCursor(response.nextCursor)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load more AI logs"
      setError(message)
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor])

  const refresh = useCallback(() => {
    setSelectedAiLog(null)
    void loadLogs(true)
  }, [loadLogs, setSelectedAiLog])

  const handleClear = useCallback(() => {
    showConfirm({
      title: "Clear AI Logs",
      message: "Are you sure you want to clear all AI logs? This action cannot be undone.",
      confirmText: "Clear",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          await clearAiLogs()
          setLogs([])
          setNextCursor(null)
          setSelectedAiLog(null)
          void loadLogs(true)
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to clear AI logs"
          setError(message)
        }
      },
    })
  }, [showConfirm, loadLogs, setSelectedAiLog])

  useEffect(() => {
    void loadLogs(true)
  }, [loadLogs])

  return (
    <Box data-testid="ai-logs-view" sx={{ minHeight: 1, p: 2 }}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1.5, gap: 1 }}
      >
        <Typography
          variant="subtitle2"
          sx={{
            fontSize: AI_LOGS_FONT_SIZE.title,
            fontWeight: "var(--font-weight-semibold)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 0,
          }}
        >
          AI Logs
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flexShrink: 0 }}>
          <Tooltip title={issuesOnly ? "Show all logs" : "Show issues only"}>
            <span>
              <IconButton
                size="small"
                onClick={() => setIssuesOnly((value) => !value)}
                disabled={logs.length === 0 || loading || loadingMore}
                color={issuesOnly ? "warning" : "default"}
                data-testid="ai-logs-issues-toggle"
                sx={{
                  bgcolor: issuesOnly ? "rgba(245, 158, 11, 0.12)" : "transparent",
                  border: issuesOnly ? "1px solid" : "1px solid transparent",
                  borderColor: issuesOnly ? "warning.main" : "transparent",
                  transition: "all var(--transition-base)",
                  "&:hover": {
                    bgcolor: issuesOnly ? "rgba(245, 158, 11, 0.2)" : "action.hover",
                  },
                }}
                aria-label="Toggle issues"
              >
                <Badge
                  badgeContent={issueCount}
                  color="warning"
                  max={99}
                  slotProps={{
                    badge: {
                      style: {
                        fontSize: "9px",
                        height: "15px",
                        minWidth: "15px",
                        padding: "0 2px",
                      },
                    },
                  }}
                >
                  <ReportProblemIcon fontSize="small" />
                </Badge>
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Refresh logs">
            <span>
              <IconButton
                size="small"
                onClick={refresh}
                disabled={loading || loadingMore}
                data-testid="ai-logs-refresh"
                aria-label="Refresh logs"
              >
                {loading ? (
                  <CircularProgress size={18} thickness={5} />
                ) : (
                  <RefreshIcon fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Clear logs">
            <span>
              <IconButton
                size="small"
                onClick={handleClear}
                disabled={logs.length === 0 || loading || loadingMore}
                color="error"
                data-testid="ai-logs-clear"
                sx={{
                  "&:hover": {
                    bgcolor: "rgba(239, 68, 68, 0.08)",
                  },
                }}
                aria-label="Clear logs"
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
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
          <Typography sx={{ ml: 1, fontSize: AI_LOGS_FONT_SIZE.body }}>
            Loading AI logs...
          </Typography>
        </Box>
      ) : !error && visibleLogs.length === 0 ? (
        <Box data-testid="ai-logs-empty" sx={{ py: 4, textAlign: "center" }}>
          <Typography color="text.secondary" sx={{ fontSize: AI_LOGS_FONT_SIZE.body }}>
            {issuesOnly ? "No AI log issues found." : "No AI logs found."}
          </Typography>
        </Box>
      ) : (
        <Box>
          <List disablePadding dense>
            {visibleLogs.map((entry) => (
              <ListItem
                key={entry.id}
                onClick={() => setSelectedAiLog(entry)}
                data-testid={`ai-log-row-${entry.id}`}
                sx={{
                  px: 1.5,
                  py: 1.25,
                  my: 0.75,
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  bgcolor:
                    selectedAiLog?.id === entry.id
                      ? "var(--color-accent-subtle)"
                      : "var(--color-panel)",
                  border: "1px solid",
                  borderColor:
                    selectedAiLog?.id === entry.id
                      ? "var(--color-accent)"
                      : isIssueLog(entry)
                        ? "rgba(239, 68, 68, 0.25)"
                        : "var(--color-panel-border)",
                  "&:hover": {
                    bgcolor:
                      selectedAiLog?.id === entry.id
                        ? "var(--color-accent-subtle)"
                        : "var(--color-surface-hover)",
                    borderColor:
                      selectedAiLog?.id === entry.id
                        ? "var(--color-accent)"
                        : isIssueLog(entry)
                          ? "rgba(239, 68, 68, 0.45)"
                          : "var(--color-surface-border-hover)",
                    transform: "translateY(-1px)",
                    boxShadow: "var(--shadow-sm)",
                  },
                  transition: "all var(--transition-base)",
                  overflow: "hidden",
                  boxShadow: isIssueLog(entry)
                    ? "var(--glow-danger)"
                    : "none",
                }}
              >
                {(() => {
                  const toolCallSummary = getToolCallSummary(entry)
                  const argumentPreview = getArgumentPreview(entry)
                  return (
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
                            entry.status === "success"
                              ? "success.main"
                              : entry.status === "error"
                                ? "error.main"
                                : entry.status === "blocked"
                                  ? "warning.main"
                                  : "text.disabled",
                          boxShadow:
                            entry.status === "success"
                              ? "0 0 8px var(--color-success)"
                              : entry.status === "error"
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
                              entry.status === "success"
                                ? "success.main"
                                : entry.status === "error"
                                  ? "error.main"
                                  : entry.status === "blocked"
                                    ? "warning.main"
                                    : "transparent",
                            opacity: 0.4,
                            animation:
                              entry.status === "success" || entry.status === "error" || entry.status === "blocked"
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
                          <Stack direction="row" spacing={0.5} sx={{ minWidth: 0 }}>
                            <Chip
                              label={entry.eventKind}
                              size="small"
                              color={getEventKindColor(entry.eventKind)}
                              sx={{ fontSize: "10px", height: 18, px: 0.5 }}
                            />
                            {(isIssueLog(entry) || entry.status === "pending") && (
                              <Chip
                                label={entry.status}
                                size="small"
                                color={getStatusColor(entry.status)}
                                sx={{ fontSize: "10px", height: 18, px: 0.5 }}
                              />
                            )}
                          </Stack>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontSize: "10px", whiteSpace: "nowrap" }}
                          >
                            {formatTimestampShort(entry.createdAt)}
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
                            title={entry.toolName ? `Tool: ${entry.toolName}` : entry.model}
                          >
                            {entry.toolName ? `Tool: ${entry.toolName}` : entry.model}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontSize: "10px" }}
                          >
                            {formatDuration(entry.durationMs)}
                          </Typography>
                        </Stack>
                        {entry.toolName && toolCallSummary && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              fontSize: "10px",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            title={toolCallSummary}
                          >
                            {toolCallSummary}
                          </Typography>
                        )}
                        {entry.toolName && argumentPreview && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              fontSize: "10px",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            title={argumentPreview}
                          >
                            {argumentPreview}
                          </Typography>
                        )}
                        {isIssueLog(entry) && entry.errorMessage && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              fontSize: "10px",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            title={entry.errorMessage}
                          >
                            {entry.errorMessage}
                          </Typography>
                        )}
                      </Stack>
                    </Stack>
                  )
                })()}
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
  )
}
