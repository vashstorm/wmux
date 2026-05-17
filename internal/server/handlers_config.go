package server

import (
	"errors"
	"net/http"
	"strings"

	"github.com/panh/wmux/internal/config"
)

type configResponse struct {
	config.Config
	Auth         configAuthResponse         `json:"auth"`
	Intelligence configIntelligenceResponse `json:"intelligence"`
}

type configAuthResponse struct {
	Token           string `json:"token"`
	TokenConfigured bool   `json:"tokenConfigured"`
}

type configIntelligenceProviderResponse struct {
	Name             string `json:"name"`
	Provider         string `json:"provider"`
	Model            string `json:"model"`
	BaseURL          string `json:"baseURL,omitempty"`
	APIKeyConfigured bool   `json:"apiKeyConfigured"`
}

type configIntelligenceResponse struct {
	Enabled               bool                                 `json:"enabled"`
	ActiveProvider        string                               `json:"activeProvider,omitempty"`
	Providers             []configIntelligenceProviderResponse `json:"providers,omitempty"`
	MaxBytes              int                                  `json:"maxBytes,omitempty"`
	TimeoutSec            int                                  `json:"timeoutSec,omitempty"`
	MinSessionIntervalSec int                                  `json:"minSessionIntervalSec,omitempty"`
	MaxConcurrency        int                                  `json:"maxConcurrency,omitempty"`
	CacheTTLSec           int                                  `json:"cacheTTLSec,omitempty"`
}

func newConfigResponse(cfg config.Config) configResponse {
	sanitized := SanitizeConfig(cfg)

	providers := make([]configIntelligenceProviderResponse, len(sanitized.Intelligence.Providers))
	for i, p := range sanitized.Intelligence.Providers {
		providers[i] = configIntelligenceProviderResponse{
			Name:             p.Name,
			Provider:         p.Provider,
			Model:            p.Model,
			BaseURL:          p.BaseURL,
			APIKeyConfigured: strings.TrimSpace(cfg.Intelligence.Providers[i].APIKey) != "",
		}
	}

	return configResponse{
		Config: sanitized,
		Auth: configAuthResponse{
			Token:           "",
			TokenConfigured: strings.TrimSpace(cfg.Auth.Token) != "",
		},
		Intelligence: configIntelligenceResponse{
			Enabled:               sanitized.Intelligence.Enabled,
			ActiveProvider:        sanitized.Intelligence.ActiveProvider,
			Providers:             providers,
			MaxBytes:              sanitized.Intelligence.MaxBytes,
			TimeoutSec:            sanitized.Intelligence.TimeoutSec,
			MinSessionIntervalSec: sanitized.Intelligence.MinSessionIntervalSec,
			MaxConcurrency:        sanitized.Intelligence.MaxConcurrency,
			CacheTTLSec:           sanitized.Intelligence.CacheTTLSec,
		},
	}
}

func (s *Server) handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	s.writeJSON(w, http.StatusOK, newConfigResponse(s.currentConfig()))
}

func (s *Server) handleUpdateConfig(w http.ResponseWriter, r *http.Request) {
	var payload config.Config
	if err := s.decodeJSON(r, &payload); err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", "invalid config payload")
		return
	}

	current := s.currentConfig()
	if strings.TrimSpace(payload.Auth.Token) == "" {
		payload.Auth.Token = current.Auth.Token
	}

	// Build a set of provider names in the new payload to detect renames.
	newNames := make(map[string]bool, len(payload.Intelligence.Providers))
	for _, p := range payload.Intelligence.Providers {
		newNames[strings.TrimSpace(p.Name)] = true
	}

	// existingMatched tracks which existing providers have been consumed.
	existingMatched := make(map[string]bool, len(current.Intelligence.Providers))

	for i := range payload.Intelligence.Providers {
		if strings.TrimSpace(payload.Intelligence.Providers[i].APIKey) == "" {
			matched := false

			// First pass: direct name match (regular edit, no rename).
			for _, existing := range current.Intelligence.Providers {
				if existing.Name == payload.Intelligence.Providers[i].Name {
					payload.Intelligence.Providers[i].APIKey = existing.APIKey
					existingMatched[existing.Name] = true
					matched = true
					break
				}
			}
			if matched {
				continue
			}

			// Second pass: the provider may have been renamed. Find an existing
			// provider whose name is NOT present in the new payload (it was
			// either deleted or renamed to the current provider's name).
			for _, existing := range current.Intelligence.Providers {
				if existingMatched[existing.Name] {
					continue
				}
				if strings.TrimSpace(existing.APIKey) == "" {
					continue
				}
				if !newNames[existing.Name] {
					payload.Intelligence.Providers[i].APIKey = existing.APIKey
					existingMatched[existing.Name] = true
					break
				}
			}
		}
	}

	if err := payload.ValidateAuth(); err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}

	if err := s.store.Replace(payload); err != nil {
		if errors.Is(err, config.ErrConfigModified) {
			_ = s.store.Reload()
		}
		s.writeStoreError(w, err)
		return
	}

	s.writeJSON(w, http.StatusOK, newConfigResponse(s.currentConfig()))
}
