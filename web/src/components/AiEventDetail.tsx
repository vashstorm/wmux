import { Alert, Box, Typography, IconButton, Chip, Divider } from "@mui/material"
import CloseIcon from "@mui/icons-material/Close"
import type { AiUsageEvent } from "../api/client.js"
import { SafeHtml } from "./SafeHtml.js"
import {
  formatBytes,
  formatDuration,
  getAiUsageKindLabel,
  isProjectAiHtmlEvent,
  parseAiUsageResponse,
} from "./aiUsagePresentation.js"

interface AiEventDetailProps {
  event: AiUsageEvent
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

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso)
    return date.toLocaleString()
  } catch {
    return iso
  }
}

function formatTokens(tokens: number | null | undefined): string {
  if (tokens == null) return "—"
  return tokens.toLocaleString()
}

export function AiEventDetail({ event, onClose }: AiEventDetailProps) {
  const isSuccess = event.status === "success"
  const isError = event.status === "error"
  const parsedResponse = parseAiUsageResponse(event.responseJson)
  const isProjectHtml = isProjectAiHtmlEvent(event, parsedResponse)
  const kindLabel = getAiUsageKindLabel(event, parsedResponse)
  const shouldShowAiResponse =
    !isProjectHtml || parsedResponse.parseError || parsedResponse.contentParseError

  return (
    <Box
      data-testid="ai-event-detail"
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
            {isProjectHtml ? "Project HTML Detail" : "Event Detail"}
          </Typography>
          <Chip
            label={kindLabel}
            size="small"
            color={isProjectHtml ? "secondary" : "default"}
            variant="outlined"
            sx={{ fontSize: DETAIL_FONT_SIZE.label, height: 24 }}
          />
          <Chip
            label={event.status}
            size="small"
            color={isSuccess ? "success" : isError ? "error" : "default"}
            variant="outlined"
            sx={{ fontSize: DETAIL_FONT_SIZE.label, height: 24 }}
          />
        </Box>
        <IconButton
          size="small"
          onClick={onClose}
          aria-label="Close detail"
          data-testid="ai-event-detail-close"
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
          Model
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
          <Typography
            variant="body2"
            sx={{ fontSize: "var(--font-size-base)", fontWeight: "var(--font-weight-semibold)" }}
          >
            {event.model}
          </Typography>
        </Box>

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
          Connection
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
          <DetailRow label="Target" value={event.targetName || "—"} />
          <DetailRow label="Session" value={event.sessionName || "—"} />
          {event.projectId && <DetailRow label="Project" value={event.projectId} mono />}
          <DetailRow
            label="Window"
            value={event.windowNumber != null ? event.windowNumber.toString() : "—"}
          />
        </Box>

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
          <DetailRow label="Duration" value={formatDuration(event.durationMs)} />
          <DetailRow label="Prompt Tokens" value={formatTokens(event.promptTokens)} />
          <DetailRow label="Completion Tokens" value={formatTokens(event.completionTokens)} />
          <DetailRow label="Total Tokens" value={formatTokens(event.totalTokens)} />
        </Box>

        {event.estimatedCost != null && (
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
              Cost
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
              <DetailRow label="Estimated" value={`$${event.estimatedCost.toFixed(4)}`} />
            </Box>
          </>
        )}

        {isProjectHtml && (
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
              Project HTML
            </Typography>
            <Box
              data-testid="ai-html-log-summary"
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
              <DetailRow
                label="Operation"
                value={parsedResponse.summary ?? "Project AI HTML generated"}
              />
              <DetailRow
                label="Project"
                value={parsedResponse.projectName ?? event.sessionName ?? "—"}
              />
              <DetailRow
                label="Project ID"
                value={parsedResponse.projectId ?? event.projectId ?? "—"}
                mono
              />
              <DetailRow label="HTML Size" value={formatBytes(parsedResponse.aiHtmlBytes)} />
            </Box>

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
              HTML Preview
            </Typography>
            <Box
              data-testid="ai-html-log-preview"
              sx={{
                mt: 0.5,
                mb: 2,
                bgcolor: "background.default",
                borderRadius: "var(--radius-sm)",
                border: "1px solid",
                borderColor: "divider",
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontSize: DETAIL_FONT_SIZE.body,
                    fontWeight: "var(--font-weight-semibold)",
                  }}
                >
                  Rendered sanitized HTML
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontSize: DETAIL_FONT_SIZE.label, flexShrink: 0 }}
                >
                  {formatBytes(parsedResponse.aiHtmlBytes)}
                </Typography>
              </Box>
              <Box sx={{ p: 2, maxHeight: 420, overflow: "auto" }}>
                {parsedResponse.aiHtml ? (
                  <SafeHtml html={parsedResponse.aiHtml} />
                ) : (
                  <Alert severity="info" sx={{ fontSize: DETAIL_FONT_SIZE.body }}>
                    This log was recorded before HTML previews were stored. Regenerate the project
                    HTML to see the rendered preview here.
                  </Alert>
                )}
              </Box>
            </Box>
          </>
        )}

        {shouldShowAiResponse &&
          (() => {
            if (!parsedResponse.formatted) return null
            return (
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
                  AI Response
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
                  <Typography
                    variant="body2"
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
                    {parsedResponse.formatted}
                  </Typography>
                </Box>
                {parsedResponse.contentJson != null && (
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
                      Content
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
                      <Typography
                        variant="body2"
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
                        {parsedResponse.contentJson}
                      </Typography>
                    </Box>
                  </>
                )}
              </>
            )
          })()}

        {isError && event.errorMessage && (
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
              Error
            </Typography>
            <Box
              sx={{
                mt: 0.5,
                mb: 2,
                p: 1.5,
                bgcolor: "error.main",
                color: "error.contrastText",
                borderRadius: "var(--radius-sm)",
                border: "1px solid",
                borderColor: "error.dark",
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
                {event.errorMessage}
              </Typography>
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
          <DetailRow label="ID" value={event.id} mono />
          <DetailRow label="Created" value={formatTimestamp(event.createdAt)} />
        </Box>
      </Box>
    </Box>
  )
}
