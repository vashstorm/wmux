package intelligence

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
)

const defaultMaxBytes = 12000

var (
	ansiPatterns = []*regexp.Regexp{
		regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]`),
		regexp.MustCompile(`\x1b\][^\x07]*(\x07|\x1b\\)`),
		regexp.MustCompile(`\x1b[PX^_].*?(\x1b\\|\x07)`),
	}
	redactionPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?is)-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----`),
		regexp.MustCompile(`(?i)Bearer\s+[a-zA-Z0-9._-]+`),
		regexp.MustCompile(`(?i)\bAPI_KEY\s*=\s*\S+`),
		regexp.MustCompile(`(?i)\bTOKEN\s*=\s*\S+`),
		regexp.MustCompile(`(?i)\bPASSWORD\s*=\s*\S+`),
		regexp.MustCompile(`(?i)--token\s+\S+`),
		regexp.MustCompile(`(?i)--password\s+\S+`),
		regexp.MustCompile(`https?://[^\s:/]+:[^\s@]+@`),
		regexp.MustCompile(`\b(?:sk-[a-zA-Z0-9._-]+|sk_live_[a-zA-Z0-9._-]+|sk_test_[a-zA-Z0-9._-]+|ghp_[a-zA-Z0-9._-]+|gho_[a-zA-Z0-9._-]+)\b`),
	}
)

// RedactContent strips terminal control sequences and replaces secrets.
func RedactContent(raw string) string {
	content := stripANSI(raw)
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	for _, pattern := range redactionPatterns {
		content = pattern.ReplaceAllString(content, "[REDACTED]")
	}
	return strings.TrimSpace(content)
}

// NormalizeAndHash redacts, trims, truncates, and hashes pane content.
func NormalizeAndHash(paneID, currentCommand, raw string, maxBytes int) (normalized, hash string) {
	normalized = RedactContent(raw)
	if maxBytes <= 0 {
		maxBytes = defaultMaxBytes
	}
	if len([]byte(normalized)) > maxBytes {
		normalized = truncateBytes(normalized, maxBytes)
	}

	h := sha256.New()
	h.Write([]byte(paneID))
	h.Write([]byte(":"))
	h.Write([]byte(currentCommand))
	h.Write([]byte(":"))
	h.Write([]byte(normalized))
	return normalized, hex.EncodeToString(h.Sum(nil))
}

func stripANSI(raw string) string {
	cleaned := raw
	for _, pattern := range ansiPatterns {
		cleaned = pattern.ReplaceAllString(cleaned, "")
	}
	return cleaned
}

func truncateBytes(s string, maxBytes int) string {
	if maxBytes <= 0 || len([]byte(s)) <= maxBytes {
		return s
	}
	bytes := []byte(s)
	for maxBytes > 0 && !isUTF8Boundary(bytes, maxBytes) {
		maxBytes--
	}
	return string(bytes[:maxBytes])
}

func isUTF8Boundary(bytes []byte, index int) bool {
	if index >= len(bytes) {
		return true
	}
	return bytes[index]&0b1100_0000 != 0b1000_0000
}
