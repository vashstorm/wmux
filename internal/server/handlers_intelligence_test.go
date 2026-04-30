package server

import (
	"net/http"
	"testing"

	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/intelligence"
)

func TestAnalyzeSessionIntelligenceUpdatesTargetSession(t *testing.T) {
	adapterPath, _ := createFakeTMUXBinary(t)

	cfg := config.DefaultConfig()
	cfg.Tmux.Path = adapterPath
	cfg.Intelligence.MinSessionIntervalSec = 0
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Type: "local",
	}}

	fake := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{
		App:        intelligence.AppClaude,
		Status:     intelligence.StatusWaiting,
		Summary:    "Waiting for user input",
		Confidence: 0.92,
	})
	srv := newTestServerWithIntelligence(t, cfg, fake)

	rec := performSessionRequest(t, srv, http.MethodPost, "/api/connections/local-1/sessions/alpha/analyze", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	payload := decodeBody[analyzeResponse](t, rec.Body.Bytes())
	if payload.ConnectionID != "local-1" || payload.Session != "alpha" || payload.Status != "ok" {
		t.Fatalf("unexpected analyze payload: %#v", payload)
	}
	if payload.Intelligence == nil {
		t.Fatal("expected aggregate intelligence in analyze response")
	}
	if payload.Intelligence.App != "claude" || payload.Intelligence.Status != "waiting" {
		t.Fatalf("unexpected intelligence aggregate: %#v", payload.Intelligence)
	}
	if payload.Intelligence.Summary != "Waiting for user input" {
		t.Fatalf("unexpected intelligence summary: %q", payload.Intelligence.Summary)
	}
	if payload.Updated == 0 || payload.Errors != 0 {
		t.Fatalf("unexpected analyze counts: %#v", payload)
	}

	rec = performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected sessions status code: %d", rec.Code)
	}
	sessionsPayload := decodeBody[sessionsListResponse](t, rec.Body.Bytes())
	if len(sessionsPayload.Data) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessionsPayload.Data))
	}
	if sessionsPayload.Data[0].Name != "alpha" || sessionsPayload.Data[0].IntelligenceApp != "claude" {
		t.Fatalf("expected alpha to include intelligence, got %#v", sessionsPayload.Data[0])
	}
	if sessionsPayload.Data[1].Name != "beta" || sessionsPayload.Data[1].IntelligenceApp != "" {
		t.Fatalf("expected beta to remain without intelligence, got %#v", sessionsPayload.Data[1])
	}
}

func TestListSessionsDoesNotInvokeIntelligenceProvider(t *testing.T) {
	adapterPath, _ := createFakeTMUXBinary(t)

	cfg := config.DefaultConfig()
	cfg.Tmux.Path = adapterPath
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Type: "local",
	}}

	fake := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{Error: "panic"})
	srv := newTestServerWithIntelligence(t, cfg, fake)

	rec := performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	if fake.Calls != 0 {
		t.Fatalf("expected provider not to be called, got %d calls", fake.Calls)
	}
}

func TestAnalyzeSSHConnectionReturnsBadRequest(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "ssh-1",
		Type: "ssh",
		Host: "example.com",
		User: "root",
	}}
	srv := newTestServer(t, cfg)

	rec := performSessionRequest(t, srv, http.MethodPost, "/api/connections/ssh-1/sessions/work/analyze", "")
	assertErrorResponse(t, rec, http.StatusBadRequest, "bad_request", "intelligence analysis is only supported for local connections")
}

func TestAnalyzeDisabledReturnsFastOK(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Type: "local",
	}}
	srv := newTestServer(t, cfg)

	rec := performSessionRequest(t, srv, http.MethodPost, "/api/connections/local-1/sessions/work/analyze", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	payload := decodeBody[analyzeResponse](t, rec.Body.Bytes())
	if payload.Status != "disabled" || payload.ConnectionID != "local-1" || payload.Session != "work" {
		t.Fatalf("unexpected disabled response: %#v", payload)
	}
}

func newTestServerWithIntelligence(t *testing.T, cfg config.Config, provider intelligence.Provider) *Server {
	t.Helper()

	store, err := intelligence.NewStore(":memory:")
	if err != nil {
		t.Fatalf("failed to create intelligence store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	srv := newTestServer(t, cfg)
	srv.intelligenceStore = store
	srv.intelligenceAnalyzer = intelligence.NewAnalyzer(provider, store, cfg.Intelligence.MaxConcurrency, nil)
	return srv
}
