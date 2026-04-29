package sshclient

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
	"github.com/panh/wmux/internal/tmux"
)

func TestNewClient(t *testing.T) {
	client := New(Config{Host: "example.com", Port: 22, User: "root"})
	if client.Config.Host != "example.com" {
		t.Fatalf("unexpected host: %q", client.Config.Host)
	}
	if client.port() != 22 {
		t.Fatalf("unexpected port: %d", client.port())
	}
}

func TestConnectInvalidPrivateKeyPathReturnsKeyUnreadable(t *testing.T) {
	client := New(Config{
		Host:           "example.com",
		Port:           22,
		User:           "root",
		PrivateKeyPath: filepath.Join(t.TempDir(), "missing-key"),
		KnownHostsPath: writeKnownHostsFile(t, ""),
	})
	client.dial = func(string, string, *ssh.ClientConfig) (*ssh.Client, error) {
		t.Fatal("dial should not be called when private key is unreadable")
		return nil, nil
	}

	err := client.Connect()
	assertErrorCode(t, err, ErrorCodeKeyUnreadable)
}

func TestConnectMissingKnownHostsReturnsKeyUnreadable(t *testing.T) {
	client := New(Config{
		Host:           "example.com",
		Port:           22,
		User:           "root",
		KnownHostsPath: filepath.Join(t.TempDir(), "missing-known-hosts"),
	})

	err := client.Connect()
	assertErrorCode(t, err, ErrorCodeKeyUnreadable)
}

func TestConnectHostKeyMismatchReturnsSpecificCode(t *testing.T) {
	privateKeyPath, signer := writePrivateKeyFile(t)
	knownHostsPath := writeKnownHostsFile(t, "")

	client := New(Config{
		Host:           "example.com",
		Port:           2222,
		User:           "root",
		PrivateKeyPath: privateKeyPath,
		KnownHostsPath: knownHostsPath,
	})
	client.dial = func(string, string, *ssh.ClientConfig) (*ssh.Client, error) {
		return nil, fmt.Errorf("handshake failed: %w", &knownhosts.KeyError{Want: []knownhosts.KnownKey{{
			Filename: knownHostsPath,
			Line:     1,
			Key:      signer.PublicKey(),
		}}})
	}

	err := client.Connect()
	assertErrorCode(t, err, ErrorCodeHostKeyMismatch)
}

func TestConnectUnknownHostReturnsSpecificCode(t *testing.T) {
	privateKeyPath, _ := writePrivateKeyFile(t)

	client := New(Config{
		Host:           "example.com",
		Port:           2222,
		User:           "root",
		PrivateKeyPath: privateKeyPath,
		KnownHostsPath: writeKnownHostsFile(t, ""),
	})
	client.dial = func(string, string, *ssh.ClientConfig) (*ssh.Client, error) {
		return nil, fmt.Errorf("handshake failed: %w", &knownhosts.KeyError{})
	}

	err := client.Connect()
	assertErrorCode(t, err, ErrorCodeUnknownHost)
}

func TestClientJSONDoesNotSerializeRuntimeSecrets(t *testing.T) {
	privateKeyPath, _ := writePrivateKeyFile(t)
	secretBytes, err := os.ReadFile(privateKeyPath)
	if err != nil {
		t.Fatalf("read private key: %v", err)
	}

	client := New(Config{
		Host:           "example.com",
		Port:           22,
		User:           "root",
		PrivateKeyPath: privateKeyPath,
		KnownHostsPath: writeKnownHostsFile(t, ""),
	})

	payload, err := json.Marshal(client)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	if bytes.Contains(payload, secretBytes) {
		t.Fatal("serialized payload unexpectedly contains private key contents")
	}
	if strings.Contains(string(payload), "agentConn") || strings.Contains(string(payload), "passphrase") || strings.Contains(string(payload), "password") {
		t.Fatalf("serialized payload unexpectedly contains runtime secret fields: %s", string(payload))
	}
}

func TestRemoteListSessionsParsesOutput(t *testing.T) {
	remote := Remote{
		BinaryPath: "tmux",
		runCommand: func(binary string, args ...string) (string, error) {
			if binary != "tmux" {
				t.Fatalf("unexpected binary: %q", binary)
			}
			wantArgs := []string{"list-sessions", "-F", remoteSessionFormat}
			if !reflect.DeepEqual(args, wantArgs) {
				t.Fatalf("args = %#v, want %#v", args, wantArgs)
			}
			return "$1:dev:1\n$2:ops:0", nil
		},
	}

	sessions, err := remote.ListSessions()
	if err != nil {
		t.Fatalf("ListSessions() error = %v", err)
	}
	want := []tmux.Session{{ID: "$1", Name: "dev", Attached: true}, {ID: "$2", Name: "ops", Attached: false}}
	if !reflect.DeepEqual(sessions, want) {
		t.Fatalf("ListSessions() = %#v, want %#v", sessions, want)
	}
}

func TestBuildRemoteExecCommandEscapesArguments(t *testing.T) {
	command := buildRemoteExecCommand("tmux", "new-session", "-s", "name'; touch /tmp/pwned; echo '")
	if !strings.Contains(command, "'name'\"'\"'; touch /tmp/pwned; echo '\"'\"''") {
		t.Fatalf("command did not escape single quotes safely: %s", command)
	}
	if !strings.HasPrefix(command, "sh -lc 'exec \"$0\" \"$@\"' 'tmux'") {
		t.Fatalf("command used unexpected wrapper: %s", command)
	}
}

func TestSSHIntegration(t *testing.T) {
	host := strings.TrimSpace(os.Getenv("WEBMUX_TEST_SSH_HOST"))
	user := strings.TrimSpace(os.Getenv("WEBMUX_TEST_SSH_USER"))
	keyPath := strings.TrimSpace(os.Getenv("WEBMUX_TEST_SSH_KEY"))
	if host == "" || user == "" || keyPath == "" {
		t.Skip("set WEBMUX_TEST_SSH_HOST, WEBMUX_TEST_SSH_USER, and WEBMUX_TEST_SSH_KEY to run SSH integration tests")
	}

	port := 22
	if value := strings.TrimSpace(os.Getenv("WEBMUX_TEST_SSH_PORT")); value != "" {
		fmt.Sscanf(value, "%d", &port)
	}

	client := New(Config{
		Host:           host,
		Port:           port,
		User:           user,
		PrivateKeyPath: keyPath,
		KnownHostsPath: strings.TrimSpace(os.Getenv("WEBMUX_TEST_SSH_KNOWN_HOSTS")),
	})
	defer client.Close()

	if err := client.Connect(); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}

	session, err := client.NewSession()
	if err != nil {
		t.Fatalf("NewSession() error = %v", err)
	}
	defer session.Close()

	output, err := session.Output("printf ready")
	if err != nil {
		t.Fatalf("session.Output() error = %v", err)
	}
	if strings.TrimSpace(string(output)) != "ready" {
		t.Fatalf("session.Output() = %q, want %q", string(output), "ready")
	}
}

func assertErrorCode(t *testing.T, err error, want string) {
	t.Helper()
	var sshErr *Error
	if !errors.As(err, &sshErr) {
		t.Fatalf("expected *Error, got %T (%v)", err, err)
	}
	if sshErr.Code != want {
		t.Fatalf("error code = %q, want %q", sshErr.Code, want)
	}
}

func writePrivateKeyFile(t *testing.T) (string, ssh.Signer) {
	t.Helper()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey() error = %v", err)
	}

	privateKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	})

	path := filepath.Join(t.TempDir(), "id_rsa")
	if err := os.WriteFile(path, privateKeyPEM, 0o600); err != nil {
		t.Fatalf("os.WriteFile() error = %v", err)
	}

	signer, err := ssh.ParsePrivateKey(privateKeyPEM)
	if err != nil {
		t.Fatalf("ssh.ParsePrivateKey() error = %v", err)
	}

	return path, signer
}

func writeKnownHostsFile(t *testing.T, content string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "known_hosts")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("os.WriteFile() error = %v", err)
	}
	return path
}
