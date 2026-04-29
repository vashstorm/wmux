package tmux

type Session struct {
	ID         string
	Name       string
	Attached   bool
	WindowCount int
}

type Window struct {
	ID              string
	Name            string
	Index           int
	Active          bool
	PaneCount       int
	ActivePaneID    string
	ActivePaneTitle string
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
}
