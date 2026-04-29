package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/protocol"
)

type connectionsListPayload struct {
	Data []config.ConnectionConfig `json:"data"`
}

func TestListConnectionsReturnsAllConnectionsFromConfig(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{
		{ID: "local-1", Name: "Local", Type: "local"},
		{ID: "ssh-1", Name: "Remote", Type: "ssh", Host: "example.com", User: "root", KnownHostsPath: "/tmp/known_hosts"},
	}

	srv := newTestServer(t, cfg)
	req := httptest.NewRequest(http.MethodGet, "/api/connections", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload connectionsListPayload
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode connections payload: %v", err)
	}

	if len(payload.Data) != 2 {
		t.Fatalf("unexpected connection count: %d", len(payload.Data))
	}

	if payload.Data[0].ID != "local-1" || payload.Data[0].Name != "Local" || payload.Data[0].Type != "local" {
		t.Fatalf("unexpected first connection: %#v", payload.Data[0])
	}

	if payload.Data[1].ID != "ssh-1" || payload.Data[1].Host != "example.com" || payload.Data[1].User != "root" {
		t.Fatalf("unexpected second connection: %#v", payload.Data[1])
	}
}

func TestCreateConnectionReturnsCreatedConnection(t *testing.T) {
	tests := []struct {
		name    string
		payload config.ConnectionConfig
		assert  func(*testing.T, config.ConnectionConfig)
	}{
		{
			name: "local connection",
			payload: config.ConnectionConfig{
				Name: "Local",
				Type: "local",
			},
			assert: func(t *testing.T, connection config.ConnectionConfig) {
				t.Helper()
				if connection.Name != "Local" || connection.Type != "local" {
					t.Fatalf("unexpected connection payload: %#v", connection)
				}
				if connection.Host != "" || connection.User != "" {
					t.Fatalf("expected local connection without ssh fields: %#v", connection)
				}
			},
		},
		{
			name: "ssh connection",
			payload: config.ConnectionConfig{
				Name: "Remote",
				Type: "ssh",
				Host: "example.com",
				User: "root",
			},
			assert: func(t *testing.T, connection config.ConnectionConfig) {
				t.Helper()
				if connection.Name != "Remote" || connection.Type != "ssh" {
					t.Fatalf("unexpected connection payload: %#v", connection)
				}
				if connection.Host != "example.com" || connection.User != "root" {
					t.Fatalf("unexpected ssh fields: %#v", connection)
				}
				if connection.KnownHostsPath == "" {
					t.Fatalf("expected normalized known hosts path: %#v", connection)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := newTestServer(t, config.DefaultConfig())

			body, err := json.Marshal(tt.payload)
			if err != nil {
				t.Fatalf("failed to encode create payload: %v", err)
			}

			req := httptest.NewRequest(http.MethodPost, "/api/connections", bytes.NewReader(body))
			rec := httptest.NewRecorder()
			srv.Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusCreated {
				t.Fatalf("unexpected status code: %d", rec.Code)
			}

			var created config.ConnectionConfig
			if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
				t.Fatalf("failed to decode create response: %v", err)
			}

			if created.ID == "" {
				t.Fatalf("expected generated id in create response: %#v", created)
			}
			tt.assert(t, created)

			listReq := httptest.NewRequest(http.MethodGet, "/api/connections", nil)
			listRec := httptest.NewRecorder()
			srv.Handler().ServeHTTP(listRec, listReq)

			if listRec.Code != http.StatusOK {
				t.Fatalf("unexpected list status code: %d", listRec.Code)
			}

			var listPayload connectionsListPayload
			if err := json.Unmarshal(listRec.Body.Bytes(), &listPayload); err != nil {
				t.Fatalf("failed to decode connections list: %v", err)
			}

			if len(listPayload.Data) != 1 {
				t.Fatalf("unexpected persisted connection count: %d", len(listPayload.Data))
			}
			if listPayload.Data[0].ID != created.ID {
				t.Fatalf("unexpected persisted connection: %#v", listPayload.Data[0])
			}
		})
	}
}

func TestCreateConnectionRejectsInvalidPayload(t *testing.T) {
	tests := []struct {
		name        string
		payload     config.ConnectionConfig
		wantMessage string
	}{
		{
			name: "empty name",
			payload: config.ConnectionConfig{
				Type: "local",
			},
			wantMessage: "connection name is required",
		},
		{
			name: "invalid type",
			payload: config.ConnectionConfig{
				Name: "Broken",
				Type: "docker",
			},
			wantMessage: "connection type must be local or ssh",
		},
		{
			name: "ssh without host",
			payload: config.ConnectionConfig{
				Name: "Remote",
				Type: "ssh",
				User: "root",
			},
			wantMessage: "ssh connection host is required",
		},
		{
			name: "ssh without user",
			payload: config.ConnectionConfig{
				Name: "Remote",
				Type: "ssh",
				Host: "example.com",
			},
			wantMessage: "ssh connection user is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := newTestServer(t, config.DefaultConfig())

			body, err := json.Marshal(tt.payload)
			if err != nil {
				t.Fatalf("failed to encode create payload: %v", err)
			}

			req := httptest.NewRequest(http.MethodPost, "/api/connections", bytes.NewReader(body))
			rec := httptest.NewRecorder()
			srv.Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("unexpected status code: %d", rec.Code)
			}

			var payload protocol.ErrorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
				t.Fatalf("failed to decode error payload: %v", err)
			}

			if payload.Error.Code != "bad_request" {
				t.Fatalf("unexpected error code: %q", payload.Error.Code)
			}
			if payload.Error.Message != tt.wantMessage {
				t.Fatalf("unexpected error message: %q", payload.Error.Message)
			}
		})
	}
}

func TestCreateConnectionReturnsConflictForDuplicateID(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "duplicate-id",
		Name: "Existing",
		Type: "local",
	}}

	srv := newTestServer(t, cfg)
	body, err := json.Marshal(config.ConnectionConfig{
		ID:   "duplicate-id",
		Name: "Another",
		Type: "local",
	})
	if err != nil {
		t.Fatalf("failed to encode duplicate payload: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/connections", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload protocol.ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode conflict payload: %v", err)
	}

	if payload.Error.Code != "conflict" {
		t.Fatalf("unexpected error code: %q", payload.Error.Code)
	}
	if payload.Error.Message != "connection already exists" {
		t.Fatalf("unexpected error message: %q", payload.Error.Message)
	}
}

func TestGetConnectionReturnsExistingConnection(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Name: "Local",
		Type: "local",
	}}

	srv := newTestServer(t, cfg)
	req := httptest.NewRequest(http.MethodGet, "/api/connections/local-1", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload config.ConnectionConfig
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode connection payload: %v", err)
	}

	if payload.ID != "local-1" || payload.Name != "Local" || payload.Type != "local" {
		t.Fatalf("unexpected connection payload: %#v", payload)
	}
}

func TestGetConnectionReturnsNotFoundForMissingConnection(t *testing.T) {
	srv := newTestServer(t, config.DefaultConfig())
	req := httptest.NewRequest(http.MethodGet, "/api/connections/missing", nil)
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
	if payload.Error.Message != "connection not found" {
		t.Fatalf("unexpected error message: %q", payload.Error.Message)
	}
}

func TestUpdateConnectionUpdatesExistingConnection(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Name: "Local",
		Type: "local",
	}}

	srv := newTestServer(t, cfg)
	body, err := json.Marshal(config.ConnectionConfig{
		ID:   "ignored-id",
		Name: "Remote",
		Type: "ssh",
		Host: "example.com",
		User: "root",
	})
	if err != nil {
		t.Fatalf("failed to encode update payload: %v", err)
	}

	req := httptest.NewRequest(http.MethodPut, "/api/connections/local-1", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload config.ConnectionConfig
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode update payload: %v", err)
	}

	if payload.ID != "local-1" || payload.Name != "Remote" || payload.Type != "ssh" {
		t.Fatalf("unexpected updated payload: %#v", payload)
	}
	if payload.Host != "example.com" || payload.User != "root" {
		t.Fatalf("unexpected updated ssh fields: %#v", payload)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/connections/local-1", nil)
	getRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("unexpected get status code after update: %d", getRec.Code)
	}

	var persisted config.ConnectionConfig
	if err := json.Unmarshal(getRec.Body.Bytes(), &persisted); err != nil {
		t.Fatalf("failed to decode persisted connection: %v", err)
	}

	if persisted.KnownHostsPath == "" {
		t.Fatalf("expected normalized persisted known hosts path: %#v", persisted)
	}
}

func TestUpdateConnectionReturnsNotFoundForMissingConnection(t *testing.T) {
	srv := newTestServer(t, config.DefaultConfig())
	body, err := json.Marshal(config.ConnectionConfig{
		Name: "Remote",
		Type: "ssh",
		Host: "example.com",
		User: "root",
	})
	if err != nil {
		t.Fatalf("failed to encode update payload: %v", err)
	}

	req := httptest.NewRequest(http.MethodPut, "/api/connections/missing", bytes.NewReader(body))
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
	if payload.Error.Message != "connection not found" {
		t.Fatalf("unexpected error message: %q", payload.Error.Message)
	}
}

func TestDeleteConnectionDeletesExistingConnection(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Name: "Local",
		Type: "local",
	}}

	srv := newTestServer(t, cfg)
	req := httptest.NewRequest(http.MethodDelete, "/api/connections/local-1", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("expected empty delete response body, got %q", rec.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/connections/local-1", nil)
	getRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusNotFound {
		t.Fatalf("expected deleted connection to be missing, got %d", getRec.Code)
	}
}

func TestDeleteConnectionReturnsNotFoundForMissingConnection(t *testing.T) {
	srv := newTestServer(t, config.DefaultConfig())
	req := httptest.NewRequest(http.MethodDelete, "/api/connections/missing", nil)
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
	if payload.Error.Message != "connection not found" {
		t.Fatalf("unexpected error message: %q", payload.Error.Message)
	}
}
