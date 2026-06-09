import { useState, useEffect, useCallback } from "react"
import { createStreamBurst } from "../api/streamPoc.js"

interface StreamPocTestProps {
  count?: number
  autoStart?: boolean
}

export function StreamPocTest({ count = 100, autoStart = false }: StreamPocTestProps) {
  const [lines, setLines] = useState<string[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runStream = useCallback(async () => {
    setLines([])
    setIsRunning(true)
    setIsComplete(false)
    setError(null)

    try {
      const cleanup = await createStreamBurst(
        count,
        (line) => {
          setLines((prev) => [...prev, line])
        },
        () => {
          setIsRunning(false)
          setIsComplete(true)
        },
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setIsRunning(false)
    }
  }, [count])

  useEffect(() => {
    if (autoStart) {
      runStream()
    }
  }, [autoStart, runStream])

  return (
    <div
      style={{
        padding: "16px",
        border: "1px solid #ccc",
        borderRadius: "8px",
        maxWidth: "400px",
        fontFamily: "monospace",
      }}
    >
      <h3 style={{ margin: "0 0 12px 0" }}>Stream PoC Test</h3>

      <div style={{ marginBottom: "12px" }}>
        <button
          onClick={runStream}
          disabled={isRunning}
          style={{
            padding: "8px 16px",
            cursor: isRunning ? "not-allowed" : "pointer",
          }}
        >
          {isRunning ? "Running..." : "Start Stream"}
        </button>
        <button
          onClick={() => {
            setLines([])
            setIsComplete(false)
            setError(null)
          }}
          style={{ marginLeft: "8px", padding: "8px 16px" }}
        >
          Clear
        </button>
      </div>

      <div style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>
        Count: {count} | Received: {lines.length} | Complete: {isComplete ? "Yes" : "No"}
      </div>

      {error && <div style={{ color: "red", marginBottom: "8px" }}>Error: {error}</div>}

      <div
        style={{
          height: "200px",
          overflow: "auto",
          border: "1px solid #eee",
          padding: "8px",
          fontSize: "11px",
          backgroundColor: "#f9f9f9",
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: "#999" }}>No lines received yet</div>
        ) : (
          lines.map((line, i) => (
            <div key={i} style={{ lineHeight: "1.4" }}>
              {line}
            </div>
          ))
        )}
      </div>

      {isComplete && (
        <div style={{ marginTop: "8px", color: "green" }}>
          Stream complete! Received {lines.length} lines.
        </div>
      )}
    </div>
  )
}
