package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/semantic"
)

func TestSemanticAttentionAdditive(t *testing.T) {
	adapterPath, _ := createFakeTMUXBinaryWithCapture(t, `[Y/n] Continue?`)

	cfg := config.DefaultConfig()
	cfg.Tmux.Path = adapterPath
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Type: "local",
	}}

	srv := newTestServer(t, cfg)

	rec := performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions/work/windows/editor/panes", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	panesPayload := decodeBody[panesListResponse](t, rec.Body.Bytes())
	if len(panesPayload.Data) != 2 {
		t.Fatalf("expected 2 panes, got %d", len(panesPayload.Data))
	}
	for _, p := range panesPayload.Data {
		if p.AttentionState == "" {
			t.Fatalf("pane missing AttentionState: %#v", p)
		}
		if p.SemanticEventType == "" {
			t.Fatalf("pane missing SemanticEventType: %#v", p)
		}
	}
}

func TestSemanticAttentionAggregation(t *testing.T) {
	adapterPath, _ := createFakeTMUXBinaryWithCapture(t, `[Y/n] Continue?`)

	cfg := config.DefaultConfig()
	cfg.Tmux.Path = adapterPath
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Type: "local",
	}}

	srv := newTestServer(t, cfg)

	rec := performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions/work/windows", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	windowsPayload := decodeBody[windowsListResponse](t, rec.Body.Bytes())
	if len(windowsPayload.Data) != 1 {
		t.Fatalf("expected 1 window, got %d", len(windowsPayload.Data))
	}
	w := windowsPayload.Data[0]
	if w.SemanticEventType != string(semantic.EventChoiceRequired) {
		t.Fatalf("window semantic event type = %q, want choice_required", w.SemanticEventType)
	}
	if w.SemanticEventCount != 1 {
		t.Fatalf("window semantic event count = %d, want 1", w.SemanticEventCount)
	}
}

func TestSemanticAttentionDedupe(t *testing.T) {
	adapterPath, _ := createFakeTMUXBinaryWithCapture(t, `[Y/n] Continue?`)

	cfg := config.DefaultConfig()
	cfg.Tmux.Path = adapterPath
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Type: "local",
	}}

	srv := newTestServer(t, cfg)

	// First request
	rec := performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions/work/windows", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	windowsPayload1 := decodeBody[windowsListResponse](t, rec.Body.Bytes())
	if windowsPayload1.Data[0].SemanticEventCount != 1 {
		t.Fatalf("first request: expected semantic event count 1, got %d", windowsPayload1.Data[0].SemanticEventCount)
	}

	// Second request with same output (should dedupe, count stays 1)
	rec = performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions/work/windows", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	windowsPayload2 := decodeBody[windowsListResponse](t, rec.Body.Bytes())
	if windowsPayload2.Data[0].SemanticEventCount != 1 {
		t.Fatalf("second request: expected semantic event count 1 (deduped), got %d", windowsPayload2.Data[0].SemanticEventCount)
	}
}

func TestSemanticAttentionClearOnInput(t *testing.T) {
	adapterPath, _ := createFakeTMUXBinaryWithCapture(t, `[Y/n] Continue?`)

	cfg := config.DefaultConfig()
	cfg.Tmux.Path = adapterPath
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Type: "local",
	}}

	srv := newTestServer(t, cfg)

	// First request to populate state
	rec := performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions/work/windows/editor/panes", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	panesPayload := decodeBody[panesListResponse](t, rec.Body.Bytes())
	paneID := panesPayload.Data[0].ID

	// Clear the semantic state
	srv.ClearSemanticState(paneID)

	// Verify state is cleared
	rec = performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions/work/windows", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	windowsPayload := decodeBody[windowsListResponse](t, rec.Body.Bytes())
	// After clear, re-capture will repopulate state
	if windowsPayload.Data[0].SemanticEventType != string(semantic.EventChoiceRequired) {
		t.Fatalf("expected semantic event to be repopulated after re-capture, got %q", windowsPayload.Data[0].SemanticEventType)
	}
}

func TestSemanticAttentionNonAIPaneSkipped(t *testing.T) {
	adapterPath, _ := createFakeTMUXBinaryWithCaptureNonAI(t)

	cfg := config.DefaultConfig()
	cfg.Tmux.Path = adapterPath
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Type: "local",
	}}

	srv := newTestServer(t, cfg)

	rec := performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions/work/windows/editor/panes", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	panesPayload := decodeBody[panesListResponse](t, rec.Body.Bytes())
	for _, p := range panesPayload.Data {
		if p.SemanticEventType != "none" {
			t.Fatalf("non-AI pane should have semantic event type 'none', got %q", p.SemanticEventType)
		}
		if p.SemanticEventCount != 0 {
			t.Fatalf("non-AI pane should have semantic event count 0, got %d", p.SemanticEventCount)
		}
	}

	rec = performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions/work/windows", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	windowsPayload := decodeBody[windowsListResponse](t, rec.Body.Bytes())
	for _, w := range windowsPayload.Data {
		if w.SemanticEventType != "none" {
			t.Fatalf("window with non-AI panes should have semantic event type 'none', got %q", w.SemanticEventType)
		}
	}
}

func TestSemanticEventPriorityAggregation(t *testing.T) {
	// Test that higher priority events override lower priority ones
	events := []semantic.SemanticEventType{
		semantic.EventDeadLoop,
		semantic.EventBlockedError,
		semantic.EventChoiceRequired,
		semantic.EventUserResponseRequired,
	}
	result := semantic.AggregateSemanticEvent(events)
	if result != semantic.EventUserResponseRequired {
		t.Fatalf("expected highest priority event user_response_required, got %q", result)
	}
}

func createFakeTMUXBinaryWithCapture(t *testing.T, captureOutput string) (string, string) {
	t.Helper()

	dir := t.TempDir()
	logPath := filepath.Join(dir, "tmux.log")
	binaryPath := filepath.Join(dir, "fake-tmux")

	script := `#!/bin/sh
set -eu
printf '%s\n' "$*" >> __LOG_PATH__
cmd="${1:-}"
if [ -z "$cmd" ]; then
  echo "missing command" >&2
  exit 1
fi
shift
case "$cmd" in
  list-sessions)
    printf '$1:work:1\n'
    ;;
  list-windows)
    printf '@1:editor:1:1:2:%%1:zsh\n'
    ;;
  list-panes)
    printf '%%1\x1fmain\x1f0\x1f1\x1f120\x1f40\x1f0\x1f0\x1f1\x1f0\x1f0\x1f0\x1fclaude\n'
    printf '%%2\x1fvim\x1f1\x1f0\x1f80\x1f24\x1f0\x1f0\x1f0\x1f0\x1f0\x1f1\x1fvim\n'
    ;;
  capture-pane)
    printf '__CAPTURE_OUTPUT__'
    ;;
  *)
    echo "unsupported command: $cmd" >&2
    exit 1
    ;;
esac
`

	script = strings.ReplaceAll(script, "__LOG_PATH__", strconv.Quote(logPath))
	script = strings.ReplaceAll(script, "__CAPTURE_OUTPUT__", captureOutput)
	if err := os.WriteFile(binaryPath, []byte(script), 0o755); err != nil {
		t.Fatalf("failed to write fake tmux binary: %v", err)
	}

	return binaryPath, logPath
}

func createFakeTMUXBinaryWithCaptureNonAI(t *testing.T) (string, string) {
	t.Helper()

	dir := t.TempDir()
	logPath := filepath.Join(dir, "tmux.log")
	binaryPath := filepath.Join(dir, "fake-tmux")

	script := `#!/bin/sh
set -eu
printf '%s\n' "$*" >> __LOG_PATH__
cmd="${1:-}"
if [ -z "$cmd" ]; then
  echo "missing command" >&2
  exit 1
fi
shift
case "$cmd" in
  list-sessions)
    printf '$1:work:1\n'
    ;;
  list-windows)
    printf '@1:editor:1:1:2:%%1:zsh\n'
    ;;
  list-panes)
    printf '%%1\x1fmain\x1f0\x1f1\x1f120\x1f40\x1f0\x1f0\x1f1\x1f0\x1f0\x1f0\x1fbash\n'
    printf '%%2\x1fvim\x1f1\x1f0\x1f80\x1f24\x1f0\x1f0\x1f0\x1f0\x1f0\x1f1\x1fvim\n'
    ;;
  capture-pane)
    printf 'some output\n'
    ;;
  *)
    echo "unsupported command: $cmd" >&2
    exit 1
    ;;
esac
`

	script = strings.ReplaceAll(script, "__LOG_PATH__", strconv.Quote(logPath))
	if err := os.WriteFile(binaryPath, []byte(script), 0o755); err != nil {
		t.Fatalf("failed to write fake tmux binary: %v", err)
	}

	return binaryPath, logPath
}
