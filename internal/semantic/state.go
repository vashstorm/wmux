package semantic

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"
)

// PaneSemanticState holds the active semantic event for one pane.
type PaneSemanticState struct {
	PaneID    string
	EventType SemanticEventType
	Signature string // hash of pane_id + event_type + output snippet for dedupe
}

// StateManager tracks active semantic events per pane in memory.
// PoC: ephemeral, no persistence.
type StateManager struct {
	mu     sync.Mutex
	states map[string]*PaneSemanticState // keyed by pane ID
}

// NewStateManager creates a new empty state manager.
func NewStateManager() *StateManager {
	return &StateManager{
		states: make(map[string]*PaneSemanticState),
	}
}

// computeSignature generates a deduplication signature from paneID, eventType and output snippet.
func computeSignature(paneID string, event SemanticEventType, outputSnippet string) string {
	h := sha256.New()
	h.Write([]byte(paneID))
	h.Write([]byte(event))
	h.Write([]byte(outputSnippet))
	return hex.EncodeToString(h.Sum(nil))[:16]
}

// Update sets or refreshes the semantic event for a pane.
// If the event is EventNone, the pane state is cleared.
// If signature matches existing state, it is a refresh (no-op for dedupe).
func (m *StateManager) Update(paneID string, event SemanticEventType, outputSnippet string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if event == EventNone {
		delete(m.states, paneID)
		return
	}

	sig := computeSignature(paneID, event, outputSnippet)

	// Check if this is a duplicate (same signature)
	if existing, ok := m.states[paneID]; ok && existing.Signature == sig {
		// Same event, same output - no-op for dedupe
		return
	}

	// New or changed event - update state
	m.states[paneID] = &PaneSemanticState{
		PaneID:    paneID,
		EventType: event,
		Signature: sig,
	}
}

// Get returns the current semantic event for a pane, or EventNone if not present.
func (m *StateManager) Get(paneID string) SemanticEventType {
	m.mu.Lock()
	defer m.mu.Unlock()

	if state, ok := m.states[paneID]; ok {
		return state.EventType
	}
	return EventNone
}

// ClearIfInputReceived clears state for a pane if it holds an event that requires user input.
// Called after actual user input is sent to that pane.
func (m *StateManager) ClearIfInputReceived(paneID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, ok := m.states[paneID]
	if !ok {
		return
	}

	// Only clear events that require user input
	if ClearRequiresInput(state.EventType) {
		delete(m.states, paneID)
	}
}

// GetAll returns a snapshot of all active pane states.
func (m *StateManager) GetAll() map[string]SemanticEventType {
	m.mu.Lock()
	defer m.mu.Unlock()

	result := make(map[string]SemanticEventType, len(m.states))
	for paneID, state := range m.states {
		result[paneID] = state.EventType
	}
	return result
}
