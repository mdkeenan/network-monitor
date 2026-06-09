package server

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type ipProvider struct {
	name string
	url  string
}

// IPv4-specific — tried in order; first success wins
var publicIPv4Providers = []ipProvider{
	{name: "icanhazip-v4", url: "https://ipv4.icanhazip.com"},
	{name: "ipify-v4", url: "https://api4.ipify.org"},
	{name: "ident-v4", url: "https://4.ident.me"},
}

// IPv6-specific — tried in order; first success wins
// All-fail is normal on IPv4-only machines — do not log as error
var publicIPv6Providers = []ipProvider{
	{name: "icanhazip-v6", url: "https://ipv6.icanhazip.com"},
	{name: "ipify-v6", url: "https://api6.ipify.org"},
	{name: "ident-v6", url: "https://6.ident.me"},
}

// Auto-detect fallback — used only if all IPv4-specific providers fail
var publicIPAutoProviders = []ipProvider{
	{name: "ipify-auto64", url: "https://api64.ipify.org"},
	{name: "ident-auto", url: "https://ident.me"},
}

func allEchoProviders() []ipProvider {
	total := len(publicIPv4Providers) + len(publicIPv6Providers) + len(publicIPAutoProviders)
	out := make([]ipProvider, 0, total)
	out = append(out, publicIPv4Providers...)
	out = append(out, publicIPv6Providers...)
	out = append(out, publicIPAutoProviders...)
	return out
}

type publicIPResponse struct {
	IP   string `json:"ip,omitempty"`
	ISP  string `json:"isp,omitempty"`
	IPv6 string `json:"ipv6,omitempty"`
}

func fetchIPFromProvider(ctx context.Context, p ipProvider) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.url, nil)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 128))
	if err != nil {
		return "", err
	}
	ip := strings.TrimSpace(string(body))
	if net.ParseIP(ip) == nil {
		return "", fmt.Errorf("unexpected response %q", ip)
	}
	return ip, nil
}

// tryIPProviders tries each provider in order.
// Individual failures are logged to the app log only — they are not returned
// as errors and do not surface to the user.
// Returns ("", error) only if every provider in the chain fails.
func tryIPProviders(ctx context.Context, providers []ipProvider) (string, error) {
	var lastErr error
	for _, p := range providers {
		ip, err := fetchIPFromProvider(ctx, p)
		if err != nil {
			log.Printf("[public-ip] provider %s failed: %v", p.name, err)
			lastErr = err
			continue
		}
		return ip, nil
	}
	return "", fmt.Errorf("all providers exhausted; last error: %w", lastErr)
}

func (s *Server) handlePublicIP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	var detectedIPv4, detectedIPv6 string

	wg.Add(2)

	go func() {
		defer wg.Done()
		ip, err := tryIPProviders(ctx, publicIPv4Providers)
		if err != nil {
			ip, err = tryIPProviders(ctx, publicIPAutoProviders)
			if err != nil {
				log.Printf("[public-ip] all IPv4 providers failed: %v", err)
			}
		}
		detectedIPv4 = ip
	}()

	go func() {
		defer wg.Done()
		ip, err := tryIPProviders(ctx, publicIPv6Providers)
		if err != nil {
			log.Printf("[public-ip] IPv6 unavailable (normal on IPv4-only): %v", err)
		}
		detectedIPv6 = ip
	}()

	wg.Wait()

	result := publicIPResponse{
		IP:   detectedIPv4,
		IPv6: detectedIPv6,
	}
	if detectedIPv4 != "" {
		if lookup, err := s.lookupIPInfo(ctx, detectedIPv4); err == nil && lookup.ISP != "" {
			result.ISP = lookup.ISP
		}
	}

	writeJSON(w, result)
}
