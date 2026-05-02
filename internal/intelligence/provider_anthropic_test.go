package intelligence_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/intelligence"
)

func TestAnthropicProviderValidResponse(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := map[string]any{
			"id":    "msg_test",
			"type":  "message",
			"role":  "assistant",
			"model": "claude-3-haiku-20240307",
			"content": []map[string]any{
				{
					"type": "text",
					"text": `{"application":"claude","status":"running","summary":"Processing user request","confidence":0.95,"reason":"Claude CLI detected"}`,
				},
			},
			"stop_reason": "end_turn",
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	cfg := config.IntelligenceProviderConfig{
		Provider: "anthropic",
		Model:    "claude-3-haiku-20240307",
		APIKey:   "test-key",
		BaseURL:  ts.URL,
	}

	provider, err := intelligence.NewAnthropicProvider(cfg)
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	result, err := provider.Analyze(context.Background(), intelligence.AnalyzeInput{
		PaneID:         "test-pane",
		SessionName:    "test-session",
		WindowID:       "test-window",
		CurrentCommand: "claude",
		RawContent:     "Claude is processing",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.App != intelligence.AppClaude {
		t.Errorf("expected AppClaude, got %v", result.App)
	}
	if result.Status != intelligence.StatusRunning {
		t.Errorf("expected StatusRunning, got %v", result.Status)
	}
	if result.Summary != "Processing user request" {
		t.Errorf("unexpected summary: %v", result.Summary)
	}
	if result.Confidence != 0.95 {
		t.Errorf("expected 0.95, got %v", result.Confidence)
	}
}

func TestAnthropicProviderTimeout(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	cfg := config.IntelligenceProviderConfig{
		Provider: "anthropic",
		Model:    "claude-3-haiku-20240307",
		APIKey:   "test-key",
		BaseURL:  ts.URL,
	}

	provider, err := intelligence.NewAnthropicProvider(cfg)
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err = provider.Analyze(ctx, intelligence.AnalyzeInput{
		PaneID:     "test-pane",
		RawContent: "test",
	})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if elapsed > 2*time.Second {
		t.Errorf("should have timed out early, took %v", elapsed)
	}

	var provErr *intelligence.ProviderError
	if !errorAsProviderError(err, &provErr) {
		t.Fatalf("expected ProviderError, got %T", err)
	}
	if provErr.Category != intelligence.ErrCategoryTimeout {
		t.Errorf("expected timeout, got %v", provErr.Category)
	}
}

func TestAnthropicProviderRateLimited(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"type":    "rate_limit_error",
				"message": "Rate limit exceeded",
			},
		})
	}))
	defer ts.Close()

	cfg := config.IntelligenceProviderConfig{
		Provider: "anthropic",
		Model:    "claude-3-haiku-20240307",
		APIKey:   "test-key",
		BaseURL:  ts.URL,
	}

	provider, err := intelligence.NewAnthropicProvider(cfg)
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	_, err = provider.Analyze(context.Background(), intelligence.AnalyzeInput{
		RawContent: "test",
	})

	if err == nil {
		t.Fatal("expected error, got nil")
	}

	var provErr *intelligence.ProviderError
	if !errorAsProviderError(err, &provErr) {
		t.Fatalf("expected ProviderError, got %T", err)
	}
	if provErr.Category != intelligence.ErrCategoryRateLimited {
		t.Errorf("expected rate_limited, got %v", provErr.Category)
	}
}

func TestAnthropicProviderMissingCreds(t *testing.T) {
	cfg := config.IntelligenceProviderConfig{
		Provider: "anthropic",
		Model:    "claude-3-haiku-20240307",
		APIKey:   "",
	}

	_, err := intelligence.NewAnthropicProvider(cfg)
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	var provErr *intelligence.ProviderError
	if !errorAsProviderError(err, &provErr) {
		t.Fatalf("expected ProviderError, got %T", err)
	}
	if provErr.Category != intelligence.ErrCategoryMissingCreds {
		t.Errorf("expected missing_credentials, got %v", provErr.Category)
	}
}

func TestAnthropicProviderName(t *testing.T) {
	cfg := config.IntelligenceProviderConfig{
		Provider: "anthropic",
		Model:    "claude-3-haiku-20240307",
		APIKey:   "test",
		BaseURL:  "http://localhost",
	}

	provider, err := intelligence.NewAnthropicProvider(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if provider.Name() != "anthropic" {
		t.Errorf("expected 'anthropic', got %v", provider.Name())
	}
}
