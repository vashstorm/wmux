package tmux

type Session struct {
	ID                  string
	Name                string
	Attached            bool
	WindowCount         int
	AttentionState      AttentionState
	AttentionCount      int
	SemanticEventType   string `json:"semanticEventType"`
	SemanticEventCount  int    `json:"semanticEventCount"`
}

type Window struct {
	ID                  string
	Name                string
	Index               int
	Active              bool
	PaneCount           int
	ActivePaneID        string
	ActivePaneTitle     string
	AttentionState      AttentionState
	AttentionCount      int
	SemanticEventType   string `json:"semanticEventType"`
	SemanticEventCount  int    `json:"semanticEventCount"`
}

type Pane struct {
	ID                string
	Title             string
	Index             int
	Active            bool
	Width             int
	Height            int
	Left              int
	Top               int
	Dead              bool
	InputOff          bool
	InMode            bool
	AlternateOn       bool
	CurrentCommand    string
	AttentionState    AttentionState
	SemanticEventType  string `json:"semanticEventType"`
	SemanticEventCount int    `json:"semanticEventCount"`
}
