package server_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/protocol"
)

func TestTerminalWebSocketMissingConnectionID(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	srv := newTestServer(t, cfg)
	httpServer := httptest.NewServer(srv.Handler())
	defer httpServer.Close()

	wsURL := websocketURL(httpServer.URL + "/api/terminal?token=secret-token")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial websocket: %v", err)
	}
	defer conn.Close()

	var connected protocol.ServerMessage
	if err := conn.ReadJSON(&connected); err != nil {
		t.Fatalf("failed to read connected message: %v", err)
	}
	if connected.Type != protocol.ServerMessageTypeStatus || connected.Status != "connected" {
		t.Fatalf("unexpected connected message: %#v", connected)
	}

	var message protocol.ServerMessage
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatalf("failed to read error message: %v", err)
	}

	if message.Type != protocol.ServerMessageTypeError || message.Error == nil || message.Error.Code != "not_found" {
		t.Fatalf("unexpected error message: %#v", message)
	}
}

func TestTerminalWebSocketUnknownConnection(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	srv := newTestServer(t, cfg)
	httpServer := httptest.NewServer(srv.Handler())
	defer httpServer.Close()

	wsURL := websocketURL(httpServer.URL + "/api/terminal?token=secret-token&connectionId=unknown")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial websocket: %v", err)
	}
	defer conn.Close()

	var connected protocol.ServerMessage
	if err := conn.ReadJSON(&connected); err != nil {
		t.Fatalf("failed to read connected message: %v", err)
	}
	if connected.Type != protocol.ServerMessageTypeStatus || connected.Status != "connected" {
		t.Fatalf("unexpected connected message: %#v", connected)
	}

	var message protocol.ServerMessage
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatalf("failed to read error message: %v", err)
	}

	if message.Type != protocol.ServerMessageTypeError || message.Error == nil || message.Error.Code != "not_found" {
		t.Fatalf("unexpected error message: %#v", message)
	}
}

func TestTerminalWebSocketInvalidTarget(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-test",
		Type: "local",
	}}
	srv := newTestServer(t, cfg)
	httpServer := httptest.NewServer(srv.Handler())
	defer httpServer.Close()

	wsURL := websocketURL(httpServer.URL + "/api/terminal?token=secret-token&connectionId=local-test&session=&window=&pane=")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial websocket: %v", err)
	}
	defer conn.Close()

	var connected protocol.ServerMessage
	if err := conn.ReadJSON(&connected); err != nil {
		t.Fatalf("failed to read connected message: %v", err)
	}
	if connected.Type != protocol.ServerMessageTypeStatus || connected.Status != "connected" {
		t.Fatalf("unexpected connected message: %#v", connected)
	}

	var message protocol.ServerMessage
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatalf("failed to read error message: %v", err)
	}

	if message.Type != protocol.ServerMessageTypeError || message.Error == nil || message.Error.Code != "bad_request" {
		t.Fatalf("unexpected error message: %#v", message)
	}
}

func TestTerminalWebSocketInvalidRows(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-test",
		Type: "local",
	}}
	srv := newTestServer(t, cfg)
	httpServer := httptest.NewServer(srv.Handler())
	defer httpServer.Close()

	wsURL := websocketURL(httpServer.URL + "/api/terminal?token=secret-token&connectionId=local-test&session=test&window=test&pane=test&rows=abc")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial websocket: %v", err)
	}
	defer conn.Close()

	var connected protocol.ServerMessage
	if err := conn.ReadJSON(&connected); err != nil {
		t.Fatalf("failed to read connected message: %v", err)
	}
	if connected.Type != protocol.ServerMessageTypeStatus || connected.Status != "connected" {
		t.Fatalf("unexpected connected message: %#v", connected)
	}

	var message protocol.ServerMessage
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatalf("failed to read error message: %v", err)
	}

	if message.Type != protocol.ServerMessageTypeError || message.Error == nil || message.Error.Code != "bad_request" {
		t.Fatalf("unexpected error message: %#v", message)
	}
}

func TestTerminalWebSocketInvalidCols(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-test",
		Type: "local",
	}}
	srv := newTestServer(t, cfg)
	httpServer := httptest.NewServer(srv.Handler())
	defer httpServer.Close()

	wsURL := websocketURL(httpServer.URL + "/api/terminal?token=secret-token&connectionId=local-test&session=test&window=test&pane=test&cols=-1")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial websocket: %v", err)
	}
	defer conn.Close()

	var connected protocol.ServerMessage
	if err := conn.ReadJSON(&connected); err != nil {
		t.Fatalf("failed to read connected message: %v", err)
	}
	if connected.Type != protocol.ServerMessageTypeStatus || connected.Status != "connected" {
		t.Fatalf("unexpected connected message: %#v", connected)
	}

	var message protocol.ServerMessage
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatalf("failed to read error message: %v", err)
	}

	if message.Type != protocol.ServerMessageTypeError || message.Error == nil || message.Error.Code != "bad_request" {
		t.Fatalf("unexpected error message: %#v", message)
	}
}

func TestTerminalWebSocketUnsupportedConnectionType(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "unknown-type",
		Type: "docker",
	}}
	srv := newTestServer(t, cfg)
	httpServer := httptest.NewServer(srv.Handler())
	defer httpServer.Close()

	wsURL := websocketURL(httpServer.URL + "/api/terminal?token=secret-token&connectionId=unknown-type&session=test&window=test&pane=test")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial websocket: %v", err)
	}
	defer conn.Close()

	var connected protocol.ServerMessage
	if err := conn.ReadJSON(&connected); err != nil {
		t.Fatalf("failed to read connected message: %v", err)
	}
	if connected.Type != protocol.ServerMessageTypeStatus || connected.Status != "connected" {
		t.Fatalf("unexpected connected message: %#v", connected)
	}

	var message protocol.ServerMessage
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatalf("failed to read error message: %v", err)
	}

	if message.Type != protocol.ServerMessageTypeError || message.Error == nil || message.Error.Code != "bad_request" {
		t.Fatalf("unexpected error message: %#v", message)
	}
}

func TestTerminalWebSocketEmptyTokenAllowed(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = ""
	srv := newTestServer(t, cfg)
	httpServer := httptest.NewServer(srv.Handler())
	defer httpServer.Close()

	wsURL := websocketURL(httpServer.URL + "/api/terminal")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial websocket without token: %v", err)
	}
	defer conn.Close()

	var connected protocol.ServerMessage
	if err := conn.ReadJSON(&connected); err != nil {
		t.Fatalf("failed to read connected message: %v", err)
	}
	if connected.Type != protocol.ServerMessageTypeStatus || connected.Status != "connected" {
		t.Fatalf("unexpected connected message: %#v", connected)
	}
}

func TestTerminalWebSocketEmptyTokenWithQueryParam(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = ""
	srv := newTestServer(t, cfg)
	httpServer := httptest.NewServer(srv.Handler())
	defer httpServer.Close()

	wsURL := websocketURL(httpServer.URL + "/api/terminal?token=")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial websocket with empty token param: %v", err)
	}
	defer conn.Close()

	var connected protocol.ServerMessage
	if err := conn.ReadJSON(&connected); err != nil {
		t.Fatalf("failed to read connected message: %v", err)
	}
	if connected.Type != protocol.ServerMessageTypeStatus || connected.Status != "connected" {
		t.Fatalf("unexpected connected message: %#v", connected)
	}
}

func TestTerminalWebSocketUpgradeFailure(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	srv := newTestServer(t, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/terminal?token=secret-token", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	body := rec.Body.String()
	if !strings.Contains(body, "bad_request") {
		t.Fatalf("expected bad_request in response, got: %s", body)
	}
}
