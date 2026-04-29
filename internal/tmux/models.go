package tmux

type Session struct {
	ID             string
	Name           string
	Attached       bool
	WindowCount    int
	AttentionState AttentionState
	AttentionCount int
}

type Window struct {
	ID              string
	Name            string
	Index           int
	Active          bool
	PaneCount       int
	ActivePaneID    string
	ActivePaneTitle string
	AttentionState  AttentionState
	AttentionCount  int
}

type Pane struct {
	ID     string
	Title  string
	Index  int
	Active bool
	Width  int
	Height int
	Left   int
	Top    int
	Dead           bool
	InputOff       bool
	InMode         bool
	AlternateOn    bool
	CurrentCommand string
	AttentionState AttentionState
}
