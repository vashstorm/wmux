package session

import (
	"fmt"
	"io"
	"os"
	"os/exec"

	"github.com/creack/pty"
	"github.com/panh/wmux/internal/tmux"
)

type localPTY struct {
	file *os.File
	cmd  *exec.Cmd
}

func newLocalPTY(tmuxPath string, target attachTarget, initialSize WindowSize) (*localPTY, error) {
	adapter := tmux.NewAdapter(tmuxPath)
	if target.Window != "" {
		windowTarget, err := target.windowTarget()
		if err != nil {
			return nil, err
		}
		if err := adapter.SelectWindow(windowTarget); err != nil {
			return nil, err
		}
	}
	if target.Pane != "" {
		paneTarget, err := target.paneTarget()
		if err != nil {
			return nil, err
		}
		if err := adapter.SelectPane(paneTarget); err != nil {
			return nil, err
		}
	}

	cmd := exec.Command(adapter.Path, "attach-session", "-t", target.sessionTarget())
	file, err := pty.StartWithSize(cmd, toPTYWindowSize(initialSize))
	if err != nil {
		return nil, fmt.Errorf("start tmux attach session: %w", err)
	}

	return &localPTY{file: file, cmd: cmd}, nil
}

func (p *localPTY) Output() io.Reader {
	return p.file
}

func (p *localPTY) Input() io.Writer {
	return p.file
}

func (p *localPTY) Resize(size WindowSize) error {
	validatedSize, err := validateWindowSize(size)
	if err != nil {
		return err
	}
	return pty.Setsize(p.file, toPTYWindowSize(validatedSize))
}

func (p *localPTY) Wait() error {
	if p == nil || p.cmd == nil {
		return nil
	}
	return p.cmd.Wait()
}

func (p *localPTY) Close() error {
	if p == nil || p.file == nil {
		return nil
	}
	return p.file.Close()
}

func toPTYWindowSize(size WindowSize) *pty.Winsize {
	return &pty.Winsize{Rows: uint16(size.Rows), Cols: uint16(size.Cols)}
}
