package server

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/sshclient"
	"github.com/panh/wmux/internal/tmux"
)

type connectionsListResponse struct {
	Data []config.ConnectionConfig `json:"data"`
}

type connectionHealthResponse struct {
	ConnectionID string `json:"connectionId"`
	Status       string `json:"status"`
	CheckedAt    string `json:"checkedAt"`
	ErrorCode    string `json:"errorCode,omitempty"`
	Message      string `json:"message,omitempty"`
}

type connectionHealthListResponse struct {
	Data []connectionHealthResponse `json:"data"`
}

func (s *Server) handleListConnections(w http.ResponseWriter, _ *http.Request) {
	cfg := s.currentConfig()
	s.writeJSON(w, http.StatusOK, connectionsListResponse{Data: cfg.Connections})
}

func (s *Server) handleListConnectionHealth(w http.ResponseWriter, _ *http.Request) {
	cfg := s.currentConfig()
	checker := s.connectionHealthChecker()
	data := make([]connectionHealthResponse, 0, len(cfg.Connections))

	for _, connection := range cfg.Connections {
		data = append(data, checker(connection, cfg.Tmux.Path))
	}

	s.writeJSON(w, http.StatusOK, connectionHealthListResponse{Data: data})
}

func (s *Server) handleCreateConnection(w http.ResponseWriter, r *http.Request) {
	var payload config.ConnectionConfig
	if err := s.decodeJSON(r, &payload); err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", "invalid connection payload")
		return
	}

	if err := validateConnectionPayload(payload); err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	payload.Type = strings.ToLower(strings.TrimSpace(payload.Type))

	if err := s.store.Update(func(cfg *config.Config) error {
		for _, existing := range cfg.Connections {
			if payload.ID != "" && existing.ID == payload.ID {
				return errConnectionConflict
			}
		}

		cfg.Connections = append(cfg.Connections, payload)
		return nil
	}); err != nil {
		s.writeStoreError(w, err)
		return
	}

	connections := s.currentConfig().Connections
	if len(connections) == 0 {
		s.writeError(w, http.StatusInternalServerError, "internal_error", "failed to resolve created connection")
		return
	}

	s.writeJSON(w, http.StatusCreated, connections[len(connections)-1])
}

func (s *Server) handleGetConnection(w http.ResponseWriter, r *http.Request) {
	connectionID := r.PathValue("id")
	connection, ok := s.findConnectionByID(connectionID)
	if !ok {
		s.writeError(w, http.StatusNotFound, "not_found", "connection not found")
		return
	}

	s.writeJSON(w, http.StatusOK, connection)
}

func (s *Server) handleGetConnectionHealth(w http.ResponseWriter, r *http.Request) {
	connectionID := r.PathValue("id")
	connection, ok := s.findConnectionByID(connectionID)
	if !ok {
		s.writeError(w, http.StatusNotFound, "not_found", "connection not found")
		return
	}

	s.writeJSON(w, http.StatusOK, s.connectionHealthChecker()(connection, s.currentConfig().Tmux.Path))
}

func (s *Server) handleUpdateConnection(w http.ResponseWriter, r *http.Request) {
	connectionID := r.PathValue("id")

	var payload config.ConnectionConfig
	if err := s.decodeJSON(r, &payload); err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", "invalid connection payload")
		return
	}
	payload.ID = connectionID

	if err := validateConnectionPayload(payload); err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	payload.Type = strings.ToLower(strings.TrimSpace(payload.Type))

	if err := s.store.Update(func(cfg *config.Config) error {
		for idx, existing := range cfg.Connections {
			if existing.ID == connectionID {
				cfg.Connections[idx] = payload
				return nil
			}
		}

		return errConnectionNotFound
	}); err != nil {
		s.writeStoreError(w, err)
		return
	}

	s.writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleDeleteConnection(w http.ResponseWriter, r *http.Request) {
	connectionID := r.PathValue("id")

	if err := s.store.Update(func(cfg *config.Config) error {
		for idx, existing := range cfg.Connections {
			if existing.ID == connectionID {
				cfg.Connections = append(cfg.Connections[:idx], cfg.Connections[idx+1:]...)
				return nil
			}
		}

		return errConnectionNotFound
	}); err != nil {
		s.writeStoreError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

var (
	errConnectionNotFound = errors.New("connection not found")
	errConnectionConflict = errors.New("connection already exists")
)

func validateConnectionPayload(connection config.ConnectionConfig) error {
	if strings.TrimSpace(connection.Name) == "" {
		return fmt.Errorf("connection name is required")
	}

	connectionType := strings.ToLower(strings.TrimSpace(connection.Type))
	if connectionType != "local" && connectionType != "ssh" {
		return fmt.Errorf("connection type must be local or ssh")
	}

	if connectionType == "ssh" {
		if strings.TrimSpace(connection.Host) == "" {
			return fmt.Errorf("ssh connection host is required")
		}
		if strings.TrimSpace(connection.User) == "" {
			return fmt.Errorf("ssh connection user is required")
		}
	}

	return nil
}

func (s *Server) writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errConnectionNotFound):
		s.writeError(w, http.StatusNotFound, "not_found", err.Error())
	case errors.Is(err, errConnectionConflict), errors.Is(err, config.ErrConfigModified):
		s.writeError(w, http.StatusConflict, "conflict", err.Error())
	default:
		s.writeError(w, http.StatusInternalServerError, "internal_error", "failed to persist configuration")
	}
}

func (s *Server) findConnectionByID(connectionID string) (config.ConnectionConfig, bool) {
	for _, connection := range s.currentConfig().Connections {
		if connection.ID == connectionID {
			return connection, true
		}
	}

	return config.ConnectionConfig{}, false
}

func (s *Server) connectionHealthChecker() func(config.ConnectionConfig, string) connectionHealthResponse {
	if s.checkConnectionHealth != nil {
		return s.checkConnectionHealth
	}

	return checkConnectionHealth
}

func checkConnectionHealth(conn config.ConnectionConfig, tmuxPath string) connectionHealthResponse {
	checkedAt := time.Now().UTC().Format(time.RFC3339)
	response := connectionHealthResponse{
		ConnectionID: conn.ID,
		CheckedAt:    checkedAt,
	}

	switch strings.ToLower(strings.TrimSpace(conn.Type)) {
	case "local":
		if err := tmux.DetectBinary(tmuxPath); err != nil {
			return connectionHealthOfflineResponse(response, err)
		}

		if _, err := tmux.NewAdapter(tmuxPath).ListSessions(); err != nil {
			if code := errorCode(err); code == tmux.ErrorCodeNoSessions {
				response.Status = "online"
				return response
			}
			return connectionHealthOfflineResponse(response, err)
		}

		response.Status = "online"
		return response
	case "ssh":
		client := sshclient.New(sshclient.Config{
			Host:           conn.Host,
			Port:           conn.Port,
			User:           conn.User,
			PrivateKeyPath: conn.PrivateKeyPath,
			KnownHostsPath: conn.KnownHostsPath,
		})
		if err := client.Connect(); err != nil {
			return connectionHealthOfflineResponse(response, err)
		}
		defer func() { _ = client.Close() }()

		response.Status = "online"
		return response
	default:
		response.Status = "offline"
		response.ErrorCode = "unsupported_connection_type"
		response.Message = fmt.Sprintf("unsupported connection type %q", conn.Type)
		return response
	}
}

func connectionHealthOfflineResponse(response connectionHealthResponse, err error) connectionHealthResponse {
	response.Status = "offline"
	response.ErrorCode = errorCode(err)
	response.Message = err.Error()
	return response
}

func errorCode(err error) string {
	var tmuxErr *tmux.Error
	if errors.As(err, &tmuxErr) && tmuxErr != nil {
		return tmuxErr.Code
	}

	var sshErr *sshclient.Error
	if errors.As(err, &sshErr) && sshErr != nil {
		return sshErr.Code
	}

	return "unknown_error"
}
