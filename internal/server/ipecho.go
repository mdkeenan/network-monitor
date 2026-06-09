package server

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"
)

type echoProviderStatus struct {
	Name              string   `json:"name"`
	URL               string   `json:"url"`
	Host              string   `json:"host"`
	IsIPv6Provider    bool     `json:"is_ipv6_provider"`
	DNSOK             bool     `json:"dns_ok"`
	DNSIPs            []string `json:"dns_ips,omitempty"`
	ServiceIP         string   `json:"service_ip,omitempty"`
	Reachable         bool     `json:"reachable"`
	EchoIP            string   `json:"echo_ip,omitempty"`
	UnreachableKind   string   `json:"unreachable_kind,omitempty"`
	UnreachableReason string   `json:"unreachable_reason,omitempty"`
}

const (
	echoUnreachableLocalIPv6 = "local_ipv6"
	echoUnreachableService   = "service"
)

func isIPv6EchoProvider(p ipProvider) bool {
	for _, v6 := range publicIPv6Providers {
		if v6.name == p.name {
			return true
		}
	}
	return false
}

func pickDisplayIP(ips []string, preferIPv6 bool) string {
	var fallback string
	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		if fallback == "" {
			fallback = ipStr
		}
		if preferIPv6 && ip.To4() == nil {
			return ipStr
		}
		if !preferIPv6 && ip.To4() != nil {
			return ipStr
		}
	}
	return fallback
}

func localIPv6OutboundAvailable() bool {
	conn, err := net.DialTimeout("udp6", "[2001:4860:4860::8888]:80", 2*time.Second)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func classifyEchoUnreachable(p ipProvider, echoErr error, dnsOK bool) (kind, reason string) {
	if isIPv6EchoProvider(p) && !localIPv6OutboundAvailable() {
		return echoUnreachableLocalIPv6,
			"This system has no usable IPv6 address, so IPv6 echo services cannot respond from here."
	}
	if !dnsOK {
		return echoUnreachableService,
			"This echo service is unreachable and its hostname could not be resolved."
	}
	if isIPv6EchoProvider(p) {
		return echoUnreachableService,
			"IPv6 is available on this system, but the echo service did not respond."
	}
	if echoErr != nil {
		return echoUnreachableService, fmt.Sprintf("Echo service did not respond: %v", echoErr)
	}
	return echoUnreachableService, "This IP Echo Service Provider is currently unreachable."
}

func providerHost(rawURL string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("parse url: %w", err)
	}
	host := u.Hostname()
	if host == "" {
		return "", fmt.Errorf("missing host in %q", rawURL)
	}
	return host, nil
}

func lookupProviderDNS(ctx context.Context, host string, preferIPv6 bool) ([]string, error) {
	resolver := net.Resolver{}
	seen := make(map[string]struct{})
	unique := make([]string, 0, 4)

	addIPs := func(addrs []net.IP, err error) {
		if err != nil {
			return
		}
		for _, ip := range addrs {
			s := ip.String()
			if _, ok := seen[s]; ok {
				continue
			}
			seen[s] = struct{}{}
			unique = append(unique, s)
		}
	}

	lookup := func(network string) {
		addIPs(resolver.LookupIP(ctx, network, host))
	}

	if preferIPv6 {
		lookup("ip6")
		lookup("ip4")
	} else {
		lookup("ip4")
		lookup("ip6")
	}

	if len(unique) == 0 && preferIPv6 {
		if ips, err := lookupAAAANslookup(ctx, host); err == nil && len(ips) > 0 {
			return ips, nil
		}
	}

	if len(unique) == 0 {
		return nil, fmt.Errorf("no DNS records for %q", host)
	}
	sort.Strings(unique)
	return unique, nil
}

func lookupAAAANslookup(ctx context.Context, host string) ([]string, error) {
	for _, args := range [][]string{{"-type=AAAA", host}, {host}} {
		cmd := exec.CommandContext(ctx, "nslookup", args...)
		hideExecCmd(cmd)
		out, err := cmd.CombinedOutput()
		if err != nil {
			continue
		}
		if ips := parseNslookupAAAA(string(out)); len(ips) > 0 {
			return ips, nil
		}
	}
	return nil, fmt.Errorf("nslookup found no AAAA records for %q", host)
}

func parseNslookupAAAA(output string) []string {
	seen := make(map[string]struct{})
	ips := make([]string, 0, 4)

	addIPv6 := func(raw string) {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return
		}
		ip := net.ParseIP(raw)
		if ip == nil || ip.To4() != nil {
			return
		}
		s := ip.String()
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		ips = append(ips, s)
	}

	inAnswer := false
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "name:") {
			inAnswer = true
			continue
		}
		if !inAnswer {
			continue
		}

		if strings.HasPrefix(lower, "address") {
			colon := strings.Index(trimmed, ":")
			if colon < 0 {
				continue
			}
			rest := strings.TrimSpace(trimmed[colon+1:])
			if rest != "" {
				addIPv6(strings.Fields(rest)[0])
			}
			continue
		}

		if strings.Contains(trimmed, ":") {
			addIPv6(trimmed)
		}
	}

	sort.Strings(ips)
	return ips
}

func checkEchoProvider(ctx context.Context, p ipProvider) echoProviderStatus {
	host, err := providerHost(p.url)
	if err != nil {
		return echoProviderStatus{Name: p.name, URL: p.url, Host: p.url, DNSOK: false}
	}

	ipv6Provider := isIPv6EchoProvider(p)
	status := echoProviderStatus{
		Name:           p.name,
		URL:            p.url,
		Host:           host,
		IsIPv6Provider: ipv6Provider,
	}

	dnsCtx, dnsCancel := context.WithTimeout(ctx, 5*time.Second)
	defer dnsCancel()

	ips, dnsErr := lookupProviderDNS(dnsCtx, host, ipv6Provider)
	if dnsErr == nil && len(ips) > 0 {
		status.DNSOK = true
		status.DNSIPs = ips
		status.ServiceIP = pickDisplayIP(ips, ipv6Provider)
	}

	echoIP, echoErr := fetchIPFromProvider(ctx, p)
	if echoErr == nil && echoIP != "" {
		status.Reachable = true
		status.EchoIP = echoIP
	} else {
		status.UnreachableKind, status.UnreachableReason = classifyEchoUnreachable(p, echoErr, status.DNSOK)
	}

	return status
}

func (s *Server) handleIPEchoServices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	providers := allEchoProviders()
	results := make([]echoProviderStatus, len(providers))

	var wg sync.WaitGroup
	for i, p := range providers {
		wg.Add(1)
		go func(idx int, prov ipProvider) {
			defer wg.Done()
			results[idx] = checkEchoProvider(ctx, prov)
		}(i, p)
	}
	wg.Wait()

	writeJSON(w, map[string]any{"providers": results})
}
