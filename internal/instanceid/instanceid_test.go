package instanceid

import (
	"strings"
	"testing"
)

func TestGenerateInstanceSegment(t *testing.T) {
	seg, err := GenerateInstanceSegment()
	if err != nil {
		t.Fatalf("GenerateInstanceSegment: %v", err)
	}
	if len(seg) != 12 {
		t.Fatalf("length = %d, want 12", len(seg))
	}
	for _, ch := range seg {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') {
			t.Fatalf("non-hex char %q in %q", ch, seg)
		}
	}
}

func TestComputeVersionSegment(t *testing.T) {
	got := ComputeVersionSegment("v1.0.0")
	if len(got) != 8 {
		t.Fatalf("length = %d, want 8", len(got))
	}
	if got != ComputeVersionSegment("v1.0.0") {
		t.Fatal("version segment not deterministic")
	}
}

func TestBuildDateSegment(t *testing.T) {
	if got := BuildDateSegment("20260609"); got != "20260609" {
		t.Fatalf("BuildDateSegment = %q, want 20260609", got)
	}
}

func TestComputeIntegrity(t *testing.T) {
	instance := "a3f7e2b1c9d4"
	version := ComputeVersionSegment("v1.0.0")
	build := "20260609"
	got := ComputeIntegrity(instance, version, build)
	if len(got) != 8 {
		t.Fatalf("length = %d, want 8", len(got))
	}
	if got != ComputeIntegrity(instance, version, build) {
		t.Fatal("integrity not deterministic")
	}
}

func TestCompose(t *testing.T) {
	instance := "a3f7e2b1c9d4"
	version := ComputeVersionSegment("v1.0.0")
	build := "20260609"
	id := Compose(instance, version, build)
	parts := strings.Split(id, "-")
	if len(parts) != 4 {
		t.Fatalf("parts = %d, want 4 (%q)", len(parts), id)
	}
	if parts[0] != instance || parts[1] != version || parts[2] != build {
		t.Fatalf("unexpected segments: %v", parts)
	}
	if parts[3] != ComputeIntegrity(instance, version, build) {
		t.Fatalf("integrity mismatch: %q", parts[3])
	}
}

func TestGetOrCreateExisting(t *testing.T) {
	state := map[string]string{"instance_segment": "abc123def456"}
	seg, err := GetOrCreate(
		func(key string) (string, error) { return state[key], nil },
		func(key, value string) error { state[key] = value; return nil },
	)
	if err != nil {
		t.Fatalf("GetOrCreate: %v", err)
	}
	if seg != "abc123def456" {
		t.Fatalf("seg = %q, want abc123def456", seg)
	}
}

func TestGetOrCreateNew(t *testing.T) {
	state := map[string]string{}
	seg, err := GetOrCreate(
		func(key string) (string, error) { return state[key], nil },
		func(key, value string) error { state[key] = value; return nil },
	)
	if err != nil {
		t.Fatalf("GetOrCreate: %v", err)
	}
	if len(seg) != 12 {
		t.Fatalf("length = %d, want 12", len(seg))
	}
	if state["instance_segment"] != seg {
		t.Fatalf("stored %q, want %q", state["instance_segment"], seg)
	}
}
