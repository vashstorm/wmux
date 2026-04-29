package semantic_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/panh/wmux/internal/semantic"
)

type mockCapturer struct {
	output string
	err    error
}

func (m *mockCapturer) CapturePane(paneID string) (string, error) {
	return m.output, m.err
}

func TestNormalizeOutput_StripsANSI(t *testing.T) {
	input := "\x1b[32mHello\x1b[0m \x1b[1;31mWorld\x1b[0m\n\x1b[2J\x1b[?25lDone\x1b]0;title\x07"
	got := semantic.NormalizeOutput(input)
	want := "Hello World\nDone"
	if got != want {
		t.Errorf("NormalizeOutput() = %q, want %q", got, want)
	}
}

func TestNormalizeOutput_LimitsTo50Lines(t *testing.T) {
	var lines []string
	for i := 0; i < 100; i++ {
		lines = append(lines, strings.Repeat("x", i))
	}
	input := strings.Join(lines, "\n")
	got := semantic.NormalizeOutput(input)
	gotLines := strings.Split(got, "\n")
	if len(gotLines) != 50 {
		t.Errorf("NormalizeOutput() returned %d lines, want 50", len(gotLines))
	}
	if gotLines[0] != strings.Repeat("x", 50) {
		t.Errorf("first kept line = %q, want %q", gotLines[0], strings.Repeat("x", 50))
	}
	if gotLines[49] != strings.Repeat("x", 99) {
		t.Errorf("last kept line = %q, want %q", gotLines[49], strings.Repeat("x", 99))
	}
}

func TestNormalizeOutput_TrimsEmptyLinesAndWhitespace(t *testing.T) {
	input := "\n\n  hello  \t\r\n\n  world  \n\n"
	got := semantic.NormalizeOutput(input)
	want := "  hello\n\n  world"
	if got != want {
		t.Errorf("NormalizeOutput() = %q, want %q", got, want)
	}
}

func TestCaptureForClassification_SkipsNonAIPane(t *testing.T) {
	mock := &mockCapturer{output: "some output"}
	got, ok := semantic.CaptureForClassification(mock, "%0", "bash")
	if ok {
		t.Errorf("CaptureForClassification() ok = true, want false for non-AI pane")
	}
	if got != "" {
		t.Errorf("CaptureForClassification() got = %q, want empty string", got)
	}
}

func TestCaptureForClassification_CapturesAIPane(t *testing.T) {
	mock := &mockCapturer{output: "\x1b[32mAI says hello\x1b[0m\n"}
	got, ok := semantic.CaptureForClassification(mock, "%0", "claude")
	if !ok {
		t.Errorf("CaptureForClassification() ok = false, want true for AI pane")
	}
	want := "AI says hello"
	if got != want {
		t.Errorf("CaptureForClassification() got = %q, want %q", got, want)
	}
}

func TestCaptureForClassification_HandlesCaptureError(t *testing.T) {
	mock := &mockCapturer{err: errors.New("tmux not found")}
	got, ok := semantic.CaptureForClassification(mock, "%0", "claude")
	if !ok {
		t.Errorf("CaptureForClassification() ok = false, want true even on capture error")
	}
	if got != "" {
		t.Errorf("CaptureForClassification() got = %q, want empty string on error", got)
	}
}

func TestLocalCapture_EmptyPaneID(t *testing.T) {
	lc := semantic.NewLocalCapture("tmux")
	_, err := lc.CapturePane("")
	if err == nil {
		t.Error("CapturePane(\"\") expected error, got nil")
	}
}

func TestLocalCapture_UsesDefaultPath(t *testing.T) {
	lc := semantic.NewLocalCapture("")
	_, err := lc.CapturePane("")
	if err == nil {
		t.Error("CapturePane(\"\") expected error, got nil")
	}
}
