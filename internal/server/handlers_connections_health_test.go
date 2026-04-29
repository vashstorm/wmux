package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/protocol"
)

func TestGetConnectionHealthReturnsNotFoundForMissingConnection(t *testing.T) {
	srv := newTestServer(t, config.DefaultConfig())

	req := httptest.NewRequest("GET", "/api/connections/missing/health", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload protocol.ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode error payload: %v", err)
	}

	if payload.Error.Code != "not_found" {
		t.Fatalf("unexpected error code: %q", payload.Error.Code)
	}
}

func TestGetConnectionHealthReturnsOnlineForLocalConnection(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Name: "Local",
		Type: "local",
	}}

	srv := newTestServer(t, cfg)
	srv.checkConnectionHealth = func(conn config.ConnectionConfig, tmuxPath string) connectionHealthResponse {
		if conn.ID != "local-1" {
			t.Fatalf("unexpected connection id: %q", conn.ID)
		}
		if tmuxPath != cfg.Tmux.Path {
			t.Fatalf("unexpected tmux path: %q", tmuxPath)
		}

		return connectionHealthResponse{
			ConnectionID: conn.ID,
			Status:       "online",
			CheckedAt:    "2026-04-29T00:00:00Z",
		}
	}

	req := httptest.NewRequest("GET", "/api/connections/local-1/health", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload connectionHealthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode health payload: %v", err)
	}

	if payload.ConnectionID != "local-1" {
		t.Fatalf("unexpected connection id: %q", payload.ConnectionID)
	}
	if payload.Status != "online" {
		t.Fatalf("unexpected status: %q", payload.Status)
	}
	if payload.CheckedAt != "2026-04-29T00:00:00Z" {
		t.Fatalf("unexpected checkedAt: %q", payload.CheckedAt)
	}
	if payload.ErrorCode != "" {
		t.Fatalf("unexpected error code: %q", payload.ErrorCode)
	}
}

func TestGetConnectionHealthReturnsOfflineForSSHError(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "ssh-1",
		Name: "Remote",
		Type: "ssh",
		Host: "example.com",
		User: "root",
	}}

	srv := newTestServer(t, cfg)
	srv.checkConnectionHealth = func(conn config.ConnectionConfig, _ string) connectionHealthResponse {
		return connectionHealthResponse{
			ConnectionID: conn.ID,
			Status:       "offline",
			CheckedAt:    "2026-04-29T00:00:00Z",
			ErrorCode:    "ssh_unknown_host",
			Message:      "SSH host example.com:22 is unknown; add it to known_hosts and try again",
		}
	}

	req := httptest.NewRequest("GET", "/api/connections/ssh-1/health", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload connectionHealthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode health payload: %v", err)
	}

	if payload.Status != "offline" {
		t.Fatalf("unexpected status: %q", payload.Status)
	}
	if payload.ErrorCode != "ssh_unknown_host" {
		t.Fatalf("unexpected error code: %q", payload.ErrorCode)
	}
	if payload.Message == "" {
		t.Fatal("expected offline message")
	}
}

func TestListConnectionHealthReturnsEntriesForAllConnections(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{
		{ID: "local-1", Name: "Local", Type: "local"},
		{ID: "ssh-1", Name: "Remote", Type: "ssh", Host: "example.com", User: "root"},
	}

	srv := newTestServer(t, cfg)
	srv.checkConnectionHealth = func(conn config.ConnectionConfig, _ string) connectionHealthResponse {
		if conn.Type == "local" {
			return connectionHealthResponse{
				ConnectionID: conn.ID,
				Status:       "online",
				CheckedAt:    "2026-04-29T00:00:00Z",
			}
		}

		return connectionHealthResponse{
			ConnectionID: conn.ID,
			Status:       "offline",
			CheckedAt:    "2026-04-29T00:00:01Z",
			ErrorCode:    "ssh_connection_failed",
			Message:      "failed to connect",
		}
	}

	req := httptest.NewRequest("GET", "/api/connections/health", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload connectionHealthListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode health list payload: %v", err)
	}

	if len(payload.Data) != 2 {
		t.Fatalf("unexpected item count: %d", len(payload.Data))
	}
	if payload.Data[0].ConnectionID != "local-1" || payload.Data[0].Status != "online" {
		t.Fatalf("unexpected first item: %#v", payload.Data[0])
	}
	if payload.Data[1].ConnectionID != "ssh-1" || payload.Data[1].ErrorCode != "ssh_connection_failed" {
		t.Fatalf("unexpected second item: %#v", payload.Data[1])
	}
}

func TestListConnectionHealthReturnsEmptyDataForNoConnections(t *testing.T) {
	srv := newTestServer(t, config.DefaultConfig())

	req := httptest.NewRequest("GET", "/api/connections/health", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload connectionHealthListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode empty list payload: %v", err)
	}

	if len(payload.Data) != 0 {
		t.Fatalf("expected empty data, got %d entries", len(payload.Data))
	}
}

func newTestServer(t *testing.T, cfg config.Config) *Server {
	t.Helper()

	store := newTestStore(t, cfg)
	return New(Options{
		Store: store,
		Assets: http.FS(fstest.MapFS{
			"index.html": &fstest.MapFile{Data: []byte("<html>Wmux</html>")},
		}),
	})
}

func newTestStore(t *testing.T, cfg config.Config) *config.Store {
	t.Helper()

	store, err := config.Load(filepath.Join(t.TempDir(), "config.jsonc"))
	if err != nil {
		t.Fatalf("failed to create test config store: %v", err)
	}

	if err := store.Replace(cfg); err != nil {
		t.Fatalf("failed to seed test config store: %v", err)
	}

	return store
}
