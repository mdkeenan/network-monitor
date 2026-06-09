package config

import (
	"strings"
	"testing"
)

func TestValidateTarget(t *testing.T) {
	tests := []struct {
		input   string
		want    string
		wantErr string
	}{
		{input: "8.8.8.8", want: "8.8.8.8"},
		{input: "google.com", want: "google.com"},
		{input: "https://google.com/", want: "google.com"},
		{input: "999.3.3.3", wantErr: "each part of an IP address must be a number from 0 to 255"},
		{input: "256.1.1.1", wantErr: "each part of an IP address must be a number from 0 to 255"},
		{input: "", wantErr: "enter an IP address or hostname"},
		{input: "bad host!", wantErr: "enter a valid hostname"},
	}

	for _, tc := range tests {
		got, err := ValidateTarget(tc.input)
		if tc.wantErr != "" {
			if err == nil {
				t.Fatalf("ValidateTarget(%q) expected error, got %q", tc.input, got)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("ValidateTarget(%q) error = %q, want substring %q", tc.input, err.Error(), tc.wantErr)
			}
			continue
		}
		if err != nil {
			t.Fatalf("ValidateTarget(%q) unexpected error: %v", tc.input, err)
		}
		if got != tc.want {
			t.Fatalf("ValidateTarget(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}
