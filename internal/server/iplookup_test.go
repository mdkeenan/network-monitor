package server

import "testing"

func TestSubnetMaskFromPrefix(t *testing.T) {
	tests := []struct {
		prefix int
		want   string
	}{
		{24, "255.255.255.0"},
		{16, "255.255.0.0"},
		{22, "255.255.252.0"},
		{8, "255.0.0.0"},
	}

	for _, tc := range tests {
		if got := subnetMaskFromPrefix(tc.prefix); got != tc.want {
			t.Fatalf("subnetMaskFromPrefix(%d) = %q, want %q", tc.prefix, got, tc.want)
		}
	}
}
