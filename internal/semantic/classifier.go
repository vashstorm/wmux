// Package semantic provides AI-pane semantic event classification.
package semantic

import (
	"regexp"
	"strings"
)

// Classify analyzes normalized plain-text terminal output and returns the
// most appropriate semantic event type based on pattern matching rules.
// The input is expected to be plain text with ANSI codes already stripped.
func Classify(output string) SemanticEventType {
	if isUserResponseRequired(output) {
		return EventUserResponseRequired
	}

	if isChoiceRequired(output) {
		return EventChoiceRequired
	}

	if isBlockedError(output) {
		return EventBlockedError
	}

	if isDeadLoop(output) {
		return EventDeadLoop
	}

	return EventNone
}

func isChoiceRequired(output string) bool {
	lines := strings.Split(output, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if yesNoPattern.MatchString(line) {
			return true
		}

		lowerLine := strings.ToLower(line)
		if strings.Contains(lowerLine, "please select") ||
			strings.Contains(lowerLine, "choose an option") ||
			strings.Contains(lowerLine, "select one of the following") {
			return true
		}

		if numberedMenuPattern.MatchString(output) {
			return true
		}

		if strings.Contains(line, "?") && hasOptionIndicators(line) {
			return true
		}

		if isMenuItem(line) && hasMultipleMenuItems(lines) {
			return true
		}
	}

	return false
}

func isBlockedError(output string) bool {
	lines := strings.Split(output, "\n")
	lowerOutput := strings.ToLower(output)

	if strings.Contains(lowerOutput, "permission denied") ||
		strings.Contains(lowerOutput, "eacces") ||
		strings.Contains(lowerOutput, "eperm") {
		return true
	}

	if strings.Contains(lowerOutput, "command not found") ||
		strings.Contains(lowerOutput, "no such file or directory") {
		return true
	}

	if fatalPattern.MatchString(output) {
		return true
	}

	if strings.Contains(lowerOutput, "error: cannot find module") {
		return true
	}

	if cargoErrorPattern.MatchString(lowerOutput) {
		return true
	}

	if strings.Contains(lowerOutput, "error: enoent") ||
		strings.Contains(lowerOutput, "error: econnrefused") {
		return true
	}

	if strings.Contains(lowerOutput, "authentication failed") ||
		strings.Contains(lowerOutput, "access denied") {
		return true
	}

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if exitStatusPattern.MatchString(line) {
			return true
		}
	}

	return false
}

func isUserResponseRequired(output string) bool {
	lowerOutput := strings.ToLower(output)

	if cannotProceedPattern.MatchString(output) {
		return true
	}

	if needYouToPattern.MatchString(output) {
		return true
	}

	if strings.Contains(lowerOutput, "waiting for your input") ||
		strings.Contains(lowerOutput, "blocked until you") {
		return true
	}

	if beforeIContinuePattern.MatchString(output) {
		return true
	}

	if needYourApprovalPattern.MatchString(output) {
		return true
	}

	if pleaseProvidePattern.MatchString(output) {
		return true
	}

	if strings.Contains(lowerOutput, "waiting for your response") ||
		strings.Contains(lowerOutput, "awaiting input") ||
		strings.Contains(lowerOutput, "need your answer") {
		return true
	}

	if strings.Contains(lowerOutput, "requires your input to proceed") {
		return true
	}

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		lowerLine := strings.ToLower(line)

		if strings.Contains(lowerLine, "input required") ||
			strings.Contains(lowerLine, "your input needed") {
			return true
		}
	}

	return false
}

func isDeadLoop(output string) bool {
	if isDeadLoopPattern(output) {
		return true
	}
	return false
}

func isDeadLoopPattern(output string) bool {
	lines := strings.Split(output, "\n")
	lowerOutput := strings.ToLower(output)

	if hasRepeatedIdenticalLines(lines, 5) {
		return true
	}

	retryPatterns := []string{"attempting again", "retrying", "retry"}
	for _, p := range retryPatterns {
		if countOccurrences(lowerOutput, p) >= 4 {
			return true
		}
	}

	loopPatterns := []string{"loop iteration", "cycle"}
	for _, p := range loopPatterns {
		if countOccurrences(lowerOutput, p) >= 4 {
			return true
		}
	}

	cursorResetCount := strings.Count(output, "\033[1A") + strings.Count(output, "\r")
	if cursorResetCount >= 10 {
		return true
	}

	return false
}

func hasRepeatedIdenticalLines(lines []string, threshold int) bool {
	if threshold < 2 {
		threshold = 2
	}
	var nonEmpty []string
	for _, line := range lines {
		if strings.TrimSpace(line) != "" {
			nonEmpty = append(nonEmpty, strings.TrimSpace(line))
		}
	}
	if len(nonEmpty) < threshold {
		return false
	}
	windowStart := 0
	if len(nonEmpty) > 10 {
		windowStart = len(nonEmpty) - 10
	}
	window := nonEmpty[windowStart:]
	if len(window) < threshold {
		return false
	}

	freq := make(map[string]int, len(window))
	for _, line := range window {
		freq[line]++
		if freq[line] >= threshold {
			return true
		}
	}
	return false
}

func countOccurrences(s, substr string) int {
	if substr == "" {
		return 0
	}
	count := 0
	for {
		idx := strings.Index(s, substr)
		if idx == -1 {
			break
		}
		count++
		s = s[idx+len(substr):]
	}
	return count
}

func hasOptionIndicators(line string) bool {
	lower := strings.ToLower(line)
	return strings.Contains(lower, "(1)") ||
		strings.Contains(lower, "(2)") ||
		strings.Contains(lower, "[1]") ||
		strings.Contains(lower, "[2]") ||
		strings.Contains(lower, "(use arrow keys)") ||
		strings.Contains(lower, "react") ||
		strings.Contains(lower, "vue") ||
		strings.Contains(lower, "angular") ||
		strings.Contains(lower, "yes") ||
		strings.Contains(lower, "no") ||
		strings.Contains(lower, "option")
}

func isMenuItem(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}
	return strings.HasPrefix(trimmed, ">") || strings.HasPrefix(trimmed, "❯")
}

func hasMultipleMenuItems(lines []string) bool {
	count := 0
	for _, line := range lines {
		if isMenuItem(strings.TrimSpace(line)) {
			count++
			if count >= 2 {
				return true
			}
		}
	}
	return false
}

var (
	// Matches [Y/n], [y/N], [Y/N], [yes/no] with optional trailing text
	yesNoPattern = regexp.MustCompile(`(?i)\[[Yy]/[Nn]\].*$|\[yes/no\].*$`)

	// Matches (1) Option (2) Option ... Enter choice:
	numberedMenuPattern = regexp.MustCompile(`(?is)\(1\).*\(2\).*enter choice`)

	// Matches Fatal error:, FATAL:, panic:
	fatalPattern = regexp.MustCompile(`(?i)(fatal error:|fatal:|panic:)\s*`)

	// Matches error: could not (Rust/cargo style)
	cargoErrorPattern = regexp.MustCompile(`(?i)error:\s*could not`)

	// Matches "exit status [1-9]" or "Exit 1"
	exitStatusPattern = regexp.MustCompile(`(?i)(exit status [1-9]|exit [1-9])`)

	// Matches "Please provide/Enter your/Type your" with context
	pleaseProvidePattern = regexp.MustCompile(`(?i)(please provide|enter your|type your)\s+\w+`)

	cannotProceedPattern = regexp.MustCompile(`(?i)(i cannot proceed|cannot continue without|blocked until you)`)

	needYouToPattern = regexp.MustCompile(`(?i)(i need you to|i need your)`)

	beforeIContinuePattern = regexp.MustCompile(`(?i)(before i continue, please)`)

	needYourApprovalPattern = regexp.MustCompile(`(?i)(need your approval to proceed|need your approval)`)
)
