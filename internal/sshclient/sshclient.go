package sshclient

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"
)

const (
	defaultSSHPort = 22

	ErrorCodeKeyUnreadable   = "ssh_key_unreadable"
	ErrorCodeUnknownHost     = "ssh_unknown_host"
	ErrorCodeHostKeyMismatch = "ssh_host_key_mismatch"
	ErrorCodeConnectionFailed = "ssh_connection_failed"
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

type Config struct {
	Host           string `json:"host,omitempty"`
	Port           int    `json:"port,omitempty"`
	User           string `json:"user,omitempty"`
	PrivateKeyPath string `json:"privateKeyPath,omitempty"`
	KnownHostsPath string `json:"knownHostsPath,omitempty"`
}

type dialFunc func(network, addr string, config *ssh.ClientConfig) (*ssh.Client, error)
type readFileFunc func(name string) ([]byte, error)
type homeDirFunc func() (string, error)
type hostKeyCallbackFactory func(files ...string) (ssh.HostKeyCallback, error)
type networkDialFunc func(network, address string) (net.Conn, error)
type envLookupFunc func(key string) (string, bool)

type Client struct {
	Config Config `json:"config"`

	client           *ssh.Client
	agentConn        net.Conn
	dial             dialFunc
	readFile         readFileFunc
	userHomeDir      homeDirFunc
	hostKeyCallback  hostKeyCallbackFactory
	agentDial        networkDialFunc
	lookupEnv        envLookupFunc
}

type Session struct {
	raw *ssh.Session
}

func New(config Config) Client {
	return Client{
		Config:          config,
		dial:            ssh.Dial,
		readFile:        os.ReadFile,
		userHomeDir:     os.UserHomeDir,
		hostKeyCallback: knownhosts.New,
		agentDial:       net.Dial,
		lookupEnv:       os.LookupEnv,
	}
}

func (c *Client) Connect() (err error) {
	if c == nil {
		return &Error{Code: ErrorCodeConnectionFailed, Message: "SSH client is nil"}
	}
	if c.client != nil {
		return nil
	}

	defer func() {
		if err != nil {
			_ = c.closeAgentConn()
		}
	}()

	host := strings.TrimSpace(c.Config.Host)
	if host == "" {
		return &Error{Code: ErrorCodeConnectionFailed, Message: "SSH host is required"}
	}
	user := strings.TrimSpace(c.Config.User)
	if user == "" {
		return &Error{Code: ErrorCodeConnectionFailed, Message: "SSH user is required"}
	}

	knownHostsPath, err := c.resolveKnownHostsPath()
	if err != nil {
		return err
	}

	hostKeyCallback, err := c.hostKeyCallback(knownHostsPath)
	if err != nil {
		return &Error{
			Code:    ErrorCodeKeyUnreadable,
			Message: fmt.Sprintf("failed to read known_hosts file %q", knownHostsPath),
			Err:     err,
		}
	}

	authMethods, err := c.buildAuthMethods()
	if err != nil {
		return err
	}

	addr := net.JoinHostPort(host, fmt.Sprintf("%d", c.port()))
	sshClient, err := c.dial("tcp", addr, &ssh.ClientConfig{
		User:            user,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
		Timeout:         10 * time.Second,
	})
	if err != nil {
		return classifyConnectError(host, c.port(), err)
	}

	c.client = sshClient
	return nil
}

func (c *Client) NewSession() (*Session, error) {
	if c == nil {
		return nil, &Error{Code: ErrorCodeConnectionFailed, Message: "SSH client is nil"}
	}
	if c.client == nil {
		return nil, &Error{Code: ErrorCodeConnectionFailed, Message: "SSH client is not connected"}
	}

	raw, err := c.client.NewSession()
	if err != nil {
		return nil, &Error{Code: ErrorCodeConnectionFailed, Message: "failed to create SSH session", Err: err}
	}

	return &Session{raw: raw}, nil
}

func (s *Session) RequestPty(term string, rows, cols int) error {
	if s == nil || s.raw == nil {
		return &Error{Code: ErrorCodeConnectionFailed, Message: "SSH session is not available"}
	}
	if strings.TrimSpace(term) == "" {
		term = "xterm-256color"
	}

	return s.raw.RequestPty(term, rows, cols, ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	})
}

func (s *Session) WindowChange(rows, cols int) error {
	if s == nil || s.raw == nil {
		return &Error{Code: ErrorCodeConnectionFailed, Message: "SSH session is not available"}
	}
	return s.raw.WindowChange(rows, cols)
}

func (s *Session) StdoutPipe() (io.Reader, error) {
	if s == nil || s.raw == nil {
		return nil, &Error{Code: ErrorCodeConnectionFailed, Message: "SSH session is not available"}
	}
	return s.raw.StdoutPipe()
}

func (s *Session) StderrPipe() (io.Reader, error) {
	if s == nil || s.raw == nil {
		return nil, &Error{Code: ErrorCodeConnectionFailed, Message: "SSH session is not available"}
	}
	return s.raw.StderrPipe()
}

func (s *Session) StdinPipe() (io.WriteCloser, error) {
	if s == nil || s.raw == nil {
		return nil, &Error{Code: ErrorCodeConnectionFailed, Message: "SSH session is not available"}
	}
	return s.raw.StdinPipe()
}

func (s *Session) Output(command string) ([]byte, error) {
	if s == nil || s.raw == nil {
		return nil, &Error{Code: ErrorCodeConnectionFailed, Message: "SSH session is not available"}
	}
	return s.raw.Output(command)
}

func (s *Session) CombinedOutput(command string) ([]byte, error) {
	if s == nil || s.raw == nil {
		return nil, &Error{Code: ErrorCodeConnectionFailed, Message: "SSH session is not available"}
	}
	return s.raw.CombinedOutput(command)
}

func (s *Session) Start(command string) error {
	if s == nil || s.raw == nil {
		return &Error{Code: ErrorCodeConnectionFailed, Message: "SSH session is not available"}
	}
	return s.raw.Start(command)
}

func (s *Session) Wait() error {
	if s == nil || s.raw == nil {
		return &Error{Code: ErrorCodeConnectionFailed, Message: "SSH session is not available"}
	}
	return s.raw.Wait()
}

func (s *Session) Shell() error {
	if s == nil || s.raw == nil {
		return &Error{Code: ErrorCodeConnectionFailed, Message: "SSH session is not available"}
	}
	return s.raw.Shell()
}

func (s *Session) Close() error {
	if s == nil || s.raw == nil {
		return nil
	}
	return s.raw.Close()
}

func (c *Client) Close() error {
	if c == nil {
		return nil
	}

	var errs []error
	if c.client != nil {
		errs = append(errs, c.client.Close())
		c.client = nil
	}
	if err := c.closeAgentConn(); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

func (c *Client) resolveKnownHostsPath() (string, error) {
	if path := strings.TrimSpace(c.Config.KnownHostsPath); path != "" {
		return path, nil
	}

	homeDir, err := c.userHomeDir()
	if err != nil {
		return "", &Error{Code: ErrorCodeKeyUnreadable, Message: "failed to resolve home directory for known_hosts", Err: err}
	}
	return filepath.Join(homeDir, ".ssh", "known_hosts"), nil
}

func (c *Client) buildAuthMethods() ([]ssh.AuthMethod, error) {
	methods := make([]ssh.AuthMethod, 0, 2)

	privateKeyPath := strings.TrimSpace(c.Config.PrivateKeyPath)
	if privateKeyPath != "" {
		signer, err := c.loadPrivateKey(privateKeyPath)
		if err != nil {
			return nil, err
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}

	agentAuth, err := c.loadAgentAuthMethod()
	if err != nil {
		if len(methods) == 0 {
			return nil, err
		}
		agentAuth = nil
	}
	if agentAuth != nil {
		methods = append(methods, agentAuth)
	}

	if len(methods) == 0 {
		return nil, &Error{Code: ErrorCodeConnectionFailed, Message: "no SSH authentication method available"}
	}

	return methods, nil
}

func (c *Client) loadPrivateKey(path string) (ssh.Signer, error) {
	privateKey, err := c.readFile(path)
	if err != nil {
		return nil, &Error{Code: ErrorCodeKeyUnreadable, Message: fmt.Sprintf("failed to read private key %q", path), Err: err}
	}

	signer, err := ssh.ParsePrivateKey(privateKey)
	if err != nil {
		return nil, &Error{Code: ErrorCodeKeyUnreadable, Message: fmt.Sprintf("failed to parse private key %q", path), Err: err}
	}

	return signer, nil
}

func (c *Client) loadAgentAuthMethod() (ssh.AuthMethod, error) {
	sshAuthSock, ok := c.lookupEnv("SSH_AUTH_SOCK")
	if !ok || strings.TrimSpace(sshAuthSock) == "" {
		return nil, nil
	}

	conn, err := c.agentDial("unix", sshAuthSock)
	if err != nil {
		return nil, &Error{Code: ErrorCodeConnectionFailed, Message: "failed to connect to ssh-agent", Err: err}
	}

	c.agentConn = conn
	return ssh.PublicKeysCallback(agent.NewClient(conn).Signers), nil
}

func (c *Client) closeAgentConn() error {
	if c.agentConn == nil {
		return nil
	}
	err := c.agentConn.Close()
	c.agentConn = nil
	return err
}

func (c *Client) port() int {
	if c.Config.Port > 0 {
		return c.Config.Port
	}
	return defaultSSHPort
}

func classifyConnectError(host string, port int, err error) error {
	if keyErr, ok := errors.AsType[*knownhosts.KeyError](err); ok {
		address := net.JoinHostPort(host, fmt.Sprintf("%d", port))
		if len(keyErr.Want) == 0 {
			return &Error{
				Code:    ErrorCodeUnknownHost,
				Message: fmt.Sprintf("SSH host %s is unknown; add it to known_hosts and try again", address),
				Err:     err,
			}
		}
		return &Error{
			Code:    ErrorCodeHostKeyMismatch,
			Message: fmt.Sprintf("SSH host key mismatch for %s; verify the server identity and update known_hosts", address),
			Err:     err,
		}
	}

	return &Error{
		Code:    ErrorCodeConnectionFailed,
		Message: fmt.Sprintf("failed to connect to SSH host %s", net.JoinHostPort(host, fmt.Sprintf("%d", port))),
		Err:     err,
	}
}
