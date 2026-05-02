package intelligence

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const defaultCacheTTLSec = 300

// Store persists derived intelligence results only.
type Store struct {
	db *sql.DB
	mu sync.Mutex
}

// NewStore opens a SQLite-backed intelligence store.
func NewStore(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open intelligence store: %w", err)
	}
	db.SetMaxOpenConns(1)

	store := &Store{db: db}
	if err := store.init(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

// Close closes the underlying database.
func (s *Store) Close() error {
	return s.db.Close()
}

// Set stores or replaces a derived result.
func (s *Store) Set(result Result) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	result = normalizeResult(result)
	_, err := s.db.Exec(`
INSERT INTO intelligence_results (
    content_hash, pane_id, session_name, window_id, app, status, summary,
    source, confidence, reason, updated_at, stale, error
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(pane_id) DO UPDATE SET
    content_hash = excluded.content_hash,
    session_name = excluded.session_name,
    window_id = excluded.window_id,
    app = excluded.app,
    status = excluded.status,
    summary = excluded.summary,
    source = excluded.source,
    confidence = excluded.confidence,
    reason = excluded.reason,
    updated_at = excluded.updated_at,
    stale = excluded.stale,
    error = excluded.error`,
		result.ContentHash,
		result.PaneID,
		result.SessionName,
		result.WindowID,
		string(result.App),
		string(result.Status),
		result.Summary,
		result.Source,
		result.Confidence,
		result.Reason,
		result.UpdatedAt.Unix(),
		boolToInt(result.Stale),
		result.Error,
	)
	if err != nil {
		return fmt.Errorf("set intelligence result: %w", err)
	}
	return nil
}

// Get returns a result by pane ID. Expired results are returned as stale.
func (s *Store) Get(paneID string) (Result, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	result, err := s.getLocked(paneID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Result{}, false, nil
		}
		return Result{}, false, err
	}
	if s.IsExpired(result, defaultCacheTTLSec) && !result.Stale {
		result.Stale = true
		if err := s.setStaleLocked(paneID); err != nil {
			return Result{}, false, err
		}
	}
	return result, true, nil
}

// GetBySession returns all cached results for a session.
func (s *Store) GetBySession(sessionName string, cacheTTLSec int) ([]Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rows, err := s.db.Query(`
SELECT content_hash, pane_id, session_name, window_id, app, status, summary,
       source, confidence, reason, updated_at, stale, error
FROM intelligence_results
WHERE session_name = ?
ORDER BY pane_id`, sessionName)
	if err != nil {
		return nil, fmt.Errorf("get intelligence results by session: %w", err)
	}
	defer rows.Close()

	var results []Result
	for rows.Next() {
		result, err := scanResult(rows)
		if err != nil {
			return nil, err
		}
		if s.IsExpired(result, cacheTTLSec) {
			result.Stale = true
		}
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate intelligence results: %w", err)
	}
	return results, nil
}

// IsExpired reports whether a result is older than the configured TTL.
func (s *Store) IsExpired(result Result, cacheTTLSec int) bool {
	if cacheTTLSec <= 0 || result.UpdatedAt.IsZero() {
		return false
	}
	return !result.UpdatedAt.Add(time.Duration(cacheTTLSec) * time.Second).After(time.Now())
}

func (s *Store) DeleteExcept(sessionName string, keepPaneIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(keepPaneIDs) == 0 {
		_, err := s.db.Exec(`DELETE FROM intelligence_results WHERE session_name = ?`, sessionName)
		if err != nil {
			return fmt.Errorf("delete all session results: %w", err)
		}
		return nil
	}

	placeholders := make([]string, len(keepPaneIDs))
	args := make([]any, 0, len(keepPaneIDs)+1)
	args = append(args, sessionName)
	for i, id := range keepPaneIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}

	query := fmt.Sprintf(
		`DELETE FROM intelligence_results WHERE session_name = ? AND pane_id NOT IN (%s)`,
		strings.Join(placeholders, ","),
	)
	_, err := s.db.Exec(query, args...)
	if err != nil {
		return fmt.Errorf("delete stale session results: %w", err)
	}
	return nil
}

func (s *Store) init() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS intelligence_results (
    content_hash TEXT NOT NULL,
    pane_id TEXT NOT NULL,
    session_name TEXT NOT NULL,
    window_id TEXT NOT NULL,
    app TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    source TEXT NOT NULL,
    confidence REAL NOT NULL,
    reason TEXT,
    updated_at INTEGER NOT NULL,
    stale INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    PRIMARY KEY (pane_id)
);
CREATE INDEX IF NOT EXISTS idx_session ON intelligence_results(session_name);`)
	if err != nil {
		return fmt.Errorf("init intelligence store: %w", err)
	}
	return nil
}

func (s *Store) getLocked(paneID string) (Result, error) {
	row := s.db.QueryRow(`
SELECT content_hash, pane_id, session_name, window_id, app, status, summary,
       source, confidence, reason, updated_at, stale, error
FROM intelligence_results
WHERE pane_id = ?`, paneID)
	return scanResult(row)
}

func (s *Store) setStaleLocked(paneID string) error {
	_, err := s.db.Exec(`UPDATE intelligence_results SET stale = 1 WHERE pane_id = ?`, paneID)
	if err != nil {
		return fmt.Errorf("mark intelligence result stale: %w", err)
	}
	return nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanResult(row rowScanner) (Result, error) {
	var result Result
	var app string
	var status string
	var updatedAt int64
	var stale int
	if err := row.Scan(
		&result.ContentHash,
		&result.PaneID,
		&result.SessionName,
		&result.WindowID,
		&app,
		&status,
		&result.Summary,
		&result.Source,
		&result.Confidence,
		&result.Reason,
		&updatedAt,
		&stale,
		&result.Error,
	); err != nil {
		return Result{}, err
	}
	result.App = NormalizeApplication(app)
	result.Status = NormalizeStatus(status)
	result.UpdatedAt = time.Unix(updatedAt, 0)
	result.Stale = stale != 0
	return result, nil
}

func normalizeResult(result Result) Result {
	result.App = NormalizeApplication(string(result.App))
	result.Status = NormalizeStatus(string(result.Status))
	if result.UpdatedAt.IsZero() {
		result.UpdatedAt = time.Now()
	}
	if result.Confidence < 0 {
		result.Confidence = 0
	}
	if result.Confidence > 1 {
		result.Confidence = 1
	}
	result.Summary = truncateRunes(result.Summary, 120)
	result.Reason = truncateRunes(result.Reason, 240)
	return result
}

func truncateRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max])
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
