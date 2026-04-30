package intelligence

import (
	"strings"
	"testing"
)

func TestRedactTerminalContent(t *testing.T) {
	raw := strings.Join([]string{
		"export API_KEY=sk-test",
		"Authorization: Bearer abc123",
		"-----BEGIN RSA PRIVATE KEY-----",
		"very-secret-key-material",
		"-----END RSA PRIVATE KEY-----",
		"curl --token cli-secret --password pass-secret https://user:pass@example.com/path",
		"token ghp_secretvalue and key sk_live_secretvalue",
	}, "\n")

	got := RedactContent(raw)
	if count := strings.Count(got, "[REDACTED]"); count < 7 {
		t.Fatalf("expected multiple redaction placeholders, got %d in %q", count, got)
	}
	for _, secret := range []string{
		"sk-test",
		"abc123",
		"very-secret-key-material",
		"cli-secret",
		"pass-secret",
		"user:pass@",
		"ghp_secretvalue",
		"sk_live_secretvalue",
	} {
		if strings.Contains(got, secret) {
			t.Fatalf("redacted content still contains secret %q: %q", secret, got)
		}
	}
}

func TestNormalizeAndHashStripsANSI(t *testing.T) {
	normalized, hash := NormalizeAndHash("%1", "claude", "\x1b[31mhello\x1b[0m\n", 12000)
	if normalized != "hello" {
		t.Fatalf("normalized = %q, want hello", normalized)
	}
	if hash == "" {
		t.Fatal("expected non-empty hash")
	}
}

func TestNormalizeAndHashTruncates(t *testing.T) {
	normalized, _ := NormalizeAndHash("%1", "claude", "abcdef", 3)
	if normalized != "abc" {
		t.Fatalf("normalized = %q, want abc", normalized)
	}
}

func TestNormalizeAndHashEmpty(t *testing.T) {
	normalized, hash := NormalizeAndHash("%1", "claude", " \n\t ", 12000)
	if normalized != "" {
		t.Fatalf("normalized = %q, want empty", normalized)
	}
	if hash == "" {
		t.Fatal("expected stable hash even for empty normalized content")
	}

	_, hashAgain := NormalizeAndHash("%1", "claude", "", 12000)
	if hash != hashAgain {
		t.Fatalf("empty hash should be stable: %q != %q", hash, hashAgain)
	}
}
