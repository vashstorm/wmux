package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/tmux"
)

func TestHandlerJSONIncludesAttentionFields(t *testing.T) {
	adapterPath, _ := createFakeTMUXBinary(t)

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
	}

	rec = performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions/work/windows", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	windowsPayload := decodeBody[windowsListResponse](t, rec.Body.Bytes())
	for _, w := range windowsPayload.Data {
		if w.AttentionState == "" {
			t.Fatalf("window missing AttentionState: %#v", w)
		}
	}

	rec = performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	sessionsPayload := decodeBody[sessionsListResponse](t, rec.Body.Bytes())
	for _, s := range sessionsPayload.Data {
		if s.AttentionState == "" {
			t.Fatalf("session missing AttentionState: %#v", s)
		}
	}
}

func TestHandlerAttentionAggregation(t *testing.T) {
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

	cfg := config.DefaultConfig()
	cfg.Tmux.Path = binaryPath
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
	if w.AttentionState != tmux.AttentionStateExplicit {
		t.Fatalf("window attention state = %q, want explicit", w.AttentionState)
	}
	if w.AttentionCount != 2 {
		t.Fatalf("window attention count = %d, want 2", w.AttentionCount)
	}

	rec = performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	sessionsPayload := decodeBody[sessionsListResponse](t, rec.Body.Bytes())
	if len(sessionsPayload.Data) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessionsPayload.Data))
	}
	s := sessionsPayload.Data[0]
	if s.AttentionState != tmux.AttentionStateExplicit {
		t.Fatalf("session attention state = %q, want explicit", s.AttentionState)
	}
	if s.AttentionCount != 2 {
		t.Fatalf("session attention count = %d, want 2", s.AttentionCount)
	}

	rec = performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions/work/windows/editor/panes", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	panesPayload := decodeBody[panesListResponse](t, rec.Body.Bytes())
	if len(panesPayload.Data) != 2 {
		t.Fatalf("expected 2 panes, got %d", len(panesPayload.Data))
	}
	if panesPayload.Data[0].AttentionState != tmux.AttentionStateExplicit {
		t.Fatalf("pane 0 attention state = %q, want explicit", panesPayload.Data[0].AttentionState)
	}
	if panesPayload.Data[1].AttentionState != tmux.AttentionStateAttention {
		t.Fatalf("pane 1 attention state = %q, want attention", panesPayload.Data[1].AttentionState)
	}
}
