package server

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/panh/webmux/internal/protocol"
	"github.com/panh/webmux/internal/session"
	"github.com/panh/webmux/internal/sshclient"
	"github.com/panh/webmux/internal/tmux"
)

func (s *Server) handleTerminalWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.websocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "bad_request", "failed to upgrade websocket connection")
		return
	}

	if err := conn.WriteJSON(protocol.ServerMessage{Type: protocol.ServerMessageTypeStatus, Status: "connected"}); err != nil {
		_ = conn.Close()
		return
	}

	connectionID := strings.TrimSpace(r.URL.Query().Get("connectionId"))
	connection, ok := s.findConnectionByID(connectionID)
	if !ok {
		s.writeTerminalError(conn, "not_found", "connection not found")
		return
	}

	target, err := session.BuildTarget(
		r.URL.Query().Get("session"),
		r.URL.Query().Get("window"),
		r.URL.Query().Get("pane"),
	)
	if err != nil {
		s.writeTerminalError(conn, "bad_request", err.Error())
		return
	}

	initialSize, err := parseInitialTerminalSize(r)
	if err != nil {
		s.writeTerminalError(conn, "bad_request", err.Error())
		return
	}

	switch connection.Type {
	case "local":
		if err := s.sessionManager.AttachLocal(connection.ID, s.currentConfig().Tmux.Path, target, conn, initialSize); err != nil {
			s.writeTerminalAttachError(conn, err)
		}
	case "ssh":
		client := sshclient.New(sshclient.Config{
			Host:           connection.Host,
			Port:           connection.Port,
			User:           connection.User,
			PrivateKeyPath: connection.PrivateKeyPath,
			KnownHostsPath: connection.KnownHostsPath,
		})
		if err := s.sessionManager.AttachSSH(connection.ID, &client, target, conn, initialSize); err != nil {
			s.writeTerminalAttachError(conn, err)
			_ = client.Close()
		}
	default:
		s.writeTerminalError(conn, "bad_request", fmt.Sprintf("unsupported connection type %q", connection.Type))
	}
}

func parseInitialTerminalSize(r *http.Request) (session.WindowSize, error) {
	rows, err := parseOptionalPositiveInt(r.URL.Query().Get("rows"))
	if err != nil {
		return session.WindowSize{}, fmt.Errorf("invalid rows query parameter: %w", err)
	}
	cols, err := parseOptionalPositiveInt(r.URL.Query().Get("cols"))
	if err != nil {
		return session.WindowSize{}, fmt.Errorf("invalid cols query parameter: %w", err)
	}

	return session.WindowSize{Rows: rows, Cols: cols}, nil
}

func parseOptionalPositiveInt(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, err
	}
	if value <= 0 {
		return 0, fmt.Errorf("must be positive")
	}

	return value, nil
}

func (s *Server) writeTerminalAttachError(conn *websocket.Conn, err error) {
	if websocketIsClosed(err) {
		_ = conn.Close()
		return
	}

	code := "terminal_attach_failed"
	message := "failed to attach terminal"

	if tmuxErr, ok := errors.AsType[*tmux.Error](err); ok {
		code = tmuxErr.Code
		message = tmuxErr.Message
	}

	if sshErr, ok := errors.AsType[*sshclient.Error](err); ok {
		code = sshErr.Code
		message = sshErr.Message
	}

	if message == "" {
		message = err.Error()
	}

	s.writeTerminalError(conn, code, message)
}

func (s *Server) writeTerminalError(conn *websocket.Conn, code, message string) {
	if conn == nil {
		return
	}

	_ = conn.WriteJSON(protocol.ServerMessage{
		Type: protocol.ServerMessageTypeError,
		Error: &protocol.ErrorDetail{
			Code:    code,
			Message: message,
		},
	})
	_ = conn.Close()
}

func websocketIsClosed(err error) bool {
	return websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) ||
		errors.Is(err, websocket.ErrCloseSent)
}
