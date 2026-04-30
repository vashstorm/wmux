package intelligence

import "testing"

func TestNormalizeApplication(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want Application
	}{
		{name: "uppercase claude", in: "CLAUDE", want: AppClaude},
		{name: "unknown app", in: "vim", want: AppUnknown},
		{name: "empty", in: "", want: AppUnknown},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeApplication(tt.in); got != tt.want {
				t.Fatalf("NormalizeApplication(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestNormalizeStatus(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want Status
	}{
		{name: "uppercase dead loop", in: "DEAD_LOOP", want: StatusDeadLoop},
		{name: "unknown status", in: "busy", want: StatusNone},
		{name: "empty", in: "", want: StatusNone},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeStatus(tt.in); got != tt.want {
				t.Fatalf("NormalizeStatus(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestStatusPriority(t *testing.T) {
	tests := []struct {
		status Status
		want   int
	}{
		{status: StatusDeadLoop, want: 4},
		{status: StatusBlocked, want: 3},
		{status: StatusWaiting, want: 2},
		{status: StatusRunning, want: 1},
		{status: StatusNone, want: 0},
	}

	for _, tt := range tests {
		if got := StatusPriority(tt.status); got != tt.want {
			t.Fatalf("StatusPriority(%q) = %d, want %d", tt.status, got, tt.want)
		}
	}
}
