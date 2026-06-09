package server

import (
	"strings"
	"testing"
	"time"

	"network-monitor/internal/database"
)

func TestParseExportList(t *testing.T) {
	got, err := parseExportList("log,csv,md", validExportFormats, "formats")
	if err != nil {
		t.Fatalf("parseExportList: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}

	if _, err := parseExportList("", validExportFormats, "formats"); err == nil {
		t.Fatal("expected error for empty formats")
	}

	if _, err := parseExportList("bad", validExportFormats, "formats"); err == nil {
		t.Fatal("expected error for invalid format")
	}
}

func TestBuildExportCSVHeadersOnly(t *testing.T) {
	payload := exportPayload{
		From:      time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
		To:        time.Date(2026, 6, 8, 0, 0, 0, 0, time.UTC),
		Target:    "8.8.8.8",
		Generated: time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC),
		DataTypes: []string{"pings"},
	}

	data, err := buildExportCSV(payload, "pings")
	if err != nil {
		t.Fatalf("buildExportCSV: %v", err)
	}
	if !strings.Contains(string(data), "timestamp,ok,rtt_ms,target") {
		t.Fatalf("missing csv header: %q", string(data))
	}
}

func TestBuildExportLogNoDataNote(t *testing.T) {
	payload := exportPayload{
		From:      time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
		To:        time.Date(2026, 6, 8, 0, 0, 0, 0, time.UTC),
		Target:    "8.8.8.8",
		Generated: time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC),
		DataTypes: []string{"events"},
		Events:    []database.Event{},
	}

	out := string(buildExportLog(payload))
	if !strings.Contains(out, "No data in this range") {
		t.Fatalf("expected no-data note in log export")
	}
}
