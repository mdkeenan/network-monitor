package iplookup

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"network-monitor/internal/database"
)

const CacheTTL = 24 * time.Hour

type Info struct {
	IP       string
	ISP      string
	Hostname string
}

var HTTPClient = http.DefaultClient

func Lookup(ctx context.Context, db *database.DB, ip string) (Info, error) {
	ip = strings.TrimSpace(ip)
	if ip == "" || net.ParseIP(ip) == nil {
		return Info{}, fmt.Errorf("invalid IP address %q", ip)
	}

	if db != nil {
		if cached, ok, err := db.GetIPLookup(ip); err == nil && ok {
			if time.Since(cached.LookedUpAt) < CacheTTL {
				return Info{
					IP:       ip,
					ISP:      cached.ISP,
					Hostname: cached.Hostname,
				}, nil
			}
		}
	}

	remote, err := fetchRemote(ctx, ip)
	if err != nil {
		if db != nil {
			if cached, ok, cacheErr := db.GetIPLookup(ip); cacheErr == nil && ok {
				return Info{
					IP:       ip,
					ISP:      cached.ISP,
					Hostname: cached.Hostname,
				}, nil
			}
		}
		return Info{}, err
	}

	if remote.Hostname == "" {
		if names, lookupErr := net.DefaultResolver.LookupAddr(ctx, ip); lookupErr == nil && len(names) > 0 {
			remote.Hostname = strings.TrimSuffix(strings.TrimSpace(names[0]), ".")
		}
	}

	if db != nil {
		if err := db.UpsertIPLookup(ip, remote.ISP, remote.Hostname, time.Now().UTC()); err != nil {
			return Info{}, err
		}
	}

	return remote, nil
}

func fetchRemote(ctx context.Context, ip string) (Info, error) {
	url := fmt.Sprintf("http://ip-api.com/json/%s?fields=status,message,query,isp,reverse", ip)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return Info{}, fmt.Errorf("build lookup request: %w", err)
	}

	resp, err := HTTPClient.Do(req)
	if err != nil {
		return Info{}, fmt.Errorf("fetch ip lookup: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Info{}, fmt.Errorf("fetch ip lookup: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return Info{}, fmt.Errorf("read ip lookup: %w", err)
	}

	var payload struct {
		Status  string `json:"status"`
		Message string `json:"message"`
		Query   string `json:"query"`
		ISP     string `json:"isp"`
		Reverse string `json:"reverse"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return Info{}, fmt.Errorf("decode ip lookup: %w", err)
	}
	if payload.Status != "success" {
		msg := strings.TrimSpace(payload.Message)
		if msg == "" {
			msg = "lookup failed"
		}
		return Info{}, fmt.Errorf("ip lookup: %s", msg)
	}

	hostname := strings.TrimSpace(payload.Reverse)
	return Info{
		IP:       strings.TrimSpace(payload.Query),
		ISP:      strings.TrimSpace(payload.ISP),
		Hostname: strings.TrimSuffix(hostname, "."),
	}, nil
}

func FormatProvider(isp string) string {
	isp = strings.TrimSpace(isp)
	if isp == "" {
		return "unknown provider"
	}
	return isp
}
