package session

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
	"unicode/utf8"

	"context"

	"github.com/gorilla/websocket"
	"github.com/panh/wmux/internal/protocol"
)

const (
	terminalReadLimit  = 4096
	terminalWriteWait  = 10 * time.Second
	terminalPongWait   = 60 * time.Second
	terminalPingPeriod = (terminalPongWait * 9) / 10
	terminalBufferSize = 4096
)

type terminalIO interface {
	Output() io.Reader
	Input() io.Writer
	Resize(WindowSize) error
	Wait() error
	Close() error
}

type terminalBridge struct {
	wsConn   *websocket.Conn
	terminal terminalIO
	onInput  func()
}

func newBridge(wsConn *websocket.Conn, terminal terminalIO, onInput func()) terminalBridge {
	return terminalBridge{wsConn: wsConn, terminal: terminal, onInput: onInput}
}

func (b terminalBridge) Run(parent context.Context) error {
	if b.wsConn == nil {
		return fmt.Errorf("websocket connection is required")
	}
	if b.terminal == nil {
		return fmt.Errorf("terminal is required")
	}

	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	outbound := make(chan protocol.ServerMessage, 32)
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		b.writePump(outbound, cancel)
	}()

	go func() {
		<-ctx.Done()
		_ = b.wsConn.SetReadDeadline(time.Now())
		_ = b.terminal.Close()
	}()

	var pumps sync.WaitGroup
	pumps.Add(3)
	go func() {
		defer pumps.Done()
		b.readPump(ctx, cancel, outbound)
	}()
	go func() {
		defer pumps.Done()
		b.outputPump(ctx, cancel, outbound)
	}()
	go func() {
		defer pumps.Done()
		b.waitPump(ctx, cancel, outbound)
	}()

	pumps.Wait()
	close(outbound)
	<-writerDone
	_ = b.wsConn.Close()

	return nil
}

func (b terminalBridge) readPump(ctx context.Context, cancel context.CancelFunc, outbound chan<- protocol.ServerMessage) {
	b.wsConn.SetReadLimit(terminalReadLimit)
	_ = b.wsConn.SetReadDeadline(time.Now().Add(terminalPongWait))
	b.wsConn.SetPongHandler(func(string) error {
		return b.wsConn.SetReadDeadline(time.Now().Add(terminalPongWait))
	})

	inputWriter := b.terminal.Input()
	for {
		var message protocol.ClientMessage
		if err := b.wsConn.ReadJSON(&message); err != nil {
			switch {
			case websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway):
				cancel()
				return
			case errors.Is(err, websocket.ErrCloseSent), errors.Is(err, io.EOF), errors.Is(err, net.ErrClosed):
				cancel()
				return
			case ctx.Err() != nil:
				return
			case isBadTerminalMessage(err):
				sendTerminalError(ctx, outbound, "bad_terminal_message", "invalid terminal message")
				continue
			default:
				sendTerminalError(ctx, outbound, "terminal_read_failed", "failed to read terminal websocket message")
				cancel()
				return
			}
		}

		switch message.Type {
		case protocol.ClientMessageTypeInput:
			if message.Data == "" {
				continue
			}
			if _, err := io.WriteString(inputWriter, message.Data); err != nil {
				sendTerminalError(ctx, outbound, "terminal_write_failed", "failed to forward terminal input")
				cancel()
				return
			}
			if b.onInput != nil {
				b.onInput()
			}
		case protocol.ClientMessageTypeResize:
			size, err := validateWindowSize(WindowSize{Rows: message.Rows, Cols: message.Cols})
			if err != nil {
				sendTerminalError(ctx, outbound, "bad_terminal_message", err.Error())
				continue
			}
			if err := b.terminal.Resize(size); err != nil {
				sendTerminalError(ctx, outbound, "terminal_resize_failed", "failed to resize terminal")
				cancel()
				return
			}
		case protocol.ClientMessageTypeClose:
			sendServerMessage(ctx, outbound, protocol.ServerMessage{Type: protocol.ServerMessageTypeClose})
			cancel()
			return
		default:
			sendTerminalError(ctx, outbound, "bad_terminal_message", "unsupported terminal message type")
		}
	}
}

func (b terminalBridge) outputPump(ctx context.Context, cancel context.CancelFunc, outbound chan<- protocol.ServerMessage) {
	reader := b.terminal.Output()
	buffer := make([]byte, terminalBufferSize)
	pending := make([]byte, 0, utf8.UTFMax)
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			chunk := append(pending, buffer[:n]...)
			var complete []byte
			complete, pending = splitCompleteUTF8(chunk)
			if len(complete) > 0 {
				if !sendTerminalOutput(ctx, outbound, string(complete)) {
					return
				}
			}
		}
		if err != nil {
			if len(pending) > 0 {
				if !sendTerminalOutput(ctx, outbound, string(pending)) {
					return
				}
			}
			if errors.Is(err, io.EOF) || ctx.Err() != nil {
				cancel()
				return
			}
			sendTerminalError(ctx, outbound, "terminal_output_failed", "failed to read terminal output")
			cancel()
			return
		}
	}
}

func splitCompleteUTF8(data []byte) ([]byte, []byte) {
	if len(data) == 0 {
		return data, nil
	}

	maxCheck := min(utf8.UTFMax, len(data))
	for i := len(data) - 1; i >= len(data)-maxCheck; i-- {
		b := data[i]
		if b < utf8.RuneSelf {
			return data, nil
		}
		if !utf8.RuneStart(b) {
			continue
		}

		size := expectedUTF8Size(b)
		if size == 0 {
			return data, nil
		}
		if len(data)-i >= size {
			return data, nil
		}
		for j := i + 1; j < len(data); j++ {
			if data[j]&0xc0 != 0x80 {
				return data, nil
			}
		}

		return data[:i], append([]byte(nil), data[i:]...)
	}

	return data, nil
}

func expectedUTF8Size(b byte) int {
	switch {
	case b >= 0xc2 && b <= 0xdf:
		return 2
	case b >= 0xe0 && b <= 0xef:
		return 3
	case b >= 0xf0 && b <= 0xf4:
		return 4
	default:
		return 0
	}
}

func (b terminalBridge) waitPump(ctx context.Context, cancel context.CancelFunc, outbound chan<- protocol.ServerMessage) {
	if err := b.terminal.Wait(); err != nil && ctx.Err() == nil {
		sendTerminalError(ctx, outbound, "terminal_closed", "terminal session ended unexpectedly")
	}
	cancel()
}

func (b terminalBridge) writePump(outbound <-chan protocol.ServerMessage, cancel context.CancelFunc) {
	ticker := time.NewTicker(terminalPingPeriod)
	defer ticker.Stop()

	for {
		select {
		case message, ok := <-outbound:
			if !ok {
				return
			}
			if err := b.writeJSON(message); err != nil {
				cancel()
				return
			}
		case <-ticker.C:
			if err := b.writePing(); err != nil {
				cancel()
				return
			}
		}
	}
}

func (b terminalBridge) writeJSON(message protocol.ServerMessage) error {
	_ = b.wsConn.SetWriteDeadline(time.Now().Add(terminalWriteWait))
	return b.wsConn.WriteJSON(message)
}

func (b terminalBridge) writePing() error {
	return b.wsConn.WriteControl(websocket.PingMessage, nil, time.Now().Add(terminalWriteWait))
}

func sendTerminalOutput(ctx context.Context, outbound chan<- protocol.ServerMessage, data string) bool {
	return sendServerMessage(ctx, outbound, protocol.ServerMessage{
		Type: protocol.ServerMessageTypeOutput,
		Data: data,
	})
}

func sendServerMessage(ctx context.Context, outbound chan<- protocol.ServerMessage, message protocol.ServerMessage) bool {
	select {
	case outbound <- message:
		return true
	case <-ctx.Done():
		return false
	}
}

func sendTerminalError(ctx context.Context, outbound chan<- protocol.ServerMessage, code, message string) {
	_ = sendServerMessage(ctx, outbound, protocol.ServerMessage{
		Type: protocol.ServerMessageTypeError,
		Error: &protocol.ErrorDetail{
			Code:    code,
			Message: message,
		},
	})
}

func isBadTerminalMessage(err error) bool {
	if _, ok := errors.AsType[*json.SyntaxError](err); ok {
		return true
	}

	if _, ok := errors.AsType[*json.UnmarshalTypeError](err); ok {
		return true
	}

	return errors.Is(err, io.ErrUnexpectedEOF)
}
