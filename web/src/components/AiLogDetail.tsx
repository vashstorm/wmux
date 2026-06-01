import { Alert, Box, Typography, IconButton, Chip, Divider } from "@mui/material"
import CloseIcon from "@mui/icons-material/Close"
import type { AiLogEntry } from "../api/client.js"

interface AiLogDetailProps {
  log: AiLogEntry
  onClose: () => void
}

const DETAIL_FONT_SIZE = {
  title: "var(--font-size-lg)",
  section: "var(--font-size-xs)",
  label: "var(--font-size-xs)",
  body: "var(--font-size-sm)",
  value: "var(--font-size-sm)",
  code: "var(--font-size-sm)",
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

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 2,
        py: 0.75,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          fontSize: DETAIL_FONT_SIZE.label,
          flexShrink: 0,
          minWidth: 140,
        }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontSize: DETAIL_FONT_SIZE.value,
          fontWeight: "var(--font-weight-medium)",
          textAlign: "right",
          wordBreak: "break-all",
          fontFamily: mono ? "var(--font-mono)" : "inherit",
        }}
      >
        {value}
      </Typography>
    </Box>
  )
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp)
    return date.toLocaleString()
  } catch {
    return timestamp
  }
}

function formatJson(jsonStr: string | null | undefined): string {
  if (!jsonStr) return ""
  try {
    const parsed = JSON.parse(jsonStr)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return jsonStr
  }
}

function formatDuration(durationMs: number | null | undefined): string {
  return typeof durationMs === "number" ? `${durationMs}ms` : "-"
}

export function AiLogDetail({ log, onClose }: AiLogDetailProps) {
  const isError = log.status === "error"
  const isIssue = isError || log.status === "blocked"

  return (
    <Box
      data-testid="ai-log-detail"
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: "var(--spacing-lg)",
          minHeight: "var(--app-shell-header-height, 42px)",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography
            variant="subtitle2"
            sx={{
              fontSize: DETAIL_FONT_SIZE.title,
              fontWeight: "var(--font-weight-bold)",
              fontFamily: "var(--font-display)",
              letterSpacing: "0",
            }}
          >
            AI Log Detail
          </Typography>
          <Chip
            label={log.eventKind}
            size="small"
            color={getEventKindColor(log.eventKind)}
            variant="outlined"
            sx={{ fontSize: DETAIL_FONT_SIZE.label, height: 24 }}
          />
          <Chip
            label={log.status}
            size="small"
            color={getStatusColor(log.status)}
            variant="outlined"
            sx={{ fontSize: DETAIL_FONT_SIZE.label, height: 24 }}
          />
        </Box>
        <IconButton
          size="small"
          onClick={onClose}
          aria-label="Close detail"
          data-testid="ai-log-detail-close"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto", px: "var(--spacing-lg)", py: "var(--spacing-md)" }}>
        <Typography
          variant="caption"
          sx={{
            color: "text.disabled",
            fontSize: DETAIL_FONT_SIZE.section,
            textTransform: "uppercase",
            letterSpacing: "0",
            fontWeight: "var(--font-weight-semibold)",
          }}
        >
          Model & Conversation
        </Typography>
        <Box
          sx={{
            mt: 0.5,
            mb: 2,
            p: 1.5,
            bgcolor: "background.default",
            borderRadius: "var(--radius-sm)",
            border: "1px solid",
            borderColor: "divider",
          }}
        >
          <DetailRow label="Model" value={log.model} />
          <DetailRow label="Conversation ID" value={log.conversationId} mono />
        </Box>

        {log.promptText && (
          <>
            <Typography
              variant="caption"
              sx={{
                color: "text.disabled",
                fontSize: DETAIL_FONT_SIZE.section,
                textTransform: "uppercase",
                letterSpacing: "0",
                fontWeight: "var(--font-weight-semibold)",
              }}
            >
              Prompt
            </Typography>
            <Box
              sx={{
                mt: 0.5,
                mb: 2,
                p: 1.5,
                bgcolor: "background.default",
                borderRadius: "var(--radius-sm)",
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              <Box
                component="pre"
                sx={{
                  fontSize: DETAIL_FONT_SIZE.code,
                  fontFamily: "var(--font-mono)",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  m: 0,
                  maxHeight: 250,
                  overflow: "auto",
                }}
              >
                {log.promptText}
              </Box>
            </Box>
          </>
        )}

        {log.toolName && (
          <>
            <Typography
              variant="caption"
              sx={{
                color: "text.disabled",
                fontSize: DETAIL_FONT_SIZE.section,
                textTransform: "uppercase",
                letterSpacing: "0",
                fontWeight: "var(--font-weight-semibold)",
              }}
            >
              Tool Execution
            </Typography>
            <Box
              sx={{
                mt: 0.5,
                mb: 2,
                p: 1.5,
                bgcolor: "background.default",
                borderRadius: "var(--radius-sm)",
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              <DetailRow label="Tool Name" value={log.toolName} />
              {log.toolCallId && <DetailRow label="Call ID" value={log.toolCallId} mono />}

              {log.toolArgumentsJson && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography
                    sx={{ fontSize: DETAIL_FONT_SIZE.label, color: "text.secondary", mb: 0.5 }}
                  >
                    Arguments
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      p: 1.5,
                      bgcolor: "background.paper",
                      borderRadius: "var(--radius-sm)",
                      fontFamily: "var(--font-mono)",
                      fontSize: DETAIL_FONT_SIZE.code,
                      whiteSpace: "pre-wrap",
                      maxHeight: 200,
                      overflow: "auto",
                      m: 0,
                      border: "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    {formatJson(log.toolArgumentsJson)}
                  </Box>
                </Box>
              )}

              {log.toolResultJson && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography
                    sx={{ fontSize: DETAIL_FONT_SIZE.label, color: "text.secondary", mb: 0.5 }}
                  >
                    Result
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      p: 1.5,
                      bgcolor: "background.paper",
                      borderRadius: "var(--radius-sm)",
                      fontFamily: "var(--font-mono)",
                      fontSize: DETAIL_FONT_SIZE.code,
                      whiteSpace: "pre-wrap",
                      maxHeight: 250,
                      overflow: "auto",
                      m: 0,
                      border: "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    {formatJson(log.toolResultJson)}
                  </Box>
                </Box>
              )}
            </Box>
          </>
        )}

        <Typography
          variant="caption"
          sx={{
            color: "text.disabled",
            fontSize: DETAIL_FONT_SIZE.section,
            textTransform: "uppercase",
            letterSpacing: "0",
            fontWeight: "var(--font-weight-semibold)",
          }}
        >
          Performance
        </Typography>
        <Box
          sx={{
            mt: 0.5,
            mb: 2,
            p: 1.5,
            bgcolor: "background.default",
            borderRadius: "var(--radius-sm)",
            border: "1px solid",
            borderColor: "divider",
          }}
        >
          <DetailRow label="Duration" value={formatDuration(log.durationMs)} />
        </Box>

        {log.metricsJson && (
          <>
            <Typography
              variant="caption"
              sx={{
                color: "text.disabled",
                fontSize: DETAIL_FONT_SIZE.section,
                textTransform: "uppercase",
                letterSpacing: "0",
                fontWeight: "var(--font-weight-semibold)",
              }}
            >
              Metrics
            </Typography>
            <Box
              sx={{
                mt: 0.5,
                mb: 2,
                p: 1.5,
                bgcolor: "background.default",
                borderRadius: "var(--radius-sm)",
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              <Box
                component="pre"
                sx={{
                  fontSize: DETAIL_FONT_SIZE.code,
                  fontFamily: "var(--font-mono)",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  m: 0,
                }}
              >
                {formatJson(log.metricsJson)}
              </Box>
            </Box>
          </>
        )}

        {isIssue && log.errorMessage && (
          <>
            <Typography
              variant="caption"
              sx={{
                color: "text.disabled",
                fontSize: DETAIL_FONT_SIZE.section,
                textTransform: "uppercase",
                letterSpacing: "0",
                fontWeight: "var(--font-weight-semibold)",
              }}
            >
              {isError ? "Error" : "Issue"}
            </Typography>
            <Box
              sx={{
                mt: 0.5,
                mb: 2,
                p: 1.5,
                bgcolor: isError ? "error.main" : "warning.main",
                color: isError ? "error.contrastText" : "warning.contrastText",
                borderRadius: "var(--radius-sm)",
                border: "1px solid",
                borderColor: isError ? "error.dark" : "warning.dark",
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontSize: DETAIL_FONT_SIZE.body,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {log.errorMessage}
              </Typography>
            </Box>
          </>
        )}

        {log.rawEventJson && (
          <>
            <Typography
              variant="caption"
              sx={{
                color: "text.disabled",
                fontSize: DETAIL_FONT_SIZE.section,
                textTransform: "uppercase",
                letterSpacing: "0",
                fontWeight: "var(--font-weight-semibold)",
              }}
            >
              Raw Event
            </Typography>
            <Box
              sx={{
                mt: 0.5,
                mb: 2,
                p: 1.5,
                bgcolor: "background.default",
                borderRadius: "var(--radius-sm)",
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              <Box
                component="pre"
                sx={{
                  fontSize: DETAIL_FONT_SIZE.code,
                  fontFamily: "var(--font-mono)",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  m: 0,
                  maxHeight: 250,
                  overflow: "auto",
                }}
              >
                {formatJson(log.rawEventJson)}
              </Box>
            </Box>
          </>
        )}

        <Divider sx={{ my: 1.5 }} />

        <Typography
          variant="caption"
          sx={{
            color: "text.disabled",
            fontSize: DETAIL_FONT_SIZE.section,
            textTransform: "uppercase",
            letterSpacing: "0",
            fontWeight: "var(--font-weight-semibold)",
          }}
        >
          Metadata
        </Typography>
        <Box
          sx={{
            mt: 0.5,
            mb: 2,
            p: 1.5,
            bgcolor: "background.default",
            borderRadius: "var(--radius-sm)",
            border: "1px solid",
            borderColor: "divider",
          }}
        >
          <DetailRow label="Log ID" value={log.id} mono />
          <DetailRow label="Created" value={formatTimestamp(log.createdAt)} />
        </Box>
      </Box>
    </Box>
  )
}
