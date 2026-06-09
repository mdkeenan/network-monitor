package server

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"network-monitor/internal/iplookup"
)

type ipLookupResponse struct {
	IP       string `json:"ip"`
	ISP      string `json:"isp,omitempty"`
	Hostname string `json:"hostname,omitempty"`
}

func (s *Server) handleTargetInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}

	target := s.monitor.Target()
	info, err := s.lookupTargetInfo(r.Context(), target)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}

	writeJSON(w, info)
}

func (s *Server) lookupTargetInfo(ctx context.Context, target string) (map[string]any, error) {
	lookupIP, displayName, err := resolveTargetLookupIP(target)
	if err != nil {
		return nil, err
	}

	lookup, err := s.lookupIPInfo(ctx, lookupIP)
	if err != nil {
		return nil, err
	}

	hostname := lookup.Hostname
	if hostname == "" && displayName != "" && !isIPAddress(displayName) {
		hostname = displayName
	}

	return map[string]any{
		"target":   target,
		"ip":       lookupIP,
		"isp":      lookup.ISP,
		"hostname": hostname,
	}, nil
}

func (s *Server) lookupIPInfo(ctx context.Context, ip string) (ipLookupResponse, error) {
	info, err := iplookup.Lookup(ctx, s.db, ip)
	if err != nil {
		return ipLookupResponse{}, err
	}
	return ipLookupResponse{
		IP:       info.IP,
		ISP:      info.ISP,
		Hostname: info.Hostname,
	}, nil
}

func resolveTargetLookupIP(target string) (lookupIP string, displayName string, err error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return "", "", fmt.Errorf("empty target")
	}
	if isIPAddress(target) {
		return target, "", nil
	}

	displayName = target
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ips, lookupErr := net.DefaultResolver.LookupIP(ctx, "ip4", target)
	if lookupErr != nil {
		return "", displayName, fmt.Errorf("resolve target %q: %w", target, lookupErr)
	}
	if len(ips) == 0 {
		return "", displayName, fmt.Errorf("resolve target %q: no IPv4 address", target)
	}
	return ips[0].String(), displayName, nil
}

func isIPAddress(value string) bool {
	return net.ParseIP(strings.TrimSpace(value)) != nil
}
