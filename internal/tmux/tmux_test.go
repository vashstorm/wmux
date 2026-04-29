package tmux

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestNewAdapterDefaultsPath(t *testing.T) {
	adapter := NewAdapter("")
	if adapter.Path != defaultBinaryPath {
		t.Fatalf("unexpected adapter path: %q", adapter.Path)
	}
}

func TestDetectBinaryMissing(t *testing.T) {
	missingPath := filepath.Join(t.TempDir(), "missing-tmux")
	err := DetectBinary(missingPath)
	if err == nil {
		t.Fatal("expected error for missing tmux binary")
	}
	assertErrorCode(t, err, ErrorCodeNotFound)
}

func TestMissingTmux(t *testing.T) {
	path := os.Getenv("WEBMUX_TMUX_PATH")
	if strings.TrimSpace(path) == "" {
		path = filepath.Join(t.TempDir(), "missing-tmux")
	}

	err := DetectBinary(path)
	if err == nil {
		t.Fatal("expected missing tmux binary error")
	}
	assertErrorCode(t, err, ErrorCodeNotFound)
}

func TestParseSessionRow(t *testing.T) {
	session, err := parseSessionRow("$1:dev:api:1")
	if err != nil {
		t.Fatalf("parseSessionRow() error = %v", err)
	}

	want := Session{ID: "$1", Name: "dev:api", Attached: true}
	if !reflect.DeepEqual(session, want) {
		t.Fatalf("parseSessionRow() = %#v, want %#v", session, want)
	}
}

func TestParseWindowRow(t *testing.T) {
	window, err := parseWindowRow("@2:editor:main:3:0:1:%5:zsh")
	if err != nil {
		t.Fatalf("parseWindowRow() error = %v", err)
	}

	want := Window{ID: "@2", Name: "editor:main", Index: 3, Active: false, PaneCount: 1, ActivePaneID: "%5", ActivePaneTitle: "zsh"}
	if !reflect.DeepEqual(window, want) {
		t.Fatalf("parseWindowRow() = %#v, want %#v", window, want)
	}
}

func TestParseWindowRowFormattedFieldsAllowsColonTitle(t *testing.T) {
	row := strings.Join([]string{"@2", "editor:main", "3", "0", "1", "%5", "user@host:/workspace"}, fieldSeparator)
	window, err := parseWindowRow(row)
	if err != nil {
		t.Fatalf("parseWindowRow() error = %v", err)
	}

	want := Window{ID: "@2", Name: "editor:main", Index: 3, Active: false, PaneCount: 1, ActivePaneID: "%5", ActivePaneTitle: "user@host:/workspace"}
	if !reflect.DeepEqual(window, want) {
		t.Fatalf("parseWindowRow() = %#v, want %#v", window, want)
	}
}

func TestParsePaneRow(t *testing.T) {
	row := strings.Join([]string{"%3", "nvim:logs", "1", "1", "120", "40", "0", "0", "0", "0", "0", "0", "vim"}, fieldSeparator)
	pane, err := parsePaneRow(row)
	if err != nil {
		t.Fatalf("parsePaneRow() error = %v", err)
	}

	want := Pane{ID: "%3", Title: "nvim:logs", Index: 1, Active: true, Width: 120, Height: 40, Left: 0, Top: 0, CurrentCommand: "vim", AttentionState: AttentionStateNone}
	if !reflect.DeepEqual(pane, want) {
		t.Fatalf("parsePaneRow() = %#v, want %#v", pane, want)
	}
}

func TestParsePaneRowFormattedFieldsAllowsColonTitle(t *testing.T) {
	row := strings.Join([]string{"%3", "nvim:/workspace", "1", "1", "120", "40", "0", "0", "0", "0", "0", "0", "tmux"}, fieldSeparator)
	pane, err := parsePaneRow(row)
	if err != nil {
		t.Fatalf("parsePaneRow() error = %v", err)
	}

	want := Pane{ID: "%3", Title: "nvim:/workspace", Index: 1, Active: true, Width: 120, Height: 40, Left: 0, Top: 0, CurrentCommand: "tmux", AttentionState: AttentionStateNone}
	if !reflect.DeepEqual(pane, want) {
		t.Fatalf("parsePaneRow() = %#v, want %#v", pane, want)
	}
}

func TestParseWindowsOutputWithNewFields(t *testing.T) {
	output := "@1:editor:1:1:2:%1:zsh\n@2:shell:2:0:1:%2:bash"
	windows, err := parseWindowsOutput(output)
	if err != nil {
		t.Fatalf("parseWindowsOutput() error = %v", err)
	}

	want := []Window{
		{ID: "@1", Name: "editor", Index: 1, Active: true, PaneCount: 2, ActivePaneID: "%1", ActivePaneTitle: "zsh"},
		{ID: "@2", Name: "shell", Index: 2, Active: false, PaneCount: 1, ActivePaneID: "%2", ActivePaneTitle: "bash"},
	}
	if !reflect.DeepEqual(windows, want) {
		t.Fatalf("parseWindowsOutput() = %#v, want %#v", windows, want)
	}
}

func TestParsePanesOutputWithGeometry(t *testing.T) {
	output := strings.Join([]string{"%1", "main", "0", "1", "120", "40", "0", "0", "0", "0", "0", "0", ""}, fieldSeparator) + "\n" +
		strings.Join([]string{"%2", "logs", "1", "0", "80", "24", "0", "40", "0", "0", "0", "0", ""}, fieldSeparator) + "\n" +
		strings.Join([]string{"%3", "side", "2", "0", "40", "40", "120", "0", "0", "0", "0", "0", ""}, fieldSeparator)
	panes, err := parsePanesOutput(output)
	if err != nil {
		t.Fatalf("parsePanesOutput() error = %v", err)
	}

	want := []Pane{
		{ID: "%1", Title: "main", Index: 0, Active: true, Width: 120, Height: 40, Left: 0, Top: 0, AttentionState: AttentionStateNone},
		{ID: "%2", Title: "logs", Index: 1, Active: false, Width: 80, Height: 24, Left: 0, Top: 40, AttentionState: AttentionStateNone},
		{ID: "%3", Title: "side", Index: 2, Active: false, Width: 40, Height: 40, Left: 120, Top: 0, AttentionState: AttentionStateNone},
	}
	if !reflect.DeepEqual(panes, want) {
		t.Fatalf("parsePanesOutput() = %#v, want %#v", panes, want)
	}
}

func TestParseWindowRowSinglePane(t *testing.T) {
	window, err := parseWindowRow("@1:single:0:1:1:%1:")
	if err != nil {
		t.Fatalf("parseWindowRow() error = %v", err)
	}

	want := Window{ID: "@1", Name: "single", Index: 0, Active: true, PaneCount: 1, ActivePaneID: "%1", ActivePaneTitle: ""}
	if !reflect.DeepEqual(window, want) {
		t.Fatalf("parseWindowRow() = %#v, want %#v", window, want)
	}
}

func TestParsePaneRowWithPosition(t *testing.T) {
	row := strings.Join([]string{"%5", "vim", "3", "1", "80", "24", "10", "5", "0", "0", "0", "0", ""}, fieldSeparator)
	pane, err := parsePaneRow(row)
	if err != nil {
		t.Fatalf("parsePaneRow() error = %v", err)
	}

	want := Pane{ID: "%5", Title: "vim", Index: 3, Active: true, Width: 80, Height: 24, Left: 10, Top: 5, AttentionState: AttentionStateNone}
	if !reflect.DeepEqual(pane, want) {
		t.Fatalf("parsePaneRow() = %#v, want %#v", pane, want)
	}
}

func TestParsePaneRowFallbackColonSeparated(t *testing.T) {
	pane, err := parsePaneRow("%5:vim:3:1:80:24:10:5")
	if err != nil {
		t.Fatalf("parsePaneRow() error = %v", err)
	}

	want := Pane{ID: "%5", Title: "vim", Index: 3, Active: true, Width: 80, Height: 24, Left: 10, Top: 5, AttentionState: AttentionStateNone}
	if !reflect.DeepEqual(pane, want) {
		t.Fatalf("parsePaneRow() = %#v, want %#v", pane, want)
	}
}

func TestCommandBuilders(t *testing.T) {
	tests := []struct {
		name    string
		build   func() ([]string, error)
		want    []string
		wantErr bool
	}{
		{
			name:  "list windows args",
			build: func() ([]string, error) { return buildListWindowsArgs("session-1") },
			want:  []string{"list-windows", "-t", "session-1", "-F", windowFormat},
		},
		{
			name:  "list panes builds session target",
			build: func() ([]string, error) { return buildListPanesArgs("session-1", "window-1") },
			want:  []string{"list-panes", "-t", "session-1:window-1", "-F", paneFormat},
		},
		{
			name:  "split pane horizontal args",
			build: func() ([]string, error) { return buildSplitPaneArgs("%1", true) },
			want:  []string{"split-window", "-h", "-t", "%1", "-P", "-F", paneFormat},
		},
		{
			name:    "reject empty session",
			build:   func() ([]string, error) { return buildListWindowsArgs("") },
			wantErr: true,
		},
		{
			name:    "reject empty pane target",
			build:   func() ([]string, error) { return buildKillPaneArgs("") },
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.build()
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}

			if err != nil {
				t.Fatalf("build() error = %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("build() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestListSessionsNoServerReturnsEmpty(t *testing.T) {
	adapter := newFakeAdapter(t, fakeExecConfig{
		stderr:   "no server running on /tmp/tmux-1000/default\n",
		exitCode: 1,
	})

	sessions, err := adapter.ListSessions()
	if err != nil {
		t.Fatalf("ListSessions() error = %v", err)
	}
	if len(sessions) != 0 {
		t.Fatalf("ListSessions() returned %d sessions, want 0", len(sessions))
	}
}

func TestRunCommandFailureIncludesStderr(t *testing.T) {
	adapter := newFakeAdapter(t, fakeExecConfig{
		stderr:   "permission denied\n",
		exitCode: 1,
	})

	_, err := adapter.ListWindows("session-1")
	if err == nil {
		t.Fatal("expected command failure")
	}
	assertErrorCode(t, err, ErrorCodeCommandFailed)
	if !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected stderr in error, got %q", err.Error())
	}
}

func TestParsePaneRowWithAttentionFields(t *testing.T) {
	tests := []struct {
		name string
		row  string
		want Pane
	}{
		{
			name: "dead pane explicit",
			row: strings.Join([]string{"%1", "main", "0", "1", "120", "40", "0", "0", "1", "0", "0", "0", "bash"}, fieldSeparator),
			want: Pane{ID: "%1", Title: "main", Index: 0, Active: true, Width: 120, Height: 40, Left: 0, Top: 0, Dead: true, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "bash", AttentionState: AttentionStateExplicit},
		},
		{
			name: "input off explicit",
			row: strings.Join([]string{"%2", "logs", "1", "0", "80", "24", "0", "40", "0", "1", "0", "0", "bash"}, fieldSeparator),
			want: Pane{ID: "%2", Title: "logs", Index: 1, Active: false, Width: 80, Height: 24, Left: 0, Top: 40, Dead: false, InputOff: true, InMode: false, AlternateOn: false, CurrentCommand: "bash", AttentionState: AttentionStateExplicit},
		},
		{
			name: "in mode attention",
			row: strings.Join([]string{"%3", "vim", "2", "0", "80", "24", "0", "0", "0", "0", "1", "0", "bash"}, fieldSeparator),
			want: Pane{ID: "%3", Title: "vim", Index: 2, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: true, AlternateOn: false, CurrentCommand: "bash", AttentionState: AttentionStateAttention},
		},
		{
			name: "alternate on with TUI attention",
			row: strings.Join([]string{"%4", "editor", "3", "0", "100", "30", "10", "0", "0", "0", "0", "1", "vim"}, fieldSeparator),
			want: Pane{ID: "%4", Title: "editor", Index: 3, Active: false, Width: 100, Height: 30, Left: 10, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: true, CurrentCommand: "vim", AttentionState: AttentionStateAttention},
		},
		{
			name: "alternate on with shell none",
			row: strings.Join([]string{"%5", "shell", "4", "0", "80", "24", "0", "0", "0", "0", "0", "1", "bash"}, fieldSeparator),
			want: Pane{ID: "%5", Title: "shell", Index: 4, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: true, CurrentCommand: "bash", AttentionState: AttentionStateNone},
		},
		{
			name: "alternate on with login shell none",
			row: strings.Join([]string{"%6", "login", "5", "0", "80", "24", "0", "0", "0", "0", "0", "1", "-bash"}, fieldSeparator),
			want: Pane{ID: "%6", Title: "login", Index: 5, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: true, CurrentCommand: "-bash", AttentionState: AttentionStateNone},
		},
		{
			name: "empty command none",
			row: strings.Join([]string{"%7", "empty", "6", "0", "80", "24", "0", "0", "0", "0", "0", "0", ""}, fieldSeparator),
			want: Pane{ID: "%7", Title: "empty", Index: 6, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "", AttentionState: AttentionStateNone},
		},
		{
			name: "all false none",
			row: strings.Join([]string{"%8", "idle", "7", "1", "120", "40", "0", "0", "0", "0", "0", "0", "zsh"}, fieldSeparator),
			want: Pane{ID: "%8", Title: "idle", Index: 7, Active: true, Width: 120, Height: 40, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "zsh", AttentionState: AttentionStateNone},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parsePaneRow(tt.row)
			if err != nil {
				t.Fatalf("parsePaneRow() error = %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("parsePaneRow() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestParsePanesOutputWithAttentionFields(t *testing.T) {
	output := strings.Join([]string{"%1", "main", "0", "1", "120", "40", "0", "0", "0", "0", "0", "0", "bash"}, fieldSeparator) + "\n" +
		strings.Join([]string{"%2", "vim", "1", "0", "80", "24", "0", "0", "0", "0", "0", "1", "vim"}, fieldSeparator) + "\n" +
		strings.Join([]string{"%3", "dead", "2", "0", "80", "24", "0", "0", "1", "0", "0", "0", "bash"}, fieldSeparator)

	panes, err := parsePanesOutput(output)
	if err != nil {
		t.Fatalf("parsePanesOutput() error = %v", err)
	}

	want := []Pane{
		{ID: "%1", Title: "main", Index: 0, Active: true, Width: 120, Height: 40, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "bash", AttentionState: AttentionStateNone},
		{ID: "%2", Title: "vim", Index: 1, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: false, InputOff: false, InMode: false, AlternateOn: true, CurrentCommand: "vim", AttentionState: AttentionStateAttention},
		{ID: "%3", Title: "dead", Index: 2, Active: false, Width: 80, Height: 24, Left: 0, Top: 0, Dead: true, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "bash", AttentionState: AttentionStateExplicit},
	}
	if !reflect.DeepEqual(panes, want) {
		t.Fatalf("parsePanesOutput() = %#v, want %#v", panes, want)
	}
}

func TestParsePaneRowFallbackColonSeparatedDoesNotPanic(t *testing.T) {
	pane, err := parsePaneRow("%5:vim:3:1:80:24:10:5")
	if err != nil {
		t.Fatalf("parsePaneRow() error = %v", err)
	}

	want := Pane{ID: "%5", Title: "vim", Index: 3, Active: true, Width: 80, Height: 24, Left: 10, Top: 5, Dead: false, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "", AttentionState: AttentionStateNone}
	if !reflect.DeepEqual(pane, want) {
		t.Fatalf("parsePaneRow() = %#v, want %#v", pane, want)
	}
}

func TestListPanesReturnsErrorOnCommandFailure(t *testing.T) {
	adapter := newFakeAdapter(t, fakeExecConfig{
		stderr:   "bad target\n",
		exitCode: 1,
	})

	_, err := adapter.ListPanes("session-1", "window-1")
	if err == nil {
		t.Fatal("expected error for failed list-panes")
	}
	assertErrorCode(t, err, ErrorCodeCommandFailed)
}

func TestLocalTmuxIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping tmux integration in short mode")
	}
	if os.Getenv("WEBMUX_RUN_TMUX_TESTS") != "1" {
		t.Skip("set WEBMUX_RUN_TMUX_TESTS=1 to run tmux integration tests")
	}

	path := testTmuxPath()
	if err := DetectBinary(path); err != nil {
		t.Skipf("skipping tmux integration because tmux is unavailable: %v", err)
	}

	adapter := NewAdapter(path)
	sessionName := fmt.Sprintf("wmux-test-%d", time.Now().UnixNano())
	windowName := "wmux-window"

	t.Cleanup(func() {
		_ = adapter.KillSession(sessionName)
	})

	session, err := adapter.NewSession(sessionName)
	if err != nil {
		t.Fatalf("NewSession() error = %v", err)
	}
	if session.Name != sessionName {
		t.Fatalf("NewSession() name = %q, want %q", session.Name, sessionName)
	}

	sessions, err := adapter.ListSessions()
	if err != nil {
		t.Fatalf("ListSessions() error = %v", err)
	}
	if !containsSession(sessions, sessionName) {
		t.Fatalf("ListSessions() did not include %q", sessionName)
	}

	window, err := adapter.NewWindow(sessionName, windowName)
	if err != nil {
		t.Fatalf("NewWindow() error = %v", err)
	}
	if window.Name != windowName {
		t.Fatalf("NewWindow() name = %q, want %q", window.Name, windowName)
	}

	panes, err := adapter.ListPanes(sessionName, window.ID)
	if err != nil {
		t.Fatalf("ListPanes() error = %v", err)
	}
	if len(panes) == 0 {
		t.Fatal("ListPanes() returned no panes")
	}

	splitPane, err := adapter.SplitPane(window.ID, true)
	if err != nil {
		t.Fatalf("SplitPane() error = %v", err)
	}

	panes, err = adapter.ListPanes(sessionName, window.ID)
	if err != nil {
		t.Fatalf("ListPanes() after split error = %v", err)
	}
	if len(panes) < 2 {
		t.Fatalf("expected at least 2 panes after split, got %d", len(panes))
	}

	if err := adapter.SelectWindow(window.ID); err != nil {
		t.Fatalf("SelectWindow() error = %v", err)
	}
	if err := adapter.SelectPane(splitPane.ID); err != nil {
		t.Fatalf("SelectPane() error = %v", err)
	}
	if err := adapter.KillPane(splitPane.ID); err != nil {
		t.Fatalf("KillPane() error = %v", err)
	}
	if err := adapter.KillWindow(window.ID); err != nil {
		t.Fatalf("KillWindow() error = %v", err)
	}
}

type fakeExecConfig struct {
	stdout   string
	stderr   string
	exitCode int
}

func newFakeAdapter(t *testing.T, cfg fakeExecConfig) Adapter {
	t.Helper()
	return Adapter{
		Path: testTmuxPath(),
		lookPath: func(string) (string, error) {
			return "/usr/bin/tmux", nil
		},
		execCommand: func(name string, args ...string) *exec.Cmd {
			commandArgs := []string{"-test.run=TestHelperProcess", "--", name}
			commandArgs = append(commandArgs, args...)

			cmd := exec.Command(os.Args[0], commandArgs...)
			cmd.Env = append(os.Environ(),
				"GO_WANT_HELPER_PROCESS=1",
				"HELPER_STDOUT="+base64.StdEncoding.EncodeToString([]byte(cfg.stdout)),
				"HELPER_STDERR="+base64.StdEncoding.EncodeToString([]byte(cfg.stderr)),
				"HELPER_EXIT_CODE="+strconv.Itoa(cfg.exitCode),
			)
			return cmd
		},
	}
}

func TestHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}

	stdout, _ := base64.StdEncoding.DecodeString(os.Getenv("HELPER_STDOUT"))
	stderr, _ := base64.StdEncoding.DecodeString(os.Getenv("HELPER_STDERR"))
	_, _ = os.Stdout.Write(stdout)
	_, _ = os.Stderr.Write(stderr)

	exitCode, err := strconv.Atoi(os.Getenv("HELPER_EXIT_CODE"))
	if err != nil {
		exitCode = 0
	}
	os.Exit(exitCode)
}

func assertErrorCode(t *testing.T, err error, want string) {
	t.Helper()
	var tmuxErr *Error
	if !errors.As(err, &tmuxErr) {
		t.Fatalf("expected *Error, got %T (%v)", err, err)
	}
	if tmuxErr.Code != want {
		t.Fatalf("error code = %q, want %q", tmuxErr.Code, want)
	}
}

func containsSession(sessions []Session, name string) bool {
	for _, session := range sessions {
		if session.Name == name {
			return true
		}
	}
	return false
}

func testTmuxPath() string {
	if path := strings.TrimSpace(os.Getenv("WEBMUX_TMUX_PATH")); path != "" {
		return path
	}
	return defaultBinaryPath
}
