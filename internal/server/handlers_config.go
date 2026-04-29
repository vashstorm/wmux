package server

import (
	"errors"
	"net/http"
	"strings"

	"github.com/panh/wmux/internal/config"
)

type configResponse struct {
	config.Config
	Auth configAuthResponse `json:"auth"`
}

type configAuthResponse struct {
	Token           string `json:"token"`
	TokenConfigured bool   `json:"tokenConfigured"`
}

func newConfigResponse(cfg config.Config) configResponse {
	return configResponse{
		Config: SanitizeConfig(cfg),
		Auth: configAuthResponse{
			Token:           "",
			TokenConfigured: strings.TrimSpace(cfg.Auth.Token) != "",
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
