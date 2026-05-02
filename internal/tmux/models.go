package tmux

type Session struct {
	ID                      string
	Name                    string
	Attached                bool
	WindowCount             int
	AttentionState          AttentionState
	AttentionCount          int
	IntelligenceApp         string         `json:"intelligenceApp,omitempty"`
	IntelligenceStatus      string         `json:"intelligenceStatus,omitempty"`
	IntelligenceSummary     string         `json:"intelligenceSummary,omitempty"`
	IntelligenceSource      string         `json:"intelligenceSource,omitempty"`
	IntelligenceConfidence  float64        `json:"intelligenceConfidence,omitempty"`
	IntelligenceUpdatedAt   string         `json:"intelligenceUpdatedAt,omitempty"`
	IntelligenceStale       bool           `json:"intelligenceStale,omitempty"`
	IntelligenceError       string         `json:"intelligenceError,omitempty"`
	IntelligenceWindowCount int            `json:"intelligenceWindowCount,omitempty"`
	IntelligencePaneCount   int            `json:"intelligencePaneCount,omitempty"`
	IntelligenceAppCounts   map[string]int `json:"intelligenceAppCounts,omitempty"`
}

type Window struct {
	ID                     string
	Name                   string
	Index                  int
	Active                 bool
	PaneCount              int
	ActivePaneID           string
	ActivePaneTitle        string
	AttentionState         AttentionState
	AttentionCount         int
	IntelligenceApp        string  `json:"intelligenceApp,omitempty"`
	IntelligenceStatus     string  `json:"intelligenceStatus,omitempty"`
	IntelligenceSummary    string  `json:"intelligenceSummary,omitempty"`
	IntelligenceSource     string  `json:"intelligenceSource,omitempty"`
	IntelligenceConfidence float64 `json:"intelligenceConfidence,omitempty"`
	IntelligenceUpdatedAt  string  `json:"intelligenceUpdatedAt,omitempty"`
	IntelligenceStale      bool    `json:"intelligenceStale,omitempty"`
	IntelligenceError      string  `json:"intelligenceError,omitempty"`
}

type Pane struct {
	ID                     string
	Title                  string
	Index                  int
	Active                 bool
	Width                  int
	Height                 int
	Left                   int
	Top                    int
	Dead                   bool
	InputOff               bool
	InMode                 bool
	AlternateOn            bool
	CurrentCommand         string
	AttentionState         AttentionState
	IntelligenceApp        string  `json:"intelligenceApp,omitempty"`
	IntelligenceStatus     string  `json:"intelligenceStatus,omitempty"`
	IntelligenceSummary    string  `json:"intelligenceSummary,omitempty"`
	IntelligenceSource     string  `json:"intelligenceSource,omitempty"`
	IntelligenceConfidence float64 `json:"intelligenceConfidence,omitempty"`
	IntelligenceUpdatedAt  string  `json:"intelligenceUpdatedAt,omitempty"`
	IntelligenceStale      bool    `json:"intelligenceStale,omitempty"`
	IntelligenceError      string  `json:"intelligenceError,omitempty"`
}
