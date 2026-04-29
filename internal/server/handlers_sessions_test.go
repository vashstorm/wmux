package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/protocol"
	"github.com/panh/wmux/internal/sshclient"
	"github.com/panh/wmux/internal/tmux"
)

func TestSessionHandlersReturnNotFoundForMissingConnection(t *testing.T) {
	srv := newTestServer(t, config.DefaultConfig())

	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "list sessions", method: http.MethodGet, path: "/api/connections/missing/sessions"},
		{name: "list windows", method: http.MethodGet, path: "/api/connections/missing/sessions/work/windows"},
		{name: "list panes", method: http.MethodGet, path: "/api/connections/missing/sessions/work/windows/editor/panes"},
		{name: "create session", method: http.MethodPost, path: "/api/connections/missing/sessions", body: `{"name":"work"}`},
		{name: "create window", method: http.MethodPost, path: "/api/connections/missing/sessions/work/windows", body: `{"name":"editor"}`},
		{name: "delete session", method: http.MethodDelete, path: "/api/connections/missing/sessions/work"},
		{name: "rename session", method: http.MethodPatch, path: "/api/connections/missing/sessions/work", body: `{"name":"next"}`},
		{name: "delete window", method: http.MethodDelete, path: "/api/connections/missing/sessions/work/windows/editor"},
		{name: "split pane", method: http.MethodPost, path: "/api/connections/missing/sessions/work/windows/editor/panes/%251/split", body: `{"horizontal":true}`},
		{name: "delete pane", method: http.MethodDelete, path: "/api/connections/missing/sessions/work/windows/editor/panes/%251"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := performSessionRequest(t, srv, tt.method, tt.path, tt.body)
			assertErrorResponse(t, rec, http.StatusNotFound, "not_found", "connection not found")
		})
	}
}

func TestSessionHandlersReturnBadRequestForUnsupportedConnectionType(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "unsupported-1",
		Name: "Unsupported",
		Type: "serial",
	}}
	srv := newTestServer(t, cfg)

	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "list sessions", method: http.MethodGet, path: "/api/connections/unsupported-1/sessions"},
		{name: "list windows", method: http.MethodGet, path: "/api/connections/unsupported-1/sessions/work/windows"},
		{name: "list panes", method: http.MethodGet, path: "/api/connections/unsupported-1/sessions/work/windows/editor/panes"},
		{name: "create session", method: http.MethodPost, path: "/api/connections/unsupported-1/sessions", body: `{"name":"work"}`},
		{name: "create window", method: http.MethodPost, path: "/api/connections/unsupported-1/sessions/work/windows", body: `{"name":"editor"}`},
		{name: "delete session", method: http.MethodDelete, path: "/api/connections/unsupported-1/sessions/work"},
		{name: "rename session", method: http.MethodPatch, path: "/api/connections/unsupported-1/sessions/work", body: `{"name":"next"}`},
		{name: "delete window", method: http.MethodDelete, path: "/api/connections/unsupported-1/sessions/work/windows/editor"},
		{name: "split pane", method: http.MethodPost, path: "/api/connections/unsupported-1/sessions/work/windows/editor/panes/%251/split", body: `{"horizontal":true}`},
		{name: "delete pane", method: http.MethodDelete, path: "/api/connections/unsupported-1/sessions/work/windows/editor/panes/%251"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := performSessionRequest(t, srv, tt.method, tt.path, tt.body)
			assertErrorResponse(t, rec, http.StatusBadRequest, "bad_request", `unsupported connection type "serial"`)
		})
	}
}

func TestSessionHandlersRejectInvalidJSONPayloads(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Name: "Local",
		Type: "local",
	}}
	srv := newTestServer(t, cfg)

	tests := []struct {
		name    string
		method  string
		path    string
		message string
	}{
		{name: "create session", method: http.MethodPost, path: "/api/connections/local-1/sessions", message: "invalid session payload"},
		{name: "create window", method: http.MethodPost, path: "/api/connections/local-1/sessions/work/windows", message: "invalid window payload"},
		{name: "rename session", method: http.MethodPatch, path: "/api/connections/local-1/sessions/work", message: "invalid rename payload"},
		{name: "split pane", method: http.MethodPost, path: "/api/connections/local-1/sessions/work/windows/editor/panes/%251/split", message: "invalid split pane payload"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := performSessionRequest(t, srv, tt.method, tt.path, "{")
			assertErrorResponse(t, rec, http.StatusBadRequest, "bad_request", tt.message)
		})
	}
}

func TestSessionHandlersSurfaceValidationErrorsForMissingNames(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Name: "Local",
		Type: "local",
	}}
	srv := newTestServer(t, cfg)

	tests := []struct {
		name    string
		method  string
		path    string
		body    string
		message string
	}{
		{name: "create session", method: http.MethodPost, path: "/api/connections/local-1/sessions", body: `{"name":"   "}`, message: "session operation failed"},
		{name: "create window", method: http.MethodPost, path: "/api/connections/local-1/sessions/work/windows", body: `{"name":""}`, message: "session operation failed"},
		{name: "rename session", method: http.MethodPatch, path: "/api/connections/local-1/sessions/work", body: `{"name":""}`, message: "session operation failed"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := performSessionRequest(t, srv, tt.method, tt.path, tt.body)
			// Empty names are passed through to tmux which fails with generic error
			assertErrorResponse(t, rec, http.StatusInternalServerError, "internal_error", tt.message)
		})
	}
}

func TestSessionHandlersLocalResponsesIncludeAdapterPath(t *testing.T) {
	tests := []struct {
		name            string
		method          string
		path            string
		body            string
		wantStatus      int
		wantLogContains []string
		assert          func(t *testing.T, rec *httptest.ResponseRecorder, adapterPath string)
	}{
		{
			name:            "list sessions",
			method:          http.MethodGet,
			path:            "/api/connections/local-1/sessions",
			wantStatus:      http.StatusOK,
			wantLogContains: []string{"list-sessions", "-F", "#{session_id}:#{session_name}:#{session_attached}"},
			assert: func(t *testing.T, rec *httptest.ResponseRecorder, adapterPath string) {
				payload := decodeBody[sessionsListResponse](t, rec.Body.Bytes())
				if payload.ConnectionID != "local-1" || payload.Mode != "local" || payload.AdapterPath != adapterPath {
					t.Fatalf("unexpected payload: %#v", payload)
				}
				if len(payload.Data) != 2 || payload.Data[0].Name != "alpha" || !payload.Data[0].Attached {
					t.Fatalf("unexpected sessions: %#v", payload.Data)
				}
			},
		},
		{
			name:            "list windows",
			method:          http.MethodGet,
			path:            "/api/connections/local-1/sessions/work/windows",
			wantStatus:      http.StatusOK,
			wantLogContains: []string{"list-windows", "-t", "work", "#{window_id}:#{window_name}:#{window_index}:#{window_active}"},
			assert: func(t *testing.T, rec *httptest.ResponseRecorder, adapterPath string) {
				payload := decodeBody[windowsListResponse](t, rec.Body.Bytes())
				if payload.Session != "work" || payload.Mode != "local" || payload.AdapterPath != adapterPath {
					t.Fatalf("unexpected payload: %#v", payload)
				}
				if len(payload.Data) != 2 || payload.Data[0].Name != "editor" || !payload.Data[0].Active {
					t.Fatalf("unexpected windows: %#v", payload.Data)
				}
			},
		},
		{
			name:            "list panes",
			method:          http.MethodGet,
			path:            "/api/connections/local-1/sessions/work/windows/editor/panes",
			wantStatus:      http.StatusOK,
			wantLogContains: []string{"list-panes", "-t", "work:editor", "#{pane_id}:#{pane_title}:#{pane_index}:#{pane_active}:#{pane_width}:#{pane_height}"},
			assert: func(t *testing.T, rec *httptest.ResponseRecorder, adapterPath string) {
				payload := decodeBody[panesListResponse](t, rec.Body.Bytes())
				if payload.Session != "work" || payload.Window != "editor" || payload.AdapterPath != adapterPath {
					t.Fatalf("unexpected payload: %#v", payload)
				}
				if len(payload.Data) != 2 || payload.Data[0].ID != "%1" || payload.Data[0].Width != 120 {
					t.Fatalf("unexpected panes: %#v", payload.Data)
				}
			},
		},
		{
			name:            "create session",
			method:          http.MethodPost,
			path:            "/api/connections/local-1/sessions",
			body:            `{"name":"work"}`,
			wantStatus:      http.StatusCreated,
			wantLogContains: []string{"new-session", "-d", "-s", "work", "-P", "-F"},
			assert: func(t *testing.T, rec *httptest.ResponseRecorder, adapterPath string) {
				payload := decodeBody[sessionOperationResponse](t, rec.Body.Bytes())
				if payload.Operation != "create_session" || payload.Mode != "local" || payload.AdapterPath != adapterPath {
					t.Fatalf("unexpected payload: %#v", payload)
				}
				if payload.Data.Name != "work" {
					t.Fatalf("unexpected created session: %#v", payload.Data)
				}
			},
		},
		{
			name:            "create window",
			method:          http.MethodPost,
			path:            "/api/connections/local-1/sessions/work/windows",
			body:            `{"name":"editor"}`,
			wantStatus:      http.StatusCreated,
			wantLogContains: []string{"new-window", "-t", "work", "-n", "editor", "-P", "-F"},
			assert: func(t *testing.T, rec *httptest.ResponseRecorder, adapterPath string) {
				payload := decodeBody[windowOperationResponse](t, rec.Body.Bytes())
				if payload.Operation != "create_window" || payload.Session != "work" || payload.AdapterPath != adapterPath {
					t.Fatalf("unexpected payload: %#v", payload)
				}
				if payload.Data.Name != "editor" {
					t.Fatalf("unexpected created window: %#v", payload.Data)
				}
			},
		},
		{
			name:            "rename session",
			method:          http.MethodPatch,
			path:            "/api/connections/local-1/sessions/work",
			body:            `{"name":"renamed"}`,
			wantStatus:      http.StatusOK,
			wantLogContains: []string{"rename-session", "-t", "work", "renamed"},
			assert: func(t *testing.T, rec *httptest.ResponseRecorder, adapterPath string) {
				payload := decodeBody[operationResponse](t, rec.Body.Bytes())
				if payload.Operation != "rename_session" || payload.Status != "accepted" || payload.AdapterPath != adapterPath {
					t.Fatalf("unexpected payload: %#v", payload)
				}
			},
		},
		{
			name:            "delete session",
			method:          http.MethodDelete,
			path:            "/api/connections/local-1/sessions/work",
			wantStatus:      http.StatusOK,
			wantLogContains: []string{"kill-session", "-t", "work"},
			assert: func(t *testing.T, rec *httptest.ResponseRecorder, adapterPath string) {
				payload := decodeBody[operationResponse](t, rec.Body.Bytes())
				if payload.Operation != "delete_session" || payload.Session != "work" || payload.AdapterPath != adapterPath {
					t.Fatalf("unexpected payload: %#v", payload)
				}
			},
		},
		{
			name:            "delete window",
			method:          http.MethodDelete,
			path:            "/api/connections/local-1/sessions/work/windows/editor",
			wantStatus:      http.StatusOK,
			wantLogContains: []string{"kill-window", "-t", "work:editor"},
			assert: func(t *testing.T, rec *httptest.ResponseRecorder, adapterPath string) {
				payload := decodeBody[operationResponse](t, rec.Body.Bytes())
				if payload.Operation != "delete_window" || payload.Window != "editor" || payload.AdapterPath != adapterPath {
					t.Fatalf("unexpected payload: %#v", payload)
				}
			},
		},
		{
			name:            "split pane",
			method:          http.MethodPost,
			path:            "/api/connections/local-1/sessions/work/windows/editor/panes/%251/split",
			body:            `{"horizontal":true}`,
			wantStatus:      http.StatusCreated,
			wantLogContains: []string{"split-window", "-h", "-t", "work:editor.%1", "-P", "-F"},
			assert: func(t *testing.T, rec *httptest.ResponseRecorder, adapterPath string) {
				payload := decodeBody[paneOperationResponse](t, rec.Body.Bytes())
				if payload.Operation != "split_pane" || payload.Window != "editor" || payload.AdapterPath != adapterPath {
					t.Fatalf("unexpected payload: %#v", payload)
				}
				if payload.Data.ID != "%3" || payload.Data.Title != "split" {
					t.Fatalf("unexpected split pane: %#v", payload.Data)
				}
			},
		},
		{
			name:            "delete pane",
			method:          http.MethodDelete,
			path:            "/api/connections/local-1/sessions/work/windows/editor/panes/%251",
			wantStatus:      http.StatusOK,
			wantLogContains: []string{"kill-pane", "-t", "work:editor.%1"},
			assert: func(t *testing.T, rec *httptest.ResponseRecorder, adapterPath string) {
				payload := decodeBody[operationResponse](t, rec.Body.Bytes())
				if payload.Operation != "delete_pane" || payload.Pane != "%1" || payload.AdapterPath != adapterPath {
					t.Fatalf("unexpected payload: %#v", payload)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapterPath, logPath := createFakeTMUXBinary(t)

			cfg := config.DefaultConfig()
			cfg.Tmux.Path = adapterPath
			cfg.Connections = []config.ConnectionConfig{{
				ID:   "local-1",
				Name: "Local",
				Type: "local",
			}}

			srv := newTestServer(t, cfg)
			rec := performSessionRequest(t, srv, tt.method, tt.path, tt.body)
			if rec.Code != tt.wantStatus {
				t.Fatalf("unexpected status code: %d", rec.Code)
			}

			tt.assert(t, rec, adapterPath)

			logLines := readFakeTMUXLog(t, logPath)
			if len(logLines) != 1 {
				t.Fatalf("expected one tmux invocation, got %#v", logLines)
			}
			for _, want := range tt.wantLogContains {
				if !strings.Contains(logLines[0], want) {
					t.Fatalf("expected tmux log %q to contain %q", logLines[0], want)
				}
			}
		})
	}
}

func TestListSessionsReturnsSSHConnectionErrors(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "ssh-1",
		Name: "Remote",
		Type: "ssh",
		User: "root",
	}}

	srv := newTestServer(t, cfg)
	rec := performSessionRequest(t, srv, http.MethodGet, "/api/connections/ssh-1/sessions", "")
	assertErrorResponse(t, rec, http.StatusBadGateway, sshclient.ErrorCodeConnectionFailed, "SSH client is not connected")
}

func TestWriteSessionHTTPErrorMapsKnownErrors(t *testing.T) {
	srv := newTestServer(t, config.DefaultConfig())

	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
		wantMsg    string
	}{
		{
			name:       "tmux not found",
			err:        &tmux.Error{Code: tmux.ErrorCodeNotFound, Message: `tmux binary "tmux" not found`},
			wantStatus: http.StatusNotFound,
			wantCode:   tmux.ErrorCodeNotFound,
			wantMsg:    `tmux binary "tmux" not found`,
		},
		{
			name:       "tmux command failed",
			err:        &tmux.Error{Code: tmux.ErrorCodeCommandFailed, Message: "tmux command failed: bad target"},
			wantStatus: http.StatusBadRequest,
			wantCode:   tmux.ErrorCodeCommandFailed,
			wantMsg:    "tmux command failed: bad target",
		},
		{
			name:       "ssh unknown host",
			err:        &sshclient.Error{Code: sshclient.ErrorCodeUnknownHost, Message: "unknown host"},
			wantStatus: http.StatusBadRequest,
			wantCode:   sshclient.ErrorCodeUnknownHost,
			wantMsg:    "unknown host",
		},
		{
			name:       "ssh connection failed",
			err:        &sshclient.Error{Code: sshclient.ErrorCodeConnectionFailed, Message: "dial tcp timeout"},
			wantStatus: http.StatusBadGateway,
			wantCode:   sshclient.ErrorCodeConnectionFailed,
			wantMsg:    "dial tcp timeout",
		},
		{
			name:       "generic error",
			err:        errors.New("boom"),
			wantStatus: http.StatusInternalServerError,
			wantCode:   "internal_error",
			wantMsg:    "session operation failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			srv.writeSessionHTTPError(rec, tt.err)
			assertErrorResponse(t, rec, tt.wantStatus, tt.wantCode, tt.wantMsg)
		})
	}
}

func TestStatusForTMUXError(t *testing.T) {
	tests := []struct {
		name string
		err  *tmux.Error
		want int
	}{
		{name: "nil", want: http.StatusInternalServerError},
		{name: "not found", err: &tmux.Error{Code: tmux.ErrorCodeNotFound}, want: http.StatusNotFound},
		{name: "no sessions", err: &tmux.Error{Code: tmux.ErrorCodeNoSessions}, want: http.StatusNotFound},
		{name: "command failed", err: &tmux.Error{Code: tmux.ErrorCodeCommandFailed}, want: http.StatusBadRequest},
		{name: "unknown", err: &tmux.Error{Code: "other"}, want: http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := statusForTMUXError(tt.err); got != tt.want {
				t.Fatalf("unexpected status: got %d want %d", got, tt.want)
			}
		})
	}
}

func TestStatusForSSHError(t *testing.T) {
	tests := []struct {
		name string
		err  *sshclient.Error
		want int
	}{
		{name: "nil", want: http.StatusInternalServerError},
		{name: "unknown host", err: &sshclient.Error{Code: sshclient.ErrorCodeUnknownHost}, want: http.StatusBadRequest},
		{name: "host key mismatch", err: &sshclient.Error{Code: sshclient.ErrorCodeHostKeyMismatch}, want: http.StatusBadRequest},
		{name: "key unreadable", err: &sshclient.Error{Code: sshclient.ErrorCodeKeyUnreadable}, want: http.StatusBadRequest},
		{name: "connection failed", err: &sshclient.Error{Code: sshclient.ErrorCodeConnectionFailed}, want: http.StatusBadGateway},
		{name: "unknown", err: &sshclient.Error{Code: "other"}, want: http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := statusForSSHError(tt.err); got != tt.want {
				t.Fatalf("unexpected status: got %d want %d", got, tt.want)
			}
		})
	}
}

func TestBuildWindowTarget(t *testing.T) {
	if got := buildWindowTarget("work", "editor"); got != "work:editor" {
		t.Fatalf("unexpected window target: %q", got)
	}
}

func TestBuildPaneTarget(t *testing.T) {
	if got := buildPaneTarget("work", "editor", "%1"); got != "work:editor.%1" {
		t.Fatalf("unexpected pane target: %q", got)
	}
}

func performSessionRequest(t *testing.T, srv *Server, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()

	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}

	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return rec
}

func assertErrorResponse(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantCode, wantMessage string) {
	t.Helper()

	if rec.Code != wantStatus {
		t.Fatalf("unexpected status code: got %d want %d", rec.Code, wantStatus)
	}

	payload := decodeBody[protocol.ErrorResponse](t, rec.Body.Bytes())
	if payload.Error.Code != wantCode {
		t.Fatalf("unexpected error code: got %q want %q", payload.Error.Code, wantCode)
	}
	if payload.Error.Message != wantMessage {
		t.Fatalf("unexpected error message: got %q want %q", payload.Error.Message, wantMessage)
	}
}

func decodeBody[T any](t *testing.T, body []byte) T {
	t.Helper()

	var payload T
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	return payload
}

func createFakeTMUXBinary(t *testing.T) (string, string) {
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

find_flag_value() {
  flag="$1"
  shift
  while [ "$#" -gt 1 ]; do
    if [ "$1" = "$flag" ]; then
      printf '%s' "$2"
      return 0
    fi
    shift
  done
  return 1
}

case "$cmd" in
  list-sessions)
    printf '$1:alpha:1\n$2:beta:0\n'
    ;;
  list-windows)
    printf '@1:editor:1:1\n@2:shell:2:0\n'
    ;;
  list-panes)
    printf '%%1:main:0:1:120:40\n%%2:logs:1:0:80:24\n'
    ;;
  new-session)
    name="$(find_flag_value -s "$@" || true)"
    printf '$%s:%s:0\n' "${name:-created}" "${name:-created}"
    ;;
  new-window)
    name="$(find_flag_value -n "$@" || true)"
    printf '@3:%s:3:1\n' "${name:-created}"
    ;;
  rename-session|kill-session|kill-window|kill-pane)
    ;;
  split-window)
    printf '%%3:split:2:0:60:20\n'
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

func readFakeTMUXLog(t *testing.T, path string) []string {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read fake tmux log: %v", err)
	}

	text := strings.TrimSpace(string(data))
	if text == "" {
		return nil
	}
	return strings.Split(text, "\n")
}
