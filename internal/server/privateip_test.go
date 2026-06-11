package server

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
)

func TestIsPrivateIPv4(t *testing.T) {
	tests := []struct {
		ip   string
		want bool
	}{
		{"10.0.0.1", true},
		{"172.16.0.5", true},
		{"192.168.1.42", true},
		{"8.8.8.8", false},
		{"203.0.113.10", false},
	}

	for _, tc := range tests {
		if got := isPrivateIPv4(net.ParseIP(tc.ip)); got != tc.want {
			t.Fatalf("isPrivateIPv4(%s) = %v, want %v", tc.ip, got, tc.want)
		}
	}
}

func TestHandlePrivateIPMethodNotAllowed(t *testing.T) {
	s := &Server{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/private-ip", nil)
	s.handlePrivateIP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestDetectPrivateIPLive(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live private IP detection in short mode")
	}

	info, err := detectPrivateNetwork()
	if err != nil {
		t.Skipf("private IP detection unavailable in this environment: %v", err)
	}
	if !isPrivateIPv4(net.ParseIP(info.IP)) {
		t.Fatalf("detectPrivateNetwork().IP = %q, want private IPv4", info.IP)
	}
}

func TestDetectPrivateNetworkLive(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live private network detection in short mode")
	}

	info, err := detectPrivateNetwork()
	if err != nil {
		t.Skipf("private network detection unavailable in this environment: %v", err)
	}
	if !isPrivateIPv4(net.ParseIP(info.IP)) {
		t.Fatalf("detectPrivateNetwork().IP = %q, want private IPv4", info.IP)
	}
	if info.Prefix <= 0 || info.Prefix > 32 {
		t.Fatalf("detectPrivateNetwork().Prefix = %d, want 1..32", info.Prefix)
	}
	if runtime.GOOS != "windows" {
		return
	}
	if info.Gateway == "" {
		t.Fatal("detectPrivateNetwork().Gateway is empty")
	}
	if net.ParseIP(info.Gateway) == nil {
		t.Fatalf("detectPrivateNetwork().Gateway = %q, want IP address", info.Gateway)
	}
}

func TestHandlePrivateIPLive(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live private IP handler in short mode")
	}

	s := &Server{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/private-ip", nil)
	s.handlePrivateIP(rec, req)
	if rec.Code != http.StatusOK {
		t.Skipf("private IP handler unavailable in this environment: status=%d body=%s", rec.Code, rec.Body.String())
	}

	var body privateNetworkInfo
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.IP == "" || body.Prefix <= 0 {
		t.Fatalf("unexpected body: %+v", body)
	}
	if runtime.GOOS == "windows" && body.Gateway == "" {
		t.Fatalf("unexpected body: %+v", body)
	}
}
