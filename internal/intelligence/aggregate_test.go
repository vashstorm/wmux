package intelligence

import (
	"testing"
	"time"
)

func TestCountApplications(t *testing.T) {
	t.Run("counts recognized apps excluding unknown", func(t *testing.T) {
		got := CountApplications([]Result{
			{PaneID: "%1", App: AppClaude},
			{PaneID: "%2", App: AppZsh},
			{PaneID: "%3", App: AppClaude},
			{PaneID: "%4", App: AppUnknown},
			{PaneID: "%5", App: AppOpenCode},
		})
		if got["claude"] != 2 {
			t.Fatalf("got claude count %d, want 2", got["claude"])
		}
		if got["zsh"] != 1 {
			t.Fatalf("got zsh count %d, want 1", got["zsh"])
		}
		if got["opencode"] != 1 {
			t.Fatalf("got opencode count %d, want 1", got["opencode"])
		}
		if _, ok := got["unknown"]; ok {
			t.Fatal("unknown should not be in counts")
		}
	})

	t.Run("returns nil for empty input", func(t *testing.T) {
		got := CountApplications([]Result{})
		if got != nil {
			t.Fatalf("got %v, want nil", got)
		}
	})

	t.Run("returns nil when only unknown apps", func(t *testing.T) {
		got := CountApplications([]Result{
			{PaneID: "%1", App: AppUnknown},
			{PaneID: "%2", App: AppUnknown},
		})
		if got != nil {
			t.Fatalf("got %v, want nil", got)
		}
	})

	t.Run("includes codex", func(t *testing.T) {
		got := CountApplications([]Result{
			{PaneID: "%1", App: AppCodex},
			{PaneID: "%2", App: AppCodex},
		})
		if got["codex"] != 2 {
			t.Fatalf("got codex count %d, want 2", got["codex"])
		}
	})
}

func TestAggregateSessionIntelligence(t *testing.T) {
	now := time.Now()

	t.Run("highest priority status wins", func(t *testing.T) {
		got := AggregateSessionIntelligence([]Result{
			{PaneID: "%1", Status: StatusRunning, Summary: "running", UpdatedAt: now},
			{PaneID: "%2", Status: StatusWaiting, Summary: "waiting", UpdatedAt: now},
			{PaneID: "%3", Status: StatusBlocked, Summary: "blocked", UpdatedAt: now},
		}, "%1")
		if got.Status != StatusBlocked || got.Summary != "blocked" {
			t.Fatalf("got %+v, want blocked", got)
		}
	})

	t.Run("active pane breaks status ties", func(t *testing.T) {
		got := AggregateSessionIntelligence([]Result{
			{PaneID: "%1", Status: StatusBlocked, Summary: "inactive", UpdatedAt: now.Add(time.Minute)},
			{PaneID: "%2", Status: StatusBlocked, Summary: "active", UpdatedAt: now},
		}, "%2")
		if got.Summary != "active" {
			t.Fatalf("got summary %q, want active", got.Summary)
		}
	})

	t.Run("most recent breaks non-active ties", func(t *testing.T) {
		got := AggregateSessionIntelligence([]Result{
			{PaneID: "%1", Status: StatusBlocked, Summary: "older", UpdatedAt: now},
			{PaneID: "%2", Status: StatusBlocked, Summary: "newer", UpdatedAt: now.Add(time.Minute)},
		}, "%3")
		if got.Summary != "newer" {
			t.Fatalf("got summary %q, want newer", got.Summary)
		}
	})

	t.Run("dead loop outranks all other statuses", func(t *testing.T) {
		got := AggregateSessionIntelligence([]Result{
			{PaneID: "%1", Status: StatusNone, Summary: "none", UpdatedAt: now.Add(4 * time.Minute)},
			{PaneID: "%2", Status: StatusRunning, Summary: "running", UpdatedAt: now.Add(3 * time.Minute)},
			{PaneID: "%3", Status: StatusWaiting, Summary: "waiting", UpdatedAt: now.Add(2 * time.Minute)},
			{PaneID: "%4", Status: StatusBlocked, Summary: "blocked", UpdatedAt: now.Add(time.Minute)},
			{PaneID: "%5", Status: StatusDeadLoop, Summary: "dead loop", UpdatedAt: now},
		}, "%1")
		if got.Status != StatusDeadLoop {
			t.Fatalf("got status %q, want dead_loop", got.Status)
		}
	})
}
