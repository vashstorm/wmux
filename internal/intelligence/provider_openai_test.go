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

func TestOpenAIProviderValidResponse(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := map[string]any{
			"id":      "chatcmpl-test",
			"object":  "chat.completion",
			"model":   "gpt-4o-mini",
			"created": 1234567890,
			"choices": []map[string]any{
				{
					"index": 0,
					"message": map[string]any{
						"role":    "assistant",
						"content": `{"application":"codex","status":"running","summary":"Codex is analyzing code","confidence":0.9,"reason":"Codex CLI detected"}`,
					},
					"finish_reason": "stop",
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     10,
				"completion_tokens": 20,
				"total_tokens":      30,
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	cfg := config.IntelligenceProviderConfig{
		Provider: "openai",
		Model:    "gpt-4o-mini",
		APIKey:   "test-key",
		BaseURL:  ts.URL,
	}
	provider, err := intelligence.NewOpenAIProvider(cfg)
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	result, err := provider.Analyze(context.Background(), intelligence.AnalyzeInput{
		PaneID:         "test-pane",
		SessionName:    "test-session",
		WindowID:       "test-window",
		CurrentCommand: "codex",
		RawContent:     "Codex is analyzing",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.App != intelligence.AppCodex {
		t.Errorf("expected AppCodex, got %v", result.App)
	}
	if result.Status != intelligence.StatusRunning {
		t.Errorf("expected StatusRunning, got %v", result.Status)
	}
	if result.Summary != "Codex is analyzing code" {
		t.Errorf("unexpected summary: %v", result.Summary)
	}
	if result.Confidence != 0.9 {
		t.Errorf("expected 0.9, got %v", result.Confidence)
	}
}

func TestOpenAIProviderInvalidEnum(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := map[string]any{
			"id":      "chatcmpl-test",
			"object":  "chat.completion",
			"model":   "gpt-4o-mini",
			"created": 1234567890,
			"choices": []map[string]any{
				{
					"index": 0,
					"message": map[string]any{
						"role":    "assistant",
						"content": `{"application":"vim","status":"busy"}`,
					},
					"finish_reason": "stop",
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     10,
				"completion_tokens": 10,
				"total_tokens":      20,
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	cfg := config.IntelligenceProviderConfig{
		Provider: "openai",
		Model:    "gpt-4o-mini",
		APIKey:   "test-key",
		BaseURL:  ts.URL,
	}
	provider, err := intelligence.NewOpenAIProvider(cfg)
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	_, err = provider.Analyze(context.Background(), intelligence.AnalyzeInput{
		PaneID:     "test-pane",
		RawContent: "test",
	})

	if err == nil {
		t.Fatal("expected error, got nil")
	}

	var provErr *intelligence.ProviderError
	if !errorAsProviderError(err, &provErr) {
		t.Fatalf("expected ProviderError, got %T", err)
	}
	if provErr.Category != intelligence.ErrCategoryInvalidResponse {
		t.Errorf("expected invalid_response, got %v", provErr.Category)
	}
}

func TestOpenAIProviderTimeout(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	cfg := config.IntelligenceProviderConfig{
		Provider: "openai",
		Model:    "gpt-4o-mini",
		APIKey:   "test-key",
		BaseURL:  ts.URL,
	}
	provider, err := intelligence.NewOpenAIProvider(cfg)
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

func TestOpenAIProviderRateLimited(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"message": "Rate limit exceeded",
				"type":    "rate_limit_error",
			},
		})
	}))
	defer ts.Close()

	cfg := config.IntelligenceProviderConfig{
		Provider: "openai",
		Model:    "gpt-4o-mini",
		APIKey:   "test-key",
		BaseURL:  ts.URL,
	}
	provider, err := intelligence.NewOpenAIProvider(cfg)
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

func TestOpenAIProviderMissingCreds(t *testing.T) {
	cfg := config.IntelligenceProviderConfig{
		Provider: "openai",
		Model:    "gpt-4o-mini",
		APIKey:   "",
	}

	_, err := intelligence.NewOpenAIProvider(cfg)
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

func TestOpenAIProviderName(t *testing.T) {
	cfg := config.IntelligenceProviderConfig{
		Provider: "openai",
		Model:    "gpt-4o-mini",
		APIKey:   "test",
		BaseURL:  "http://localhost",
	}

	provider, err := intelligence.NewOpenAIProvider(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if provider.Name() != "openai" {
		t.Errorf("expected 'openai', got %v", provider.Name())
	}
}
