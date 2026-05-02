package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/panh/wmux/internal/config"
)

func TestDefaultConfigIncludesIntelligenceDefaults(t *testing.T) {
	cfg := config.DefaultConfig()

	if cfg.Intelligence.Enabled {
		t.Fatal("intelligence should be disabled by default")
	}
	if len(cfg.Intelligence.Providers) != 0 {
		t.Fatalf("default providers = %d, want 0", len(cfg.Intelligence.Providers))
	}
	if cfg.Intelligence.ActiveProvider != "" {
		t.Fatalf("default activeProvider = %q, want empty", cfg.Intelligence.ActiveProvider)
	}
	if cfg.Intelligence.MaxBytes != 12000 {
		t.Fatalf("default max bytes = %d, want 12000", cfg.Intelligence.MaxBytes)
	}
	if cfg.Intelligence.TimeoutSec != 8 {
		t.Fatalf("default timeout sec = %d, want 8", cfg.Intelligence.TimeoutSec)
	}
	if cfg.Intelligence.MinSessionIntervalSec != 60 {
		t.Fatalf("default min session interval sec = %d, want 60", cfg.Intelligence.MinSessionIntervalSec)
	}
	if cfg.Intelligence.MaxConcurrency != 3 {
		t.Fatalf("default max concurrency = %d, want 3", cfg.Intelligence.MaxConcurrency)
	}
	if cfg.Intelligence.CacheTTLSec != 300 {
		t.Fatalf("default cache ttl sec = %d, want 300", cfg.Intelligence.CacheTTLSec)
	}
}

func TestLoadEnabledIntelligenceConfigWithProviders(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.jsonc")
	content := `{
  "schemaVersion": 1,
  "server": { "bind": "127.0.0.1:7331" },
  "auth": { "token": "" },
  "tmux": { "path": "tmux" },
  "connections": [],
  "ui": { "theme": "dark" },
  "intelligence": {
    "enabled": true,
    "activeProvider": "openai-main",
    "providers": [
      {
        "name": "openai-main",
        "provider": "openai",
        "model": "gpt-4o-mini",
        "apiKey": "test-key",
        "baseURL": "https://api.example.test/v1"
      }
    ]
  }
}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	got := store.Config.Intelligence
	if !got.Enabled {
		t.Fatal("intelligence should be enabled")
	}
	if got.ActiveProvider != "openai-main" {
		t.Fatalf("activeProvider = %q, want openai-main", got.ActiveProvider)
	}
	if len(got.Providers) != 1 {
		t.Fatalf("providers len = %d, want 1", len(got.Providers))
	}
	p := got.Providers[0]
	if p.Name != "openai-main" || p.Provider != "openai" || p.Model != "gpt-4o-mini" || p.APIKey != "test-key" {
		t.Fatalf("unexpected provider fields: %#v", p)
	}
	if p.BaseURL != "https://api.example.test/v1" {
		t.Fatalf("base url = %q", p.BaseURL)
	}
	if got.MaxBytes != 12000 || got.TimeoutSec != 8 || got.MinSessionIntervalSec != 60 || got.MaxConcurrency != 3 || got.CacheTTLSec != 300 {
		t.Fatalf("missing normalized defaults: %#v", got)
	}
}

func TestLoadLegacySingleProviderConfigAutoMigrates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.jsonc")
	content := `{
  "schemaVersion": 1,
  "server": { "bind": "127.0.0.1:7331" },
  "auth": { "token": "" },
  "tmux": { "path": "tmux" },
  "connections": [],
  "ui": { "theme": "dark" },
  "intelligence": {
    "enabled": true,
    "provider": "anthropic",
    "model": "claude-3-5-haiku-latest",
    "apiKey": "legacy-key",
    "baseURL": "https://api.anthropic.test/v1"
  }
}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	got := store.Config.Intelligence
	if len(got.Providers) != 1 {
		t.Fatalf("expected auto-migration to create 1 provider, got %d", len(got.Providers))
	}
	p := got.Providers[0]
	if p.Name != "anthropic" {
		t.Fatalf("migrated provider name = %q, want anthropic", p.Name)
	}
	if p.Provider != "anthropic" || p.Model != "claude-3-5-haiku-latest" || p.APIKey != "legacy-key" {
		t.Fatalf("unexpected migrated provider fields: %#v", p)
	}
	if p.BaseURL != "https://api.anthropic.test/v1" {
		t.Fatalf("migrated base url = %q", p.BaseURL)
	}
	if got.ActiveProvider != "anthropic" {
		t.Fatalf("migrated activeProvider = %q, want anthropic", got.ActiveProvider)
	}
}

func TestLoadLegacyConfigWithoutProviderDoesNotMigrate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.jsonc")
	content := `{
  "schemaVersion": 1,
  "server": { "bind": "127.0.0.1:7331" },
  "auth": { "token": "" },
  "tmux": { "path": "tmux" },
  "connections": [],
  "ui": { "theme": "dark" },
  "intelligence": {
    "enabled": false,
    "provider": "",
    "model": "some-model",
    "apiKey": "key-with-no-provider"
  }
}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	got := store.Config.Intelligence
	if len(got.Providers) != 0 {
		t.Fatalf("expected no migration when provider is empty, got %d providers", len(got.Providers))
	}
	if got.ActiveProvider != "" {
		t.Fatalf("expected no activeProvider when provider is empty, got %q", got.ActiveProvider)
	}
}

func TestLoadEnabledIntelligenceRequiresActiveProvider(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.jsonc")
	content := `{
  "schemaVersion": 1,
  "server": { "bind": "127.0.0.1:7331" },
  "auth": { "token": "" },
  "tmux": { "path": "tmux" },
  "connections": [],
  "ui": { "theme": "dark" },
  "intelligence": {
    "enabled": true,
    "providers": [
      {
        "name": "p1",
        "provider": "openai",
        "model": "gpt-4",
        "apiKey": "key"
      }
    ]
  }
}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if store.Config.Intelligence.ActiveProvider != "p1" {
		t.Fatalf("expected auto-selection of sole provider, got %q", store.Config.Intelligence.ActiveProvider)
	}
}

func TestLoadEnabledIntelligenceRejectsMissingAPIKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.jsonc")
	content := `{
  "schemaVersion": 1,
  "server": { "bind": "127.0.0.1:7331" },
  "auth": { "token": "" },
  "tmux": { "path": "tmux" },
  "connections": [],
  "ui": { "theme": "dark" },
  "intelligence": {
    "enabled": true,
    "activeProvider": "p1",
    "providers": [
      {
        "name": "p1",
        "provider": "anthropic",
        "model": "claude-3-5-haiku-latest",
        "apiKey": ""
      }
    ]
  }
}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	_, err := config.Load(path)
	if err == nil {
		t.Fatal("expected missing api key error")
	}
	if !strings.Contains(err.Error(), "apiKey") {
		t.Fatalf("error %q should mention missing api key", err.Error())
	}
}

func TestValidateIntelligenceRejectsDuplicateProviderNames(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "p1"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
		{Name: "p1", Provider: "anthropic", Model: "claude", APIKey: "key2"},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected duplicate name error")
	}
	if !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("error %q should mention duplicate", err.Error())
	}
}

func TestValidateIntelligenceRejectsInvalidActiveProvider(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "missing"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected active provider not found error")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Fatalf("error %q should mention not found", err.Error())
	}
}

func TestValidateIntelligenceRejectsInvalidBaseURLForProvider(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "p1"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "openai", Model: "gpt-4", APIKey: "key1", BaseURL: "ftp://api.example.test"},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected invalid baseURL error")
	}
	if !strings.Contains(err.Error(), "baseURL") {
		t.Fatalf("error %q should mention baseURL", err.Error())
	}
}

func TestCloneConfigDeepCopiesProviders(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
	}

	cloned := cfg
	cloned.Intelligence.Providers = append([]config.IntelligenceProviderConfig(nil), cfg.Intelligence.Providers...)

	cloned.Intelligence.Providers[0].Name = "modified"
	if cfg.Intelligence.Providers[0].Name != "p1" {
		t.Fatal("modifying cloned provider should not affect original")
	}
}

func TestValidateIntelligenceRejectsInvalidProviderType(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "p1"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "google", Model: "gemini", APIKey: "key1"},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected invalid provider type error")
	}
	if !strings.Contains(err.Error(), "anthropic or openai") {
		t.Fatalf("error %q should mention anthropic or openai", err.Error())
	}
}

func TestValidateIntelligenceRejectsEmptyProviderName(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "valid"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "valid", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
		{Name: "", Provider: "anthropic", Model: "claude", APIKey: "key2"},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected empty name error")
	}
	if !strings.Contains(err.Error(), "name") {
		t.Fatalf("error %q should mention name", err.Error())
	}
}

func TestValidateIntelligenceRejectsEmptyProviderTypeForNonActive(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "p1"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
		{Name: "p2", Provider: "", Model: "claude", APIKey: "key2"},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected empty provider type error for non-active provider")
	}
	if !strings.Contains(err.Error(), "provider type") || !strings.Contains(err.Error(), "p2") {
		t.Fatalf("error %q should mention provider type and p2", err.Error())
	}
}

func TestValidateIntelligenceRejectsEmptyModelForNonActive(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "p1"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
		{Name: "p2", Provider: "anthropic", Model: "", APIKey: "key2"},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected empty model error for non-active provider")
	}
	if !strings.Contains(err.Error(), "model") || !strings.Contains(err.Error(), "p2") {
		t.Fatalf("error %q should mention model and p2", err.Error())
	}
}

func TestValidateIntelligenceRejectsEmptyAPIKeyForNonActive(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "p1"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
		{Name: "p2", Provider: "anthropic", Model: "claude", APIKey: ""},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected empty apiKey error for non-active provider")
	}
	if !strings.Contains(err.Error(), "apiKey") || !strings.Contains(err.Error(), "p2") {
		t.Fatalf("error %q should mention apiKey and p2", err.Error())
	}
}

func TestValidateIntelligenceRejectsEmptyModelForActiveProvider(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "p1"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "openai", Model: "", APIKey: "key1"},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected empty model error for active provider")
	}
	if !strings.Contains(err.Error(), "model") {
		t.Fatalf("error %q should mention model", err.Error())
	}
}

func TestValidateIntelligenceRejectsEmptyAPIKeyForActiveProvider(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "p1"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "openai", Model: "gpt-4", APIKey: ""},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected empty apiKey error for active provider")
	}
	if !strings.Contains(err.Error(), "apiKey") {
		t.Fatalf("error %q should mention apiKey", err.Error())
	}
}

func TestValidateIntelligenceAcceptsHTTPBaseURL(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "p1"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "openai", Model: "gpt-4", APIKey: "key1", BaseURL: "http://api.example.test"},
	}

	err := cfg.ValidateIntelligence()
	if err != nil {
		t.Fatalf("expected http baseURL to be accepted, got: %v", err)
	}
}

func TestValidateIntelligenceRejectsInvalidBaseURLString(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "p1"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "openai", Model: "gpt-4", APIKey: "key1", BaseURL: "not-a-url"},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected invalid baseURL error")
	}
	if !strings.Contains(err.Error(), "baseURL") {
		t.Fatalf("error %q should mention baseURL", err.Error())
	}
}

func TestValidateIntelligenceDisabledBypassesValidation(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = false
	cfg.Intelligence.ActiveProvider = ""
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{}

	err := cfg.ValidateIntelligence()
	if err != nil {
		t.Fatalf("disabled intelligence should bypass validation, got: %v", err)
	}
}

func TestValidateIntelligenceRejectsEmptyProviderTypeForActiveProvider(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "p1"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "", Model: "gpt-4", APIKey: "key1"},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected empty provider type error for active provider")
	}
	if !strings.Contains(err.Error(), "provider type") {
		t.Fatalf("error %q should mention provider type", err.Error())
	}
}

func TestValidateIntelligenceRejectsInvalidBaseURLForNonActiveProvider(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = "p1"
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "p1", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
		{Name: "p2", Provider: "anthropic", Model: "claude", APIKey: "key2", BaseURL: "ftp://bad.example.test"},
	}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected invalid baseURL error for non-active provider")
	}
	if !strings.Contains(err.Error(), "baseURL") || !strings.Contains(err.Error(), "p2") {
		t.Fatalf("error %q should mention baseURL and p2", err.Error())
	}
}

func TestValidateIntelligenceRejectsEmptyProviderListWhenEnabled(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.ActiveProvider = ""
	cfg.Intelligence.Providers = []config.IntelligenceProviderConfig{}

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected empty providers error")
	}
	if !strings.Contains(err.Error(), "at least one") {
		t.Fatalf("error %q should mention at least one provider", err.Error())
	}
}

func TestNormalizeConfigAutoSelectsSoleProvider(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.jsonc")
	if err := os.WriteFile(path, []byte("{}"), 0o600); err != nil {
		t.Fatalf("write empty config: %v", err)
	}

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	store.Config.Intelligence.Enabled = true
	store.Config.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "sole-provider", Provider: "openai", Model: "gpt-4", APIKey: "key1"},
	}

	if err := store.Replace(store.Config); err != nil {
		t.Fatalf("replace config: %v", err)
	}

	if store.Config.Intelligence.ActiveProvider != "sole-provider" {
		t.Fatalf("expected auto-selection of sole provider, got %q", store.Config.Intelligence.ActiveProvider)
	}
}

func TestLoadConfigWithMultipleProviders(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.jsonc")
	content := `{
  "schemaVersion": 1,
  "server": { "bind": "127.0.0.1:7331" },
  "auth": { "token": "" },
  "tmux": { "path": "tmux" },
  "connections": [],
  "ui": { "theme": "dark" },
  "intelligence": {
    "enabled": true,
    "activeProvider": "openai-main",
    "providers": [
      {
        "name": "openai-main",
        "provider": "openai",
        "model": "gpt-4o",
        "apiKey": "key1"
      },
      {
        "name": "anthropic-main",
        "provider": "anthropic",
        "model": "claude-3",
        "apiKey": "key2",
        "baseURL": "https://api.anthropic.test/v1"
      }
    ]
  }
}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	got := store.Config.Intelligence
	if !got.Enabled {
		t.Fatal("intelligence should be enabled")
	}
	if got.ActiveProvider != "openai-main" {
		t.Fatalf("activeProvider = %q, want openai-main", got.ActiveProvider)
	}
	if len(got.Providers) != 2 {
		t.Fatalf("providers len = %d, want 2", len(got.Providers))
	}
	if got.Providers[0].Name != "openai-main" || got.Providers[0].APIKey != "key1" {
		t.Fatalf("unexpected provider 0: %#v", got.Providers[0])
	}
	if got.Providers[1].Name != "anthropic-main" || got.Providers[1].BaseURL != "https://api.anthropic.test/v1" {
		t.Fatalf("unexpected provider 1: %#v", got.Providers[1])
	}
}

func TestLoadConfigIntelligenceDisabledWithEmptyProviders(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.jsonc")
	content := `{
  "schemaVersion": 1,
  "server": { "bind": "127.0.0.1:7331" },
  "auth": { "token": "" },
  "tmux": { "path": "tmux" },
  "connections": [],
  "ui": { "theme": "dark" },
  "intelligence": {
    "enabled": false,
    "providers": []
  }
}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	got := store.Config.Intelligence
	if got.Enabled {
		t.Fatal("intelligence should be disabled")
	}
	if len(got.Providers) != 0 {
		t.Fatalf("providers len = %d, want 0", len(got.Providers))
	}
}

func TestLoadConfigRejectsActiveProviderNotInProviders(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.jsonc")
	content := `{
  "schemaVersion": 1,
  "server": { "bind": "127.0.0.1:7331" },
  "auth": { "token": "" },
  "tmux": { "path": "tmux" },
  "connections": [],
  "ui": { "theme": "dark" },
  "intelligence": {
    "enabled": true,
    "activeProvider": "non-existent",
    "providers": [
      {
        "name": "existing",
        "provider": "openai",
        "model": "gpt-4",
        "apiKey": "key1"
      }
    ]
  }
}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	_, err := config.Load(path)
	if err == nil {
		t.Fatal("expected error when activeProvider references non-existent provider")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Fatalf("error %q should mention not found", err.Error())
	}
}

func TestLoadConfigWithJSONCComments(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.jsonc")
	content := `{
  // This is a comment
  "schemaVersion": 1,
  "server": { "bind": "127.0.0.1:7331" },
  "auth": { "token": "" },
  "tmux": { "path": "tmux" },
  "connections": [],
  "ui": { "theme": "dark" },
  "intelligence": {
    "enabled": true,
    "activeProvider": "main",
    "providers": [
      {
        "name": "main",  // primary provider
        "provider": "anthropic",
        "model": "claude-3",
        "apiKey": "commented-key"
      }
    ]
  }
}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config with JSONC comments: %v", err)
	}

	if store.Config.Intelligence.Providers[0].APIKey != "commented-key" {
		t.Fatalf("expected apiKey commented-key, got %q", store.Config.Intelligence.Providers[0].APIKey)
	}
}

func TestStoreSaveAndReloadWithIntelligenceProviders(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.jsonc")
	if err := os.WriteFile(path, []byte("{}"), 0o600); err != nil {
		t.Fatalf("write empty config: %v", err)
	}

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	store.Config.Intelligence.Enabled = true
	store.Config.Intelligence.ActiveProvider = "main"
	store.Config.Intelligence.Providers = []config.IntelligenceProviderConfig{
		{Name: "main", Provider: "openai", Model: "gpt-4", APIKey: "saved-key"},
	}

	if err := store.Replace(store.Config); err != nil {
		t.Fatalf("save config: %v", err)
	}

	if err := store.Reload(); err != nil {
		t.Fatalf("reload config: %v", err)
	}

	got := store.Config.Intelligence
	if !got.Enabled {
		t.Fatal("intelligence should be enabled after reload")
	}
	if len(got.Providers) != 1 || got.Providers[0].APIKey != "saved-key" {
		t.Fatalf("unexpected providers after reload: %#v", got.Providers)
	}
}
