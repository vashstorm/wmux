import type { AiUsageEvent } from "../api/client.js"

export interface ParsedAiUsageResponse {
  formatted: string | null
  content: unknown
  contentJson: string | null
  parseError: boolean
  contentParseError: boolean
  operation?: string
  summary?: string
  projectId?: string
  projectName?: string
  aiHtml?: string
  aiHtmlBytes?: number | null
  app?: string
  status?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function asNumber(value: unknown): number | null | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value === null) return null
  return undefined
}

function parseJsonRecord(jsonString: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(jsonString)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseContentRecord(content: unknown): Record<string, unknown> | null {
  if (isRecord(content)) return content
  if (typeof content !== "string") return null
  return parseJsonRecord(content)
}

function contentAsJson(content: unknown): string | null {
  if (content == null) return null
  if (typeof content === "string") {
    try {
      return JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      return JSON.stringify(content)
    }
  }
  return JSON.stringify(content, null, 2)
}

export function parseAiUsageResponse(
  responseJson: string | null | undefined,
): ParsedAiUsageResponse {
  if (!responseJson) {
    return {
      formatted: null,
      content: null,
      contentJson: null,
      parseError: false,
      contentParseError: false,
    }
  }

  const parsed = parseJsonRecord(responseJson)
  if (!parsed) {
    return {
      formatted: responseJson,
      content: null,
      contentJson: null,
      parseError: true,
      contentParseError: false,
    }
  }

  const choices = Array.isArray(parsed.choices) ? parsed.choices : []
  const firstChoice = choices[0]
  const firstMessage =
    isRecord(firstChoice) && isRecord(firstChoice.message) ? firstChoice.message : null
  const content = parsed.content ?? firstMessage?.content ?? null
  const contentRecord = parseContentRecord(content)
  const source = contentRecord ?? parsed
  const contentParseError =
    typeof content === "string" && content.trim().length > 0 && contentRecord === null

  return {
    formatted: JSON.stringify(parsed, null, 2),
    content,
    contentJson: contentAsJson(content),
    parseError: false,
    contentParseError,
    operation: asString(source.operation),
    summary: asString(source.summary),
    projectId: asString(source.projectId),
    projectName: asString(source.projectName),
    aiHtml: asString(source.aiHtml),
    aiHtmlBytes: asNumber(source.aiHtmlBytes),
    app: asString(source.application) ?? asString(source.app),
    status: asString(source.status),
  }
}

export function isProjectAiHtmlEvent(
  event: AiUsageEvent,
  parsed = parseAiUsageResponse(event.responseJson),
): boolean {
  return event.targetName === "project" || parsed.operation === "generate_ai_html"
}

export function getAiUsageKindLabel(
  event: AiUsageEvent,
  parsed = parseAiUsageResponse(event.responseJson),
): string {
  if (isProjectAiHtmlEvent(event, parsed)) return "Project HTML"
  return "Window Analysis"
}

export function getAiUsageTitle(
  event: AiUsageEvent,
  parsed = parseAiUsageResponse(event.responseJson),
): string {
  if (isProjectAiHtmlEvent(event, parsed))
    return parsed.projectName ?? event.sessionName ?? "Project HTML"
  return event.sessionName || parsed.app || event.model || "Window Analysis"
}

export function getAiUsageSubtitle(
  event: AiUsageEvent,
  parsed = parseAiUsageResponse(event.responseJson),
): string {
  if (isProjectAiHtmlEvent(event, parsed)) return parsed.summary ?? "Project AI HTML generated"
  return parsed.summary ?? event.model
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "-"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
