package session

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/panh/wmux/internal/protocol"
	"github.com/panh/wmux/internal/tmux"
)

func TestNewManager(t *testing.T) {
	manager := NewManager()
	if len(manager.ListActive()) != 0 {
		t.Fatalf("expected no active sessions, got %d", len(manager.ListActive()))
	}
}

func TestTmuxAttachArgsUseIgnoreSize(t *testing.T) {
	got := tmuxAttachArgs("dev")
	want := []string{"attach-session", "-f", "ignore-size", "-t", "dev"}
	if !slices.Equal(got, want) {
		t.Fatalf("tmuxAttachArgs() = %#v, want %#v", got, want)
	}
}

func TestBridgeHandlesInputResizeAndClose(t *testing.T) {
	manager := NewManager()
	terminal := newFakeTerminal()
	conn, errCh := openTerminalSession(t, &manager, "session-one", terminal)

	if err := conn.WriteJSON(protocol.ClientMessage{Type: protocol.ClientMessageTypeInput, Data: "ls\n"}); err != nil {
		t.Fatalf("failed to send input message: %v", err)
	}
	if err := conn.WriteJSON(protocol.ClientMessage{Type: protocol.ClientMessageTypeResize, Rows: 40, Cols: 100}); err != nil {
		t.Fatalf("failed to send resize message: %v", err)
	}
	if err := conn.WriteJSON(protocol.ClientMessage{Type: protocol.ClientMessageTypeClose}); err != nil {
		t.Fatalf("failed to send close message: %v", err)
	}

	var message protocol.ServerMessage
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatalf("failed to read close message: %v", err)
	}
	if message.Type != protocol.ServerMessageTypeClose {
		t.Fatalf("unexpected server message: %#v", message)
	}

	assertNoSessionError(t, errCh)

	if inputs := terminal.inputsSnapshot(); len(inputs) != 1 || inputs[0] != "ls\n" {
		t.Fatalf("unexpected terminal input: %#v", inputs)
	}
	if sizes := terminal.sizesSnapshot(); len(sizes) != 1 || sizes[0] != (WindowSize{Rows: 40, Cols: 100}) {
		t.Fatalf("unexpected terminal sizes: %#v", sizes)
	}
	if len(manager.ListActive()) != 0 {
		t.Fatalf("expected no active sessions after close, got %#v", manager.ListActive())
	}
}

func TestBridgeReportsMalformedJSON(t *testing.T) {
	manager := NewManager()
	terminal := newFakeTerminal()
	conn, errCh := openTerminalSession(t, &manager, "session-one", terminal)

	if err := conn.WriteMessage(websocket.TextMessage, []byte("{")); err != nil {
		t.Fatalf("failed to send malformed websocket payload: %v", err)
	}

	var message protocol.ServerMessage
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatalf("failed to read error message: %v", err)
	}
	if message.Type != protocol.ServerMessageTypeError || message.Error == nil || message.Error.Code != "bad_terminal_message" {
		t.Fatalf("unexpected error message: %#v", message)
	}

	manager.Detach("conn-1")
	assertNoSessionError(t, errCh)
}

func TestBridgeForwardsResize(t *testing.T) {
	manager := NewManager()
	terminal := newFakeTerminal()
	conn, errCh := openTerminalSession(t, &manager, "session-one", terminal)

	if err := conn.WriteJSON(protocol.ClientMessage{Type: protocol.ClientMessageTypeResize, Rows: 55, Cols: 120}); err != nil {
		t.Fatalf("failed to send resize message: %v", err)
	}

	waitForCondition(t, func() bool {
		sizes := terminal.sizesSnapshot()
		return len(sizes) == 1 && sizes[0] == (WindowSize{Rows: 55, Cols: 120})
	}, "resize forwarding")

	manager.Detach("conn-1")
	assertNoSessionError(t, errCh)
}

func TestBridgePreservesUTF8AcrossOutputReads(t *testing.T) {
	manager := NewManager()
	terminal := newFakeTerminal()
	conn, errCh := openTerminalSession(t, &manager, "session-one", terminal)

	payload := []byte("prefix: \xe4\xb8\xad\xe6\x96\x87 icon: \xf0\x9f\x9a\x80\n")
	splitAt := bytes.Index(payload, []byte{0xe4, 0xb8, 0xad}) + 2
	if splitAt < 2 {
		t.Fatalf("failed to find split point in payload")
	}

	if _, err := terminal.outputWriter.Write(payload[:splitAt]); err != nil {
		t.Fatalf("failed to write first output chunk: %v", err)
	}
	if _, err := terminal.outputWriter.Write(payload[splitAt:]); err != nil {
		t.Fatalf("failed to write second output chunk: %v", err)
	}

	var got string
	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("failed to set read deadline: %v", err)
	}
	for len([]byte(got)) < len(payload) {
		var message protocol.ServerMessage
		if err := conn.ReadJSON(&message); err != nil {
			t.Fatalf("failed to read output message: %v", err)
		}
		if message.Type != protocol.ServerMessageTypeOutput {
			t.Fatalf("unexpected server message: %#v", message)
		}
		got += message.Data
	}

	if got != string(payload) {
		t.Fatalf("unexpected terminal output:\nwant: %q\n got: %q", string(payload), got)
	}

	manager.Detach("conn-1")
	assertNoSessionError(t, errCh)
}

func TestManagerDetachCancelsActiveSession(t *testing.T) {
	manager := NewManager()
	terminal := newFakeTerminal()
	_, errCh := openTerminalSession(t, &manager, "session-one", terminal)

	waitForCondition(t, func() bool {
		return len(manager.ListActive()) == 1
	}, "active session registration")

	manager.Detach("conn-1")
	assertNoSessionError(t, errCh)

	if terminal.closeCalls() == 0 {
		t.Fatalf("expected terminal close to be called")
	}
	if len(manager.ListActive()) != 0 {
		t.Fatalf("expected no active sessions after detach, got %#v", manager.ListActive())
	}
}

func TestAttachLocalCloseKeepsTmuxSession(t *testing.T) {
	if os.Getenv("WEBMUX_RUN_TMUX_TESTS") != "1" {
		t.Skip("set WEBMUX_RUN_TMUX_TESTS=1 to run tmux integration tests")
	}
	if err := tmux.DetectBinary("tmux"); err != nil {
		t.Skipf("tmux is unavailable: %v", err)
	}

	adapter := tmux.NewAdapter("tmux")
	sessionName := fmt.Sprintf("wmux-test-%d", time.Now().UnixNano())
	if _, err := adapter.NewSession(sessionName); err != nil {
		t.Fatalf("failed to create tmux session: %v", err)
	}
	defer func() {
		_ = adapter.KillSession(sessionName)
	}()

	target, err := BuildTarget(sessionName, "", "")
	if err != nil {
		t.Fatalf("failed to build target: %v", err)
	}

	manager := NewManager()
	errCh := make(chan error, 1)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, upgradeErr := upgrader.Upgrade(w, r, nil)
		if upgradeErr != nil {
			errCh <- upgradeErr
			return
		}
		errCh <- manager.AttachLocal("conn-1", "tmux", target, conn, WindowSize{Rows: 24, Cols: 80}, nil)
	}))
	defer server.Close()

	conn, _, err := websocket.DefaultDialer.Dial(websocketURL(server.URL), nil)
	if err != nil {
		t.Fatalf("failed to dial local tmux websocket: %v", err)
	}

	waitForCondition(t, func() bool {
		return len(manager.ListActive()) == 1
	}, "local tmux attach")

	if err := conn.Close(); err != nil {
		t.Fatalf("failed to close websocket client: %v", err)
	}
	assertNoSessionError(t, errCh)

	sessions, err := adapter.ListSessions()
	if err != nil {
		t.Fatalf("failed to list tmux sessions: %v", err)
	}
	for _, activeSession := range sessions {
		if activeSession.Name == sessionName {
			return
		}
	}

	t.Fatalf("expected tmux session %q to remain after websocket close", sessionName)
}

type fakeTerminal struct {
	outputReader *io.PipeReader
	outputWriter *io.PipeWriter
	waitCh       chan error

	mu         sync.Mutex
	inputs     []string
	sizes      []WindowSize
	closeCount int
	finishOnce sync.Once
}

func newFakeTerminal() *fakeTerminal {
	outputReader, outputWriter := io.Pipe()
	return &fakeTerminal{
		outputReader: outputReader,
		outputWriter: outputWriter,
		waitCh:       make(chan error, 1),
	}
}

func (t *fakeTerminal) Output() io.Reader {
	return t.outputReader
}

func (t *fakeTerminal) Input() io.Writer {
	return writerFunc(func(data []byte) (int, error) {
		t.mu.Lock()
		defer t.mu.Unlock()

		t.inputs = append(t.inputs, string(data))
		return len(data), nil
	})
}

func (t *fakeTerminal) Resize(size WindowSize) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.sizes = append(t.sizes, size)
	return nil
}

func (t *fakeTerminal) Wait() error {
	err, ok := <-t.waitCh
	if !ok {
		return nil
	}
	return err
}

func (t *fakeTerminal) Close() error {
	t.finishOnce.Do(func() {
		t.mu.Lock()
		t.closeCount++
		t.mu.Unlock()

		_ = t.outputWriter.Close()
		t.waitCh <- nil
		close(t.waitCh)
	})
	return nil
}

func (t *fakeTerminal) inputsSnapshot() []string {
	t.mu.Lock()
	defer t.mu.Unlock()

	return append([]string(nil), t.inputs...)
}

func (t *fakeTerminal) sizesSnapshot() []WindowSize {
	t.mu.Lock()
	defer t.mu.Unlock()

	return append([]WindowSize(nil), t.sizes...)
}

func (t *fakeTerminal) closeCalls() int {
	t.mu.Lock()
	defer t.mu.Unlock()

	return t.closeCount
}

type writerFunc func([]byte) (int, error)

func (f writerFunc) Write(data []byte) (int, error) {
	return f(data)
}

func openTerminalSession(t *testing.T, manager *Manager, target string, terminal terminalIO) (*websocket.Conn, <-chan error) {
	t.Helper()

	errCh := make(chan error, 1)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			errCh <- err
			return
		}
		errCh <- manager.attach("conn-1", target, conn, terminal, nil)
	}))
	t.Cleanup(server.Close)

	conn, _, err := websocket.DefaultDialer.Dial(websocketURL(server.URL), nil)
	if err != nil {
		t.Fatalf("failed to dial websocket test server: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})

	return conn, errCh
}

func assertNoSessionError(t *testing.T, errCh <-chan error) {
	t.Helper()

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("unexpected session error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for session shutdown")
	}
}

func waitForCondition(t *testing.T, condition func() bool, description string) {
	t.Helper()

	deadline := time.After(2 * time.Second)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	for {
		if condition() {
			return
		}

		select {
		case <-deadline:
			t.Fatalf("timed out waiting for %s", description)
		case <-ticker.C:
		}
	}
}

func websocketURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		panic(err)
	}

	if parsed.Scheme == "https" {
		parsed.Scheme = "wss"
	} else {
		parsed.Scheme = "ws"
	}

	return parsed.String()
}

func TestBridgeCallsOnInputCallback(t *testing.T) {
	manager := NewManager()
	terminal := newFakeTerminal()

	var (
		mu     sync.Mutex
		called int
	)
	onInput := func() {
		mu.Lock()
		defer mu.Unlock()
		called++
	}

	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	errCh := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			errCh <- err
			return
		}
		errCh <- manager.attach("conn-1", "test-target", conn, terminal, onInput)
	}))
	t.Cleanup(server.Close)

	conn, _, err := websocket.DefaultDialer.Dial(websocketURL(server.URL), nil)
	if err != nil {
		t.Fatalf("failed to dial websocket test server: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	if err := conn.WriteJSON(protocol.ClientMessage{Type: protocol.ClientMessageTypeInput, Data: "y\n"}); err != nil {
		t.Fatalf("failed to send input message: %v", err)
	}

	waitForCondition(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return called >= 1
	}, "onInput callback invocation")

	if err := conn.WriteJSON(protocol.ClientMessage{Type: protocol.ClientMessageTypeClose}); err != nil {
		t.Fatalf("failed to send close message: %v", err)
	}
	assertNoSessionError(t, errCh)

	mu.Lock()
	gotCalled := called
	mu.Unlock()
	if gotCalled < 1 {
		t.Fatalf("expected onInput to be called at least once, got %d", gotCalled)
	}
}
