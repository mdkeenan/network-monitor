package updates

import "testing"

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		current string
		latest  string
		want    int
	}{
		{current: "v1.0.0", latest: "v1.0.1", want: -1},
		{current: "1.0.0", latest: "1.0.0", want: 0},
		{current: "v1.1.0", latest: "v1.0.9", want: 1},
		{current: "dev", latest: "v1.0.0", want: -1},
	}

	for _, tc := range tests {
		got := CompareVersions(tc.current, tc.latest)
		if got != tc.want {
			t.Fatalf("CompareVersions(%q, %q) = %d, want %d", tc.current, tc.latest, got, tc.want)
		}
	}
}
