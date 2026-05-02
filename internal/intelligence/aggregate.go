package intelligence

// CountApplications returns a histogram of recognized applications across pane results.
// Unknown apps are excluded. Returns nil when no countable apps exist.
func CountApplications(results []Result) map[string]int {
	counts := make(map[string]int)
	for _, result := range results {
		if result.App == "" || result.App == AppUnknown {
			continue
		}
		counts[string(result.App)]++
	}
	if len(counts) == 0 {
		return nil
	}
	return counts
}

// AggregateSessionIntelligence returns the highest-priority pane result.
func AggregateSessionIntelligence(results []Result, activePaneID string) Result {
	var best Result
	for _, result := range results {
		if best.PaneID == "" || betterResult(result, best, activePaneID) {
			best = result
		}
	}
	return best
}

func betterResult(candidate Result, current Result, activePaneID string) bool {
	candidatePriority := StatusPriority(candidate.Status)
	currentPriority := StatusPriority(current.Status)
	if candidatePriority != currentPriority {
		return candidatePriority > currentPriority
	}

	candidateActive := candidate.PaneID == activePaneID
	currentActive := current.PaneID == activePaneID
	if candidateActive != currentActive {
		return candidateActive
	}

	return candidate.UpdatedAt.After(current.UpdatedAt)
}
