package intelligence

import (
	"context"
	"errors"
	"sync"
	"time"
)

// FakeProviderConfig configures FakeProvider behavior.
type FakeProviderConfig struct {
	App        Application
	Status     Status
	Summary    string
	Confidence float64
	Error      string
	DelayMs    int
}

// FakeProvider is a deterministic provider for testing.
type FakeProvider struct {
	Config FakeProviderConfig
	mu     sync.Mutex
	Calls  int
}

// NewFakeProvider creates a new FakeProvider with the given config.
func NewFakeProvider(cfg FakeProviderConfig) *FakeProvider {
	return &FakeProvider{Config: cfg}
}

// Analyze returns a predetermined result or error.
func (f *FakeProvider) Analyze(ctx context.Context, input AnalyzeInput) (Result, error) {
	if f.Config.Error == "panic" {
		panic("fake provider panic")
	}

	f.mu.Lock()
	f.Calls++
	f.mu.Unlock()

	if f.Config.DelayMs > 0 {
		select {
		case <-time.After(time.Duration(f.Config.DelayMs) * time.Millisecond):
		case <-ctx.Done():
			return Result{}, &ProviderError{Category: ErrCategoryTimeout, Err: ctx.Err()}
		}
	}

	if f.Config.Error != "" {
		return Result{}, &ProviderError{Category: f.Config.Error, Err: errors.New(f.Config.Error)}
	}

	return Result{
		PaneID:      input.PaneID,
		SessionName: input.SessionName,
		WindowID:    input.WindowID,
		App:         f.Config.App,
		Status:      f.Config.Status,
		Summary:     f.Config.Summary,
		Confidence:  f.Config.Confidence,
		Source:      "fake",
	}, nil
}

// Name returns the provider name.
func (f *FakeProvider) Name() string {
	return "fake"
}
