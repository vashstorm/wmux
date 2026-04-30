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
	if cfg.Intelligence.Provider != "" {
		t.Fatalf("default provider = %q, want empty", cfg.Intelligence.Provider)
	}
	if cfg.Intelligence.Model != "" {
		t.Fatalf("default model = %q, want empty", cfg.Intelligence.Model)
	}
	if cfg.Intelligence.APIKey != "" {
		t.Fatalf("default api key = %q, want empty", cfg.Intelligence.APIKey)
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

func TestLoadEnabledIntelligenceConfig(t *testing.T) {
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
	    "provider": "openai",
	    "model": "gpt-4o-mini",
	    "apiKey": "test-key",
	    "baseURL": "https://api.example.test/v1"
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
	if got.Provider != "openai" || got.Model != "gpt-4o-mini" || got.APIKey != "test-key" {
		t.Fatalf("unexpected intelligence identity fields: %#v", got)
	}
	if got.BaseURL != "https://api.example.test/v1" {
		t.Fatalf("base url = %q", got.BaseURL)
	}
	if got.MaxBytes != 12000 || got.TimeoutSec != 8 || got.MinSessionIntervalSec != 60 || got.MaxConcurrency != 3 || got.CacheTTLSec != 300 {
		t.Fatalf("missing normalized defaults: %#v", got)
	}
}

func TestLoadEnabledIntelligenceRequiresAPIKey(t *testing.T) {
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
	    "apiKey": ""
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

func TestValidateIntelligenceRejectsInvalidBaseURL(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Intelligence.Enabled = true
	cfg.Intelligence.Provider = "openai"
	cfg.Intelligence.Model = "gpt-4o-mini"
	cfg.Intelligence.APIKey = "test-key"
	cfg.Intelligence.BaseURL = "ftp://api.example.test"

	err := cfg.ValidateIntelligence()
	if err == nil {
		t.Fatal("expected invalid baseURL error")
	}
	if !strings.Contains(err.Error(), "baseURL") {
		t.Fatalf("error %q should mention baseURL", err.Error())
	}
}
