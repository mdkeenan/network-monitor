package database

import (
	"testing"
	"time"
)

func TestPingJitterMs(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(dir)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	target := "8.8.8.8"
	if jitter, err := db.PingJitterMs(target, 60); err != nil {
		t.Fatalf("empty jitter: %v", err)
	} else if jitter != 0 {
		t.Fatalf("expected 0 jitter with no pings, got %v", jitter)
	}

	base := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	rtts := []int{20, 24, 18, 30}
	for i, rtt := range rtts {
		rttCopy := rtt
		if err := db.InsertPing(base.Add(time.Duration(i)*time.Second), true, &rttCopy, target); err != nil {
			t.Fatalf("insert ping %d: %v", i, err)
		}
	}

	jitter, err := db.PingJitterMs(target, 60)
	if err != nil {
		t.Fatalf("jitter: %v", err)
	}
	want := 7.3
	if jitter != want {
		t.Fatalf("expected jitter %v, got %v", want, jitter)
	}
}
