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
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "test"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "test", Provider: "openai", Model: "gpt-4", APIKey: "key"},
	}
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Type: "local",
	}}

	fake := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{
		App:        intelligence.AppClaude,
		Status:     intelligence.StatusWaitingConfirm,
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
	if payload.Intelligence.App != "claude" || payload.Intelligence.Status != "waiting_confirm" {
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

func TestAnalyzeSessionIntelligenceUpdatesTargetWindow(t *testing.T) {
	adapterPath, _ := createFakeTMUXBinary(t)

	cfg := config.DefaultConfig()
	cfg.Tmux.Path = adapterPath
	cfg.Intelligence.MinSessionIntervalSec = 0
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "test"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "test", Provider: "openai", Model: "gpt-4", APIKey: "key"},
	}
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Type: "local",
	}}

	fake := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{
		App:        intelligence.AppOpenCode,
		Status:     intelligence.StatusWaitingIdle,
		Summary:    "OpenCode CLI 正在等待用户输入",
		Confidence: 0.96,
	})
	srv := newTestServerWithIntelligence(t, cfg, fake)

	rec := performSessionRequest(t, srv, http.MethodPost, "/api/connections/local-1/sessions/alpha/analyze", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	rec = performSessionRequest(t, srv, http.MethodGet, "/api/connections/local-1/sessions/alpha/windows", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected windows status code: %d", rec.Code)
	}

	windowsPayload := decodeBody[windowsListResponse](t, rec.Body.Bytes())
	if len(windowsPayload.Data) == 0 {
		t.Fatal("expected at least one window")
	}

	found := false
	for _, window := range windowsPayload.Data {
		if window.IntelligenceSummary == "OpenCode CLI 正在等待用户输入" {
			found = true
			if window.IntelligenceApp != "opencode" {
				t.Fatalf("expected window app opencode, got %#v", window)
			}
			if window.IntelligenceAppCounts["opencode"] < 1 {
				t.Fatalf("expected window app counts to include opencode, got %#v", window.IntelligenceAppCounts)
			}
			break
		}
	}
	if !found {
		t.Fatalf("expected one window to include intelligence summary, got %#v", windowsPayload.Data)
	}
}

func TestListSessionsDoesNotInvokeIntelligenceProvider(t *testing.T) {
	adapterPath, _ := createFakeTMUXBinary(t)

	cfg := config.DefaultConfig()
	cfg.Tmux.Path = adapterPath
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "test"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "test", Provider: "openai", Model: "gpt-4", APIKey: "key"},
	}
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

func TestAnalyzeSessionSwitchesActiveProvider(t *testing.T) {
	adapterPath, _ := createFakeTMUXBinary(t)

	cfg := config.DefaultConfig()
	cfg.Tmux.Path = adapterPath
	cfg.Intelligence.MinSessionIntervalSec = 0
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "openai-main"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
		{Name: "anthropic-main", Provider: "anthropic", Model: "claude", APIKey: "key2"},
	}
	cfg.Connections = []config.ConnectionConfig{{
		ID:   "local-1",
		Type: "local",
	}}

	openaiFake := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{
		App:        intelligence.AppCodex,
		Status:     intelligence.StatusRunning,
		Summary:    "OpenAI analysis",
		Confidence: 0.9,
	})
	anthropicFake := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{
		App:        intelligence.AppClaude,
		Status:     intelligence.StatusWaitingIdle,
		Summary:    "Anthropic analysis",
		Confidence: 0.95,
	})

	factory := func(p config.IntelligenceProviderConfig) (intelligence.Provider, error) {
		if p.Provider == "openai" {
			return openaiFake, nil
		}
		return anthropicFake, nil
	}

	srv := newTestServer(t, cfg)
	srv.intelligenceStore = newIntelligenceStore(t)
	srv.intelligenceAnalyzer = intelligence.NewAnalyzer(srv.intelligenceStore, cfg.Intelligence.MaxConcurrency, nil, factory)

	rec := performSessionRequest(t, srv, http.MethodPost, "/api/connections/local-1/sessions/alpha/analyze", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	payload := decodeBody[analyzeResponse](t, rec.Body.Bytes())
	if payload.Intelligence == nil {
		t.Fatal("expected aggregate intelligence in analyze response")
	}
	if payload.Intelligence.App != "codex" {
		t.Fatalf("expected openai result (codex), got %q", payload.Intelligence.App)
	}
	openaiCallCount := openaiFake.Calls
	anthropicCallCount := anthropicFake.Calls

	cfg.Intelligence.ActiveProvider = "anthropic-main"
	srv2 := newTestServer(t, cfg)
	srv2.intelligenceStore = newIntelligenceStore(t)
	srv2.intelligenceAnalyzer = intelligence.NewAnalyzer(srv2.intelligenceStore, cfg.Intelligence.MaxConcurrency, nil, factory)

	rec = performSessionRequest(t, srv2, http.MethodPost, "/api/connections/local-1/sessions/beta/analyze", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	payload = decodeBody[analyzeResponse](t, rec.Body.Bytes())
	if payload.Intelligence == nil {
		t.Fatal("expected aggregate intelligence in analyze response")
	}
	if payload.Intelligence.App != "claude" {
		t.Fatalf("expected anthropic result (claude), got %q", payload.Intelligence.App)
	}
	if openaiFake.Calls != openaiCallCount {
		t.Fatalf("openai provider calls changed from %d to %d", openaiCallCount, openaiFake.Calls)
	}
	if anthropicFake.Calls <= anthropicCallCount {
		t.Fatalf("anthropic provider calls did not increase from %d", anthropicCallCount)
	}
}

func newIntelligenceStore(t *testing.T) *intelligence.Store {
	t.Helper()
	store, err := intelligence.NewStore(":memory:")
	if err != nil {
		t.Fatalf("failed to create intelligence store: %v", err)
	}
	return store
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
	srv.intelligenceAnalyzer = intelligence.NewAnalyzer(store, cfg.Intelligence.MaxConcurrency, nil, func(p config.IntelligenceProviderConfig) (intelligence.Provider, error) {
		return provider, nil
	})
	return srv
}
