import { describe, expect, test } from "vitest"
import type { AiUsageEvent } from "../api/client.js"
import {
  formatBytes,
  getAiUsageKindLabel,
  getAiUsageSubtitle,
  getAiUsageTitle,
  parseAiUsageResponse,
} from "./aiUsagePresentation.js"

function event(overrides: Partial<AiUsageEvent>): AiUsageEvent {
  return {
    id: "event-1",
    provider: "openai",
    model: "gpt-4",
    targetName: "project",
    sessionName: "wmux",
    status: "success",
    durationMs: 1200,
    responseJson: null,
    createdAt: "2026-05-31T10:00:00Z",
    ...overrides,
  }
}

describe("aiUsagePresentation", () => {
  test("detects project AI HTML logs and extracts HTML metadata", () => {
    const aiEvent = event({
      responseJson: JSON.stringify({
        operation: "generate_ai_html",
        summary: "Project AI HTML generated",
        projectId: "proj-1",
        projectName: "Wmux",
        aiHtml: "<section><h2>Summary</h2></section>",
        aiHtmlBytes: 4096,
      }),
    })
    const parsed = parseAiUsageResponse(aiEvent.responseJson)

    expect(getAiUsageKindLabel(aiEvent, parsed)).toBe("Project HTML")
    expect(getAiUsageTitle(aiEvent, parsed)).toBe("Wmux")
    expect(getAiUsageSubtitle(aiEvent, parsed)).toBe("Project AI HTML generated")
    expect(parsed.aiHtml).toContain("<section>")
    expect(formatBytes(parsed.aiHtmlBytes)).toBe("4.0 KB")
  })

  test("keeps regular events labeled as window analysis", () => {
    const aiEvent = event({
      targetName: "local",
      sessionName: "dev",
      responseJson: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                application: "vim",
                status: "running",
                summary: "Editing source files",
              }),
            },
          },
        ],
      }),
    })
    const parsed = parseAiUsageResponse(aiEvent.responseJson)

    expect(getAiUsageKindLabel(aiEvent, parsed)).toBe("Window Analysis")
    expect(getAiUsageTitle(aiEvent, parsed)).toBe("dev")
    expect(getAiUsageSubtitle(aiEvent, parsed)).toBe("Editing source files")
  })

  test("marks malformed stored response JSON as a parse error", () => {
    const parsed = parseAiUsageResponse("{not valid json")

    expect(parsed.parseError).toBe(true)
    expect(parsed.contentParseError).toBe(false)
    expect(parsed.formatted).toBe("{not valid json")
  })

  test("marks malformed nested content as a content parse error", () => {
    const parsed = parseAiUsageResponse(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "{not valid json",
            },
          },
        ],
      }),
    )

    expect(parsed.parseError).toBe(false)
    expect(parsed.contentParseError).toBe(true)
    expect(parsed.contentJson).toBe(JSON.stringify("{not valid json"))
  })
})
