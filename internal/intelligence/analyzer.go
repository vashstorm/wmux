package intelligence

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/tmux"
)

// Analyzer coordinates cached pane analysis with concurrency and interval gates.
type Analyzer struct {
	store           *Store
	maxConcurrency  int
	captureFn       func(string) (string, error)
	providerFactory func(config.IntelligenceProviderConfig) (Provider, error)
	sem             chan struct{}
	mu              sync.Mutex
	lastRun         map[string]time.Time
	firstSeen       map[string]time.Time
}

// NewAnalyzer creates an Analyzer with a bounded provider-call semaphore.
func NewAnalyzer(store *Store, maxConcurrency int, captureFn func(string) (string, error), factory func(config.IntelligenceProviderConfig) (Provider, error)) *Analyzer {
	if maxConcurrency <= 0 {
		maxConcurrency = 1
	}
	if factory == nil {
		factory = NewProvider
	}
	return &Analyzer{
		store:           store,
		maxConcurrency:  maxConcurrency,
		captureFn:       captureFn,
		providerFactory: factory,
		sem:             make(chan struct{}, maxConcurrency),
		lastRun:         make(map[string]time.Time),
		firstSeen:       make(map[string]time.Time),
	}
}

// AnalyzeSession runs analysis for all panes in a session.
func (a *Analyzer) AnalyzeSession(ctx context.Context, cfg config.IntelligenceConfig, panes []tmux.Pane, sessionName string) ([]Result, error) {
	if a == nil || a.store == nil || a.providerFactory == nil {
		return nil, fmt.Errorf("analyzer is not configured")
	}
	if a.skipSession(sessionName, cfg.MinSessionIntervalSec) {
		return nil, nil
	}

	providerCfg, err := ResolveActiveProvider(cfg)
	if err != nil {
		return nil, err
	}

	provider, err := a.providerFactory(providerCfg)
	if err != nil {
		return nil, err
	}

	results := make([]Result, len(panes))
	errs := make([]error, len(panes))
	var wg sync.WaitGroup
	for i, pane := range panes {
		wg.Add(1)
		go func(index int, pane tmux.Pane) {
			defer wg.Done()
			result, err := a.analyzePane(ctx, cfg, pane, sessionName, provider)
			if err != nil {
				errs[index] = err
				return
			}
			results[index] = result
		}(i, pane)
	}
	wg.Wait()

	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}

	compact := make([]Result, 0, len(results))
	for _, result := range results {
		if result.PaneID != "" {
			compact = append(compact, result)
		}
	}
	return compact, nil
}

func (a *Analyzer) skipSession(sessionName string, minSessionIntervalSec int) bool {
	if minSessionIntervalSec <= 0 {
		a.recordRun(sessionName)
		return false
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	lastRun, ok := a.lastRun[sessionName]
	if ok && now.Sub(lastRun) < time.Duration(minSessionIntervalSec)*time.Second {
		return true
	}
	a.lastRun[sessionName] = now
	return false
}

func (a *Analyzer) ResetSessionTimer(sessionName string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.lastRun, sessionName)
}

func (a *Analyzer) BumpSessionTimer(sessionName string) {
	a.recordRun(sessionName)
}

// RecordNewPane bumps the session timer when a pane is first discovered,
// deferring analysis until minSessionIntervalSec has elapsed.
func (a *Analyzer) RecordNewPane(sessionName, paneID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.firstSeen[paneID]; ok {
		return
	}
	a.firstSeen[paneID] = time.Now()
	a.lastRun[sessionName] = time.Now()
}

func (a *Analyzer) PruneFirstSeen(sessionName string, keepPaneIDs []string) {
	a.mu.Lock()
	defer a.mu.Unlock()

	keep := make(map[string]struct{}, len(keepPaneIDs))
	for _, id := range keepPaneIDs {
		keep[id] = struct{}{}
	}
	for paneID := range a.firstSeen {
		if _, ok := keep[paneID]; !ok {
			delete(a.firstSeen, paneID)
		}
	}
}

func (a *Analyzer) recordRun(sessionName string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.lastRun[sessionName] = time.Now()
}

func (a *Analyzer) analyzePane(ctx context.Context, cfg config.IntelligenceConfig, pane tmux.Pane, sessionName string, provider Provider) (Result, error) {
	rawContent := ""
	if a.captureFn != nil {
		if captured, captureErr := a.captureFn(pane.ID); captureErr == nil {
			rawContent = captured
		}
	}
	normalized, hash := NormalizeAndHash(pane.ID, pane.CurrentCommand, rawContent, cfg.MaxBytes)
	if cached, ok, err := a.store.Get(pane.ID); err != nil {
		return Result{}, err
	} else if ok && cached.ContentHash == hash && !a.store.IsExpired(cached, cfg.CacheTTLSec) {
		return cached, nil
	}

	input := AnalyzeInput{
		PaneID:         pane.ID,
		SessionName:    sessionName,
		CurrentCommand: pane.CurrentCommand,
		RawContent:     normalized,
	}

	select {
	case a.sem <- struct{}{}:
		defer func() { <-a.sem }()
	case <-ctx.Done():
		return Result{}, ctx.Err()
	}

	result, err := provider.Analyze(ctx, input)
	if err != nil {
		return Result{}, err
	}
	result.PaneID = pane.ID
	result.SessionName = sessionName
	result.WindowID = input.WindowID
	result.Source = provider.Name()
	result.ContentHash = hash
	result.Stale = false
	if result.UpdatedAt.IsZero() {
		result.UpdatedAt = time.Now()
	}
	if err := a.store.Set(result); err != nil {
		return Result{}, err
	}
	return normalizeResult(result), nil
}
