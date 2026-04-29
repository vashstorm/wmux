// Package semantic implements a proof-of-concept semantic attention pipeline
// for local AI panes in wmux.
//
// # Scope
//
// Semantic attention is ADDITIVE to the existing tmux/system attention pipeline
// (internal/tmux/attention.go) which remains unchanged. Semantic attention is
// represented in separate API fields (SemanticEventType, SemanticEventCount) and
// does NOT replace or modify AttentionState/AttentionCount.
//
// # Supported Cases (PoC)
//
// AI pane detection uses the process name reported by tmux (pane_current_command).
// Supported commands: claude, opencode, codex, aider, omo.
//
// Supported semantic event types:
//   - user_response_required: pane explicitly cannot proceed without user input
//   - choice_required: pane is waiting for a yes/no or option selection
//   - blocked_error: pane has hit a fatal error and stopped
//   - dead_loop: pane is repeating identical output indicative of a stuck loop
//
// # Exclusions (Intentional — not bugs)
//
// The following are intentionally out of scope for this PoC:
//   - SSH/remote panes: output capture over SSH is excluded due to latency and
//     complexity. Only local tmux panes (connection type "local") are analyzed.
//   - Persistent alert history: semantic events are ephemeral and held in memory
//     only for the current server process lifetime.
//   - Embedded model runtime: all classification uses deterministic rule-based
//     heuristics. No external ML service or embedded model is required.
//   - Generic questions: questions that do not explicitly block AI progress are
//     NOT classified as user_response_required.
//   - New WebSocket messages: semantic attention is surfaced via existing REST
//     polling endpoints only, not via new WebSocket protocol messages.
//   - Auto-clear on visibility: user_response_required and choice_required events
//     persist until actual user keyboard input is sent to the pane.
//
// # Architecture
//
// The pipeline follows this flow:
//
//	tmux pane → [IsAIPane check] → [LocalCapture.CapturePane] →
//	  [NormalizeOutput] → [Classify] → [StateManager.Update] →
//	  [aggregatePaneSemanticAttention] → REST API response fields
package semantic
