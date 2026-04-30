package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	jsonc "github.com/marcozac/go-jsonc"
)

const (
	defaultConfigFileName = "config.jsonc"
	defaultKnownHostsPath = "~/.ssh/known_hosts"
)

var (
	ErrConfigModified    = errors.New("config file changed on disk")
	ErrAuthTokenRequired = errors.New("auth token is required for non-localhost bind address")
)

type Config struct {
	SchemaVersion int                `json:"schemaVersion"`
	Server        ServerConfig       `json:"server"`
	Auth          AuthConfig         `json:"auth"`
	Tmux          TmuxConfig         `json:"tmux"`
	Connections   []ConnectionConfig `json:"connections"`
	UI            UIConfig           `json:"ui"`
	Intelligence  IntelligenceConfig `json:"intelligence"`
}

type ServerConfig struct {
	Bind string `json:"bind"`
}

type AuthConfig struct {
	Token string `json:"token"`
}

type TmuxConfig struct {
	Path string `json:"path"`
}

type ConnectionConfig struct {
	ID             string `json:"id"`
	Type           string `json:"type"`
	Host           string `json:"host,omitempty"`
	Port           int    `json:"port,omitempty"`
	User           string `json:"user,omitempty"`
	PrivateKeyPath string `json:"privateKeyPath,omitempty"`
	KnownHostsPath string `json:"knownHostsPath,omitempty"`
}

type UIConfig struct {
	Theme              string `json:"theme"`
	FontSize           int    `json:"fontSize"`
	TerminalFontSize   int    `json:"terminalFontSize"`
	TerminalFontWeight string `json:"terminalFontWeight"`
}

type IntelligenceConfig struct {
	Enabled               bool   `json:"enabled"`
	Provider              string `json:"provider,omitempty"`
	Model                 string `json:"model,omitempty"`
	APIKey                string `json:"apiKey,omitempty"`
	BaseURL               string `json:"baseURL,omitempty"`
	MaxBytes              int    `json:"maxBytes,omitempty"`
	TimeoutSec            int    `json:"timeoutSec,omitempty"`
	MinSessionIntervalSec int    `json:"minSessionIntervalSec,omitempty"`
	MaxConcurrency        int    `json:"maxConcurrency,omitempty"`
	CacheTTLSec           int    `json:"cacheTTLSec,omitempty"`
}

type Store struct {
	mu      sync.Mutex
	path    string
	modTime time.Time
	Config  Config
}

func (s *Store) Snapshot() Config {
	s.mu.Lock()
	defer s.mu.Unlock()

	return cloneConfig(s.Config)
}

func (s *Store) Replace(cfg Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.Config = cloneConfig(cfg)
	return s.saveLocked()
}

func (s *Store) Update(update func(*Config) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	next := cloneConfig(s.Config)
	if err := update(&next); err != nil {
		return err
	}

	s.Config = next
	return s.saveLocked()
}

func DefaultConfig() Config {
	cfg := Config{
		SchemaVersion: 1,
		Server: ServerConfig{
			Bind: "127.0.0.1:7331",
		},
		Auth: AuthConfig{},
		Tmux: TmuxConfig{
			Path: "tmux",
		},
		Connections: []ConnectionConfig{},
		UI: UIConfig{
			Theme:              "dark",
			FontSize:           16,
			TerminalFontSize:   14,
			TerminalFontWeight: "normal",
		},
		Intelligence: IntelligenceConfig{
			MaxBytes:              12000,
			TimeoutSec:            8,
			MinSessionIntervalSec: 60,
			MaxConcurrency:        3,
			CacheTTLSec:           300,
		},
	}

	normalizeConfig(&cfg)
	return cfg
}

func Load(path string) (*Store, error) {
	resolvedPath, err := resolvePath(path)
	if err != nil {
		return nil, err
	}

	if _, err := os.Stat(resolvedPath); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("stat config: %w", err)
		}

		store := &Store{
			path:   resolvedPath,
			Config: DefaultConfig(),
		}
		if err := store.Save(); err != nil {
			return nil, err
		}
		return store, nil
	}

	cfg, modTime, err := loadConfigFile(resolvedPath)
	if err != nil {
		return nil, err
	}

	return &Store{
		path:    resolvedPath,
		modTime: modTime,
		Config:  cfg,
	}, nil
}

func (s *Store) Save() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.saveLocked()
}

func (s *Store) saveLocked() error {

	normalizeConfig(&s.Config)

	info, err := os.Stat(s.path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("stat config before save: %w", err)
		}
		if !s.modTime.IsZero() {
			return ErrConfigModified
		}
	} else {
		if s.modTime.IsZero() || !info.ModTime().Equal(s.modTime) {
			return ErrConfigModified
		}
	}

	data, err := marshalConfig(s.Config)
	if err != nil {
		return err
	}

	tmpPath := fmt.Sprintf("%s.tmp.%s", s.path, randomHex(8))
	fileMode := os.FileMode(0o600)
	if info != nil {
		fileMode = info.Mode().Perm()
	}

	file, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, fileMode)
	if err != nil {
		return fmt.Errorf("create temp config: %w", err)
	}

	renamed := false
	defer func() {
		_ = file.Close()
		if !renamed {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := file.Write(data); err != nil {
		return fmt.Errorf("write temp config: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync temp config: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close temp config: %w", err)
	}

	syscall.Sync()

	if err := os.Rename(tmpPath, s.path); err != nil {
		return fmt.Errorf("replace config: %w", err)
	}
	renamed = true

	if err := syncDirectory(filepath.Dir(s.path)); err != nil {
		return err
	}

	updatedInfo, err := os.Stat(s.path)
	if err != nil {
		return fmt.Errorf("stat config after save: %w", err)
	}

	s.modTime = updatedInfo.ModTime()
	return nil
}

func (s *Store) Reload() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg, modTime, err := loadConfigFile(s.path)
	if err != nil {
		return err
	}

	s.Config = cfg
	s.modTime = modTime
	return nil
}

func (c Config) ValidateAuth() error {
	if c.IsLocalhostBind() {
		return nil
	}
	if strings.TrimSpace(c.Auth.Token) == "" {
		return ErrAuthTokenRequired
	}
	return nil
}

func (c Config) ValidateIntelligence() error {
	if !c.Intelligence.Enabled {
		return nil
	}

	provider := strings.TrimSpace(c.Intelligence.Provider)
	if provider == "" {
		return errors.New("intelligence provider is required when enabled")
	}
	if provider != "anthropic" && provider != "openai" {
		return fmt.Errorf("intelligence provider must be anthropic or openai, got %q", provider)
	}

	if strings.TrimSpace(c.Intelligence.Model) == "" {
		return errors.New("intelligence model is required when enabled")
	}

	apiKey := strings.TrimSpace(c.Intelligence.APIKey)
	if apiKey == "" {
		return errors.New("intelligence apiKey is required when enabled")
	}

	baseURL := strings.TrimSpace(c.Intelligence.BaseURL)
	if baseURL != "" {
		parsed, err := url.Parse(baseURL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return fmt.Errorf("intelligence baseURL must be a valid http or https URL")
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return fmt.Errorf("intelligence baseURL must use http or https")
		}
	}

	return nil
}

func (c Config) IsLocalhostBind() bool {
	host := extractBindHost(c.Server.Bind)
	if host == "" {
		return false
	}

	if strings.EqualFold(host, "localhost") {
		return true
	}

	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}

	return ip.String() == "127.0.0.1" || ip.String() == "::1"
}

func (c Config) Expanded() (Config, error) {
	expanded := cloneConfig(c)

	for i := range expanded.Connections {
		privateKeyPath, err := expandUserPath(expanded.Connections[i].PrivateKeyPath)
		if err != nil {
			return Config{}, fmt.Errorf("expand privateKeyPath for connection %q: %w", expanded.Connections[i].ID, err)
		}
		expanded.Connections[i].PrivateKeyPath = privateKeyPath

		knownHostsPath, err := expandUserPath(expanded.Connections[i].KnownHostsPath)
		if err != nil {
			return Config{}, fmt.Errorf("expand knownHostsPath for connection %q: %w", expanded.Connections[i].ID, err)
		}
		expanded.Connections[i].KnownHostsPath = knownHostsPath
	}

	return expanded, nil
}

func loadConfigFile(path string) (Config, time.Time, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, time.Time{}, fmt.Errorf("read config: %w", err)
	}

	cfg, err := parseConfig(data)
	if err != nil {
		return Config{}, time.Time{}, err
	}

	info, err := os.Stat(path)
	if err != nil {
		return Config{}, time.Time{}, fmt.Errorf("stat config: %w", err)
	}

	return cfg, info.ModTime(), nil
}

func parseConfig(data []byte) (Config, error) {
	cfg := DefaultConfig()
	if len(strings.TrimSpace(string(data))) == 0 {
		return cfg, nil
	}

	cleanData := data
	if jsonc.HasCommentRunes(data) {
		var err error
		cleanData, err = jsonc.Sanitize(data)
		if err != nil {
			return Config{}, fmt.Errorf("sanitize config: %w", err)
		}
	}

	if err := json.Unmarshal(cleanData, &cfg); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}

	normalizeConfig(&cfg)
	if err := cfg.ValidateIntelligence(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func marshalConfig(cfg Config) ([]byte, error) {
	normalizeConfig(&cfg)
	if err := cfg.ValidateIntelligence(); err != nil {
		return nil, err
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode config: %w", err)
	}

	return append(data, '\n'), nil
}

const (
	minUIFontSize       = 12
	maxUIFontSize       = 24
	minTerminalFontSize = 8
	maxTerminalFontSize = 32
)

var validTerminalFontWeights = []string{"normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"}

func normalizeConfig(cfg *Config) {
	for i := range cfg.Connections {
		if strings.TrimSpace(cfg.Connections[i].ID) == "" {
			cfg.Connections[i].ID = randomHex(16)
		}
		if strings.EqualFold(cfg.Connections[i].Type, "ssh") && strings.TrimSpace(cfg.Connections[i].KnownHostsPath) == "" {
			cfg.Connections[i].KnownHostsPath = defaultKnownHostsPath
		}
	}

	if cfg.UI.FontSize == 0 {
		cfg.UI.FontSize = 16
	}
	if cfg.UI.FontSize < minUIFontSize {
		cfg.UI.FontSize = minUIFontSize
	}
	if cfg.UI.FontSize > maxUIFontSize {
		cfg.UI.FontSize = maxUIFontSize
	}

	if cfg.UI.TerminalFontSize == 0 {
		cfg.UI.TerminalFontSize = 14
	}
	if cfg.UI.TerminalFontSize < minTerminalFontSize {
		cfg.UI.TerminalFontSize = minTerminalFontSize
	}
	if cfg.UI.TerminalFontSize > maxTerminalFontSize {
		cfg.UI.TerminalFontSize = maxTerminalFontSize
	}

	if cfg.UI.TerminalFontWeight == "" {
		cfg.UI.TerminalFontWeight = "normal"
	}
	weightValid := false
	for _, w := range validTerminalFontWeights {
		if cfg.UI.TerminalFontWeight == w {
			weightValid = true
			break
		}
	}
	if !weightValid {
		cfg.UI.TerminalFontWeight = "normal"
	}

	if cfg.Intelligence.MaxBytes == 0 {
		cfg.Intelligence.MaxBytes = 12000
	}
	if cfg.Intelligence.TimeoutSec == 0 {
		cfg.Intelligence.TimeoutSec = 8
	}
	if cfg.Intelligence.MinSessionIntervalSec == 0 {
		cfg.Intelligence.MinSessionIntervalSec = 60
	}
	if cfg.Intelligence.MaxConcurrency == 0 {
		cfg.Intelligence.MaxConcurrency = 3
	}
	if cfg.Intelligence.CacheTTLSec == 0 {
		cfg.Intelligence.CacheTTLSec = 300
	}
}

func cloneConfig(cfg Config) Config {
	cloned := cfg
	if cfg.Connections == nil {
		cloned.Connections = []ConnectionConfig{}
		return cloned
	}

	cloned.Connections = append([]ConnectionConfig(nil), cfg.Connections...)
	return cloned
}

func resolvePath(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", fmt.Errorf("get working directory: %w", err)
		}
		path = filepath.Join(cwd, defaultConfigFileName)
	}

	resolvedPath, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve config path: %w", err)
	}

	return resolvedPath, nil
}

func expandUserPath(path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" || trimmed == "~" {
		if trimmed == "~" {
			homeDir, err := os.UserHomeDir()
			if err != nil {
				return "", fmt.Errorf("resolve home directory: %w", err)
			}
			return homeDir, nil
		}
		return path, nil
	}

	if !strings.HasPrefix(trimmed, "~/") {
		return path, nil
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}

	return filepath.Join(homeDir, strings.TrimPrefix(trimmed, "~/")), nil
}

func extractBindHost(bind string) string {
	trimmed := strings.TrimSpace(bind)
	if trimmed == "" {
		return ""
	}

	host, _, err := net.SplitHostPort(trimmed)
	if err == nil {
		return strings.Trim(host, "[]")
	}

	if !strings.Contains(trimmed, ":") {
		return strings.Trim(trimmed, "[]")
	}

	return ""
}

func syncDirectory(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open config directory: %w", err)
	}
	defer dir.Close()

	if err := dir.Sync(); err != nil {
		return fmt.Errorf("sync config directory: %w", err)
	}

	return nil
}

func randomHex(byteLen int) string {
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Errorf("read random bytes: %w", err))
	}
	return hex.EncodeToString(buf)
}
