package tmux

import "strings"

// AttentionState represents the attention level of a tmux pane.
type AttentionState string

const (
	AttentionStateNone      AttentionState = "none"
	AttentionStateAttention AttentionState = "attention"
	AttentionStateExplicit  AttentionState = "explicit"
)

var knownShells = map[string]struct{}{
	"bash": {},
	"sh":   {},
	"zsh":  {},
	"fish": {},
	"tcsh": {},
	"csh":  {},
	"ksh":  {},
	"dash": {},
}

var interactiveTUIs = map[string]struct{}{
	"vim":      {},
	"nvim":     {},
	"less":     {},
	"more":     {},
	"man":      {},
	"htop":     {},
	"top":      {},
	"tig":      {},
	"lazygit":  {},
	"nano":     {},
}

// DeriveAttentionState computes the attention state for a pane from its tmux-format booleans and current command.
// Priority: explicit (dead/inputOff) > attention (inMode) > attention (alternateOn + TUI) > none.
func DeriveAttentionState(dead, inputOff, inMode, alternateOn bool, currentCommand string) AttentionState {
	if dead || inputOff {
		return AttentionStateExplicit
	}
	if inMode {
		return AttentionStateAttention
	}
	if alternateOn {
		normalized := normalizeCommandName(currentCommand)
		if !isKnownShell(normalized) && isInteractiveTUI(normalized) {
			return AttentionStateAttention
		}
	}
	return AttentionStateNone
}

// AggregateAttentionState returns the highest-priority state among the provided slice.
// Empty slice returns AttentionStateNone.
func AggregateAttentionState(states []AttentionState) AttentionState {
	var highest AttentionState = AttentionStateNone
	var highestPrio int
	for _, s := range states {
		p := attentionPriority(s)
		if p > highestPrio {
			highestPrio = p
			highest = s
		}
	}
	return highest
}

func attentionPriority(s AttentionState) int {
	switch s {
	case AttentionStateExplicit:
		return 2
	case AttentionStateAttention:
		return 1
	case AttentionStateNone:
		return 0
	default:
		return 0
	}
}

func normalizeCommandName(cmd string) string {
	cmd = strings.TrimSpace(cmd)
	if strings.HasPrefix(cmd, "-") && len(cmd) > 1 {
		cmd = cmd[1:]
	}
	return strings.ToLower(cmd)
}

func isKnownShell(cmd string) bool {
	_, ok := knownShells[cmd]
	return ok
}

func isInteractiveTUI(cmd string) bool {
	_, ok := interactiveTUIs[cmd]
	return ok
}
