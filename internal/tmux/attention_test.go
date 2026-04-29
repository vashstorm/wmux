package tmux_test

import (
	"testing"

	"github.com/panh/wmux/internal/tmux"
)

func TestDeriveAttentionState(t *testing.T) {
	tests := []struct {
		name           string
		dead           bool
		inputOff       bool
		inMode         bool
		alternateOn    bool
		currentCommand string
		want           tmux.AttentionState
	}{
		{
			name:           "none by default",
			dead:           false,
			inputOff:       false,
			inMode:         false,
			alternateOn:    false,
			currentCommand: "bash",
			want:           tmux.AttentionStateNone,
		},
		{
			name:           "explicit when dead",
			dead:           true,
			inputOff:       false,
			inMode:         false,
			alternateOn:    false,
			currentCommand: "bash",
			want:           tmux.AttentionStateExplicit,
		},
		{
			name:           "explicit when input off",
			dead:           false,
			inputOff:       true,
			inMode:         false,
			alternateOn:    false,
			currentCommand: "bash",
			want:           tmux.AttentionStateExplicit,
		},
		{
			name:           "explicit when dead and input off",
			dead:           true,
			inputOff:       true,
			inMode:         false,
			alternateOn:    false,
			currentCommand: "bash",
			want:           tmux.AttentionStateExplicit,
		},
		{
			name:           "attention when in mode",
			dead:           false,
			inputOff:       false,
			inMode:         true,
			alternateOn:    false,
			currentCommand: "bash",
			want:           tmux.AttentionStateAttention,
		},
		{
			name:           "explicit beats in mode",
			dead:           false,
			inputOff:       true,
			inMode:         true,
			alternateOn:    false,
			currentCommand: "bash",
			want:           tmux.AttentionStateExplicit,
		},
		{
			name:           "attention when alternate on and TUI command vim",
			dead:           false,
			inputOff:       false,
			inMode:         false,
			alternateOn:    true,
			currentCommand: "vim",
			want:           tmux.AttentionStateAttention,
		},
		{
			name:           "attention when alternate on and TUI command nvim",
			dead:           false,
			inputOff:       false,
			inMode:         false,
			alternateOn:    true,
			currentCommand: "nvim",
			want:           tmux.AttentionStateAttention,
		},
		{
			name:           "attention when alternate on and TUI command htop",
			dead:           false,
			inputOff:       false,
			inMode:         false,
			alternateOn:    true,
			currentCommand: "htop",
			want:           tmux.AttentionStateAttention,
		},
		{
			name:           "none when alternate on and shell bash",
			dead:           false,
			inputOff:       false,
			inMode:         false,
			alternateOn:    true,
			currentCommand: "bash",
			want:           tmux.AttentionStateNone,
		},
		{
			name:           "none when alternate on and shell zsh",
			dead:           false,
			inputOff:       false,
			inMode:         false,
			alternateOn:    true,
			currentCommand: "zsh",
			want:           tmux.AttentionStateNone,
		},
		{
			name:           "none when alternate on and login shell -bash",
			dead:           false,
			inputOff:       false,
			inMode:         false,
			alternateOn:    true,
			currentCommand: "-bash",
			want:           tmux.AttentionStateNone,
		},
		{
			name:           "none when alternate on and login shell -zsh",
			dead:           false,
			inputOff:       false,
			inMode:         false,
			alternateOn:    true,
			currentCommand: "-zsh",
			want:           tmux.AttentionStateNone,
		},
		{
			name:           "none when alternate on and empty command",
			dead:           false,
			inputOff:       false,
			inMode:         false,
			alternateOn:    true,
			currentCommand: "",
			want:           tmux.AttentionStateNone,
		},
		{
			name:           "none when alternate on and unknown command",
			dead:           false,
			inputOff:       false,
			inMode:         false,
			alternateOn:    true,
			currentCommand: "some-random-cmd",
			want:           tmux.AttentionStateNone,
		},
		{
			name:           "attention case insensitive VIM",
			dead:           false,
			inputOff:       false,
			inMode:         false,
			alternateOn:    true,
			currentCommand: "VIM",
			want:           tmux.AttentionStateAttention,
		},
		{
			name:           "attention with spaces around command",
			dead:           false,
			inputOff:       false,
			inMode:         false,
			alternateOn:    true,
			currentCommand: "  vim  ",
			want:           tmux.AttentionStateAttention,
		},
		{
			name:           "attention when in mode even with alternate on shell",
			dead:           false,
			inputOff:       false,
			inMode:         true,
			alternateOn:    true,
			currentCommand: "bash",
			want:           tmux.AttentionStateAttention,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tmux.DeriveAttentionState(tt.dead, tt.inputOff, tt.inMode, tt.alternateOn, tt.currentCommand)
			if got != tt.want {
				t.Fatalf("DeriveAttentionState() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAggregateAttentionState(t *testing.T) {
	tests := []struct {
		name   string
		states []tmux.AttentionState
		want   tmux.AttentionState
	}{
		{
			name:   "empty slice returns none",
			states: []tmux.AttentionState{},
			want:   tmux.AttentionStateNone,
		},
		{
			name:   "single none",
			states: []tmux.AttentionState{tmux.AttentionStateNone},
			want:   tmux.AttentionStateNone,
		},
		{
			name:   "single attention",
			states: []tmux.AttentionState{tmux.AttentionStateAttention},
			want:   tmux.AttentionStateAttention,
		},
		{
			name:   "single explicit",
			states: []tmux.AttentionState{tmux.AttentionStateExplicit},
			want:   tmux.AttentionStateExplicit,
		},
		{
			name:   "explicit beats attention",
			states: []tmux.AttentionState{tmux.AttentionStateAttention, tmux.AttentionStateExplicit},
			want:   tmux.AttentionStateExplicit,
		},
		{
			name:   "explicit beats none",
			states: []tmux.AttentionState{tmux.AttentionStateNone, tmux.AttentionStateExplicit},
			want:   tmux.AttentionStateExplicit,
		},
		{
			name:   "attention beats none",
			states: []tmux.AttentionState{tmux.AttentionStateNone, tmux.AttentionStateAttention},
			want:   tmux.AttentionStateAttention,
		},
		{
			name:   "all three explicit wins",
			states: []tmux.AttentionState{tmux.AttentionStateNone, tmux.AttentionStateAttention, tmux.AttentionStateExplicit},
			want:   tmux.AttentionStateExplicit,
		},
		{
			name:   "multiple none only",
			states: []tmux.AttentionState{tmux.AttentionStateNone, tmux.AttentionStateNone, tmux.AttentionStateNone},
			want:   tmux.AttentionStateNone,
		},
		{
			name:   "multiple attention only",
			states: []tmux.AttentionState{tmux.AttentionStateAttention, tmux.AttentionStateAttention},
			want:   tmux.AttentionStateAttention,
		},
		{
			name:   "explicit first then none",
			states: []tmux.AttentionState{tmux.AttentionStateExplicit, tmux.AttentionStateNone},
			want:   tmux.AttentionStateExplicit,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tmux.AggregateAttentionState(tt.states)
			if got != tt.want {
				t.Fatalf("AggregateAttentionState() = %q, want %q", got, tt.want)
			}
		})
	}
}
