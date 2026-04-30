package sshclient

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/panh/wmux/internal/tmux"
)

func TestParseRemotePaneRowWithAttentionFields(t *testing.T) {
	tests := []struct {
		name string
		row  string
		want tmux.Pane
	}{
		{
			name: "dead pane explicit",
			row:  strings.Join([]string{"%1", "main", "0", "1", "120", "40", "0", "0", "1", "0", "0", "0", "bash"}, remoteFieldSeparator),
			want: tmux.Pane{ID: "%1", Title: "main", Index: 0, Active: true, Width: 120, Height: 40, Left: 0, Top: 0, Dead: true, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "bash", AttentionState: tmux.AttentionStateExplicit},
		},
		{
			name: "input off explicit",
			row:  strings.Join([]string{"%2", "logs", "1", "0", "80", "24", "0", "40", "0", "1", "0", "0", "bash"}, remoteFieldSeparator),
			want: tmux.Pane{ID: "%2", Title: "logs", Index: 1, Active: false, Width: 80, Height: 24, Left: 0, Top: 40, Dead: false, InputOff: true, InMode: false, AlternateOn: false, CurrentCommand: "bash", AttentionState: tmux.AttentionStateExplicit},
		},
		{
			name: "in mode attention",
			row:  strings.Join([]string{"%3", "vim", "2", "0", "80", "24", "0", "0", "0", "0", "1", "0", "bash"}, remoteFieldSeparator),
			want: tmux.Pane{ID: "%3", Title: "vim", Index: 2, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: true, AlternateOn: false, CurrentCommand: "bash", AttentionState: tmux.AttentionStateAttention},
		},
		{
			name: "alternate on with TUI attention",
			row:  strings.Join([]string{"%4", "editor", "3", "0", "100", "30", "10", "0", "0", "0", "0", "1", "vim"}, remoteFieldSeparator),
			want: tmux.Pane{ID: "%4", Title: "editor", Index: 3, Active: false, Width: 100, Height: 30, Left: 10, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: true, CurrentCommand: "vim", AttentionState: tmux.AttentionStateAttention},
		},
		{
			name: "alternate on with shell none",
			row:  strings.Join([]string{"%5", "shell", "4", "0", "80", "24", "0", "0", "0", "0", "0", "1", "bash"}, remoteFieldSeparator),
			want: tmux.Pane{ID: "%5", Title: "shell", Index: 4, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: true, CurrentCommand: "bash", AttentionState: tmux.AttentionStateNone},
		},
		{
			name: "alternate on with login shell none",
			row:  strings.Join([]string{"%6", "login", "5", "0", "80", "24", "0", "0", "0", "0", "0", "1", "-bash"}, remoteFieldSeparator),
			want: tmux.Pane{ID: "%6", Title: "login", Index: 5, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: true, CurrentCommand: "-bash", AttentionState: tmux.AttentionStateNone},
		},
		{
			name: "empty command none",
			row:  strings.Join([]string{"%7", "empty", "6", "0", "80", "24", "0", "0", "0", "0", "0", "0", ""}, remoteFieldSeparator),
			want: tmux.Pane{ID: "%7", Title: "empty", Index: 6, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "", AttentionState: tmux.AttentionStateNone},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseRemotePaneRow(tt.row)
			if err != nil {
				t.Fatalf("parseRemotePaneRow() error = %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("parseRemotePaneRow() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestParseRemotePanesOutputWithAttentionFields(t *testing.T) {
	output := strings.Join([]string{"%1", "main", "0", "1", "120", "40", "0", "0", "0", "0", "0", "0", "bash"}, remoteFieldSeparator) + "\n" +
		strings.Join([]string{"%2", "vim", "1", "0", "80", "24", "0", "0", "0", "0", "0", "1", "vim"}, remoteFieldSeparator) + "\n" +
		strings.Join([]string{"%3", "dead", "2", "0", "80", "24", "0", "0", "1", "0", "0", "0", "bash"}, remoteFieldSeparator)

	panes, err := parseRemotePanesOutput(output)
	if err != nil {
		t.Fatalf("parseRemotePanesOutput() error = %v", err)
	}

	want := []tmux.Pane{
		{ID: "%1", Title: "main", Index: 0, Active: true, Width: 120, Height: 40, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "bash", AttentionState: tmux.AttentionStateNone},
		{ID: "%2", Title: "vim", Index: 1, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: true, CurrentCommand: "vim", AttentionState: tmux.AttentionStateAttention},
		{ID: "%3", Title: "dead", Index: 2, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: true, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "bash", AttentionState: tmux.AttentionStateExplicit},
	}
	if !reflect.DeepEqual(panes, want) {
		t.Fatalf("parseRemotePanesOutput() = %#v, want %#v", panes, want)
	}
}

func TestParseRemotePaneRowFallbackColonSeparatedDoesNotPanic(t *testing.T) {
	pane, err := parseRemotePaneRow("%5:vim:3:1:80:24:10:5")
	if err != nil {
		t.Fatalf("parseRemotePaneRow() error = %v", err)
	}

	want := tmux.Pane{ID: "%5", Title: "vim", Index: 3, Active: true, Width: 80, Height: 24, Left: 10, Top: 5, Dead: false, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "", AttentionState: tmux.AttentionStateNone}
	if !reflect.DeepEqual(pane, want) {
		t.Fatalf("parseRemotePaneRow() = %#v, want %#v", pane, want)
	}
}

func TestRemoteListPanesParsesAttentionFields(t *testing.T) {
	remote := Remote{
		BinaryPath: "tmux",
		runCommand: func(binary string, args ...string) (string, error) {
			if binary != "tmux" {
				t.Fatalf("unexpected binary: %q", binary)
			}
			wantArgs := []string{"list-panes", "-t", "session-1:window-1", "-F", remotePaneFormat}
			if !reflect.DeepEqual(args, wantArgs) {
				t.Fatalf("args = %#v, want %#v", args, wantArgs)
			}
			return strings.Join([]string{"%1", "main", "0", "1", "120", "40", "0", "0", "0", "0", "0", "0", "bash"}, remoteFieldSeparator) + "\n" +
				strings.Join([]string{"%2", "vim", "1", "0", "80", "24", "0", "0", "0", "0", "0", "1", "vim"}, remoteFieldSeparator), nil
		},
	}

	panes, err := remote.ListPanes("session-1:window-1")
	if err != nil {
		t.Fatalf("ListPanes() error = %v", err)
	}

	want := []tmux.Pane{
		{ID: "%1", Title: "main", Index: 0, Active: true, Width: 120, Height: 40, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "bash", AttentionState: tmux.AttentionStateNone},
		{ID: "%2", Title: "vim", Index: 1, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: true, CurrentCommand: "vim", AttentionState: tmux.AttentionStateAttention},
	}
	if !reflect.DeepEqual(panes, want) {
		t.Fatalf("ListPanes() = %#v, want %#v", panes, want)
	}
}

func TestRemoteListPanesReturnsErrorOnCommandFailure(t *testing.T) {
	remote := Remote{
		BinaryPath: "tmux",
		runCommand: func(binary string, args ...string) (string, error) {
			return "", errors.New("remote command failed: bad target")
		},
	}

	_, err := remote.ListPanes("session-1:window-1")
	if err == nil {
		t.Fatal("expected error for failed remote list-panes")
	}
	if !strings.Contains(err.Error(), "remote tmux list-panes") {
		t.Fatalf("expected remote tmux list-panes error, got %q", err.Error())
	}
}

func TestTmuxAttachArgsUseIgnoreSize(t *testing.T) {
	got := tmuxAttachArgs("dev")
	want := []string{"attach-session", "-t", "dev"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tmuxAttachArgs() = %#v, want %#v", got, want)
	}
}
