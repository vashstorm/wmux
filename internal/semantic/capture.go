package semantic

import (
	"bytes"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

const defaultMaxLines = 50

func normalizeBinaryPath(path string) string {
	if strings.TrimSpace(path) == "" {
		return "tmux"
	}
	return path
}

// PaneCapturer can capture the current visible content of a tmux pane.
type PaneCapturer interface {
	CapturePane(paneID string) (string, error)
}

// LocalCapture implements PaneCapturer using a local tmux binary.
// PoC scope: local panes only. SSH panes are excluded.
type LocalCapture struct {
	execCommand func(name string, args ...string) *exec.Cmd
	tmuxPath    string
}

// NewLocalCapture creates a LocalCapture with the given tmux binary path.
// If tmuxPath is empty, it defaults to "tmux".
func NewLocalCapture(tmuxPath string) *LocalCapture {
	return &LocalCapture{
		execCommand: exec.Command,
		tmuxPath:    normalizeBinaryPath(tmuxPath),
	}
}

// CapturePane runs "tmux capture-pane -p -t <paneID>" and returns the visible content.
func (c *LocalCapture) CapturePane(paneID string) (string, error) {
	if strings.TrimSpace(paneID) == "" {
		return "", fmt.Errorf("paneID cannot be empty")
	}

	cmd := c.execCommand(c.tmuxPath, "capture-pane", "-p", "-t", paneID)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("tmux capture-pane failed: %w", err)
	}

	return stdout.String(), nil
}

// ansiPattern matches ANSI escape sequences:
//   - CSI sequences: ESC [ <params> <final byte>
//   - OSC sequences: ESC ] <text> BEL
var ansiPattern = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07`)

func NormalizeOutput(raw string) string {
	cleaned := ansiPattern.ReplaceAllString(raw, "")

	lines := strings.Split(cleaned, "\n")

	var result []string
	for _, line := range lines {
		line = strings.TrimRight(line, " \t\r")
		result = append(result, line)
	}

	start := 0
	for start < len(result) && result[start] == "" {
		start++
	}

	end := len(result)
	for end > start && result[end-1] == "" {
		end--
	}

	result = result[start:end]

	if len(result) > defaultMaxLines {
		result = result[len(result)-defaultMaxLines:]
	}

	return strings.Join(result, "\n")
}

// CaptureForClassification captures and normalizes pane output for AI classification.
// It returns ("", false) if the pane is not an AI pane (skips non-AI panes).
// For eligible AI panes, it returns (normalizedOutput, true).
//
// PoC scope: caller is responsible for passing local panes only.
// SSH panes are NOT captured in the PoC.
func CaptureForClassification(capturer PaneCapturer, paneID string, currentCommand string) (string, bool) {
	if !IsAIPane(currentCommand) {
		return "", false
	}

	raw, err := capturer.CapturePane(paneID)
	if err != nil {
		return "", true
	}

	return NormalizeOutput(raw), true
}
