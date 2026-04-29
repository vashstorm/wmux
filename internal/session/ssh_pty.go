package session

import (
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"

	"github.com/panh/wmux/internal/sshclient"
)

const (
	defaultRemoteTmuxPath = "tmux"
	defaultTerminalType   = "xterm-256color"
)

type sshPTY struct {
	session      *sshclient.Session
	stdin        io.WriteCloser
	outputReader *io.PipeReader
	outputWriter *io.PipeWriter
	closeOutput  sync.Once
}

func newSSHPTY(sshClient *sshclient.Client, target attachTarget, initialSize WindowSize) (*sshPTY, error) {
	if sshClient == nil {
		return nil, fmt.Errorf("ssh client is required")
	}
	if err := sshClient.Connect(); err != nil {
		return nil, err
	}

	if err := prepareSSHSelection(sshClient, target); err != nil {
		return nil, err
	}

	session, err := sshClient.NewSession()
	if err != nil {
		return nil, err
	}
	if err := session.RequestPty(defaultTerminalType, initialSize.Rows, initialSize.Cols); err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("request SSH PTY: %w", err)
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("open SSH stdout pipe: %w", err)
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("open SSH stderr pipe: %w", err)
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("open SSH stdin pipe: %w", err)
	}

	outputReader, outputWriter := io.Pipe()
	terminal := &sshPTY{
		session:      session,
		stdin:        stdin,
		outputReader: outputReader,
		outputWriter: outputWriter,
	}
	terminal.copyOutput(stdout, stderr)

	command := buildRemoteExecCommand(defaultRemoteTmuxPath, "attach-session", "-t", target.sessionTarget())
	if err := session.Start(command); err != nil {
		terminal.closePipe(nil)
		_ = session.Close()
		return nil, fmt.Errorf("start remote tmux attach-session: %w", err)
	}

	return terminal, nil
}

func (p *sshPTY) Output() io.Reader {
	return p.outputReader
}

func (p *sshPTY) Input() io.Writer {
	return p.stdin
}

func (p *sshPTY) Resize(size WindowSize) error {
	validatedSize, err := validateWindowSize(size)
	if err != nil {
		return err
	}
	return p.session.WindowChange(validatedSize.Rows, validatedSize.Cols)
}

func (p *sshPTY) Wait() error {
	if p == nil || p.session == nil {
		return nil
	}
	return p.session.Wait()
}

func (p *sshPTY) Close() error {
	if p == nil {
		return nil
	}

	p.closePipe(nil)
	var errs []error
	if p.stdin != nil {
		errs = append(errs, p.stdin.Close())
	}
	if p.session != nil {
		errs = append(errs, p.session.Close())
	}
	return errors.Join(errs...)
}

func (p *sshPTY) copyOutput(readers ...io.Reader) {
	var writers sync.WaitGroup
	var outputMu sync.Mutex
	for _, reader := range readers {
		if reader == nil {
			continue
		}

		writers.Add(1)
		go func(output io.Reader) {
			defer writers.Done()

			buffer := make([]byte, terminalBufferSize)
			for {
				n, err := output.Read(buffer)
				if n > 0 {
					outputMu.Lock()
					_, writeErr := p.outputWriter.Write(buffer[:n])
					outputMu.Unlock()
					if writeErr != nil {
						return
					}
				}
				if err != nil {
					if !errors.Is(err, io.EOF) {
						p.closePipe(err)
					}
					return
				}
			}
		}(reader)
	}

	go func() {
		writers.Wait()
		p.closePipe(nil)
	}()
}

func (p *sshPTY) closePipe(err error) {
	p.closeOutput.Do(func() {
		_ = p.outputWriter.CloseWithError(err)
	})
}

func prepareSSHSelection(sshClient *sshclient.Client, target attachTarget) error {
	if target.Window != "" {
		windowTarget, err := target.windowTarget()
		if err != nil {
			return err
		}
		if err := runSSHCommand(sshClient, "select-window", "-t", windowTarget); err != nil {
			return fmt.Errorf("remote tmux select-window: %w", err)
		}
	}
	if target.Pane != "" {
		paneTarget, err := target.paneTarget()
		if err != nil {
			return err
		}
		if err := runSSHCommand(sshClient, "select-pane", "-t", paneTarget); err != nil {
			return fmt.Errorf("remote tmux select-pane: %w", err)
		}
	}

	return nil
}

func runSSHCommand(sshClient *sshclient.Client, args ...string) error {
	session, err := sshClient.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()

	output, err := session.CombinedOutput(buildRemoteExecCommand(defaultRemoteTmuxPath, args...))
	if err == nil {
		return nil
	}

	message := strings.TrimSpace(string(output))
	if message == "" {
		message = strings.Join(args, " ")
	}

	return fmt.Errorf("%s: %w", message, err)
}

func buildRemoteExecCommand(binary string, args ...string) string {
	parts := []string{"sh", "-lc", quoteRemoteShell("exec \"$0\" \"$@\""), quoteRemoteShell(binary)}
	for _, arg := range args {
		parts = append(parts, quoteRemoteShell(arg))
	}
	return strings.Join(parts, " ")
}

func quoteRemoteShell(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}
