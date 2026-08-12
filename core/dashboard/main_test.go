package main

import "testing"

func TestIsLocalOrigin(t *testing.T) {
	tests := []struct {
		origin  string
		allowed bool
	}{
		{"", true},
		{"tauri://localhost", true},
		{"https://tauri.localhost", true},
		{"http://localhost:1420", true},
		{"http://127.0.0.1:9000", true},
		{"http://[::1]:9000", true},
		{"https://example.com", false},
		{"javascript:alert(1)", false},
	}
	for _, tt := range tests {
		if got := isLocalOrigin(tt.origin); got != tt.allowed {
			t.Errorf("isLocalOrigin(%q) = %v, want %v", tt.origin, got, tt.allowed)
		}
	}
}
