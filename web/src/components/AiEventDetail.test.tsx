import { describe, expect, test } from "vitest"
import { render, screen } from "@testing-library/react"
import type { AiUsageEvent } from "../api/client.js"
import { AiEventDetail } from "./AiEventDetail.js"

function event(overrides: Partial<AiUsageEvent>): AiUsageEvent {
  return {
    id: "event-1",
    projectId: "proj-1",
    provider: "openai",
    model: "gpt-4",
    targetName: "project",
    sessionName: "Wmux",
    status: "success",
    durationMs: 1280,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    estimatedCost: null,
    errorMessage: null,
    windowNumber: null,
    responseJson: JSON.stringify({
      operation: "generate_ai_html",
      summary: "Project AI HTML generated",
      projectId: "proj-1",
      projectName: "Wmux",
      aiHtml: "<section><h2>Generated Summary</h2><p>Project is healthy.</p></section>",
      aiHtmlBytes: 4096,
    }),
    createdAt: "2026-05-31T10:00:00Z",
    ...overrides,
  }
}

describe("AiEventDetail", () => {
  test("renders project AI HTML logs as a preview instead of raw response content", () => {
    render(<AiEventDetail event={event({})} onClose={() => {}} />)

    expect(screen.getByText("Project HTML Detail")).toBeInTheDocument()
    expect(screen.getAllByText("Project HTML").length).toBeGreaterThan(0)
    expect(screen.getByTestId("ai-html-log-summary")).toHaveTextContent("Wmux")
    expect(screen.getByTestId("ai-html-log-summary")).toHaveTextContent("4.0 KB")
    expect(screen.getByTestId("ai-html-log-preview")).toHaveTextContent("Generated Summary")
    expect(screen.getByTestId("ai-html-log-preview")).toHaveTextContent("Project is healthy.")
    expect(screen.queryByText("AI Response")).not.toBeInTheDocument()
  })

  test("shows a helpful fallback for older project HTML logs without stored HTML", () => {
    render(
      <AiEventDetail
        event={event({
          responseJson: JSON.stringify({
            operation: "generate_ai_html",
            summary: "Project AI HTML generated",
            projectName: "Wmux",
            aiHtmlBytes: 4096,
          }),
        })}
        onClose={() => {}}
      />,
    )

    expect(screen.getByTestId("ai-html-log-preview")).toHaveTextContent(
      "Regenerate the project HTML",
    )
  })

  test("shows full AI response when project HTML log parsing fails", () => {
    render(
      <AiEventDetail
        event={event({
          responseJson: "{not valid json",
        })}
        onClose={() => {}}
      />,
    )

    expect(screen.getByText("AI Response")).toBeInTheDocument()
    expect(screen.getByText("{not valid json")).toBeInTheDocument()
  })
})
