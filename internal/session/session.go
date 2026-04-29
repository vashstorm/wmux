package session

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/panh/wmux/internal/sshclient"
)

const (
	defaultWindowRows = 24
	defaultWindowCols = 80
)

type WindowSize struct {
	Rows int
	Cols int
}

type ActiveSession struct {
	ConnectionID string
	Target       string
	Done         chan struct{}

	cancel context.CancelFunc
}

type Manager struct {
	mu       sync.Mutex
	sessions map[string]ActiveSession
}

func NewManager() Manager {
	return Manager{sessions: make(map[string]ActiveSession)}
}

func BuildTarget(sessionName, windowName, paneName string) (string, error) {
	sessionName = strings.TrimSpace(sessionName)
	if sessionName == "" {
		return "", fmt.Errorf("session target is required")
	}

	values := url.Values{}
	values.Set("session", sessionName)
	if windowName = strings.TrimSpace(windowName); windowName != "" {
		values.Set("window", windowName)
	}
	if paneName = strings.TrimSpace(paneName); paneName != "" {
		values.Set("pane", paneName)
	}

	return values.Encode(), nil
}

func (m *Manager) AttachLocal(connID, tmuxPath, target string, wsConn *websocket.Conn, initialSize WindowSize) error {
	parsedTarget, err := parseAttachTarget(target)
	if err != nil {
		return err
	}

	terminal, err := newLocalPTY(tmuxPath, parsedTarget, initialSize.normalize())
	if err != nil {
		return err
	}

	return m.attach(connID, parsedTarget.display(), wsConn, terminal)
}

func (m *Manager) AttachSSH(connID string, sshClient *sshclient.Client, target string, wsConn *websocket.Conn, initialSize WindowSize) error {
	parsedTarget, err := parseAttachTarget(target)
	if err != nil {
		return err
	}
	if sshClient == nil {
		return fmt.Errorf("ssh client is required")
	}
	defer sshClient.Close()

	terminal, err := newSSHPTY(sshClient, parsedTarget, initialSize.normalize())
	if err != nil {
		return err
	}

	return m.attach(connID, parsedTarget.display(), wsConn, terminal)
}

func (m *Manager) ListActive() []ActiveSession {
	m.mu.Lock()
	defer m.mu.Unlock()

	active := make([]ActiveSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		active = append(active, session)
	}

	sort.Slice(active, func(i, j int) bool {
		return active[i].ConnectionID < active[j].ConnectionID
	})

	return active
}

func (m *Manager) Detach(connID string) {
	m.mu.Lock()
	active, ok := m.sessions[connID]
	m.mu.Unlock()
	if !ok {
		return
	}

	active.cancel()
	<-active.Done
}

func (m *Manager) attach(connID, target string, wsConn *websocket.Conn, terminal terminalIO) error {
	if strings.TrimSpace(connID) == "" {
		_ = terminal.Close()
		return fmt.Errorf("connection id is required")
	}
	if wsConn == nil {
		_ = terminal.Close()
		return fmt.Errorf("websocket connection is required")
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	active := ActiveSession{
		ConnectionID: connID,
		Target:       target,
		Done:         done,
		cancel:       cancel,
	}

	if err := m.register(active); err != nil {
		cancel()
		_ = terminal.Close()
		return err
	}

	defer func() {
		cancel()
		m.unregister(connID)
		close(done)
	}()

	return newBridge(wsConn, terminal).Run(ctx)
}

func (m *Manager) register(active ActiveSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.sessions == nil {
		m.sessions = make(map[string]ActiveSession)
	}
	if _, exists := m.sessions[active.ConnectionID]; exists {
		return fmt.Errorf("connection %q already has an active terminal session", active.ConnectionID)
	}

	m.sessions[active.ConnectionID] = active
	return nil
}

func (m *Manager) unregister(connID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	delete(m.sessions, connID)
}

func (s WindowSize) normalize() WindowSize {
	if s.Rows <= 0 {
		s.Rows = defaultWindowRows
	}
	if s.Cols <= 0 {
		s.Cols = defaultWindowCols
	}
	return s
}

func validateWindowSize(size WindowSize) (WindowSize, error) {
	if size.Rows <= 0 || size.Cols <= 0 {
		return WindowSize{}, fmt.Errorf("window size must be positive")
	}
	return size, nil
}

type attachTarget struct {
	Session string
	Window  string
	Pane    string
}

func parseAttachTarget(raw string) (attachTarget, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return attachTarget{}, fmt.Errorf("session target is required")
	}

	if !strings.Contains(raw, "=") {
		return attachTarget{Session: raw}, nil
	}

	values, err := url.ParseQuery(raw)
	if err != nil {
		return attachTarget{}, fmt.Errorf("parse terminal target: %w", err)
	}

	target := attachTarget{
		Session: strings.TrimSpace(values.Get("session")),
		Window:  strings.TrimSpace(values.Get("window")),
		Pane:    strings.TrimSpace(values.Get("pane")),
	}
	if target.Session == "" {
		return attachTarget{}, fmt.Errorf("session target is required")
	}

	return target, nil
}

func (t attachTarget) sessionTarget() string {
	return t.Session
}

func (t attachTarget) display() string {
	if t.Pane != "" {
		if paneTarget, err := t.paneTarget(); err == nil {
			return paneTarget
		}
	}
	if t.Window != "" {
		if windowTarget, err := t.windowTarget(); err == nil {
			return windowTarget
		}
	}
	return t.Session
}

func (t attachTarget) windowTarget() (string, error) {
	return buildWindowTarget(t.Session, t.Window)
}

func (t attachTarget) paneTarget() (string, error) {
	return buildPaneTarget(t.Session, t.Window, t.Pane)
}

func buildWindowTarget(sessionName, windowName string) (string, error) {
	windowName = strings.TrimSpace(windowName)
	if windowName == "" {
		return "", fmt.Errorf("window target is required")
	}

	if strings.HasPrefix(windowName, "@") || strings.Contains(windowName, ":") {
		return windowName, nil
	}
	if strings.TrimSpace(sessionName) == "" {
		return windowName, nil
	}

	return fmt.Sprintf("%s:%s", sessionName, windowName), nil
}

func buildPaneTarget(sessionName, windowName, paneName string) (string, error) {
	paneName = strings.TrimSpace(paneName)
	if paneName == "" {
		return "", fmt.Errorf("pane target is required")
	}

	if strings.HasPrefix(paneName, "%") || strings.Contains(paneName, ":") || strings.Contains(paneName, ".") {
		return paneName, nil
	}

	windowTarget, err := buildWindowTarget(sessionName, windowName)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%s.%s", windowTarget, paneName), nil
}
