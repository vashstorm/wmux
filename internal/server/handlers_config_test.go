package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/panh/wmux/internal/config"
)

type intelligenceConfigResponse struct {
	Enabled        bool `json:"enabled"`
	ActiveProvider string `json:"activeProvider"`
	Providers      []struct {
		Name             string `json:"name"`
		Provider         string `json:"provider"`
		Model            string `json:"model"`
		BaseURL          string `json:"baseURL"`
		APIKeyConfigured bool   `json:"apiKeyConfigured"`
	} `json:"providers"`
	MaxBytes              int `json:"maxBytes"`
	TimeoutSec            int `json:"timeoutSec"`
	MinSessionIntervalSec int `json:"minSessionIntervalSec"`
	MaxConcurrency        int `json:"maxConcurrency"`
	CacheTTLSec           int `json:"cacheTTLSec"`
}

func TestGetConfigIncludesIntelligenceProviders(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "openai-main"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "secret-key"},
		{Name: "anthropic-main", Provider: "anthropic", Model: "claude", APIKey: "anthropic-key"},
	}

	srv := newTestServer(t, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload struct {
		Intelligence intelligenceConfigResponse `json:"intelligence"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode config payload: %v", err)
	}

	if !payload.Intelligence.Enabled {
		t.Fatal("expected intelligence to be enabled")
	}
	if payload.Intelligence.ActiveProvider != "openai-main" {
		t.Fatalf("unexpected activeProvider: %q", payload.Intelligence.ActiveProvider)
	}
	if len(payload.Intelligence.Providers) != 2 {
		t.Fatalf("expected 2 providers, got %d", len(payload.Intelligence.Providers))
	}

	p1 := payload.Intelligence.Providers[0]
	if p1.Name != "openai-main" || p1.Provider != "openai" || p1.Model != "gpt-4" {
		t.Fatalf("unexpected provider 1: %#v", p1)
	}
	if !p1.APIKeyConfigured {
		t.Fatal("expected provider 1 apiKeyConfigured to be true")
	}

	p2 := payload.Intelligence.Providers[1]
	if p2.Name != "anthropic-main" {
		t.Fatalf("unexpected provider 2 name: %q", p2.Name)
	}
	if !p2.APIKeyConfigured {
		t.Fatal("expected provider 2 apiKeyConfigured to be true")
	}
}

func TestUpdateConfigSwitchesActiveProvider(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "openai-main"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "secret-key"},
	}

	srv := newTestServer(t, cfg)

	update := config.DefaultConfig()
	update.Auth.Token = "secret-token"
	update.Intelligence.Enabled = true
	update.Intelligence.ActiveProvider = "anthropic-main"
	update.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4o", APIKey: "new-key"},
		{Name: "anthropic-main", Provider: "anthropic", Model: "claude-3", APIKey: "anthropic-key"},
	}

	body, _ := json.Marshal(update)
	req := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload struct {
		Intelligence intelligenceConfigResponse `json:"intelligence"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if payload.Intelligence.ActiveProvider != "anthropic-main" {
		t.Fatalf("unexpected activeProvider: %q", payload.Intelligence.ActiveProvider)
	}
	if len(payload.Intelligence.Providers) != 2 {
		t.Fatalf("expected 2 providers, got %d", len(payload.Intelligence.Providers))
	}

	for _, p := range payload.Intelligence.Providers {
		if !p.APIKeyConfigured {
			t.Fatalf("expected apiKeyConfigured true for provider %q", p.Name)
		}
	}
}

func TestUpdateConfigPreservesExistingAPIKey(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "openai-main"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "secret-key"},
	}

	srv := newTestServer(t, cfg)

	update := config.DefaultConfig()
	update.Auth.Token = "secret-token"
	update.Intelligence.Enabled = true
	update.Intelligence.ActiveProvider = "openai-main"
	update.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4o", APIKey: ""},
	}

	body, _ := json.Marshal(update)
	req := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload struct {
		Intelligence intelligenceConfigResponse `json:"intelligence"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(payload.Intelligence.Providers) != 1 {
		t.Fatalf("expected 1 provider, got %d", len(payload.Intelligence.Providers))
	}
	if !payload.Intelligence.Providers[0].APIKeyConfigured {
		t.Fatal("expected apiKeyConfigured to remain true after preserving existing key")
	}
	if payload.Intelligence.Providers[0].Model != "gpt-4o" {
		t.Fatalf("expected model gpt-4o, got %q", payload.Intelligence.Providers[0].Model)
	}
}

func TestUpdateConfigRejectsNewProviderWithoutAPIKey(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "openai-main"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "secret-key"},
	}

	srv := newTestServer(t, cfg)

	update := config.DefaultConfig()
	update.Auth.Token = "secret-token"
	update.Intelligence.Enabled = true
	update.Intelligence.ActiveProvider = "openai-main"
	update.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "secret-key"},
		{Name: "anthropic-main", Provider: "anthropic", Model: "claude", APIKey: ""},
	}

	body, _ := json.Marshal(update)
	req := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected internal server error for new provider without API key, got status %d", rec.Code)
	}
}

func TestUpdateConfigRejectsInvalidIntelligenceProvider(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	srv := newTestServer(t, cfg)

	update := config.DefaultConfig()
	update.Auth.Token = "secret-token"
	update.Intelligence.Enabled = true
	update.Intelligence.ActiveProvider = "invalid"
	update.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "invalid", Provider: "unknown", Model: "test", APIKey: "key"},
	}

	body, _ := json.Marshal(update)
	req := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected internal server error for invalid provider type, got status %d", rec.Code)
	}
}

func TestUpdateConfigAddsProviderWithoutChangingActiveProvider(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "openai-main"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "secret-key"},
	}

	srv := newTestServer(t, cfg)

	update := config.DefaultConfig()
	update.Auth.Token = "secret-token"
	update.Intelligence.Enabled = true
	update.Intelligence.ActiveProvider = "openai-main"
	update.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: ""},
		{Name: "anthropic-main", Provider: "anthropic", Model: "claude-3", APIKey: "anthropic-key"},
	}

	body, _ := json.Marshal(update)
	req := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload struct {
		Intelligence intelligenceConfigResponse `json:"intelligence"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if payload.Intelligence.ActiveProvider != "openai-main" {
		t.Fatalf("expected activeProvider openai-main, got %q", payload.Intelligence.ActiveProvider)
	}
	if len(payload.Intelligence.Providers) != 2 {
		t.Fatalf("expected 2 providers, got %d", len(payload.Intelligence.Providers))
	}
}

func TestUpdateConfigUpdatesExistingProviderFields(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "openai-main"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "secret-key", BaseURL: "https://old.example.com"},
	}

	srv := newTestServer(t, cfg)

	update := config.DefaultConfig()
	update.Auth.Token = "secret-token"
	update.Intelligence.Enabled = true
	update.Intelligence.ActiveProvider = "openai-main"
	update.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4o", APIKey: "", BaseURL: "https://new.example.com"},
	}

	body, _ := json.Marshal(update)
	req := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload struct {
		Intelligence intelligenceConfigResponse `json:"intelligence"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(payload.Intelligence.Providers) != 1 {
		t.Fatalf("expected 1 provider, got %d", len(payload.Intelligence.Providers))
	}
	p := payload.Intelligence.Providers[0]
	if p.Model != "gpt-4o" {
		t.Fatalf("expected model gpt-4o, got %q", p.Model)
	}
	if p.BaseURL != "https://new.example.com" {
		t.Fatalf("expected baseURL https://new.example.com, got %q", p.BaseURL)
	}
	if !p.APIKeyConfigured {
		t.Fatal("expected apiKeyConfigured true (preserved from existing)")
	}
}

func TestUpdateConfigDeletesProvider(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "openai-main"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "secret-key"},
		{Name: "anthropic-main", Provider: "anthropic", Model: "claude", APIKey: "anthropic-key"},
	}

	srv := newTestServer(t, cfg)

	update := config.DefaultConfig()
	update.Auth.Token = "secret-token"
	update.Intelligence.Enabled = true
	update.Intelligence.ActiveProvider = "openai-main"
	update.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: ""},
	}

	body, _ := json.Marshal(update)
	req := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload struct {
		Intelligence intelligenceConfigResponse `json:"intelligence"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(payload.Intelligence.Providers) != 1 {
		t.Fatalf("expected 1 provider after delete, got %d", len(payload.Intelligence.Providers))
	}
	if payload.Intelligence.Providers[0].Name != "openai-main" {
		t.Fatalf("expected remaining provider openai-main, got %q", payload.Intelligence.Providers[0].Name)
	}
}

func TestUpdateConfigDeleteActiveProviderFailsValidation(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "provider-to-delete"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "provider-to-delete", Provider: "openai", Model: "gpt-4", APIKey: "secret-key"},
		{Name: "keep-provider", Provider: "anthropic", Model: "claude", APIKey: "anthropic-key"},
	}

	srv := newTestServer(t, cfg)

	update := config.DefaultConfig()
	update.Auth.Token = "secret-token"
	update.Intelligence.Enabled = true
	update.Intelligence.ActiveProvider = "provider-to-delete"
	update.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "keep-provider", Provider: "anthropic", Model: "claude", APIKey: "anthropic-key"},
	}

	body, _ := json.Marshal(update)
	req := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected internal server error when deleting active provider, got status %d", rec.Code)
	}
}

func TestUpdateConfigSwitchActiveProviderAfterDelete(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "provider-to-delete"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "provider-to-delete", Provider: "openai", Model: "gpt-4", APIKey: "secret-key"},
		{Name: "keep-provider", Provider: "anthropic", Model: "claude", APIKey: "anthropic-key"},
	}

	srv := newTestServer(t, cfg)

	update := config.DefaultConfig()
	update.Auth.Token = "secret-token"
	update.Intelligence.Enabled = true
	update.Intelligence.ActiveProvider = "keep-provider"
	update.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "keep-provider", Provider: "anthropic", Model: "claude", APIKey: "anthropic-key"},
	}

	body, _ := json.Marshal(update)
	req := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload struct {
		Intelligence intelligenceConfigResponse `json:"intelligence"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if payload.Intelligence.ActiveProvider != "keep-provider" {
		t.Fatalf("expected activeProvider keep-provider, got %q", payload.Intelligence.ActiveProvider)
	}
	if len(payload.Intelligence.Providers) != 1 {
		t.Fatalf("expected 1 provider, got %d", len(payload.Intelligence.Providers))
	}
}

func TestGetConfigIntelligenceDisabled(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = false
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{}

	srv := newTestServer(t, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload struct {
		Intelligence intelligenceConfigResponse `json:"intelligence"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if payload.Intelligence.Enabled {
		t.Fatal("expected intelligence to be disabled")
	}
	if len(payload.Intelligence.Providers) != 0 {
		t.Fatalf("expected 0 providers when disabled, got %d", len(payload.Intelligence.Providers))
	}
}

func TestUpdateConfigWithIntelligenceDisabled(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = false
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{}

	srv := newTestServer(t, cfg)

	update := config.DefaultConfig()
	update.Auth.Token = "secret-token"
	update.Intelligence.Enabled = false
	update.Intelligence.Providers = []config.IntelligenceProviderConfig{}

	body, _ := json.Marshal(update)
	req := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
}

func TestUpdateConfigMalformedJSON(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	srv := newTestServer(t, cfg)

	req := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader([]byte("not json")))
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected bad request for malformed JSON, got status %d", rec.Code)
	}
}

func TestGetConfigRedactsAPIKeys(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "openai-main"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "secret-key"},
	}

	srv := newTestServer(t, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode config payload: %v", err)
	}

	intelRaw, ok := payload["intelligence"]
	if !ok {
		t.Fatal("intelligence field missing from config response")
	}

	var intel struct {
		Providers []map[string]interface{} `json:"providers"`
	}
	if err := json.Unmarshal(intelRaw, &intel); err != nil {
		t.Fatalf("failed to decode intelligence: %v", err)
	}

	if len(intel.Providers) != 1 {
		t.Fatalf("expected 1 provider, got %d", len(intel.Providers))
	}

	if key, exists := intel.Providers[0]["apiKey"]; exists {
		t.Fatalf("apiKey should be redacted in GET response, got %v", key)
	}
}

func TestGetConfigAuthTokenRedacted(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	srv := newTestServer(t, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}

	var payload struct {
		Auth struct {
			Token           string `json:"token"`
			TokenConfigured bool   `json:"tokenConfigured"`
		} `json:"auth"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if payload.Auth.Token != "" {
		t.Fatalf("auth token should be redacted, got %q", payload.Auth.Token)
	}
	if !payload.Auth.TokenConfigured {
		t.Fatal("expected tokenConfigured to be true")
	}
}

func TestConfigRoundtripGetModifyPutGet(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Auth.Token = "secret-token"
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "openai-main"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "secret-key"},
	}

	srv := newTestServer(t, cfg)

	// GET initial config
	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET failed: %d", rec.Code)
	}

	var initial struct {
		Intelligence intelligenceConfigResponse `json:"intelligence"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &initial); err != nil {
		t.Fatalf("failed to decode GET response: %v", err)
	}

	if len(initial.Intelligence.Providers) != 1 {
		t.Fatalf("expected 1 provider, got %d", len(initial.Intelligence.Providers))
	}

	// PUT: add a provider and change active
	update := config.DefaultConfig()
	update.Auth.Token = "secret-token"
	update.Intelligence.Enabled = true
	update.Intelligence.ActiveProvider = "anthropic-main"
	update.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: ""},
		{Name: "anthropic-main", Provider: "anthropic", Model: "claude", APIKey: "anthropic-key"},
	}

	body, _ := json.Marshal(update)
	req2 := httptest.NewRequest(http.MethodPut, "/api/config", bytes.NewReader(body))
	req2.Header.Set("Authorization", "Bearer secret-token")
	rec2 := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("PUT failed: %d", rec2.Code)
	}

	// GET again to verify persistence
	req3 := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	req3.Header.Set("Authorization", "Bearer secret-token")
	rec3 := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec3, req3)

	if rec3.Code != http.StatusOK {
		t.Fatalf("second GET failed: %d", rec3.Code)
	}

	var final struct {
		Intelligence intelligenceConfigResponse `json:"intelligence"`
	}
	if err := json.Unmarshal(rec3.Body.Bytes(), &final); err != nil {
		t.Fatalf("failed to decode second GET response: %v", err)
	}

	if final.Intelligence.ActiveProvider != "anthropic-main" {
		t.Fatalf("expected activeProvider anthropic-main after roundtrip, got %q", final.Intelligence.ActiveProvider)
	}
	if len(final.Intelligence.Providers) != 2 {
		t.Fatalf("expected 2 providers after roundtrip, got %d", len(final.Intelligence.Providers))
	}
	if !final.Intelligence.Providers[0].APIKeyConfigured {
		t.Fatal("expected openai-main apiKeyConfigured true (preserved)")
	}
	if !final.Intelligence.Providers[1].APIKeyConfigured {
		t.Fatal("expected anthropic-main apiKeyConfigured true")
	}
}
