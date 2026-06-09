package report

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTailFileReturnsEndOfFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.log")
	content := strings.Repeat("a", 100) + "TAIL_MARKER"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	got, err := TailFile(path, 20)
	if err != nil {
		t.Fatalf("TailFile: %v", err)
	}
	if !strings.HasSuffix(got, "TAIL_MARKER") {
		t.Fatalf("TailFile = %q, want suffix TAIL_MARKER", got)
	}
	if len(got) > 20 {
		t.Fatalf("TailFile length = %d, want <= 20", len(got))
	}
}

func TestTailFileMissingFile(t *testing.T) {
	got, err := TailFile(filepath.Join(t.TempDir(), "missing.log"), 100)
	if err != nil {
		t.Fatalf("TailFile: %v", err)
	}
	if got != "" {
		t.Fatalf("TailFile = %q, want empty", got)
	}
}

func TestSubmitWithoutRelayURL(t *testing.T) {
	result, err := Submit(t.Context(), "", "v1.0.0", "instance", "test", "")
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if result.Message == "" {
		t.Fatal("expected message when relay URL is empty")
	}
}
