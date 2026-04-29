package tmux

type Session struct {
	ID       string
	Name     string
	Attached bool
}

type Window struct {
	ID     string
	Name   string
	Index  int
	Active bool
}

type Pane struct {
	ID     string
	Title  string
	Index  int
	Active bool
	Width  int
	Height int
}
