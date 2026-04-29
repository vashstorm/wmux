package semantic_test

import (
	"testing"

	"github.com/panh/wmux/internal/semantic"
)

func TestClassify(t *testing.T) {
	tests := []struct {
		name   string
		output string
		want   semantic.SemanticEventType
	}{
		// ===== choice_required POSITIVE cases (>=2) =====
		{
			name:   "choice y/n prompt continue",
			output: "[Y/n] Continue?",
			want:   semantic.EventChoiceRequired,
		},
		{
			name:   "choice yes/no prompt",
			output: "Do you want to proceed? [yes/no]",
			want:   semantic.EventChoiceRequired,
		},
		{
			name:   "choice numbered menu with enter choice",
			output: "(1) Option A\n(2) Option B\n(3) Option C\nEnter choice:",
			want:   semantic.EventChoiceRequired,
		},
		{
			name:   "choice please select",
			output: "Please select an option from the list below:",
			want:   semantic.EventChoiceRequired,
		},
		{
			name:   "choice inquirer style with options",
			output: "? Which framework do you want to use? (Use arrow keys)\n> React\n  Vue\n  Angular",
			want:   semantic.EventChoiceRequired,
		},
		{
			name:   "choice opencode menu style",
			output: "Select an action:\n❯ Create new file\n❯ Open existing\n❯ Exit",
			want:   semantic.EventChoiceRequired,
		},

		// ===== blocked_error POSITIVE cases (>=2) =====
		{
			name:   "blocked permission denied",
			output: "bash: ./script.sh: Permission denied",
			want:   semantic.EventBlockedError,
		},
		{
			name:   "blocked command not found",
			output: "bash: foobar: command not found",
			want:   semantic.EventBlockedError,
		},
		{
			name:   "blocked no such file",
			output: "cat: /nonexistent/file.txt: No such file or directory",
			want:   semantic.EventBlockedError,
		},
		{
			name:   "blocked fatal error",
			output: "Fatal error: unable to connect to database",
			want:   semantic.EventBlockedError,
		},
		{
			name:   "blocked panic",
			output: "panic: runtime error: nil pointer dereference",
			want:   semantic.EventBlockedError,
		},
		{
			name:   "blocked node module not found",
			output: "Error: Cannot find module 'express'",
			want:   semantic.EventBlockedError,
		},
		{
			name:   "blocked cargo error",
			output: "error: could not compile `myproject`",
			want:   semantic.EventBlockedError,
		},
		{
			name:   "blocked enoent",
			output: "Error: ENOENT: no such file or directory, open '/tmp/missing.txt'",
			want:   semantic.EventBlockedError,
		},
		{
			name:   "blocked econnrefused",
			output: "Error: ECONNREFUSED 127.0.0.1:3306",
			want:   semantic.EventBlockedError,
		},
		{
			name:   "blocked authentication failed",
			output: "Authentication failed: invalid credentials",
			want:   semantic.EventBlockedError,
		},
		{
			name:   "blocked access denied",
			output: "Access denied for user 'admin'@'localhost'",
			want:   semantic.EventBlockedError,
		},
		{
			name:   "blocked exit status",
			output: "exit status 1",
			want:   semantic.EventBlockedError,
		},
		{
			name:   "blocked exit code",
			output: "Process finished with Exit 1",
			want:   semantic.EventBlockedError,
		},

		// ===== user_response_required POSITIVE cases (>=2) =====
		{
			name:   "user response waiting for your response",
			output: "Waiting for your response to continue...",
			want:   semantic.EventUserResponseRequired,
		},
		{
			name:   "user response cannot continue without",
			output: "Cannot continue without your input. Please provide a value.",
			want:   semantic.EventUserResponseRequired,
		},
		{
			name:   "user response requires your input",
			output: "Requires your input to proceed with the operation.",
			want:   semantic.EventUserResponseRequired,
		},
		{
			name:   "user response awaiting input",
			output: "The process is awaiting input from the user.",
			want:   semantic.EventUserResponseRequired,
		},
		{
			name:   "user response need your answer",
			output: "I need your answer before proceeding.",
			want:   semantic.EventUserResponseRequired,
		},
		{
			name:   "user response please provide",
			output: "Please provide the API key to continue.",
			want:   semantic.EventUserResponseRequired,
		},
		{
			name:   "user response enter your",
			output: "Enter your email address to receive notifications.",
			want:   semantic.EventUserResponseRequired,
		},
		{
			name:   "user response type your",
			output: "Type your password to authenticate.",
			want:   semantic.EventUserResponseRequired,
		},
		{
			name:   "user response input required",
			output: "Input required: missing configuration value",
			want:   semantic.EventUserResponseRequired,
		},
		{
			name:   "user response your input needed",
			output: "Your input needed: select the deployment target",
			want:   semantic.EventUserResponseRequired,
		},

		// ===== NEGATIVE cases - Generic questions (should be none) =====
		{
			name:   "negative generic question would you like",
			output: "Would you like to learn more about this feature?",
			want:   semantic.EventNone,
		},
		{
			name:   "negative generic question are you sure",
			output: "Are you sure you want to delete this file?",
			want:   semantic.EventNone,
		},
		{
			name:   "negative generic question what do you think",
			output: "What do you think about this approach?",
			want:   semantic.EventNone,
		},
		{
			name:   "negative generic question ending with question mark",
			output: "Is this the expected behavior?",
			want:   semantic.EventNone,
		},
		{
			name:   "negative question without option indicators",
			output: "? What would you prefer to do?",
			want:   semantic.EventNone,
		},

		// ===== NEGATIVE cases - Progress/status updates (should be none) =====
		{
			name:   "negative progress checkmark",
			output: "✓ Running tests...",
			want:   semantic.EventNone,
		},
		{
			name:   "negative progress with counter",
			output: "Processing 3/10 files...",
			want:   semantic.EventNone,
		},
		{
			name:   "negative status installing",
			output: "Installing dependencies...",
			want:   semantic.EventNone,
		},
		{
			name:   "negative status downloading",
			output: "Downloading package (45%)...",
			want:   semantic.EventNone,
		},

		// ===== NEGATIVE cases - Non-blocking summaries (should be none) =====
		{
			name:   "negative summary completed task",
			output: "I've completed the task. Here's what I did:\n- Fixed the bug\n- Added tests\n- Updated docs",
			want:   semantic.EventNone,
		},
		{
			name:   "negative summary here is the result",
			output: "Here is the result of the operation:\nAll tests passed successfully.",
			want:   semantic.EventNone,
		},
		{
			name:   "negative summary suggestion",
			output: "I suggest you review the changes before committing.",
			want:   semantic.EventNone,
		},
		{
			name:   "negative summary analysis",
			output: "Based on my analysis, the issue is caused by a missing dependency.",
			want:   semantic.EventNone,
		},

		// ===== NEGATIVE cases - Empty or whitespace (should be none) =====
		{
			name:   "negative empty output",
			output: "",
			want:   semantic.EventNone,
		},
		{
			name:   "negative whitespace only",
			output: "   \n\t\n   ",
			want:   semantic.EventNone,
		},

		// ===== NEGATIVE cases - Normal output (should be none) =====
		{
			name:   "negative normal log output",
			output: "Server started on port 8080\nListening for connections...",
			want:   semantic.EventNone,
		},
		{
			name:   "negative normal command output",
			output: "total 48\ndrwxr-xr-x  5 user  staff   160 Apr 30 10:00 .\n-rw-r--r--  1 user  staff  1234 Apr 30 10:00 main.go",
			want:   semantic.EventNone,
		},

		// ===== Edge cases =====
		{
			name:   "edge exit status 0 is not blocked",
			output: "exit status 0",
			want:   semantic.EventNone,
		},
		{
			name:   "edge single menu item no choice",
			output: "> Only one option",
			want:   semantic.EventNone,
		},
		{
			name:   "edge y/n in middle of line",
			output: "The option [Y/n] is shown but this is not a prompt",
			want:   semantic.EventChoiceRequired,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := semantic.Classify(tt.output)
			if got != tt.want {
				t.Fatalf("Classify(%q) = %q, want %q", tt.output, got, tt.want)
			}
		})
	}
}
