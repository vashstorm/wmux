package server

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/panh/wmux/internal/intelligence"
	"github.com/panh/wmux/internal/tmux"
)

type analyzeResponse struct {
	ConnectionID string               `json:"connectionId"`
	Session      string               `json:"session"`
	Status       string               `json:"status"`
	Updated      int                  `json:"updated"`
	Skipped      int                  `json:"skipped"`
	Errors       int                  `json:"errors"`
	Intelligence *sessionIntelligence `json:"intelligence,omitempty"`
}

type sessionIntelligence struct {
	App        string         `json:"app"`
	Status     string         `json:"status"`
	Summary    string         `json:"summary"`
	Source     string         `json:"source"`
	Confidence float64        `json:"confidence"`
	Stale      bool           `json:"stale"`
	Error      string         `json:"error,omitempty"`
	UpdatedAt  string         `json:"updatedAt,omitempty"`
	AppCounts  map[string]int `json:"appCounts,omitempty"`
}

func (s *Server) handleAnalyzeSession(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.findConnectionByID(r.PathValue("id"))
	if !ok {
		s.writeError(w, http.StatusNotFound, "not_found", "connection not found")
		return
	}

	sessionName := r.PathValue("session")
	if connection.Type != "local" {
		s.writeError(w, http.StatusBadRequest, "bad_request", "intelligence analysis is only supported for local connections")
		return
	}

	force := r.URL.Query().Get("force") == "true"
	if force && s.intelligenceAnalyzer != nil {
		s.intelligenceAnalyzer.ResetSessionTimer(sessionName)
	}

	cfg := s.currentConfig()

	if s.intelligenceAnalyzer == nil {
		s.writeJSON(w, http.StatusOK, analyzeResponse{
			ConnectionID: connection.ID,
			Session:      sessionName,
			Status:       "disabled",
		})
		return
	}

	adapter := tmux.NewAdapter(cfg.Tmux.Path)
	windows, err := adapter.ListWindows(sessionName)
	if err != nil {
		s.writeSessionHTTPError(w, err)
		return
	}

	allPanes := make([]tmux.Pane, 0)
	windowByPane := make(map[string]string)
	for _, window := range windows {
		target := window.ID
		if target == "" {
			target = window.Name
		}
		panes, err := adapter.ListPanes(sessionName, target)
		if err != nil {
			continue
		}
		for _, pane := range panes {
			windowByPane[pane.ID] = window.Name
			allPanes = append(allPanes, pane)
		}
	}

	timeoutSec := cfg.Intelligence.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = 8
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	results, err := s.intelligenceAnalyzer.AnalyzeSession(ctx, cfg.Intelligence, allPanes, sessionName)
	if err != nil {
		s.logger.Warn("intelligence analysis error",
			slog.String("session", sessionName),
			slog.String("error", err.Error()),
		)
	}

	updated, errCount := 0, 0
	for i := range results {
		if windowName := windowByPane[results[i].PaneID]; windowName != "" {
			results[i].WindowID = windowName
			if s.intelligenceStore != nil {
				if err := s.intelligenceStore.Set(results[i]); err != nil {
					s.logger.Warn("failed to update intelligence window cache", slog.String("error", err.Error()))
				}
			}
		}
		if results[i].Error != "" {
			errCount++
		} else {
			updated++
		}
	}

	skipped := 0
	if len(allPanes) > 0 && len(results) == 0 && err == nil {
		skipped = len(allPanes)
	}

	if s.intelligenceStore != nil && len(allPanes) > 0 {
		keepPaneIDs := make([]string, len(allPanes))
		for i, pane := range allPanes {
			keepPaneIDs[i] = pane.ID
		}
		if cleanupErr := s.intelligenceStore.DeleteExcept(sessionName, keepPaneIDs); cleanupErr != nil {
			s.logger.Warn("failed to cleanup stale intelligence results",
				slog.String("session", sessionName),
				slog.String("error", cleanupErr.Error()),
			)
		}
		if s.intelligenceAnalyzer != nil {
			s.intelligenceAnalyzer.PruneFirstSeen(sessionName, keepPaneIDs)
		}
	}

	s.writeJSON(w, http.StatusOK, analyzeResponse{
		ConnectionID: connection.ID,
		Session:      sessionName,
		Status:       "ok",
		Updated:      updated,
		Skipped:      skipped,
		Errors:       errCount,
		Intelligence: buildSessionIntelligence(results, ""),
	})
}

func buildSessionIntelligence(results []intelligence.Result, activePaneID string) *sessionIntelligence {
	if len(results) == 0 {
		return nil
	}

	agg := intelligence.AggregateSessionIntelligence(results, activePaneID)
	if agg.PaneID == "" {
		return nil
	}

	return &sessionIntelligence{
		App:        string(agg.App),
		Status:     string(agg.Status),
		Summary:    agg.Summary,
		Source:     agg.Source,
		Confidence: agg.Confidence,
		Stale:      agg.Stale,
		Error:      agg.Error,
		UpdatedAt:  formatIntelligenceTime(agg.UpdatedAt),
		AppCounts:  intelligence.CountApplications(results),
	}
}

func formatIntelligenceTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func (s *Server) attachCachedSessionIntelligence(session *tmux.Session, paneIDs []string) {
	if s.intelligenceStore == nil {
		return
	}
	cacheTTLSec := s.currentConfig().Intelligence.CacheTTLSec

	results, err := s.intelligenceStore.GetBySession(session.Name, cacheTTLSec)
	if err != nil || len(results) == 0 {
		return
	}

	filtered := filterResultsByPaneIDs(results, paneIDs)
	if len(filtered) == 0 {
		return
	}

	agg := intelligence.AggregateSessionIntelligence(filtered, "")
	if agg.PaneID == "" {
		return
	}
	applySessionResult(session, agg)
	session.IntelligencePaneCount = len(filtered)
	session.IntelligenceWindowCount = countIntelligenceWindows(filtered)
	session.IntelligenceAppCounts = intelligence.CountApplications(filtered)
}

func filterResultsByPaneIDs(results []intelligence.Result, paneIDs []string) []intelligence.Result {
	if len(paneIDs) == 0 {
		return results
	}
	allowed := make(map[string]struct{}, len(paneIDs))
	for _, id := range paneIDs {
		allowed[id] = struct{}{}
	}
	filtered := make([]intelligence.Result, 0, len(results))
	for _, result := range results {
		if _, ok := allowed[result.PaneID]; ok {
			filtered = append(filtered, result)
		}
	}
	return filtered
}

func (s *Server) attachCachedWindowIntelligence(sessionName string, windows []tmux.Window) {
	if s.intelligenceStore == nil {
		return
	}
	cacheTTLSec := s.currentConfig().Intelligence.CacheTTLSec

	results, err := s.intelligenceStore.GetBySession(sessionName, cacheTTLSec)
	if err != nil || len(results) == 0 {
		return
	}
	for i := range windows {
		windowResults := filterWindowResults(results, windows[i])
		if len(windowResults) == 0 {
			continue
		}
		agg := intelligence.AggregateSessionIntelligence(windowResults, windows[i].ActivePaneID)
		if agg.PaneID == "" {
			continue
		}
		applyWindowResult(&windows[i], agg)
	}
}

func (s *Server) attachCachedPaneIntelligence(sessionName string, panes []tmux.Pane) {
	if s.intelligenceStore == nil {
		return
	}
	cacheTTLSec := s.currentConfig().Intelligence.CacheTTLSec

	results, err := s.intelligenceStore.GetBySession(sessionName, cacheTTLSec)
	if err != nil || len(results) == 0 {
		return
	}
	byPane := make(map[string]int, len(results))
	for i := range results {
		byPane[results[i].PaneID] = i
	}
	for i := range panes {
		index, ok := byPane[panes[i].ID]
		if !ok {
			continue
		}
		applyPaneResult(&panes[i], results[index])
	}
}

func filterWindowResults(results []intelligence.Result, window tmux.Window) []intelligence.Result {
	filtered := make([]intelligence.Result, 0, len(results))
	for _, result := range results {
		if result.WindowID == window.ID || result.WindowID == window.Name {
			filtered = append(filtered, result)
		}
	}
	return filtered
}

func countIntelligenceWindows(results []intelligence.Result) int {
	windows := make(map[string]struct{})
	for _, result := range results {
		if result.WindowID == "" {
			continue
		}
		windows[result.WindowID] = struct{}{}
	}
	return len(windows)
}

func applySessionResult(session *tmux.Session, result intelligence.Result) {
	session.IntelligenceApp = string(result.App)
	session.IntelligenceStatus = string(result.Status)
	session.IntelligenceSummary = result.Summary
	session.IntelligenceSource = result.Source
	session.IntelligenceConfidence = result.Confidence
	session.IntelligenceUpdatedAt = formatIntelligenceTime(result.UpdatedAt)
	session.IntelligenceStale = result.Stale
	session.IntelligenceError = result.Error
}

func applyWindowResult(window *tmux.Window, result intelligence.Result) {
	window.IntelligenceApp = string(result.App)
	window.IntelligenceStatus = string(result.Status)
	window.IntelligenceSummary = result.Summary
	window.IntelligenceSource = result.Source
	window.IntelligenceConfidence = result.Confidence
	window.IntelligenceUpdatedAt = formatIntelligenceTime(result.UpdatedAt)
	window.IntelligenceStale = result.Stale
	window.IntelligenceError = result.Error
}

func applyPaneResult(pane *tmux.Pane, result intelligence.Result) {
	pane.IntelligenceApp = string(result.App)
	pane.IntelligenceStatus = string(result.Status)
	pane.IntelligenceSummary = result.Summary
	pane.IntelligenceSource = result.Source
	pane.IntelligenceConfidence = result.Confidence
	pane.IntelligenceUpdatedAt = formatIntelligenceTime(result.UpdatedAt)
	pane.IntelligenceStale = result.Stale
	pane.IntelligenceError = result.Error
}
