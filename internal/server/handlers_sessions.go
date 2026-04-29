package server

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/panh/wmux/internal/sshclient"
	"github.com/panh/wmux/internal/tmux"
)

type sessionsListResponse struct {
	ConnectionID string         `json:"connectionId"`
	Mode         string         `json:"mode"`
	AdapterPath  string         `json:"adapterPath,omitempty"`
	Data         []tmux.Session `json:"data"`
}

type windowsListResponse struct {
	ConnectionID string        `json:"connectionId"`
	Session      string        `json:"session"`
	Mode         string        `json:"mode"`
	AdapterPath  string        `json:"adapterPath,omitempty"`
	Data         []tmux.Window `json:"data"`
}

type panesListResponse struct {
	ConnectionID string      `json:"connectionId"`
	Session      string      `json:"session"`
	Window       string      `json:"window"`
	Mode         string      `json:"mode"`
	AdapterPath  string      `json:"adapterPath,omitempty"`
	Data         []tmux.Pane `json:"data"`
}

type namedRequest struct {
	Name string `json:"name"`
}

type splitPaneRequest struct {
	Horizontal bool `json:"horizontal"`
}

type sessionOperationResponse struct {
	ConnectionID string       `json:"connectionId"`
	Operation    string       `json:"operation"`
	Mode         string       `json:"mode"`
	AdapterPath  string       `json:"adapterPath,omitempty"`
	Data         tmux.Session `json:"data"`
}

type windowOperationResponse struct {
	ConnectionID string      `json:"connectionId"`
	Session      string      `json:"session"`
	Operation    string      `json:"operation"`
	Mode         string      `json:"mode"`
	AdapterPath  string      `json:"adapterPath,omitempty"`
	Data         tmux.Window `json:"data"`
}

type paneOperationResponse struct {
	ConnectionID string    `json:"connectionId"`
	Session      string    `json:"session"`
	Window       string    `json:"window"`
	Operation    string    `json:"operation"`
	Mode         string    `json:"mode"`
	AdapterPath  string    `json:"adapterPath,omitempty"`
	Data         tmux.Pane `json:"data"`
}

type operationResponse struct {
	ConnectionID string `json:"connectionId"`
	Session      string `json:"session,omitempty"`
	Window       string `json:"window,omitempty"`
	Pane         string `json:"pane,omitempty"`
	Operation    string `json:"operation"`
	Mode         string `json:"mode"`
	AdapterPath  string `json:"adapterPath,omitempty"`
	Status       string `json:"status"`
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.findConnectionByID(r.PathValue("id"))
	if !ok {
		s.writeError(w, http.StatusNotFound, "not_found", "connection not found")
		return
	}

	response := sessionsListResponse{
		ConnectionID: connection.ID,
		Mode:         connection.Type,
		Data:         []tmux.Session{},
	}

	switch connection.Type {
	case "local":
		adapter := tmux.NewAdapter(s.currentConfig().Tmux.Path)
		response.AdapterPath = adapter.Path

		sessions, err := adapter.ListSessions()
		if err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
		response.Data = sessions
	case "ssh":
		client := sshclient.New(sshclient.Config{
			Host:           connection.Host,
			Port:           connection.Port,
			User:           connection.User,
			PrivateKeyPath: connection.PrivateKeyPath,
			KnownHostsPath: connection.KnownHostsPath,
		})
		defer func() { _ = client.Close() }()

		remote := sshclient.NewRemote(&client)
		sessions, err := remote.ListSessions()
		if err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
		response.Data = sessions
	default:
		s.writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("unsupported connection type %q", connection.Type))
		return
	}

	s.writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleListWindows(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.findConnectionByID(r.PathValue("id"))
	if !ok {
		s.writeError(w, http.StatusNotFound, "not_found", "connection not found")
		return
	}

	sessionName := r.PathValue("session")
	response := windowsListResponse{
		ConnectionID: connection.ID,
		Session:      sessionName,
		Mode:         connection.Type,
		Data:         []tmux.Window{},
	}

	switch connection.Type {
	case "local":
		adapter := tmux.NewAdapter(s.currentConfig().Tmux.Path)
		response.AdapterPath = adapter.Path

		windows, err := adapter.ListWindows(sessionName)
		if err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
		response.Data = windows
	case "ssh":
		client := sshclient.New(sshclient.Config{
			Host:           connection.Host,
			Port:           connection.Port,
			User:           connection.User,
			PrivateKeyPath: connection.PrivateKeyPath,
			KnownHostsPath: connection.KnownHostsPath,
		})
		defer func() { _ = client.Close() }()

		remote := sshclient.NewRemote(&client)
		windows, err := remote.ListWindows(sessionName)
		if err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
		response.Data = windows
	default:
		s.writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("unsupported connection type %q", connection.Type))
		return
	}

	s.writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleListPanes(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.findConnectionByID(r.PathValue("id"))
	if !ok {
		s.writeError(w, http.StatusNotFound, "not_found", "connection not found")
		return
	}

	sessionName := r.PathValue("session")
	windowName := r.PathValue("window")
	response := panesListResponse{
		ConnectionID: connection.ID,
		Session:      sessionName,
		Window:       windowName,
		Mode:         connection.Type,
		Data:         []tmux.Pane{},
	}

	switch connection.Type {
	case "local":
		adapter := tmux.NewAdapter(s.currentConfig().Tmux.Path)
		response.AdapterPath = adapter.Path

		panes, err := adapter.ListPanes(sessionName, windowName)
		if err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
		response.Data = panes
	case "ssh":
		client := sshclient.New(sshclient.Config{
			Host:           connection.Host,
			Port:           connection.Port,
			User:           connection.User,
			PrivateKeyPath: connection.PrivateKeyPath,
			KnownHostsPath: connection.KnownHostsPath,
		})
		defer func() { _ = client.Close() }()

		remote := sshclient.NewRemote(&client)
		panes, err := remote.ListPanes(buildWindowTarget(sessionName, windowName))
		if err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
		response.Data = panes
	default:
		s.writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("unsupported connection type %q", connection.Type))
		return
	}

	s.writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.findConnectionByID(r.PathValue("id"))
	if !ok {
		s.writeError(w, http.StatusNotFound, "not_found", "connection not found")
		return
	}

	var payload namedRequest
	if err := s.decodeJSON(r, &payload); err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", "invalid session payload")
		return
	}

	name := strings.TrimSpace(payload.Name)
	response := sessionOperationResponse{
		ConnectionID: connection.ID,
		Operation:    "create_session",
		Mode:         connection.Type,
	}

	switch connection.Type {
	case "local":
		adapter := tmux.NewAdapter(s.currentConfig().Tmux.Path)
		response.AdapterPath = adapter.Path

		session, err := adapter.NewSession(name)
		if err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
		response.Data = session
	case "ssh":
		client := sshclient.New(sshclient.Config{
			Host:           connection.Host,
			Port:           connection.Port,
			User:           connection.User,
			PrivateKeyPath: connection.PrivateKeyPath,
			KnownHostsPath: connection.KnownHostsPath,
		})
		defer func() { _ = client.Close() }()

		remote := sshclient.NewRemote(&client)
		session, err := remote.NewSession(name)
		if err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
		response.Data = session
	default:
		s.writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("unsupported connection type %q", connection.Type))
		return
	}

	s.writeJSON(w, http.StatusCreated, response)
}

func (s *Server) handleCreateWindow(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.findConnectionByID(r.PathValue("id"))
	if !ok {
		s.writeError(w, http.StatusNotFound, "not_found", "connection not found")
		return
	}

	var payload namedRequest
	if err := s.decodeJSON(r, &payload); err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", "invalid window payload")
		return
	}

	sessionName := r.PathValue("session")
	name := strings.TrimSpace(payload.Name)
	response := windowOperationResponse{
		ConnectionID: connection.ID,
		Session:      sessionName,
		Operation:    "create_window",
		Mode:         connection.Type,
	}

	switch connection.Type {
	case "local":
		adapter := tmux.NewAdapter(s.currentConfig().Tmux.Path)
		response.AdapterPath = adapter.Path

		window, err := adapter.NewWindow(sessionName, name)
		if err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
		response.Data = window
	case "ssh":
		client := sshclient.New(sshclient.Config{
			Host:           connection.Host,
			Port:           connection.Port,
			User:           connection.User,
			PrivateKeyPath: connection.PrivateKeyPath,
			KnownHostsPath: connection.KnownHostsPath,
		})
		defer func() { _ = client.Close() }()

		remote := sshclient.NewRemote(&client)
		window, err := remote.NewWindow(sessionName, name)
		if err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
		response.Data = window
	default:
		s.writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("unsupported connection type %q", connection.Type))
		return
	}

	s.writeJSON(w, http.StatusCreated, response)
}

func (s *Server) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	s.writeSessionOperation(w, r, http.StatusOK, "delete_session")
}

func (s *Server) handleRenameSession(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.findConnectionByID(r.PathValue("id"))
	if !ok {
		s.writeError(w, http.StatusNotFound, "not_found", "connection not found")
		return
	}

	var payload namedRequest
	if err := s.decodeJSON(r, &payload); err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", "invalid rename payload")
		return
	}

	oldName := r.PathValue("session")
	newName := strings.TrimSpace(payload.Name)
	response := operationResponse{
		ConnectionID: connection.ID,
		Session:      oldName,
		Operation:    "rename_session",
		Mode:         connection.Type,
		Status:       "accepted",
	}

	switch connection.Type {
	case "local":
		adapter := tmux.NewAdapter(s.currentConfig().Tmux.Path)
		response.AdapterPath = adapter.Path
		if err := adapter.RenameSession(oldName, newName); err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
	case "ssh":
		client := sshclient.New(sshclient.Config{
			Host:           connection.Host,
			Port:           connection.Port,
			User:           connection.User,
			PrivateKeyPath: connection.PrivateKeyPath,
			KnownHostsPath: connection.KnownHostsPath,
		})
		defer func() { _ = client.Close() }()

		remote := sshclient.NewRemote(&client)
		if err := remote.RenameSession(oldName, newName); err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
	default:
		s.writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("unsupported connection type %q", connection.Type))
		return
	}

	s.writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleDeleteWindow(w http.ResponseWriter, r *http.Request) {
	s.writeSessionOperation(w, r, http.StatusOK, "delete_window")
}

func (s *Server) handleSplitPane(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.findConnectionByID(r.PathValue("id"))
	if !ok {
		s.writeError(w, http.StatusNotFound, "not_found", "connection not found")
		return
	}

	var payload splitPaneRequest
	if err := s.decodeJSON(r, &payload); err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", "invalid split pane payload")
		return
	}

	sessionName := r.PathValue("session")
	windowName := r.PathValue("window")
	paneID := r.PathValue("pane")
	target := buildPaneTarget(sessionName, windowName, paneID)
	response := paneOperationResponse{
		ConnectionID: connection.ID,
		Session:      sessionName,
		Window:       windowName,
		Operation:    "split_pane",
		Mode:         connection.Type,
	}

	switch connection.Type {
	case "local":
		adapter := tmux.NewAdapter(s.currentConfig().Tmux.Path)
		response.AdapterPath = adapter.Path

		pane, err := adapter.SplitPane(target, payload.Horizontal)
		if err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
		response.Data = pane
	case "ssh":
		client := sshclient.New(sshclient.Config{
			Host:           connection.Host,
			Port:           connection.Port,
			User:           connection.User,
			PrivateKeyPath: connection.PrivateKeyPath,
			KnownHostsPath: connection.KnownHostsPath,
		})
		defer func() { _ = client.Close() }()

		remote := sshclient.NewRemote(&client)
		pane, err := remote.SplitPane(target, payload.Horizontal)
		if err != nil {
			s.writeSessionHTTPError(w, err)
			return
		}
		response.Data = pane
	default:
		s.writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("unsupported connection type %q", connection.Type))
		return
	}

	s.writeJSON(w, http.StatusCreated, response)
}

func (s *Server) handleDeletePane(w http.ResponseWriter, r *http.Request) {
	s.writeSessionOperation(w, r, http.StatusOK, "delete_pane")
}

func (s *Server) writeSessionOperation(w http.ResponseWriter, r *http.Request, status int, operation string) {
	connection, ok := s.findConnectionByID(r.PathValue("id"))
	if !ok {
		s.writeError(w, http.StatusNotFound, "not_found", "connection not found")
		return
	}

	sessionName := r.PathValue("session")
	windowName := r.PathValue("window")
	paneID := r.PathValue("pane")
	response := operationResponse{
		ConnectionID: connection.ID,
		Session:      sessionName,
		Window:       windowName,
		Pane:         paneID,
		Operation:    operation,
		Mode:         connection.Type,
		Status:       "accepted",
	}

	switch operation {
	case "delete_session":
		switch connection.Type {
		case "local":
			adapter := tmux.NewAdapter(s.currentConfig().Tmux.Path)
			response.AdapterPath = adapter.Path
			if err := adapter.KillSession(sessionName); err != nil {
				s.writeSessionHTTPError(w, err)
				return
			}
		case "ssh":
			client := sshclient.New(sshclient.Config{
				Host:           connection.Host,
				Port:           connection.Port,
				User:           connection.User,
				PrivateKeyPath: connection.PrivateKeyPath,
				KnownHostsPath: connection.KnownHostsPath,
			})
			defer func() { _ = client.Close() }()

			remote := sshclient.NewRemote(&client)
			if err := remote.KillSession(sessionName); err != nil {
				s.writeSessionHTTPError(w, err)
				return
			}
		default:
			s.writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("unsupported connection type %q", connection.Type))
			return
		}
	case "delete_window":
		target := buildWindowTarget(sessionName, windowName)
		switch connection.Type {
		case "local":
			adapter := tmux.NewAdapter(s.currentConfig().Tmux.Path)
			response.AdapterPath = adapter.Path
			if err := adapter.KillWindow(target); err != nil {
				s.writeSessionHTTPError(w, err)
				return
			}
		case "ssh":
			client := sshclient.New(sshclient.Config{
				Host:           connection.Host,
				Port:           connection.Port,
				User:           connection.User,
				PrivateKeyPath: connection.PrivateKeyPath,
				KnownHostsPath: connection.KnownHostsPath,
			})
			defer func() { _ = client.Close() }()

			remote := sshclient.NewRemote(&client)
			if err := remote.KillWindow(target); err != nil {
				s.writeSessionHTTPError(w, err)
				return
			}
		default:
			s.writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("unsupported connection type %q", connection.Type))
			return
		}
	case "delete_pane":
		target := buildPaneTarget(sessionName, windowName, paneID)
		switch connection.Type {
		case "local":
			adapter := tmux.NewAdapter(s.currentConfig().Tmux.Path)
			response.AdapterPath = adapter.Path
			if err := adapter.KillPane(target); err != nil {
				s.writeSessionHTTPError(w, err)
				return
			}
		case "ssh":
			client := sshclient.New(sshclient.Config{
				Host:           connection.Host,
				Port:           connection.Port,
				User:           connection.User,
				PrivateKeyPath: connection.PrivateKeyPath,
				KnownHostsPath: connection.KnownHostsPath,
			})
			defer func() { _ = client.Close() }()

			remote := sshclient.NewRemote(&client)
			if err := remote.KillPane(target); err != nil {
				s.writeSessionHTTPError(w, err)
				return
			}
		default:
			s.writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("unsupported connection type %q", connection.Type))
			return
		}
	default:
		s.writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("unsupported session operation %q", operation))
		return
	}

	s.writeJSON(w, status, response)
}

func (s *Server) writeSessionHTTPError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	code := "internal_error"
	message := "session operation failed"

	if tmuxErr, ok := errors.AsType[*tmux.Error](err); ok {
		code = tmuxErr.Code
		message = tmuxErr.Message
		status = statusForTMUXError(tmuxErr)
	}

	if sshErr, ok := errors.AsType[*sshclient.Error](err); ok {
		code = sshErr.Code
		message = sshErr.Message
		status = statusForSSHError(sshErr)
	}

	if message == "" {
		message = err.Error()
	}

	s.writeError(w, status, code, message)
}

func statusForTMUXError(err *tmux.Error) int {
	if err == nil {
		return http.StatusInternalServerError
	}

	switch err.Code {
	case tmux.ErrorCodeNotFound, tmux.ErrorCodeNoSessions:
		return http.StatusNotFound
	case tmux.ErrorCodeCommandFailed:
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func statusForSSHError(err *sshclient.Error) int {
	if err == nil {
		return http.StatusInternalServerError
	}

	switch err.Code {
	case sshclient.ErrorCodeUnknownHost, sshclient.ErrorCodeHostKeyMismatch, sshclient.ErrorCodeKeyUnreadable:
		return http.StatusBadRequest
	case sshclient.ErrorCodeConnectionFailed:
		return http.StatusBadGateway
	default:
		return http.StatusInternalServerError
	}
}

func buildWindowTarget(session, window string) string {
	return fmt.Sprintf("%s:%s", session, window)
}

func buildPaneTarget(session, window, pane string) string {
	return fmt.Sprintf("%s.%s", buildWindowTarget(session, window), pane)
}
