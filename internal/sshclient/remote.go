package sshclient

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/panh/wmux/internal/tmux"
)

const (
	defaultRemoteTmuxPath = "tmux"
	remoteFieldSeparator  = "\x1f"

	remoteSessionFormat = "#{session_id}" + remoteFieldSeparator + "#{session_name}" + remoteFieldSeparator + "#{session_attached}" + remoteFieldSeparator + "#{session_windows}"
	remoteWindowFormat  = "#{window_id}" + remoteFieldSeparator + "#{window_name}" + remoteFieldSeparator + "#{window_index}" + remoteFieldSeparator + "#{window_active}" + remoteFieldSeparator + "#{window_panes}" + remoteFieldSeparator + "#{pane_id}" + remoteFieldSeparator + "#{pane_title}"
	remotePaneFormat    = "#{pane_id}" + remoteFieldSeparator + "#{pane_title}" + remoteFieldSeparator + "#{pane_index}" + remoteFieldSeparator + "#{pane_active}" + remoteFieldSeparator + "#{pane_width}" + remoteFieldSeparator + "#{pane_height}" + remoteFieldSeparator + "#{pane_left}" + remoteFieldSeparator + "#{pane_top}" + remoteFieldSeparator + "#{pane_dead}" + remoteFieldSeparator + "#{pane_input_off}" + remoteFieldSeparator + "#{pane_in_mode}" + remoteFieldSeparator + "#{alternate_on}" + remoteFieldSeparator + "#{pane_current_command}"
)

type remoteCommandRunner func(binary string, args ...string) (string, error)
type remoteSessionFactory func() (*Session, error)

type Remote struct {
	Client     *Client
	BinaryPath string

	runCommand remoteCommandRunner
	newSession remoteSessionFactory
}

func NewRemote(client *Client) Remote {
	return Remote{Client: client, BinaryPath: defaultRemoteTmuxPath}
}

func (r Remote) ListSessions() ([]tmux.Session, error) {
	output, err := r.run(buildRemoteListSessionsArgs()...)
	if err != nil {
		if isRemoteNoSessionsError(err) {
			return []tmux.Session{}, nil
		}
		return nil, fmt.Errorf("remote tmux list-sessions: %w", err)
	}

	return parseRemoteSessionsOutput(output)
}

func (r Remote) ListWindows(session string) ([]tmux.Window, error) {
	args, err := buildRemoteListWindowsArgs(session)
	if err != nil {
		return nil, err
	}

	output, err := r.run(args...)
	if err != nil {
		return nil, fmt.Errorf("remote tmux list-windows: %w", err)
	}

	return parseRemoteWindowsOutput(output)
}

func (r Remote) ListPanes(target string) ([]tmux.Pane, error) {
	args, err := buildRemoteListPanesArgs(target)
	if err != nil {
		return nil, err
	}

	output, err := r.run(args...)
	if err != nil {
		return nil, fmt.Errorf("remote tmux list-panes: %w", err)
	}

	return parseRemotePanesOutput(output)
}

func (r Remote) NewSession(name string) (tmux.Session, error) {
	args, err := buildRemoteNewSessionArgs(name)
	if err != nil {
		return tmux.Session{}, err
	}

	output, err := r.run(args...)
	if err != nil {
		return tmux.Session{}, fmt.Errorf("remote tmux new-session: %w", err)
	}

	return parseRemoteSessionRow(output)
}

func (r Remote) KillSession(name string) error {
	args, err := buildRemoteKillSessionArgs(name)
	if err != nil {
		return err
	}

	if _, err := r.run(args...); err != nil {
		return fmt.Errorf("remote tmux kill-session: %w", err)
	}

	return nil
}

func (r Remote) RenameSession(oldName, newName string) error {
	args, err := buildRemoteRenameSessionArgs(oldName, newName)
	if err != nil {
		return err
	}

	if _, err := r.run(args...); err != nil {
		return fmt.Errorf("remote tmux rename-session: %w", err)
	}

	return nil
}

func (r Remote) NewWindow(session, name string) (tmux.Window, error) {
	args, err := buildRemoteNewWindowArgs(session, name)
	if err != nil {
		return tmux.Window{}, err
	}

	output, err := r.run(args...)
	if err != nil {
		return tmux.Window{}, fmt.Errorf("remote tmux new-window: %w", err)
	}

	return parseRemoteWindowRow(output)
}

func (r Remote) KillWindow(target string) error {
	args, err := buildRemoteKillWindowArgs(target)
	if err != nil {
		return err
	}

	if _, err := r.run(args...); err != nil {
		return fmt.Errorf("remote tmux kill-window: %w", err)
	}

	return nil
}

func (r Remote) SplitPane(target string, horizontal bool) (tmux.Pane, error) {
	args, err := buildRemoteSplitPaneArgs(target, horizontal)
	if err != nil {
		return tmux.Pane{}, err
	}

	output, err := r.run(args...)
	if err != nil {
		return tmux.Pane{}, fmt.Errorf("remote tmux split-window: %w", err)
	}

	return parseRemotePaneRow(output)
}

func (r Remote) KillPane(target string) error {
	args, err := buildRemoteKillPaneArgs(target)
	if err != nil {
		return err
	}

	if _, err := r.run(args...); err != nil {
		return fmt.Errorf("remote tmux kill-pane: %w", err)
	}

	return nil
}

func (r Remote) AttachSession(target, term string, rows, cols int) (*Session, error) {
	if err := requireRemoteValue("session target", target); err != nil {
		return nil, err
	}

	session, err := r.sessionFactory()()
	if err != nil {
		return nil, err
	}

	if err := session.RequestPty(term, rows, cols); err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("request SSH PTY: %w", err)
	}

	command := buildRemoteExecCommand(r.binaryPath(), "attach-session", "-t", target)
	if err := session.Start(command); err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("start remote tmux attach-session: %w", err)
	}

	return session, nil
}

type remoteNoSessionsError struct {
	err error
}

func (e *remoteNoSessionsError) Error() string {
	if e == nil || e.err == nil {
		return ""
	}
	return e.err.Error()
}

func (e *remoteNoSessionsError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func buildRemoteListSessionsArgs() []string {
	return []string{"list-sessions", "-F", remoteSessionFormat}
}

func buildRemoteListWindowsArgs(session string) ([]string, error) {
	if err := requireRemoteValue("session", session); err != nil {
		return nil, err
	}
	return []string{"list-windows", "-t", session, "-F", remoteWindowFormat}, nil
}

func buildRemoteListPanesArgs(target string) ([]string, error) {
	if err := requireRemoteValue("pane target", target); err != nil {
		return nil, err
	}
	return []string{"list-panes", "-t", target, "-F", remotePaneFormat}, nil
}

func buildRemoteNewSessionArgs(name string) ([]string, error) {
	if err := requireRemoteValue("session name", name); err != nil {
		return nil, err
	}
	return []string{"new-session", "-d", "-s", name, "-P", "-F", remoteSessionFormat}, nil
}

func buildRemoteKillSessionArgs(name string) ([]string, error) {
	if err := requireRemoteValue("session name", name); err != nil {
		return nil, err
	}
	return []string{"kill-session", "-t", name}, nil
}

func buildRemoteRenameSessionArgs(oldName, newName string) ([]string, error) {
	if err := requireRemoteValue("old session name", oldName); err != nil {
		return nil, err
	}
	if err := requireRemoteValue("new session name", newName); err != nil {
		return nil, err
	}
	return []string{"rename-session", "-t", oldName, newName}, nil
}

func buildRemoteNewWindowArgs(session, name string) ([]string, error) {
	if err := requireRemoteValue("session", session); err != nil {
		return nil, err
	}
	if err := requireRemoteValue("window name", name); err != nil {
		return nil, err
	}
	return []string{"new-window", "-t", session, "-n", name, "-P", "-F", remoteWindowFormat}, nil
}

func buildRemoteKillWindowArgs(target string) ([]string, error) {
	if err := requireRemoteValue("window target", target); err != nil {
		return nil, err
	}
	return []string{"kill-window", "-t", target}, nil
}

func buildRemoteSplitPaneArgs(target string, horizontal bool) ([]string, error) {
	if err := requireRemoteValue("pane target", target); err != nil {
		return nil, err
	}

	orientation := "-v"
	if horizontal {
		orientation = "-h"
	}
	return []string{"split-window", orientation, "-t", target, "-P", "-F", remotePaneFormat}, nil
}

func buildRemoteKillPaneArgs(target string) ([]string, error) {
	if err := requireRemoteValue("pane target", target); err != nil {
		return nil, err
	}
	return []string{"kill-pane", "-t", target}, nil
}

func parseRemoteSessionsOutput(output string) ([]tmux.Session, error) {
	if strings.TrimSpace(output) == "" {
		return []tmux.Session{}, nil
	}

	lines := strings.Split(output, "\n")
	sessions := make([]tmux.Session, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		session, err := parseRemoteSessionRow(line)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}

	return sessions, nil
}

func parseRemoteWindowsOutput(output string) ([]tmux.Window, error) {
	if strings.TrimSpace(output) == "" {
		return []tmux.Window{}, nil
	}

	lines := strings.Split(output, "\n")
	windows := make([]tmux.Window, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		window, err := parseRemoteWindowRow(line)
		if err != nil {
			return nil, err
		}
		windows = append(windows, window)
	}

	return windows, nil
}

func parseRemotePanesOutput(output string) ([]tmux.Pane, error) {
	if strings.TrimSpace(output) == "" {
		return []tmux.Pane{}, nil
	}

	lines := strings.Split(output, "\n")
	panes := make([]tmux.Pane, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		pane, err := parseRemotePaneRow(line)
		if err != nil {
			return nil, err
		}
		panes = append(panes, pane)
	}

	return panes, nil
}

func parseRemoteSessionRow(row string) (tmux.Session, error) {
	if fields, ok := splitRemoteFormattedFields(row, 4); ok {
		attached, err := parseRemoteBoolField(fields[2])
		if err != nil {
			return tmux.Session{}, fmt.Errorf("parse session row %q: %w", row, err)
		}

		windowCount, err := strconv.Atoi(fields[3])
		if err != nil {
			return tmux.Session{}, fmt.Errorf("parse session row %q: invalid window count: %w", row, err)
		}

		return tmux.Session{ID: fields[0], Name: fields[1], Attached: attached, WindowCount: windowCount}, nil
	}

	first, last, ok := splitRemoteFirstLast(row)
	if !ok {
		return tmux.Session{}, fmt.Errorf("parse session row %q: invalid format", row)
	}

	attached, err := parseRemoteBoolField(row[last+1:])
	if err != nil {
		return tmux.Session{}, fmt.Errorf("parse session row %q: %w", row, err)
	}

	return tmux.Session{
		ID:          row[:first],
		Name:        row[first+1 : last],
		Attached:    attached,
		WindowCount: 0,
	}, nil
}

func parseRemoteWindowRow(row string) (tmux.Window, error) {
	if fields, ok := splitRemoteFormattedFields(row, 7); ok {
		index, err := strconv.Atoi(fields[2])
		if err != nil {
			return tmux.Window{}, fmt.Errorf("parse window row %q: invalid index: %w", row, err)
		}

		active, err := parseRemoteBoolField(fields[3])
		if err != nil {
			return tmux.Window{}, fmt.Errorf("parse window row %q: %w", row, err)
		}

		paneCount, err := strconv.Atoi(fields[4])
		if err != nil {
			return tmux.Window{}, fmt.Errorf("parse window row %q: invalid pane count: %w", row, err)
		}

		return tmux.Window{ID: fields[0], Name: fields[1], Index: index, Active: active, PaneCount: paneCount, ActivePaneID: fields[5], ActivePaneTitle: fields[6]}, nil
	}

	first := strings.Index(row, ":")
	if first <= 0 {
		return tmux.Window{}, fmt.Errorf("parse window row %q: invalid format", row)
	}
	last := strings.LastIndex(row, ":")
	if last <= first {
		return tmux.Window{}, fmt.Errorf("parse window row %q: invalid format", row)
	}
	secondLast := strings.LastIndex(row[:last], ":")
	if secondLast <= first {
		return tmux.Window{}, fmt.Errorf("parse window row %q: invalid format", row)
	}
	thirdLast := strings.LastIndex(row[:secondLast], ":")
	if thirdLast <= first {
		return tmux.Window{}, fmt.Errorf("parse window row %q: invalid format", row)
	}
	fourthLast := strings.LastIndex(row[:thirdLast], ":")
	if fourthLast <= first {
		return tmux.Window{}, fmt.Errorf("parse window row %q: invalid format", row)
	}
	fifthLast := strings.LastIndex(row[:fourthLast], ":")
	if fifthLast <= first {
		return tmux.Window{}, fmt.Errorf("parse window row %q: invalid format", row)
	}

	index, err := strconv.Atoi(row[fifthLast+1 : fourthLast])
	if err != nil {
		return tmux.Window{}, fmt.Errorf("parse window row %q: invalid index: %w", row, err)
	}

	active, err := parseRemoteBoolField(row[fourthLast+1 : thirdLast])
	if err != nil {
		return tmux.Window{}, fmt.Errorf("parse window row %q: %w", row, err)
	}

	paneCount, err := strconv.Atoi(row[thirdLast+1 : secondLast])
	if err != nil {
		return tmux.Window{}, fmt.Errorf("parse window row %q: invalid pane count: %w", row, err)
	}

	return tmux.Window{
		ID:              row[:first],
		Name:            row[first+1 : fifthLast],
		Index:           index,
		Active:          active,
		PaneCount:       paneCount,
		ActivePaneID:    row[secondLast+1 : last],
		ActivePaneTitle: row[last+1:],
	}, nil
}

func parseRemotePaneRow(row string) (tmux.Pane, error) {
	if fields, ok := splitRemoteFormattedFields(row, 13); ok {
		index, err := strconv.Atoi(fields[2])
		if err != nil {
			return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid index: %w", row, err)
		}

		active, err := parseRemoteBoolField(fields[3])
		if err != nil {
			return tmux.Pane{}, fmt.Errorf("parse pane row %q: %w", row, err)
		}

		width, err := strconv.Atoi(fields[4])
		if err != nil {
			return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid width: %w", row, err)
		}

		height, err := strconv.Atoi(fields[5])
		if err != nil {
			return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid height: %w", row, err)
		}

		left, err := strconv.Atoi(fields[6])
		if err != nil {
			return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid left: %w", row, err)
		}

		top, err := strconv.Atoi(fields[7])
		if err != nil {
			return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid top: %w", row, err)
		}

		dead, err := parseRemoteBoolField(fields[8])
		if err != nil {
			return tmux.Pane{}, fmt.Errorf("parse pane row %q: %w", row, err)
		}

		inputOff, err := parseRemoteBoolField(fields[9])
		if err != nil {
			return tmux.Pane{}, fmt.Errorf("parse pane row %q: %w", row, err)
		}

		inMode, err := parseRemoteBoolField(fields[10])
		if err != nil {
			return tmux.Pane{}, fmt.Errorf("parse pane row %q: %w", row, err)
		}

		alternateOn, err := parseRemoteBoolField(fields[11])
		if err != nil {
			return tmux.Pane{}, fmt.Errorf("parse pane row %q: %w", row, err)
		}

		currentCommand := fields[12]

		return tmux.Pane{
			ID: fields[0], Title: fields[1], Index: index, Active: active,
			Width: width, Height: height, Left: left, Top: top,
			Dead: dead, InputOff: inputOff, InMode: inMode,
			AlternateOn: alternateOn, CurrentCommand: currentCommand,
			AttentionState: tmux.DeriveAttentionState(dead, inputOff, inMode, alternateOn, currentCommand),
		}, nil
	}

	first := strings.Index(row, ":")
	if first <= 0 {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}
	last := strings.LastIndex(row, ":")
	if last <= first {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}
	secondLast := strings.LastIndex(row[:last], ":")
	if secondLast <= first {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}
	thirdLast := strings.LastIndex(row[:secondLast], ":")
	if thirdLast <= first {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}
	fourthLast := strings.LastIndex(row[:thirdLast], ":")
	if fourthLast <= first {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}
	fifthLast := strings.LastIndex(row[:fourthLast], ":")
	if fifthLast <= first {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}
	sixthLast := strings.LastIndex(row[:fifthLast], ":")
	if sixthLast <= first {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid format", row)
	}

	index, err := strconv.Atoi(row[sixthLast+1 : fifthLast])
	if err != nil {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid index: %w", row, err)
	}

	active, err := parseRemoteBoolField(row[fifthLast+1 : fourthLast])
	if err != nil {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: %w", row, err)
	}

	width, err := strconv.Atoi(row[fourthLast+1 : thirdLast])
	if err != nil {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid width: %w", row, err)
	}

	height, err := strconv.Atoi(row[thirdLast+1 : secondLast])
	if err != nil {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid height: %w", row, err)
	}

	left, err := strconv.Atoi(row[secondLast+1 : last])
	if err != nil {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid left: %w", row, err)
	}

	top, err := strconv.Atoi(row[last+1:])
	if err != nil {
		return tmux.Pane{}, fmt.Errorf("parse pane row %q: invalid top: %w", row, err)
	}

	return tmux.Pane{
		ID:     row[:first],
		Title:  row[first+1 : sixthLast],
		Index:  index,
		Active: active,
		Width:  width,
		Height: height,
		Left:   left,
		Top:    top,
		Dead: false, InputOff: false, InMode: false, AlternateOn: false, CurrentCommand: "",
		AttentionState: tmux.AttentionStateNone,
	}, nil
}

func parseRemoteBoolField(value string) (bool, error) {
	value = strings.TrimSpace(value)
	switch value {
	case "1", "true":
		return true, nil
	case "0", "false":
		return false, nil
	default:
		// Some tmux fields (e.g., session_attached) return numeric counts > 1
		if i, err := strconv.Atoi(value); err == nil {
			return i != 0, nil
		}
		return false, fmt.Errorf("invalid boolean value %q", value)
	}
}

func splitRemoteFirstLast(value string) (int, int, bool) {
	first := strings.Index(value, ":")
	last := strings.LastIndex(value, ":")
	if first <= 0 || last <= first {
		return 0, 0, false
	}
	return first, last, true
}

func splitRemoteFormattedFields(row string, count int) ([]string, bool) {
	if !strings.Contains(row, remoteFieldSeparator) {
		return nil, false
	}
	fields := strings.Split(row, remoteFieldSeparator)
	if len(fields) != count {
		return nil, false
	}
	return fields, true
}

func requireRemoteValue(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s cannot be empty", field)
	}
	return nil
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

func (r Remote) run(args ...string) (string, error) {
	runner := r.runCommand
	if runner == nil {
		runner = r.execRemoteCommand
	}

	output, err := runner(r.binaryPath(), args...)
	if err != nil && isNoSessionsText(err.Error()) {
		return "", &remoteNoSessionsError{err: err}
	}
	return output, err
}

func (r Remote) execRemoteCommand(binary string, args ...string) (string, error) {
	session, err := r.sessionFactory()()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(buildRemoteExecCommand(binary, args...))
	text := strings.TrimSpace(string(output))
	if err != nil {
		if isNoSessionsText(text) {
			return "", &remoteNoSessionsError{err: fmt.Errorf("%s: %w", text, err)}
		}
		if text == "" {
			text = strings.Join(args, " ")
		}
		return "", fmt.Errorf("remote command failed: %s: %w", text, err)
	}

	return text, nil
}

func (r Remote) sessionFactory() remoteSessionFactory {
	if r.newSession != nil {
		return r.newSession
	}
	return func() (*Session, error) {
		if r.Client == nil {
			return nil, &Error{Code: ErrorCodeConnectionFailed, Message: "SSH client is nil"}
		}
		return r.Client.NewSession()
	}
}

func (r Remote) binaryPath() string {
	if strings.TrimSpace(r.BinaryPath) == "" {
		return defaultRemoteTmuxPath
	}
	return r.BinaryPath
}

func isRemoteNoSessionsError(err error) bool {
	var noSessionsErr *remoteNoSessionsError
	return errors.As(err, &noSessionsErr)
}

func isNoSessionsText(text string) bool {
	text = strings.ToLower(strings.TrimSpace(text))
	if text == "" {
		return false
	}
	return strings.Contains(text, "no sessions") ||
		strings.Contains(text, "no server running") ||
		strings.Contains(text, "failed to connect to server") ||
		strings.Contains(text, "error connecting to") ||
		strings.Contains(text, "failed to connect to")
}
