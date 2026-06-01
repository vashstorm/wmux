import { describe, expect, test, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { AiLogEntry } from "../api/client.js"
import { AiLogDetail } from "./AiLogDetail.js"

function createMockLog(overrides: Partial<AiLogEntry> = {}): AiLogEntry {
  return {
    id: "log-1",
    conversationId: "conv-1",
    eventKind: "llm_call",
    model: "gpt-4",
    status: "success",
    promptText: "Hello there",
    toolName: null,
    toolCallId: null,
    toolArgumentsJson: null,
    toolResultJson: null,
    metricsJson: JSON.stringify({ tokens: 100 }),
    durationMs: 1200,
    rawEventJson: null,
    errorMessage: null,
    createdAt: "2026-05-31T10:00:00Z",
    ...overrides,
  }
}

describe("AiLogDetail", () => {
  test("renders basic details correctly", () => {
    const onClose = vi.fn()
    render(<AiLogDetail log={createMockLog()} onClose={onClose} />)

    expect(screen.getByText("AI Log Detail")).toBeInTheDocument()
    expect(screen.getByText("llm_call")).toBeInTheDocument()
    expect(screen.getByText("success")).toBeInTheDocument()
    expect(screen.getByText("gpt-4")).toBeInTheDocument()
    expect(screen.getByText("conv-1")).toBeInTheDocument()
    expect(screen.getByText("Hello there")).toBeInTheDocument()
    expect(screen.getByText("1200ms")).toBeInTheDocument()
    expect(screen.getByText(/"tokens": 100/)).toBeInTheDocument()
    expect(screen.getByText("log-1")).toBeInTheDocument()

    // Click close
    fireEvent.click(screen.getByTestId("ai-log-detail-close"))
    expect(onClose).toHaveBeenCalled()
  })

  test("renders tool execution details when present", () => {
    const log = createMockLog({
      eventKind: "tool_call",
      toolName: "run_command",
      toolCallId: "call-xyz",
      toolArgumentsJson: JSON.stringify({ cmd: "ls" }),
      toolResultJson: JSON.stringify({ exitCode: 0, output: "file.txt" }),
    })

    render(<AiLogDetail log={log} onClose={() => {}} />)

    expect(screen.getByText("Tool Execution")).toBeInTheDocument()
    expect(screen.getByText("run_command")).toBeInTheDocument()
    expect(screen.getByText("call-xyz")).toBeInTheDocument()
    expect(screen.getByText(/"cmd": "ls"/)).toBeInTheDocument()
    expect(screen.getByText(/"exitCode": 0/)).toBeInTheDocument()
    expect(screen.getByText(/"output": "file.txt"/)).toBeInTheDocument()
  })

  test("renders error panel when log status is error", () => {
    const log = createMockLog({
      status: "error",
      errorMessage: "Rate limit exceeded",
    })

    render(<AiLogDetail log={log} onClose={() => {}} />)

    expect(screen.getByText("error")).toBeInTheDocument()
    expect(screen.getByText("Error")).toBeInTheDocument()
    expect(screen.getByText("Rate limit exceeded")).toBeInTheDocument()
  })

  test("renders blocked reason as issue panel", () => {
    const log = createMockLog({
      status: "blocked",
      errorMessage: "confirmation_required",
      durationMs: null,
    })

    render(<AiLogDetail log={log} onClose={() => {}} />)

    expect(screen.getByText("blocked")).toBeInTheDocument()
    expect(screen.getByText("Issue")).toBeInTheDocument()
    expect(screen.getByText("confirmation_required")).toBeInTheDocument()
    expect(screen.getByText("-")).toBeInTheDocument()
  })

  test("renders raw event json when present", () => {
    const log = createMockLog({
      rawEventJson: JSON.stringify({ raw: "event_data" }),
    })

    render(<AiLogDetail log={log} onClose={() => {}} />)

    expect(screen.getByText("Raw Event")).toBeInTheDocument()
    expect(screen.getByText(/"raw": "event_data"/)).toBeInTheDocument()
  })
})
