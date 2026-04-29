package config_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/panh/wmux/internal/config"
)

func TestDefaultConfig(t *testing.T) {
	cfg := config.DefaultConfig()

	if cfg.Server.Bind != "127.0.0.1:7331" {
		t.Fatalf("unexpected bind address: %q", cfg.Server.Bind)
	}

	if cfg.Tmux.Path != "tmux" {
		t.Fatalf("unexpected tmux path: %q", cfg.Tmux.Path)
	}

	if cfg.UI.Theme != "dark" {
		t.Fatalf("unexpected theme: %q", cfg.UI.Theme)
	}
}

func TestLoadFromExistingFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.jsonc")

	content := `{
	  // Server settings
	  "schemaVersion": 2,
	  "server": {
	    "bind": "0.0.0.0:7331"
	  },
	  "auth": {
	    "token": "secret-token"
	  },
	  "tmux": {
	    "path": "/opt/homebrew/bin/tmux"
	  },
	  "connections": [
	    {
	      "name": "Remote",
	      "type": "ssh",
	      "host": "example.com",
	      "port": 22,
	      "user": "alice",
	      "privateKeyPath": "~/.ssh/id_ed25519"
	    }
	  ],
	  "ui": {
	    "theme": "light"
	  }
	}`

	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if store.Config.SchemaVersion != 2 {
		t.Fatalf("unexpected schema version: %d", store.Config.SchemaVersion)
	}
	if store.Config.Server.Bind != "0.0.0.0:7331" {
		t.Fatalf("unexpected bind: %q", store.Config.Server.Bind)
	}
	if store.Config.Auth.Token != "secret-token" {
		t.Fatalf("unexpected auth token")
	}
	if len(store.Config.Connections) != 1 {
		t.Fatalf("unexpected connection count: %d", len(store.Config.Connections))
	}
	if store.Config.Connections[0].ID == "" {
		t.Fatal("expected generated connection id")
	}
	if store.Config.Connections[0].KnownHostsPath != "~/.ssh/known_hosts" {
		t.Fatalf("unexpected known hosts path: %q", store.Config.Connections[0].KnownHostsPath)
	}
}

func TestLoadCreatesDefaultWhenMissing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.jsonc")

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("stat config file: %v", err)
	}

	if store.Config.Server.Bind != "127.0.0.1:7331" {
		t.Fatalf("unexpected bind: %q", store.Config.Server.Bind)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read config file: %v", err)
	}

	var cfg config.Config
	if err := json.Unmarshal(content, &cfg); err != nil {
		t.Fatalf("decode config file: %v", err)
	}
}

func TestSaveWritesValidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.jsonc")

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	store.Config.Auth.Token = "local-token"
	store.Config.Connections = []config.ConnectionConfig{{
		Name:           "Remote",
		Type:           "ssh",
		Host:           "example.com",
		Port:           22,
		User:           "alice",
		PrivateKeyPath: "~/.ssh/id_ed25519",
	}}

	if err := store.Save(); err != nil {
		t.Fatalf("save config: %v", err)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read config file: %v", err)
	}

	if !json.Valid(content) {
		t.Fatal("saved config is not valid JSON")
	}
	if strings.Contains(string(content), "//") {
		t.Fatal("saved config should not preserve comments")
	}

	var cfg config.Config
	if err := json.Unmarshal(content, &cfg); err != nil {
		t.Fatalf("decode saved config: %v", err)
	}
	if len(cfg.Connections) != 1 {
		t.Fatalf("unexpected connection count: %d", len(cfg.Connections))
	}
	if cfg.Connections[0].ID == "" {
		t.Fatal("expected generated connection id")
	}
	if cfg.Connections[0].KnownHostsPath != "~/.ssh/known_hosts" {
		t.Fatalf("unexpected known hosts path: %q", cfg.Connections[0].KnownHostsPath)
	}
}

func TestSaveDetectsMtimeConflict(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.jsonc")

	store, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	updated := []byte(`{"schemaVersion":1,"server":{"bind":"127.0.0.1:7331"},"auth":{"token":"changed"},"tmux":{"path":"tmux"},"connections":[],"ui":{"theme":"dark"}}`)
	if err := os.WriteFile(path, updated, 0o600); err != nil {
		t.Fatalf("overwrite config file: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat config file: %v", err)
	}
	futureTime := info.ModTime().Add(2 * time.Second)
	if err := os.Chtimes(path, futureTime, futureTime); err != nil {
		t.Fatalf("set config file mtime: %v", err)
	}

	store.Config.UI.Theme = "light"
	err = store.Save()
	if !errors.Is(err, config.ErrConfigModified) {
		t.Fatalf("expected ErrConfigModified, got %v", err)
	}
}

func TestValidateAuthRejectsNonLocalhostWithoutToken(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Server.Bind = "0.0.0.0:7331"
	cfg.Auth.Token = ""

	err := cfg.ValidateAuth()
	if !errors.Is(err, config.ErrAuthTokenRequired) {
		t.Fatalf("expected ErrAuthTokenRequired, got %v", err)
	}
}

func TestValidateAuthAllowsLocalhostWithoutToken(t *testing.T) {
	tests := []string{"127.0.0.1:7331", "localhost:7331", "[::1]:7331"}

	for _, bind := range tests {
		t.Run(bind, func(t *testing.T) {
			cfg := config.DefaultConfig()
			cfg.Server.Bind = bind
			cfg.Auth.Token = ""

			if err := cfg.ValidateAuth(); err != nil {
				t.Fatalf("validate auth: %v", err)
			}
		})
	}
}

func TestConfigNeverSerializesSensitiveFields(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		ID:             "remote-1",
		Name:           "Remote",
		Type:           "ssh",
		Host:           "example.com",
		Port:           22,
		User:           "alice",
		PrivateKeyPath: "~/.ssh/id_ed25519",
		KnownHostsPath: "~/.ssh/known_hosts",
	}}

	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}

	serialized := string(data)
	for _, forbiddenKey := range []string{"\"password\":", "\"privateKey\":", "\"passphrase\":"} {
		if strings.Contains(serialized, forbiddenKey) {
			t.Fatalf("config serialized forbidden key %s", forbiddenKey)
		}
	}
	if !strings.Contains(serialized, "\"privateKeyPath\":") {
		t.Fatal("expected privateKeyPath to be serialized")
	}
}

func TestExpandedExpandsSSHPaths(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	cfg := config.DefaultConfig()
	cfg.Connections = []config.ConnectionConfig{{
		Name:           "Remote",
		Type:           "ssh",
		PrivateKeyPath: "~/.ssh/id_ed25519",
		KnownHostsPath: "~/.ssh/known_hosts",
	}}

	expanded, err := cfg.Expanded()
	if err != nil {
		t.Fatalf("expand config: %v", err)
	}

	if expanded.Connections[0].PrivateKeyPath != filepath.Join(homeDir, ".ssh", "id_ed25519") {
		t.Fatalf("unexpected private key path: %q", expanded.Connections[0].PrivateKeyPath)
	}
	if expanded.Connections[0].KnownHostsPath != filepath.Join(homeDir, ".ssh", "known_hosts") {
		t.Fatalf("unexpected known hosts path: %q", expanded.Connections[0].KnownHostsPath)
	}
}
