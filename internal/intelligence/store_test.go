package intelligence

import (
	"database/sql"
	"strings"
	"testing"
	"time"
)

func TestStoreCacheMiss(t *testing.T) {
	store := newTestStore(t)

	_, ok, err := store.Get("%missing")
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if ok {
		t.Fatal("expected cache miss")
	}
}

func TestStoreCacheHit(t *testing.T) {
	store := newTestStore(t)
	want := testResult("%1", "dev", "@1", StatusWaitingConfirm, time.Now())

	if err := store.Set(want); err != nil {
		t.Fatalf("Set returned error: %v", err)
	}
	got, ok, err := store.Get("%1")
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected cache hit")
	}
	if got.PaneID != want.PaneID || got.SessionName != want.SessionName || got.WindowID != want.WindowID || got.Status != want.Status || got.ContentHash != want.ContentHash {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if got.Stale {
		t.Fatal("fresh result should not be stale")
	}
}

func TestStoreCacheTTLExpiry(t *testing.T) {
	store := newTestStore(t)
	old := testResult("%1", "dev", "@1", StatusBlocked, time.Now().Add(-10*time.Minute))

	if err := store.Set(old); err != nil {
		t.Fatalf("Set returned error: %v", err)
	}
	if !store.IsExpired(old, 60) {
		t.Fatal("expected old result to be expired")
	}
	got, ok, err := store.Get("%1")
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if !ok {
		t.Fatal("expired cache should return stale result")
	}
	if !got.Stale {
		t.Fatalf("expired result should be marked stale: %+v", got)
	}
}

func TestStoreGetBySession(t *testing.T) {
	store := newTestStore(t)
	for _, paneID := range []string{"%1", "%2", "%3"} {
		if err := store.Set(testResult(paneID, "dev", "@1", StatusRunning, time.Now())); err != nil {
			t.Fatalf("Set returned error: %v", err)
		}
	}
	if err := store.Set(testResult("%4", "other", "@2", StatusBlocked, time.Now())); err != nil {
		t.Fatalf("Set returned error: %v", err)
	}

	got, err := store.GetBySession("dev", 300)
	if err != nil {
		t.Fatalf("GetBySession returned error: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("len(GetBySession) = %d, want 3", len(got))
	}
}

func TestGetBySessionRespectsConfigTTL(t *testing.T) {
	store := newTestStore(t)
	updatedAt := time.Now().Add(-90 * time.Second)
	if err := store.Set(testResult("%1", "dev", "@1", StatusRunning, updatedAt)); err != nil {
		t.Fatalf("Set returned error: %v", err)
	}

	staleResults, err := store.GetBySession("dev", 60)
	if err != nil {
		t.Fatalf("GetBySession stale ttl returned error: %v", err)
	}
	if len(staleResults) != 1 {
		t.Fatalf("len(staleResults) = %d, want 1", len(staleResults))
	}
	if !staleResults[0].Stale {
		t.Fatalf("expected stale result with ttl 60s: %+v", staleResults[0])
	}

	freshResults, err := store.GetBySession("dev", 300)
	if err != nil {
		t.Fatalf("GetBySession fresh ttl returned error: %v", err)
	}
	if len(freshResults) != 1 {
		t.Fatalf("len(freshResults) = %d, want 1", len(freshResults))
	}
	if freshResults[0].Stale {
		t.Fatalf("expected fresh result with ttl 300s: %+v", freshResults[0])
	}
}

func TestStoreNeverStoresRawContent(t *testing.T) {
	store := newTestStore(t)
	if err := store.Set(testResult("%1", "dev", "@1", StatusRunning, time.Now())); err != nil {
		t.Fatalf("Set returned error: %v", err)
	}

	rows, err := store.db.Query("PRAGMA table_info(intelligence_results)")
	if err != nil {
		t.Fatalf("PRAGMA returned error: %v", err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var typ string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			t.Fatalf("scan pragma: %v", err)
		}
		if stringsContainsFold(name, "raw") || stringsContainsFold(name, "prompt") || stringsContainsFold(name, "content") && name != "content_hash" {
			t.Fatalf("schema must not store raw content or prompts, found column %q", name)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows error: %v", err)
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := NewStore(":memory:")
	if err != nil {
		t.Fatalf("NewStore returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
	})
	return store
}

func testResult(paneID string, sessionName string, windowID string, status Status, updatedAt time.Time) Result {
	return Result{
		PaneID:      paneID,
		SessionName: sessionName,
		WindowID:    windowID,
		App:         AppClaude,
		Status:      status,
		Summary:     "summary for " + paneID,
		Source:      "fake",
		Confidence:  0.9,
		Reason:      "test reason",
		ContentHash: "hash-" + paneID,
		UpdatedAt:   updatedAt,
	}
}

func stringsContainsFold(s string, substr string) bool {
	return strings.Contains(strings.ToLower(s), strings.ToLower(substr))
}
