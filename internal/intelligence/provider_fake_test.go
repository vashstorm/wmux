package intelligence_test

import (
	"context"
	"testing"
	"time"

	"github.com/panh/wmux/internal/intelligence"
)

func TestFakeProvider(t *testing.T) {
	t.Run("returns configured result", func(t *testing.T) {
		provider := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{
			App:        intelligence.AppClaude,
			Status:     intelligence.StatusRunning,
			Summary:    "Claude is processing",
			Confidence: 0.95,
		})

		result, err := provider.Analyze(context.Background(), intelligence.AnalyzeInput{
			PaneID:      "test-pane",
			SessionName: "test-session",
			WindowID:    "test-window",
		})

		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.App != intelligence.AppClaude {
			t.Errorf("expected AppClaude, got %v", result.App)
		}
		if result.Status != intelligence.StatusRunning {
			t.Errorf("expected StatusRunning, got %v", result.Status)
		}
		if result.Summary != "Claude is processing" {
			t.Errorf("expected summary, got %v", result.Summary)
		}
		if result.Confidence != 0.95 {
			t.Errorf("expected 0.95, got %v", result.Confidence)
		}
		if result.Source != "fake" {
			t.Errorf("expected source 'fake', got %v", result.Source)
		}
	})

	t.Run("increments calls counter", func(t *testing.T) {
		provider := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{
			App:    intelligence.AppUnknown,
			Status: intelligence.StatusNone,
		})

		for i := 0; i < 3; i++ {
			_, _ = provider.Analyze(context.Background(), intelligence.AnalyzeInput{})
		}

		if provider.Calls != 3 {
			t.Errorf("expected 3 calls, got %d", provider.Calls)
		}
	})

	t.Run("returns error when configured", func(t *testing.T) {
		provider := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{
			Error: intelligence.ErrCategoryRateLimited,
		})

		_, err := provider.Analyze(context.Background(), intelligence.AnalyzeInput{})

		if err == nil {
			t.Fatal("expected error, got nil")
		}

		var provErr *intelligence.ProviderError
		if !errorAsProviderError(err, &provErr) {
			t.Fatalf("expected ProviderError, got %T", err)
		}
		if provErr.Category != intelligence.ErrCategoryRateLimited {
			t.Errorf("expected rate_limited, got %v", provErr.Category)
		}
	})

	t.Run("applies delay", func(t *testing.T) {
		provider := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{
			App:     intelligence.AppUnknown,
			Status:  intelligence.StatusNone,
			DelayMs: 50,
		})

		start := time.Now()
		_, err := provider.Analyze(context.Background(), intelligence.AnalyzeInput{})
		elapsed := time.Since(start)

		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if elapsed < 40*time.Millisecond {
			t.Errorf("expected delay >= 40ms, got %v", elapsed)
		}
	})

	t.Run("respects context cancellation during delay", func(t *testing.T) {
		provider := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{
			App:     intelligence.AppUnknown,
			Status:  intelligence.StatusNone,
			DelayMs: 1000,
		})

		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()

		start := time.Now()
		_, err := provider.Analyze(ctx, intelligence.AnalyzeInput{})
		elapsed := time.Since(start)

		if err == nil {
			t.Fatal("expected error, got nil")
		}

		var provErr *intelligence.ProviderError
		if !errorAsProviderError(err, &provErr) {
			t.Fatalf("expected ProviderError, got %T", err)
		}
		if provErr.Category != intelligence.ErrCategoryTimeout {
			t.Errorf("expected timeout, got %v", provErr.Category)
		}
		if elapsed > 200*time.Millisecond {
			t.Errorf("should have returned early, took %v", elapsed)
		}
	})
}

func TestFakePanic(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Error("expected panic, but function did not panic")
		}
	}()

	provider := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{
		Error: "panic",
	})

	_, _ = provider.Analyze(context.Background(), intelligence.AnalyzeInput{})
}

func TestFakeProviderName(t *testing.T) {
	provider := intelligence.NewFakeProvider(intelligence.FakeProviderConfig{})
	if provider.Name() != "fake" {
		t.Errorf("expected name 'fake', got %v", provider.Name())
	}
}

func errorAsProviderError(err error, target **intelligence.ProviderError) bool {
	for err != nil {
		if pe, ok := err.(*intelligence.ProviderError); ok {
			*target = pe
			return true
		}
		if unwrapper, ok := err.(interface{ Unwrap() error }); ok {
			err = unwrapper.Unwrap()
		} else {
			break
		}
	}
	return false
}
