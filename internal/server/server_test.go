package server_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/gorilla/websocket"
	"github.com/panh/webmux/internal/config"
	"github.com/panh/webmux/internal/protocol"
	"github.com/panh/webmux/internal/server"
)

type configResponse struct {
	SchemaVersion int `json:"schemaVersion"`
	Server        struct {
		Bind string `json:"bind"`
	} `json:"server"`
	Auth struct {
		Token           string `json:"token"`
		TokenConfigured bool   `json:"tokenConfigured"`
	} `json:"auth"`
}

func TestHealthEndpoint(t *testing.T) {
	srv := newTestServer(t, config.DefaultConfig())

	req := httptest.NewRequest("GET", "/api/health", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode health payload: %v", err)
	}

	if payload["status"] != "ok" {
		t.Fatalf("unexpected health status: %q", payload["status"])
	}
}

func TestStaticFallbackServesIndex(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	srv := newTestServer(t, cfg)

	req := httptest.NewRequest("GET", "/missing", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	body, err := io.ReadAll(rec.Result().Body)
	if err != nil {
		t.Fatalf("failed to read response body: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	if string(body) != "<html>Webmux</html>" {
		t.Fatalf("unexpected fallback body: %q", string(body))
	}
}

func TestAPIRoutesRequireBearerTokenWhenConfigured(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	srv := newTestServer(t, cfg)

	req := httptest.NewRequest("GET", "/api/connections", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload protocol.ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode error payload: %v", err)
	}

	if payload.Error.Code != "unauthorized" {
		t.Fatalf("unexpected error code: %q", payload.Error.Code)
	}
}

func TestAPIRoutesAcceptBearerTokenWhenConfigured(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	srv := newTestServer(t, cfg)

	req := httptest.NewRequest("GET", "/api/health", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
}

func TestAPIUnknownRouteReturnsJSONError(t *testing.T) {
	srv := newTestServer(t, config.DefaultConfig())

	req := httptest.NewRequest("GET", "/api/missing", nil)
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

func TestGetConfigHidesAuthToken(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	srv := newTestServer(t, cfg)

	req := httptest.NewRequest("GET", "/api/config", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload configResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode config payload: %v", err)
	}

	if payload.Auth.Token != "" {
		t.Fatalf("expected auth token to be hidden, got %q", payload.Auth.Token)
	}
	if !payload.Auth.TokenConfigured {
		t.Fatal("expected tokenConfigured to be true")
	}
}

func TestUpdateConfigReturnsConflictAfterExternalModification(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.jsonc")
	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("failed to create test config store: %v", err)
	}

	seed := config.DefaultConfig()
	seed.Auth.Token = "secret-token"
	if err := store.Replace(seed); err != nil {
		t.Fatalf("failed to seed test config store: %v", err)
	}

	srv := server.New(server.Options{
		Store: store,
		Assets: http.FS(fstest.MapFS{
			"index.html": &fstest.MapFile{Data: []byte("<html>Webmux</html>")},
		}),
	})

	external := config.DefaultConfig()
	external.Server.Bind = "127.0.0.1:7444"
	external.Auth.Token = "external-token"
	externalData, err := json.Marshal(external)
	if err != nil {
		t.Fatalf("failed to encode external config: %v", err)
	}
	if err := os.WriteFile(path, append(externalData, '\n'), 0o600); err != nil {
		t.Fatalf("failed to simulate external config update: %v", err)
	}

	payload := config.DefaultConfig()
	payload.Server.Bind = "127.0.0.1:7555"
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("failed to encode update payload: %v", err)
	}

	req := httptest.NewRequest("PUT", "/api/config", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var errorPayload protocol.ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &errorPayload); err != nil {
		t.Fatalf("failed to decode conflict payload: %v", err)
	}
	if errorPayload.Error.Code != "conflict" {
		t.Fatalf("unexpected error code: %q", errorPayload.Error.Code)
	}

	getReq := httptest.NewRequest("GET", "/api/config", nil)
	getReq.Header.Set("Authorization", "Bearer external-token")
	getRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("unexpected get status code: %d", getRec.Code)
	}

	var latest configResponse
	if err := json.Unmarshal(getRec.Body.Bytes(), &latest); err != nil {
		t.Fatalf("failed to decode latest config payload: %v", err)
	}
	if latest.Server.Bind != "127.0.0.1:7444" {
		t.Fatalf("expected reloaded bind address, got %q", latest.Server.Bind)
	}
	if latest.Auth.Token != "" {
		t.Fatalf("expected auth token to remain hidden, got %q", latest.Auth.Token)
	}
	if !latest.Auth.TokenConfigured {
		t.Fatal("expected tokenConfigured to remain true after external config reload")
	}
}

func TestUpdateConfigRejectsSecretFields(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	srv := newTestServer(t, cfg)

	body := []byte(`{"schemaVersion":1,"server":{"bind":"127.0.0.1:7331"},"auth":{"token":""},"tmux":{"path":"tmux"},"connections":[{"id":"ssh-1","name":"SSH","type":"ssh","host":"example.com","user":"root","password":"secret"}],"ui":{"theme":"dark"}}`)
	req := httptest.NewRequest("PUT", "/api/config", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload protocol.ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode bad request payload: %v", err)
	}
	if payload.Error.Code != "bad_request" {
		t.Fatalf("unexpected error code: %q", payload.Error.Code)
	}
}

func TestTerminalWebSocketAcceptsQueryToken(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-test",
		Name: "Local",
		Type: "local",
	}}
	srv := newTestServer(t, cfg)
	httpServer := httptest.NewServer(srv.Handler())
	defer httpServer.Close()

	wsURL := websocketURL(httpServer.URL + "/api/terminal?token=secret-token&connectionId=local-test")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial websocket endpoint: %v", err)
	}
	defer conn.Close()

	var message protocol.ServerMessage
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatalf("failed to read websocket status message: %v", err)
	}

	if message.Type != protocol.ServerMessageTypeStatus || message.Status != "connected" {
		t.Fatalf("unexpected websocket status message: %#v", message)
	}
}

func newTestServer(t *testing.T, cfg config.Config) *server.Server {
	t.Helper()

	store := newTestStore(t, cfg)
	return server.New(server.Options{
		Store: store,
		Assets: http.FS(fstest.MapFS{
			"index.html": &fstest.MapFile{Data: []byte("<html>Webmux</html>")},
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

func websocketURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		panic(err)
	}

	if parsed.Scheme == "https" {
		parsed.Scheme = "wss"
	} else {
		parsed.Scheme = "ws"
	}

	return parsed.String()
}
