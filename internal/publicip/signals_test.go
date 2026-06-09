package publicip

import (
	"strconv"
	"testing"
)

func TestParsePingTTL(t *testing.T) {
	ttl := ParsePingTTL(`Reply from 8.8.8.8: bytes=32 time=15ms TTL=117`)
	if ttl == nil || *ttl != 117 {
		t.Fatalf("ParsePingTTL() = %v, want 117", ttl)
	}
}

func TestTTLChangedSignificantly(t *testing.T) {
	base := 117
	if TTLChangedSignificantly(&base, intPtr(118)) {
		t.Fatal("expected small TTL delta to be insignificant")
	}
	if !TTLChangedSignificantly(&base, intPtr(110)) {
		t.Fatal("expected large TTL delta to be significant")
	}
}

func TestTracerouteChangedSignificantly(t *testing.T) {
	prev := "1  10 ms  10 ms  10 ms  192.168.1.1\n2  20 ms  20 ms  20 ms  10.0.0.1\n"
	same := prev
	if TracerouteChangedSignificantly(prev, same) {
		t.Fatal("expected identical traceroute to be insignificant")
	}

	changedFirstHop := "1  10 ms  10 ms  10 ms  192.168.2.1\n2  20 ms  20 ms  20 ms  10.0.0.1\n"
	if !TracerouteChangedSignificantly(prev, changedFirstHop) {
		t.Fatal("expected first-hop change to be significant")
	}
}

func TestTracerouteFingerprint(t *testing.T) {
	output := "Tracing route to 8.8.8.8\n  1     1 ms     1 ms     1 ms  192.168.1.1 \n  2    10 ms    10 ms    10 ms  203.0.113.5 \n"
	got := TracerouteFingerprint(output)
	want := "192.168.1.1>203.0.113.5"
	if got != want {
		t.Fatalf("TracerouteFingerprint() = %q, want %q", got, want)
	}
}

func intPtr(v int) *int {
	return &v
}

func TestParseIntHelper(t *testing.T) {
	if _, err := parseInt("12"); err != nil {
		t.Fatalf("parseInt(12): %v", err)
	}
	if _, err := parseInt("abc"); err == nil {
		t.Fatal("expected parseInt(abc) to fail")
	}
	_ = strconv.Itoa(12)
}
