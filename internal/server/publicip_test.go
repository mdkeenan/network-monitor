package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandlePublicIPMethodNotAllowed(t *testing.T) {
	s := &Server{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/public-ip", nil)
	s.handlePublicIP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestFetchIPFromProviderValidResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("  203.0.113.10\n"))
	}))
	defer srv.Close()

	ip, err := fetchIPFromProvider(context.Background(), ipProvider{name: "test", url: srv.URL})
	if err != nil {
		t.Fatalf("fetchIPFromProvider: %v", err)
	}
	if ip != "203.0.113.10" {
		t.Fatalf("ip = %q, want %q", ip, "203.0.113.10")
	}
}

func TestFetchIPFromProviderNonIPResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("<html>error</html>"))
	}))
	defer srv.Close()

	_, err := fetchIPFromProvider(context.Background(), ipProvider{name: "test", url: srv.URL})
	if err == nil {
		t.Fatal("expected error for non-IP response body")
	}
	if !strings.Contains(err.Error(), "unexpected response") {
		t.Fatalf("error = %v, want unexpected response", err)
	}
}

func TestTryIPProvidersFirstFailsSecondSucceeds(t *testing.T) {
	failSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "fail", http.StatusInternalServerError)
	}))
	defer failSrv.Close()

	okSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("198.51.100.7"))
	}))
	defer okSrv.Close()

	providers := []ipProvider{
		{name: "fail", url: failSrv.URL},
		{name: "ok", url: okSrv.URL},
	}

	ip, err := tryIPProviders(context.Background(), providers)
	if err != nil {
		t.Fatalf("tryIPProviders: %v", err)
	}
	if ip != "198.51.100.7" {
		t.Fatalf("ip = %q, want %q", ip, "198.51.100.7")
	}
}

func TestTryIPProvidersAllFail(t *testing.T) {
	failSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("not-an-ip"))
	}))
	defer failSrv.Close()

	providers := []ipProvider{
		{name: "fail1", url: failSrv.URL},
		{name: "fail2", url: failSrv.URL},
	}

	ip, err := tryIPProviders(context.Background(), providers)
	if err == nil {
		t.Fatal("expected error when all providers fail")
	}
	if ip != "" {
		t.Fatalf("ip = %q, want empty", ip)
	}
	if !strings.Contains(err.Error(), "all providers exhausted") {
		t.Fatalf("error = %v, want all providers exhausted", err)
	}
}

func TestTryIPProvidersIPv6AllFailReturnsEmpty(t *testing.T) {
	failSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no ipv6", http.StatusServiceUnavailable)
	}))
	defer failSrv.Close()

	providers := []ipProvider{
		{name: "icanhazip-v6", url: failSrv.URL},
		{name: "ipify-v6", url: failSrv.URL},
		{name: "ident-v6", url: failSrv.URL},
	}

	ip, err := tryIPProviders(context.Background(), providers)
	if err == nil {
		t.Fatal("expected error when all IPv6 providers fail")
	}
	if ip != "" {
		t.Fatalf("ip = %q, want empty", ip)
	}

	// Handler pattern: empty string on failure, no panic.
	detectedIPv6 := ip
	if detectedIPv6 != "" {
		t.Fatalf("detectedIPv6 = %q, want empty", detectedIPv6)
	}
}
