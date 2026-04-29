// Package semantic defines the AI-pane semantic attention domain for wmux.
//
// PoC scope (encoded in types and comments):
//   - Local panes only. SSH panes are excluded from the PoC.
//   - No embedded model runtime required. Detection is command-name based.
//   - The allowlist is hard-coded; no dynamic configuration.
package semantic

import "strings"

// aiPaneAllowlist is the set of command names recognized as AI panes.
// PoC: exact match after normalization (trim, lowercase, strip leading dash).
var aiPaneAllowlist = map[string]struct{}{
	"claude":   {},
	"opencode": {},
	"codex":    {},
	"aider":    {},
	"omo":      {},
}

// SemanticEventType represents a semantic event that can occur in an AI pane.
type SemanticEventType string

const (
	// EventNone means no semantic event is present.
	EventNone SemanticEventType = "none"

	// EventUserResponseRequired means the AI is blocked waiting for the user to type a response.
	// Clear-state rule: clears ONLY after actual user input.
	EventUserResponseRequired SemanticEventType = "user_response_required"

	// EventChoiceRequired means the AI is presenting a menu/choice and waiting for selection.
	// Clear-state rule: clears ONLY after actual user input.
	EventChoiceRequired SemanticEventType = "choice_required"

	// EventBlockedError means the AI has encountered an error and is stuck.
	// Clear-state rule: can re-evaluate on each capture cycle.
	EventBlockedError SemanticEventType = "blocked_error"

	// EventDeadLoop means the AI appears to be in a dead loop (repeating without progress).
	// Clear-state rule: can re-evaluate on each capture cycle.
	EventDeadLoop SemanticEventType = "dead_loop"
)

// IsAIPane reports whether the given command name identifies an AI pane.
// Normalization: TrimSpace, strip a single leading dash, then ToLower.
func IsAIPane(command string) bool {
	normalized := normalizeCommandName(command)
	_, ok := aiPaneAllowlist[normalized]
	return ok
}

// SemanticEventPriority returns the integer priority of an event type.
// Higher values mean higher urgency.
//
// Ordering (highest first):
//   user_response_required = 4
//   choice_required        = 3
//   blocked_error          = 2
//   dead_loop              = 1
//   none                   = 0
func SemanticEventPriority(e SemanticEventType) int {
	switch e {
	case EventUserResponseRequired:
		return 4
	case EventChoiceRequired:
		return 3
	case EventBlockedError:
		return 2
	case EventDeadLoop:
		return 1
	case EventNone:
		return 0
	default:
		return 0
	}
}

// AggregateSemanticEvent returns the highest-priority event from the provided slice.
// An empty slice returns EventNone.
func AggregateSemanticEvent(events []SemanticEventType) SemanticEventType {
	var highest SemanticEventType = EventNone
	var highestPrio int
	for _, e := range events {
		p := SemanticEventPriority(e)
		if p > highestPrio {
			highestPrio = p
			highest = e
		}
	}
	return highest
}

// ClearRequiresInput reports whether the given event type requires actual user
// input before its clear-state can be considered resolved.
//
// Returns true for user_response_required and choice_required.
// Returns false for blocked_error, dead_loop, and none.
func ClearRequiresInput(e SemanticEventType) bool {
	switch e {
	case EventUserResponseRequired, EventChoiceRequired:
		return true
	default:
		return false
	}
}

// normalizeCommandName applies the same normalization used by the tmux
// attention package: trim spaces, strip a single leading dash, lowercase.
func normalizeCommandName(cmd string) string {
	cmd = strings.TrimSpace(cmd)
	if strings.HasPrefix(cmd, "-") && len(cmd) > 1 {
		cmd = cmd[1:]
	}
	return strings.ToLower(cmd)
}
