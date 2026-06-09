package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHandleIPEchoServicesMethodNotAllowed(t *testing.T) {
	s := &Server{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ip-echo-services", nil)
	s.handleIPEchoServices(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestProviderHost(t *testing.T) {
	host, err := providerHost("https://ipv4.icanhazip.com")
	if err != nil {
		t.Fatalf("providerHost: %v", err)
	}
	if host != "ipv4.icanhazip.com" {
		t.Fatalf("host = %q, want ipv4.icanhazip.com", host)
	}
}

func TestAllEchoProvidersCount(t *testing.T) {
	providers := allEchoProviders()
	if len(providers) != 8 {
		t.Fatalf("len(providers) = %d, want 8", len(providers))
	}
}

func TestPickDisplayIP(t *testing.T) {
	ips := []string{"2a01:4f9:c012:8091::1", "203.0.113.1"}
	if got := pickDisplayIP(ips, true); got != "2a01:4f9:c012:8091::1" {
		t.Fatalf("pickDisplayIP(prefer v6) = %q", got)
	}
	if got := pickDisplayIP(ips, false); got != "203.0.113.1" {
		t.Fatalf("pickDisplayIP(prefer v4) = %q", got)
	}
}

func TestClassifyEchoUnreachableIPv4Service(t *testing.T) {
	kind, reason := classifyEchoUnreachable(
		ipProvider{name: "icanhazip-v4", url: "https://ipv4.icanhazip.com"},
		fmt.Errorf("connection refused"),
		true,
	)
	if kind != echoUnreachableService {
		t.Fatalf("kind = %q, want %q", kind, echoUnreachableService)
	}
	if reason == "" {
		t.Fatal("expected non-empty reason")
	}
}

func TestClassifyEchoUnreachableIPv6Local(t *testing.T) {
	if localIPv6OutboundAvailable() {
		t.Skip("local IPv6 available; cannot test local_ipv6 classification")
	}
	kind, _ := classifyEchoUnreachable(
		ipProvider{name: "icanhazip-v6", url: "https://ipv6.icanhazip.com"},
		fmt.Errorf("timeout"),
		true,
	)
	if kind != echoUnreachableLocalIPv6 {
		t.Fatalf("kind = %q, want %q", kind, echoUnreachableLocalIPv6)
	}
}

func TestIsIPv6EchoProvider(t *testing.T) {
	if !isIPv6EchoProvider(ipProvider{name: "icanhazip-v6", url: "https://ipv6.icanhazip.com"}) {
		t.Fatal("expected icanhazip-v6 to be IPv6 provider")
	}
	if isIPv6EchoProvider(ipProvider{name: "icanhazip-v4", url: "https://ipv4.icanhazip.com"}) {
		t.Fatal("expected icanhazip-v4 not to be IPv6 provider")
	}
}

func TestParseNslookupAAAA(t *testing.T) {
	single := `Server:  unifi.localdomain
Address:  10.0.70.1

Name:    6.ident.me
Address:  2a01:4f9:c012:8091::1
`
	ips := parseNslookupAAAA(single)
	if len(ips) != 1 || ips[0] != "2a01:4f9:c012:8091::1" {
		t.Fatalf("parseNslookupAAAA(single) = %v", ips)
	}

	multi := `Server:  unifi.localdomain
Address:  10.0.70.1

Name:    ipv6.icanhazip.com
Addresses:  2606:4700::6810:b8f1
          2606:4700::6810:b9f1
`
	ips = parseNslookupAAAA(multi)
	if len(ips) != 2 {
		t.Fatalf("parseNslookupAAAA(multi) len = %d, want 2: %v", len(ips), ips)
	}
	if ips[0] != "2606:4700::6810:b8f1" || ips[1] != "2606:4700::6810:b9f1" {
		t.Fatalf("parseNslookupAAAA(multi) = %v", ips)
	}
}

func TestLookupProviderDNSIPv6IcanhazipLive(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live IPv6 DNS lookup in short mode")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ips, err := lookupProviderDNS(ctx, "ipv6.icanhazip.com", true)
	if err != nil {
		t.Fatalf("lookupProviderDNS(ipv6.icanhazip.com): %v", err)
	}
	if len(ips) < 1 {
		t.Fatalf("expected at least one IPv6 address, got %v", ips)
	}
}

func TestLookupProviderDNSIPv6HostLive(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live IPv6 DNS lookup in short mode")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ips, err := lookupProviderDNS(ctx, "6.ident.me", true)
	if err != nil {
		t.Fatalf("lookupProviderDNS(6.ident.me): %v", err)
	}
	if len(ips) == 0 {
		t.Fatal("expected at least one DNS address")
	}
	hasV6 := false
	for _, ip := range ips {
		if strings.Contains(ip, ":") {
			hasV6 = true
			break
		}
	}
	if !hasV6 {
		t.Fatalf("expected IPv6 address in %v", ips)
	}
}

func TestHandleIPEchoServicesLive(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live ip echo services check in short mode")
	}

	s := &Server{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/ip-echo-services", nil)
	s.handleIPEchoServices(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var body struct {
		Providers []echoProviderStatus `json:"providers"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Providers) != 8 {
		t.Fatalf("len(providers) = %d, want 8", len(body.Providers))
	}
}
