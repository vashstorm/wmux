package intelligence

import (
	"testing"
	"time"
)

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
