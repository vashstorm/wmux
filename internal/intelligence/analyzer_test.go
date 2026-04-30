package intelligence

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/tmux"
)

func TestAnalyzerRespectsMinInterval(t *testing.T) {
	provider := &fakeProvider{}
	analyzer := NewAnalyzer(provider, newTestStore(t), 2, nil)
	cfg := config.IntelligenceConfig{MaxBytes: 12000, MinSessionIntervalSec: 60, CacheTTLSec: 300}
	panes := []tmux.Pane{{ID: "%1", CurrentCommand: "claude"}}

	first, err := analyzer.AnalyzeSession(context.Background(), cfg, panes, "dev")
	if err != nil {
		t.Fatalf("first AnalyzeSession returned error: %v", err)
	}
	if len(first) != 1 {
		t.Fatalf("first len = %d, want 1", len(first))
	}
	second, err := analyzer.AnalyzeSession(context.Background(), cfg, panes, "dev")
	if err != nil {
		t.Fatalf("second AnalyzeSession returned error: %v", err)
	}
	if len(second) != 0 {
		t.Fatalf("second len = %d, want 0 for interval skip", len(second))
	}
	if provider.calls != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.calls)
	}
}

func TestAnalyzerConcurrencyLimit(t *testing.T) {
	provider := &fakeProvider{delay: 20 * time.Millisecond}
	analyzer := NewAnalyzer(provider, newTestStore(t), 2, nil)
	cfg := config.IntelligenceConfig{MaxBytes: 12000, MinSessionIntervalSec: 0, CacheTTLSec: 300}
	panes := []tmux.Pane{
		{ID: "%1", CurrentCommand: "claude"},
		{ID: "%2", CurrentCommand: "claude"},
		{ID: "%3", CurrentCommand: "claude"},
		{ID: "%4", CurrentCommand: "claude"},
		{ID: "%5", CurrentCommand: "claude"},
	}

	got, err := analyzer.AnalyzeSession(context.Background(), cfg, panes, "dev")
	if err != nil {
		t.Fatalf("AnalyzeSession returned error: %v", err)
	}
	if len(got) != 5 {
		t.Fatalf("len(results) = %d, want 5", len(got))
	}
	if provider.maxActive > 2 {
		t.Fatalf("max concurrent provider calls = %d, want <= 2", provider.maxActive)
	}
}


func TestAnalyzerReanalyzesWhenContentChanges(t *testing.T) {
	provider := &fakeProvider{}
	captureCalls := 0
	analyzer := NewAnalyzer(provider, newTestStore(t), 1, func(string) (string, error) {
		captureCalls++
		if captureCalls == 1 {
			return "content-v1", nil
		}
		return "content-v2", nil
	})
	cfg := config.IntelligenceConfig{MaxBytes: 12000, MinSessionIntervalSec: 0, CacheTTLSec: 3600}
	panes := []tmux.Pane{{ID: "%1", CurrentCommand: "claude"}}

	if _, err := analyzer.AnalyzeSession(context.Background(), cfg, panes, "dev"); err != nil {
		t.Fatalf("first AnalyzeSession returned error: %v", err)
	}
	if _, err := analyzer.AnalyzeSession(context.Background(), cfg, panes, "dev"); err != nil {
		t.Fatalf("second AnalyzeSession returned error: %v", err)
	}
	if provider.calls != 2 {
		t.Fatalf("provider calls = %d, want 2 when content changes", provider.calls)
	}
}

func TestAnalyzerSkipsCacheWhenContentUnchanged(t *testing.T) {
	provider := &fakeProvider{}
	analyzer := NewAnalyzer(provider, newTestStore(t), 1, func(string) (string, error) {
		return "content-v1", nil
	})
	cfg := config.IntelligenceConfig{MaxBytes: 12000, MinSessionIntervalSec: 0, CacheTTLSec: 3600}
	panes := []tmux.Pane{{ID: "%1", CurrentCommand: "claude"}}

	if _, err := analyzer.AnalyzeSession(context.Background(), cfg, panes, "dev"); err != nil {
		t.Fatalf("first AnalyzeSession returned error: %v", err)
	}
	if _, err := analyzer.AnalyzeSession(context.Background(), cfg, panes, "dev"); err != nil {
		t.Fatalf("second AnalyzeSession returned error: %v", err)
	}
	if provider.calls != 1 {
		t.Fatalf("provider calls = %d, want 1 when content is unchanged", provider.calls)
	}
}

func TestAnalyzerPassesCapturedContentToProvider(t *testing.T) {
	provider := &fakeProvider{}
	analyzer := NewAnalyzer(provider, newTestStore(t), 1, func(string) (string, error) {
		return "$ git status\nOn branch main", nil
	})
	cfg := config.IntelligenceConfig{MaxBytes: 12000, MinSessionIntervalSec: 0, CacheTTLSec: 300}
	panes := []tmux.Pane{{ID: "%1", CurrentCommand: "git"}}

	_, err := analyzer.AnalyzeSession(context.Background(), cfg, panes, "dev")
	if err != nil {
		t.Fatalf("AnalyzeSession returned error: %v", err)
	}
	if !strings.Contains(provider.lastInput.RawContent, "$ git status") {
		t.Fatalf("RawContent = %q, want captured content", provider.lastInput.RawContent)
	}
	if !strings.Contains(provider.lastInput.RawContent, "On branch main") {
		t.Fatalf("RawContent = %q, want normalized captured content", provider.lastInput.RawContent)
	}
}

type fakeProvider struct {
	mu        sync.Mutex
	calls     int
	active    int
	maxActive int
	delay     time.Duration
	lastInput AnalyzeInput
}

func (p *fakeProvider) Name() string { return "fake" }

func (p *fakeProvider) Analyze(ctx context.Context, input AnalyzeInput) (Result, error) {
	p.mu.Lock()
	p.calls++
	p.active++
	p.lastInput = input
	if p.active > p.maxActive {
		p.maxActive = p.active
	}
	p.mu.Unlock()

	if p.delay > 0 {
		select {
		case <-time.After(p.delay):
		case <-ctx.Done():
			return Result{}, ctx.Err()
		}
	}

	p.mu.Lock()
	p.active--
	p.mu.Unlock()

	return Result{
		PaneID:      input.PaneID,
		SessionName: input.SessionName,
		WindowID:    input.WindowID,
		App:         NormalizeApplication(input.CurrentCommand),
		Status:      StatusRunning,
		Summary:     "running",
		Source:      p.Name(),
		Confidence:  1,
		UpdatedAt:   time.Now(),
	}, nil
}
