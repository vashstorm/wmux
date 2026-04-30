package intelligence

import (
	"strings"
	"time"
)

// Application identifies the application observed in a pane.
type Application string

const (
	AppClaude   Application = "claude"
	AppCodex    Application = "codex"
	AppOpenCode Application = "opencode"
	AppZsh      Application = "zsh"
	AppUnknown  Application = "unknown"
)

// Status identifies the inferred state of a pane.
type Status string

const (
	StatusDeadLoop Status = "dead_loop"
	StatusBlocked  Status = "blocked"
	StatusWaiting  Status = "waiting"
	StatusRunning  Status = "running"
	StatusNone     Status = "none"
)

// StatusPriority returns an integer priority where higher means more urgent.
func StatusPriority(s Status) int {
	switch s {
	case StatusDeadLoop:
		return 4
	case StatusBlocked:
		return 3
	case StatusWaiting:
		return 2
	case StatusRunning:
		return 1
	case StatusNone:
		return 0
	default:
		return 0
	}
}

// NormalizeApplication validates and lowercases an application name.
func NormalizeApplication(s string) Application {
	switch Application(strings.ToLower(strings.TrimSpace(s))) {
	case AppClaude:
		return AppClaude
	case AppCodex:
		return AppCodex
	case AppOpenCode:
		return AppOpenCode
	case AppZsh:
		return AppZsh
	default:
		return AppUnknown
	}
}

// NormalizeStatus validates and lowercases a pane status.
func NormalizeStatus(s string) Status {
	switch Status(strings.ToLower(strings.TrimSpace(s))) {
	case StatusDeadLoop:
		return StatusDeadLoop
	case StatusBlocked:
		return StatusBlocked
	case StatusWaiting:
		return StatusWaiting
	case StatusRunning:
		return StatusRunning
	case StatusNone:
		return StatusNone
	default:
		return StatusNone
	}
}

// Result is the derived intelligence state for one pane.
type Result struct {
	PaneID      string
	SessionName string
	WindowID    string
	App         Application
	Status      Status
	Summary     string
	Source      string
	Confidence  float64
	Reason      string
	ContentHash string
	UpdatedAt   time.Time
	Stale       bool
	Error       string
}

// AnalyzeInput is passed to intelligence providers after redaction.
type AnalyzeInput struct {
	PaneID         string
	SessionName    string
	WindowID       string
	CurrentCommand string
	RawContent     string
}
