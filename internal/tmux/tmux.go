package tmux

import (
	"bytes"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

const (
	defaultBinaryPath = "tmux"
	fieldSeparator    = "\x1f"

	sessionFormat = "#{session_id}" + fieldSeparator + "#{session_name}" + fieldSeparator + "#{session_attached}" + fieldSeparator + "#{session_windows}"
	windowFormat  = "#{window_id}" + fieldSeparator + "#{window_name}" + fieldSeparator + "#{window_index}" + fieldSeparator + "#{window_active}" + fieldSeparator + "#{window_panes}" + fieldSeparator + "#{pane_id}" + fieldSeparator + "#{pane_title}"
	paneFormat    = "#{pane_id}" + fieldSeparator + "#{pane_title}" + fieldSeparator + "#{pane_index}" + fieldSeparator + "#{pane_active}" + fieldSeparator + "#{pane_width}" + fieldSeparator + "#{pane_height}" + fieldSeparator + "#{pane_left}" + fieldSeparator + "#{pane_top}"

	ErrorCodeNotFound      = "tmux_not_found"
	ErrorCodeNoSessions    = "tmux_no_sessions"
	ErrorCodeCommandFailed = "tmux_command_failed"
)

type Error struct {
	Code    string
	Message string
	Err     error
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.Message == "" && e.Err != nil {
		return e.Err.Error()
	}
	if e.Err == nil {
		return e.Message
	}
	return fmt.Sprintf("%s: %v", e.Message, e.Err)
}

func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

type commandFactory func(name string, args ...string) *exec.Cmd
type pathLookup func(file string) (string, error)

type Adapter struct {
	Path        string
	execCommand commandFactory
	lookPath    pathLookup
}

func NewAdapter(path string) Adapter {
	return Adapter{
		Path:        normalizeBinaryPath(path),
		execCommand: exec.Command,
		lookPath:    exec.LookPath,
	}
}

func DetectBinary(path string) error {
	resolvedPath := normalizeBinaryPath(path)
	if _, err := exec.LookPath(resolvedPath); err != nil {
		return newNotFoundError(resolvedPath, err)
	}
	return nil
}

func (a Adapter) ListSessions() ([]Session, error) {
	output, err := a.run(buildListSessionsArgs()...)
	if err != nil {
		if hasErrorCode(err, ErrorCodeNoSessions) {
			return []Session{}, nil
		}
		return nil, fmt.Errorf("tmux list-sessions: %w", err)
	}

	return parseSessionsOutput(output)
}

func (a Adapter) ListWindows(session string) ([]Window, error) {
	args, err := buildListWindowsArgs(session)
	if err != nil {
		return nil, err
	}

	output, err := a.run(args...)
	if err != nil {
		return nil, fmt.Errorf("tmux list-windows: %w", err)
	}

	return parseWindowsOutput(output)
}

func (a Adapter) ListPanes(session, window string) ([]Pane, error) {
	args, err := buildListPanesArgs(session, window)
	if err != nil {
		return nil, err
	}

	output, err := a.run(args...)
	if err != nil {
		return nil, fmt.Errorf("tmux list-panes: %w", err)
	}

	return parsePanesOutput(output)
}

func (a Adapter) NewSession(name string) (Session, error) {
	args, err := buildNewSessionArgs(name)
	if err != nil {
		return Session{}, err
	}

	output, err := a.run(args...)
	if err != nil {
		return Session{}, fmt.Errorf("tmux new-session: %w", err)
	}

	return parseSessionRow(output)
}

func (a Adapter) RenameSession(oldName, newName string) error {
	args, err := buildRenameSessionArgs(oldName, newName)
	if err != nil {
		return err
	}

	if _, err := a.run(args...); err != nil {
		return fmt.Errorf("tmux rename-session: %w", err)
	}

	return nil
}

func (a Adapter) KillSession(name string) error {
	args, err := buildKillSessionArgs(name)
	if err != nil {
		return err
	}

	if _, err := a.run(args...); err != nil {
		return fmt.Errorf("tmux kill-session: %w", err)
	}

	return nil
}

func (a Adapter) NewWindow(session, name string) (Window, error) {
	args, err := buildNewWindowArgs(session, name)
	if err != nil {
		return Window{}, err
	}

	output, err := a.run(args...)
	if err != nil {
		return Window{}, fmt.Errorf("tmux new-window: %w", err)
	}

	return parseWindowRow(output)
}

func (a Adapter) RenameWindow(target, name string) error {
	args, err := buildRenameWindowArgs(target, name)
	if err != nil {
		return err
	}

	if _, err := a.run(args...); err != nil {
		return fmt.Errorf("tmux rename-window: %w", err)
	}

	return nil
}

func (a Adapter) KillWindow(target string) error {
	args, err := buildKillWindowArgs(target)
	if err != nil {
		return err
	}

	if _, err := a.run(args...); err != nil {
		return fmt.Errorf("tmux kill-window: %w", err)
	}

	return nil
}

func (a Adapter) SplitPane(target string, horizontal bool) (Pane, error) {
	args, err := buildSplitPaneArgs(target, horizontal)
	if err != nil {
		return Pane{}, err
	}

	output, err := a.run(args...)
	if err != nil {
		return Pane{}, fmt.Errorf("tmux split-window: %w", err)
	}

	return parsePaneRow(output)
}

func (a Adapter) KillPane(target string) error {
	args, err := buildKillPaneArgs(target)
	if err != nil {
		return err
	}

	if _, err := a.run(args...); err != nil {
		return fmt.Errorf("tmux kill-pane: %w", err)
	}

	return nil
}

func (a Adapter) SelectWindow(target string) error {
	args, err := buildSelectWindowArgs(target)
	if err != nil {
		return err
	}

	if _, err := a.run(args...); err != nil {
		return fmt.Errorf("tmux select-window: %w", err)
	}

	return nil
}

func (a Adapter) SelectPane(target string) error {
	args, err := buildSelectPaneArgs(target)
	if err != nil {
		return err
	}

	if _, err := a.run(args...); err != nil {
		return fmt.Errorf("tmux select-pane: %w", err)
	}

	return nil
}

func buildListSessionsArgs() []string {
	return []string{"list-sessions", "-F", sessionFormat}
}

func buildListWindowsArgs(session string) ([]string, error) {
	if err := requireValue("session", session); err != nil {
		return nil, err
	}
	return []string{"list-windows", "-t", session, "-F", windowFormat}, nil
}

func buildListPanesArgs(session, window string) ([]string, error) {
	target, err := buildPaneTarget(session, window)
	if err != nil {
		return nil, err
	}
	return []string{"list-panes", "-t", target, "-F", paneFormat}, nil
}

func buildNewSessionArgs(name string) ([]string, error) {
	if err := requireValue("session name", name); err != nil {
		return nil, err
	}
	return []string{"new-session", "-d", "-s", name, "-P", "-F", sessionFormat}, nil
}

func buildRenameSessionArgs(oldName, newName string) ([]string, error) {
	if err := requireValue("old session name", oldName); err != nil {
		return nil, err
	}
	if err := requireValue("new session name", newName); err != nil {
		return nil, err
	}
	return []string{"rename-session", "-t", oldName, newName}, nil
}

func buildKillSessionArgs(name string) ([]string, error) {
	if err := requireValue("session name", name); err != nil {
		return nil, err
	}
	return []string{"kill-session", "-t", name}, nil
}

func buildNewWindowArgs(session, name string) ([]string, error) {
	if err := requireValue("session", session); err != nil {
		return nil, err
	}
	if err := requireValue("window name", name); err != nil {
		return nil, err
	}
	return []string{"new-window", "-t", session, "-n", name, "-P", "-F", windowFormat}, nil
}

func buildRenameWindowArgs(target, name string) ([]string, error) {
	if err := requireValue("window target", target); err != nil {
		return nil, err
	}
	if err := requireValue("window name", name); err != nil {
		return nil, err
	}
	return []string{"rename-window", "-t", target, name}, nil
}

func buildKillWindowArgs(target string) ([]string, error) {
	if err := requireValue("window target", target); err != nil {
		return nil, err
	}
	return []string{"kill-window", "-t", target}, nil
}

func buildSplitPaneArgs(target string, horizontal bool) ([]string, error) {
	if err := requireValue("pane target", target); err != nil {
		return nil, err
	}
	orientation := "-v"
	if horizontal {
		orientation = "-h"
	}
	return []string{"split-window", orientation, "-t", target, "-P", "-F", paneFormat}, nil
}

func buildKillPaneArgs(target string) ([]string, error) {
	if err := requireValue("pane target", target); err != nil {
		return nil, err
	}
	return []string{"kill-pane", "-t", target}, nil
}

func buildSelectWindowArgs(target string) ([]string, error) {
	if err := requireValue("window target", target); err != nil {
		return nil, err
	}
	return []string{"select-window", "-t", target}, nil
}

func buildSelectPaneArgs(target string) ([]string, error) {
	if err := requireValue("pane target", target); err != nil {
		return nil, err
	}
	return []string{"select-pane", "-t", target}, nil
}

func parseSessionsOutput(output string) ([]Session, error) {
	if strings.TrimSpace(output) == "" {
		return []Session{}, nil
	}

	lines := strings.Split(output, "\n")
	sessions := make([]Session, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		session, err := parseSessionRow(line)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}

	return sessions, nil
}

func parseWindowsOutput(output string) ([]Window, error) {
	if strings.TrimSpace(output) == "" {
		return []Window{}, nil
	}

	lines := strings.Split(output, "\n")
	windows := make([]Window, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		window, err := parseWindowRow(line)
		if err != nil {
			return nil, err
		}
		windows = append(windows, window)
	}

	return windows, nil
}

func parsePanesOutput(output string) ([]Pane, error) {
	if strings.TrimSpace(output) == "" {
		return []Pane{}, nil
	}

	lines := strings.Split(output, "\n")
	panes := make([]Pane, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		pane, err := parsePaneRow(line)
		if err != nil {
			return nil, err
		}
		panes = append(panes, pane)
	}

	return panes, nil
}

func parseSessionRow(row string) (Session, error) {
	if fields, ok := splitFormattedFields(row, 4); ok {
		attached, err := parseBoolField(fields[2])
		if err != nil {
			return Session{}, fmt.Errorf("parse session row %q: %w", row, err)
		}

		windowCount, err := strconv.Atoi(fields[3])
		if err != nil {
			return Session{}, fmt.Errorf("parse session row %q: invalid window count: %w", row, err)
		}

		return Session{ID: fields[0], Name: fields[1], Attached: attached, WindowCount: windowCount}, nil
	}

	first, last, ok := splitFirstLast(row)
	if !ok {
		return Session{}, fmt.Errorf("parse session row %q: invalid format", row)
	}

	attached, err := parseBoolField(row[last+1:])
	if err != nil {
		return Session{}, fmt.Errorf("parse session row %q: %w", row, err)
	}

	return Session{
		ID:          row[:first],
		Name:        row[first+1 : last],
		Attached:    attached,
		WindowCount: 0,
	}, nil
}

func parseWindowRow(row string) (Window, error) {
	if fields, ok := splitFormattedFields(row, 7); ok {
		index, err := strconv.Atoi(fields[2])
		if err != nil {
			return Window{}, fmt.Errorf("parse window row %q: invalid index: %w", row, err)
		}

		active, err := parseBoolField(fields[3])
		if err != nil {
			return Window{}, fmt.Errorf("parse window row %q: %w", row, err)
		}

		paneCount, err := strconv.Atoi(fields[4])
		if err != nil {
			return Window{}, fmt.Errorf("parse window row %q: invalid pane count: %w", row, err)
		}

		return Window{ID: fields[0], Name: fields[1], Index: index, Active: active, PaneCount: paneCount, ActivePaneID: fields[5], ActivePaneTitle: fields[6]}, nil
	}

	first := strings.Index(row, ":")
	if first <= 0 {
		return Window{}, fmt.Errorf("parse window row %q: invalid format", row)
	}
	last := strings.LastIndex(row, ":")
	if last <= first {
		return Window{}, fmt.Errorf("parse window row %q: invalid format", row)
	}
	secondLast := strings.LastIndex(row[:last], ":")
	if secondLast <= first {
		return Window{}, fmt.Errorf("parse window row %q: invalid format", row)
	}
	thirdLast := strings.LastIndex(row[:secondLast], ":")
	if thirdLast <= first {
		return Window{}, fmt.Errorf("parse window row %q: invalid format", row)
	}
	fourthLast := strings.LastIndex(row[:thirdLast], ":")
	if fourthLast <= first {
		return Window{}, fmt.Errorf("parse window row %q: invalid format", row)
	}
	fifthLast := strings.LastIndex(row[:fourthLast], ":")
	if fifthLast <= first {
		return Window{}, fmt.Errorf("parse window row %q: invalid format", row)
	}

	index, err := strconv.Atoi(row[fifthLast+1 : fourthLast])
	if err != nil {
		return Window{}, fmt.Errorf("parse window row %q: invalid index: %w", row, err)
	}

	active, err := parseBoolField(row[fourthLast+1 : thirdLast])
	if err != nil {
		return Window{}, fmt.Errorf("parse window row %q: %w", row, err)
	}

	paneCount, err := strconv.Atoi(row[thirdLast+1 : secondLast])
	if err != nil {
		return Window{}, fmt.Errorf("parse window row %q: invalid pane count: %w", row, err)
	}

	return Window{
		ID:              row[:first],
		Name:            row[first+1 : fifthLast],
		Index:           index,
		Active:          active,
		PaneCount:       paneCount,
		ActivePaneID:    row[secondLast+1 : last],
		ActivePaneTitle: row[last+1:],
	}, nil
}

func parsePaneRow(row string) (Pane, error) {
	if fields, ok := splitFormattedFields(row, 8); ok {
		index, err := strconv.Atoi(fields[2])
		if err != nil {
			return Pane{}, fmt.Errorf("parse pane row %q: invalid index: %w", row, err)
		}

		active, err := parseBoolField(fields[3])
		if err != nil {
			return Pane{}, fmt.Errorf("parse pane row %q: %w", row, err)
		}

		width, err := strconv.Atoi(fields[4])
		if err != nil {
			return Pane{}, fmt.Errorf("parse pane row %q: invalid width: %w", row, err)
		}

		height, err := strconv.Atoi(fields[5])
		if err != nil {
			return Pane{}, fmt.Errorf("parse pane row %q: invalid height: %w", row, err)
		}

		left, err := strconv.Atoi(fields[6])
		if err != nil {
			return Pane{}, fmt.Errorf("parse pane row %q: invalid left: %w", row, err)
		}

		top, err := strconv.Atoi(fields[7])
		if err != nil {
			return Pane{}, fmt.Errorf("parse pane row %q: invalid top: %w", row, err)
		}

		return Pane{ID: fields[0], Title: fields[1], Index: index, Active: active, Width: width, Height: height, Left: left, Top: top}, nil
	}

	first := strings.Index(row, ":")
	if first <= 0 {
		return Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}
	last := strings.LastIndex(row, ":")
	if last <= first {
		return Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}
	secondLast := strings.LastIndex(row[:last], ":")
	if secondLast <= first {
		return Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}
	thirdLast := strings.LastIndex(row[:secondLast], ":")
	if thirdLast <= first {
		return Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}
	fourthLast := strings.LastIndex(row[:thirdLast], ":")
	if fourthLast <= first {
		return Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}
	fifthLast := strings.LastIndex(row[:fourthLast], ":")
	if fifthLast <= first {
		return Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}
	sixthLast := strings.LastIndex(row[:fifthLast], ":")
	if sixthLast <= first {
		return Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}

	index, err := strconv.Atoi(row[sixthLast+1 : fifthLast])
	if err != nil {
		return Pane{}, fmt.Errorf("parse pane row %q: invalid index: %w", row, err)
	}

	active, err := parseBoolField(row[fifthLast+1 : fourthLast])
	if err != nil {
		return Pane{}, fmt.Errorf("parse pane row %q: %w", row, err)
	}

	width, err := strconv.Atoi(row[fourthLast+1 : thirdLast])
	if err != nil {
		return Pane{}, fmt.Errorf("parse pane row %q: invalid width: %w", row, err)
	}

	height, err := strconv.Atoi(row[thirdLast+1 : secondLast])
	if err != nil {
		return Pane{}, fmt.Errorf("parse pane row %q: invalid height: %w", row, err)
	}

	left, err := strconv.Atoi(row[secondLast+1 : last])
	if err != nil {
		return Pane{}, fmt.Errorf("parse pane row %q: invalid left: %w", row, err)
	}

	top, err := strconv.Atoi(row[last+1:])
	if err != nil {
		return Pane{}, fmt.Errorf("parse pane row %q: invalid top: %w", row, err)
	}

	return Pane{
		ID:     row[:first],
		Title:  row[first+1 : sixthLast],
		Index:  index,
		Active: active,
		Width:  width,
		Height: height,
		Left:   left,
		Top:    top,
	}, nil
}

func parseBoolField(value string) (bool, error) {
	switch strings.TrimSpace(value) {
	case "1", "true":
		return true, nil
	case "0", "false":
		return false, nil
	default:
		return false, fmt.Errorf("invalid boolean value %q", value)
	}
}

func normalizeBinaryPath(path string) string {
	if strings.TrimSpace(path) == "" {
		return defaultBinaryPath
	}
	return path
}

func requireValue(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s cannot be empty", field)
	}
	return nil
}

func buildPaneTarget(session, window string) (string, error) {
	if err := requireValue("window target", window); err != nil {
		return "", err
	}

	if strings.HasPrefix(window, "@") || strings.HasPrefix(window, "%") || strings.Contains(window, ":") {
		return window, nil
	}
	if strings.TrimSpace(session) == "" {
		return window, nil
	}
	return fmt.Sprintf("%s:%s", session, window), nil
}

func (a Adapter) run(args ...string) (string, error) {
	if err := a.detectBinary(); err != nil {
		return "", err
	}

	command := a.command(args...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr

	if err := command.Run(); err != nil {
		stderrText := strings.TrimSpace(stderr.String())
		if isNoSessionsError(stderrText) {
			return "", &Error{
				Code:    ErrorCodeNoSessions,
				Message: "tmux has no sessions",
				Err:     err,
			}
		}
		if errors.Is(err, exec.ErrNotFound) {
			return "", newNotFoundError(a.Path, err)
		}
		return "", &Error{
			Code:    ErrorCodeCommandFailed,
			Message: commandFailedMessage(args, stderrText),
			Err:     err,
		}
	}

	return strings.TrimSpace(stdout.String()), nil
}

func (a Adapter) detectBinary() error {
	lookup := a.lookPath
	if lookup == nil {
		lookup = exec.LookPath
	}

	path := normalizeBinaryPath(a.Path)
	if _, err := lookup(path); err != nil {
		return newNotFoundError(path, err)
	}
	return nil
}

func (a Adapter) command(args ...string) *exec.Cmd {
	command := a.execCommand
	if command == nil {
		command = exec.Command
	}
	return command(normalizeBinaryPath(a.Path), args...)
}

func newNotFoundError(path string, err error) error {
	return &Error{
		Code:    ErrorCodeNotFound,
		Message: fmt.Sprintf("tmux binary %q not found", normalizeBinaryPath(path)),
		Err:     err,
	}
}

func hasErrorCode(err error, code string) bool {
	var tmuxErr *Error
	return errors.As(err, &tmuxErr) && tmuxErr.Code == code
}

func isNoSessionsError(stderr string) bool {
	text := strings.ToLower(strings.TrimSpace(stderr))
	if text == "" {
		return false
	}

	return strings.Contains(text, "no sessions") ||
		strings.Contains(text, "no server running") ||
		strings.Contains(text, "failed to connect to server") ||
		strings.Contains(text, "error connecting to")
}

func commandFailedMessage(args []string, stderr string) string {
	if stderr != "" {
		return fmt.Sprintf("tmux command failed: %s", stderr)
	}
	return fmt.Sprintf("tmux command failed: %s", strings.Join(args, " "))
}

func splitFirstLast(value string) (int, int, bool) {
	first := strings.Index(value, ":")
	last := strings.LastIndex(value, ":")
	if first <= 0 || last <= first {
		return 0, 0, false
	}
	return first, last, true
}

func splitFormattedFields(row string, count int) ([]string, bool) {
	if !strings.Contains(row, fieldSeparator) {
		return nil, false
	}
	fields := strings.Split(row, fieldSeparator)
	if len(fields) != count {
		return nil, false
	}
	return fields, true
}
