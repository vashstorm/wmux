package semantic_test

import (
	"testing"

	"github.com/panh/wmux/internal/semantic"
)

func TestIsAIPane(t *testing.T) {
	tests := []struct {
		name    string
		command string
		want    bool
	}{
		// AI commands (allowlist)
		{name: "claude", command: "claude", want: true},
		{name: "opencode", command: "opencode", want: true},
		{name: "codex", command: "codex", want: true},
		{name: "aider", command: "aider", want: true},
		{name: "omo", command: "omo", want: true},

		// Non-AI commands
		{name: "bash", command: "bash", want: false},
		{name: "vim", command: "vim", want: false},
		{name: "node", command: "node", want: false},
		{name: "python", command: "python", want: false},
		{name: "unknown", command: "some-random-cmd", want: false},
		{name: "empty", command: "", want: false},

		// Normalization cases
		{name: "uppercase CLAUDE", command: "CLAUDE", want: true},
		{name: "mixed case Codex", command: "Codex", want: true},
		{name: "with spaces", command: "  aider  ", want: true},
		{name: "leading dash", command: "-omo", want: true},
		{name: "leading dash uppercase", command: "-OPENCODE", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := semantic.IsAIPane(tt.command)
			if got != tt.want {
				t.Fatalf("IsAIPane(%q) = %v, want %v", tt.command, got, tt.want)
			}
		})
	}
}

func TestSemanticEventPriority(t *testing.T) {
	tests := []struct {
		name  string
		event semantic.SemanticEventType
		want  int
	}{
		{name: "none", event: semantic.EventNone, want: 0},
		{name: "dead_loop", event: semantic.EventDeadLoop, want: 1},
		{name: "blocked_error", event: semantic.EventBlockedError, want: 2},
		{name: "choice_required", event: semantic.EventChoiceRequired, want: 3},
		{name: "user_response_required", event: semantic.EventUserResponseRequired, want: 4},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := semantic.SemanticEventPriority(tt.event)
			if got != tt.want {
				t.Fatalf("SemanticEventPriority(%q) = %d, want %d", tt.event, got, tt.want)
			}
		})
	}
}

func TestAggregateSemanticEvent(t *testing.T) {
	tests := []struct {
		name   string
		events []semantic.SemanticEventType
		want   semantic.SemanticEventType
	}{
		{
			name:   "empty slice returns none",
			events: []semantic.SemanticEventType{},
			want:   semantic.EventNone,
		},
		{
			name:   "single none",
			events: []semantic.SemanticEventType{semantic.EventNone},
			want:   semantic.EventNone,
		},
		{
			name:   "single user_response_required",
			events: []semantic.SemanticEventType{semantic.EventUserResponseRequired},
			want:   semantic.EventUserResponseRequired,
		},
		{
			name:   "user_response_required beats choice_required",
			events: []semantic.SemanticEventType{semantic.EventChoiceRequired, semantic.EventUserResponseRequired},
			want:   semantic.EventUserResponseRequired,
		},
		{
			name:   "choice_required beats blocked_error",
			events: []semantic.SemanticEventType{semantic.EventBlockedError, semantic.EventChoiceRequired},
			want:   semantic.EventChoiceRequired,
		},
		{
			name:   "blocked_error beats dead_loop",
			events: []semantic.SemanticEventType{semantic.EventDeadLoop, semantic.EventBlockedError},
			want:   semantic.EventBlockedError,
		},
		{
			name:   "dead_loop beats none",
			events: []semantic.SemanticEventType{semantic.EventNone, semantic.EventDeadLoop},
			want:   semantic.EventDeadLoop,
		},
		{
			name:   "mixed list user_response_required wins",
			events: []semantic.SemanticEventType{semantic.EventNone, semantic.EventDeadLoop, semantic.EventBlockedError, semantic.EventChoiceRequired, semantic.EventUserResponseRequired},
			want:   semantic.EventUserResponseRequired,
		},
		{
			name:   "mixed list without highest choice_required wins",
			events: []semantic.SemanticEventType{semantic.EventNone, semantic.EventDeadLoop, semantic.EventBlockedError, semantic.EventChoiceRequired},
			want:   semantic.EventChoiceRequired,
		},
		{
			name:   "all none",
			events: []semantic.SemanticEventType{semantic.EventNone, semantic.EventNone},
			want:   semantic.EventNone,
		},
		{
			name:   "duplicate highest first",
			events: []semantic.SemanticEventType{semantic.EventUserResponseRequired, semantic.EventNone},
			want:   semantic.EventUserResponseRequired,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := semantic.AggregateSemanticEvent(tt.events)
			if got != tt.want {
				t.Fatalf("AggregateSemanticEvent() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestClearRequiresInput(t *testing.T) {
	tests := []struct {
		name  string
		event semantic.SemanticEventType
		want  bool
	}{
		{name: "user_response_required requires input", event: semantic.EventUserResponseRequired, want: true},
		{name: "choice_required requires input", event: semantic.EventChoiceRequired, want: true},
		{name: "blocked_error does not require input", event: semantic.EventBlockedError, want: false},
		{name: "dead_loop does not require input", event: semantic.EventDeadLoop, want: false},
		{name: "none does not require input", event: semantic.EventNone, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := semantic.ClearRequiresInput(tt.event)
			if got != tt.want {
				t.Fatalf("ClearRequiresInput(%q) = %v, want %v", tt.event, got, tt.want)
			}
		})
	}
}
