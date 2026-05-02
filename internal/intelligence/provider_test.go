package intelligence_test

import (
	"testing"

	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/intelligence"
)

func TestNewProvider_OpenAI(t *testing.T) {
	cfg := config.IntelligenceProviderConfig{
		Provider: "openai",
		Model:    "gpt-4o-mini",
		APIKey:   "test-key",
	}
	provider, err := intelligence.NewProvider(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if provider.Name() != "openai" {
		t.Fatalf("expected openai provider, got %q", provider.Name())
	}
}

func TestNewProvider_Anthropic(t *testing.T) {
	cfg := config.IntelligenceProviderConfig{
		Provider: "anthropic",
		Model:    "claude-3-haiku-20240307",
		APIKey:   "test-key",
	}
	provider, err := intelligence.NewProvider(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if provider.Name() != "anthropic" {
		t.Fatalf("expected anthropic provider, got %q", provider.Name())
	}
}

func TestNewProvider_UnknownProvider(t *testing.T) {
	cfg := config.IntelligenceProviderConfig{
		Provider: "unknown",
		Model:    "test",
		APIKey:   "test-key",
	}
	_, err := intelligence.NewProvider(cfg)
	if err == nil {
		t.Fatal("expected error for unknown provider, got nil")
	}
	var provErr *intelligence.ProviderError
	if !errorAsProviderError(err, &provErr) {
		t.Fatalf("expected ProviderError, got %T", err)
	}
	if provErr.Category != intelligence.ErrCategoryDisabled {
		t.Fatalf("expected disabled category, got %q", provErr.Category)
	}
}

func TestNewProvider_EmptyProvider(t *testing.T) {
	cfg := config.IntelligenceProviderConfig{
		Provider: "",
		Model:    "test",
		APIKey:   "test-key",
	}
	_, err := intelligence.NewProvider(cfg)
	if err == nil {
		t.Fatal("expected error for empty provider, got nil")
	}
	var provErr *intelligence.ProviderError
	if !errorAsProviderError(err, &provErr) {
		t.Fatalf("expected ProviderError, got %T", err)
	}
	if provErr.Category != intelligence.ErrCategoryDisabled {
		t.Fatalf("expected disabled category, got %q", provErr.Category)
	}
}

func TestNewProvider_MissingAPIKey(t *testing.T) {
	cfg := config.IntelligenceProviderConfig{
		Provider: "openai",
		Model:    "gpt-4o-mini",
		APIKey:   "",
	}
	_, err := intelligence.NewProvider(cfg)
	if err == nil {
		t.Fatal("expected error for missing API key, got nil")
	}
	var provErr *intelligence.ProviderError
	if !errorAsProviderError(err, &provErr) {
		t.Fatalf("expected ProviderError, got %T", err)
	}
	if provErr.Category != intelligence.ErrCategoryMissingCreds {
		t.Fatalf("expected missing_credentials category, got %q", provErr.Category)
	}
}

func TestResolveActiveProvider_Disabled(t *testing.T) {
	cfg := config.IntelligenceConfig{
		Enabled: false,
	}
	_, err := intelligence.ResolveActiveProvider(cfg)
	if err == nil {
		t.Fatal("expected error when disabled, got nil")
	}
	var provErr *intelligence.ProviderError
	if !errorAsProviderError(err, &provErr) {
		t.Fatalf("expected ProviderError, got %T", err)
	}
	if provErr.Category != intelligence.ErrCategoryDisabled {
		t.Fatalf("expected disabled category, got %q", provErr.Category)
	}
}

func TestResolveActiveProvider_EmptyProviders(t *testing.T) {
	cfg := config.IntelligenceConfig{
		Enabled:   true,
		Providers: []config.IntelligenceProviderConfig{},
	}
	_, err := intelligence.ResolveActiveProvider(cfg)
	if err == nil {
		t.Fatal("expected error for empty providers, got nil")
	}
	var provErr *intelligence.ProviderError
	if !errorAsProviderError(err, &provErr) {
		t.Fatalf("expected ProviderError, got %T", err)
	}
	if provErr.Category != intelligence.ErrCategoryMissingCreds {
		t.Fatalf("expected missing_credentials category, got %q", provErr.Category)
	}
}

func TestResolveActiveProvider_NotFound(t *testing.T) {
	cfg := config.IntelligenceConfig{
		Enabled:        true,
		ActiveProvider: "missing",
		Providers: []config.IntelligenceProviderConfig{
			{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "key"},
		},
	}
	_, err := intelligence.ResolveActiveProvider(cfg)
	if err == nil {
		t.Fatal("expected error for missing active provider, got nil")
	}
	var provErr *intelligence.ProviderError
	if !errorAsProviderError(err, &provErr) {
		t.Fatalf("expected ProviderError, got %T", err)
	}
	if provErr.Category != intelligence.ErrCategoryMissingCreds {
		t.Fatalf("expected missing_credentials category, got %q", provErr.Category)
	}
}

func TestResolveActiveProvider_Found(t *testing.T) {
	cfg := config.IntelligenceConfig{
		Enabled:        true,
		ActiveProvider: "openai-main",
		Providers: []config.IntelligenceProviderConfig{
			{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
		},
	}
	result, err := intelligence.ResolveActiveProvider(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Name != "openai-main" {
		t.Fatalf("expected name openai-main, got %q", result.Name)
	}
	if result.Provider != "openai" {
		t.Fatalf("expected provider openai, got %q", result.Provider)
	}
	if result.Model != "gpt-4" {
		t.Fatalf("expected model gpt-4, got %q", result.Model)
	}
	if result.APIKey != "key1" {
		t.Fatalf("expected apiKey key1, got %q", result.APIKey)
	}
}

func TestResolveActiveProvider_MultipleProviders(t *testing.T) {
	cfg := config.IntelligenceConfig{
		Enabled:        true,
		ActiveProvider: "anthropic-main",
		Providers: []config.IntelligenceProviderConfig{
			{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
			{Name: "anthropic-main", Provider: "anthropic", Model: "claude", APIKey: "key2"},
		},
	}
	result, err := intelligence.ResolveActiveProvider(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Name != "anthropic-main" {
		t.Fatalf("expected name anthropic-main, got %q", result.Name)
	}
	if result.APIKey != "key2" {
		t.Fatalf("expected apiKey key2, got %q", result.APIKey)
	}
}

func TestResolveActiveProvider_FirstProviderSelectedWhenEmptyActiveProvider(t *testing.T) {
	cfg := config.IntelligenceConfig{
		Enabled:        true,
		ActiveProvider: "",
		Providers: []config.IntelligenceProviderConfig{
			{Name: "openai-main", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
			{Name: "anthropic-main", Provider: "anthropic", Model: "claude", APIKey: "key2"},
		},
	}
	_, err := intelligence.ResolveActiveProvider(cfg)
	if err == nil {
		t.Fatal("expected error for empty active provider, got nil")
	}
	var provErr *intelligence.ProviderError
	if !errorAsProviderError(err, &provErr) {
		t.Fatalf("expected ProviderError, got %T", err)
	}
	if provErr.Category != intelligence.ErrCategoryMissingCreds {
		t.Fatalf("expected missing_credentials category, got %q", provErr.Category)
	}
}

func TestNewProviderForTesting(t *testing.T) {
	cfg := intelligence.FakeProviderConfig{
		App:    intelligence.AppClaude,
		Status: intelligence.StatusRunning,
	}
	provider := intelligence.NewProviderForTesting(cfg)
	if provider == nil {
		t.Fatal("expected provider, got nil")
	}
	if provider.Name() != "fake" {
		t.Fatalf("expected fake provider, got %q", provider.Name())
	}
}
