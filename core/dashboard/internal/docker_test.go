package internal

import "testing"

func TestEffectiveMemoryUsage(t *testing.T) {
	tests := []struct {
		name                         string
		usage, inactive, cache, want uint64
	}{
		{"subtracts cgroup v2 inactive pages", 500, 100, 200, 400},
		{"falls back to cgroup v1 cache", 500, 0, 200, 300},
		{"never underflows", 100, 200, 0, 100},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := effectiveMemoryUsage(test.usage, test.inactive, test.cache); got != test.want {
				t.Fatalf("effectiveMemoryUsage() = %d, want %d", got, test.want)
			}
		})
	}
}

func TestMemoryPressure(t *testing.T) {
	tests := []struct {
		percent float64
		limited bool
		want    string
	}{
		{99, false, "unbounded"},
		{74.9, true, "ok"},
		{75, true, "warning"},
		{89.9, true, "warning"},
		{90, true, "critical"},
	}
	for _, test := range tests {
		if got := memoryPressure(test.percent, test.limited); got != test.want {
			t.Errorf("memoryPressure(%v, %v) = %q, want %q", test.percent, test.limited, got, test.want)
		}
	}
}

func TestBelongsToProject(t *testing.T) {
	tests := []struct {
		container, project string
		want               bool
	}{
		{"mancii", "mancii", true},
		{"mancii-web", "mancii", true},
		{"mancii-app", "mancii", true},
		{"mancii2", "mancii", false},
		{"other-mancii", "mancii", false},
	}
	for _, test := range tests {
		if got := belongsToProject(test.container, test.project); got != test.want {
			t.Errorf("belongsToProject(%q, %q) = %v, want %v", test.container, test.project, got, test.want)
		}
	}
}
