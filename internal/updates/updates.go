package updates

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const defaultHTTPTimeout = 15 * time.Second

type Manifest struct {
	Version     string `json:"version"`
	DownloadURL string `json:"download_url,omitempty"`
	Notes       string `json:"notes,omitempty"`
}

type Result struct {
	CurrentVersion  string `json:"current_version"`
	LatestVersion   string `json:"latest_version,omitempty"`
	UpdateAvailable bool   `json:"update_available"`
	DownloadURL     string `json:"download_url,omitempty"`
	Message         string `json:"message"`
}

func Check(ctx context.Context, manifestURL, currentVersion, instanceID string) (Result, error) {
	currentVersion = strings.TrimSpace(currentVersion)
	if currentVersion == "" {
		currentVersion = "dev"
	}

	result := Result{
		CurrentVersion: currentVersion,
		Message:        fmt.Sprintf("You are running Network Monitor %s.", currentVersion),
	}

	manifestURL = strings.TrimSpace(manifestURL)
	if manifestURL == "" {
		result.Message = fmt.Sprintf(
			"You are running Network Monitor %s. No update source is configured.",
			currentVersion,
		)
		return result, nil
	}

	manifest, err := fetchManifest(ctx, manifestURL, instanceID)
	if err != nil {
		return Result{}, err
	}

	latest := strings.TrimSpace(manifest.Version)
	if latest == "" {
		return Result{}, fmt.Errorf("update manifest is missing a version")
	}

	result.LatestVersion = latest
	result.DownloadURL = strings.TrimSpace(manifest.DownloadURL)
	cmp := CompareVersions(currentVersion, latest)
	if cmp < 0 {
		result.UpdateAvailable = true
		result.Message = fmt.Sprintf(
			"Update available: %s (you have %s).",
			latest,
			currentVersion,
		)
		if notes := strings.TrimSpace(manifest.Notes); notes != "" {
			result.Message += " " + notes
		}
		return result, nil
	}

	result.Message = fmt.Sprintf("You are running the latest version (%s).", currentVersion)
	return result, nil
}

func fetchManifest(ctx context.Context, manifestURL, instanceID string) (Manifest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return Manifest{}, fmt.Errorf("create update request: %w", err)
	}
	if instanceID != "" {
		req.Header.Set("X-Instance-ID", instanceID)
	}

	client := &http.Client{Timeout: defaultHTTPTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return Manifest{}, fmt.Errorf("fetch update manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Manifest{}, fmt.Errorf("update manifest returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Manifest{}, fmt.Errorf("read update manifest: %w", err)
	}

	var manifest Manifest
	if err := json.Unmarshal(body, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("parse update manifest: %w", err)
	}
	return manifest, nil
}

func CompareVersions(current, latest string) int {
	cur := parseVersionParts(current)
	lat := parseVersionParts(latest)
	maxLen := len(cur)
	if len(lat) > maxLen {
		maxLen = len(lat)
	}
	for i := 0; i < maxLen; i++ {
		c, l := 0, 0
		if i < len(cur) {
			c = cur[i]
		}
		if i < len(lat) {
			l = lat[i]
		}
		if c < l {
			return -1
		}
		if c > l {
			return 1
		}
	}
	return 0
}

func parseVersionParts(version string) []int {
	version = strings.TrimSpace(version)
	version = strings.TrimPrefix(version, "v")
	version = strings.TrimPrefix(version, "V")
	if version == "" || strings.EqualFold(version, "dev") {
		return []int{0}
	}

	segments := strings.Split(version, ".")
	parts := make([]int, 0, len(segments))
	for _, segment := range segments {
		segment = strings.TrimSpace(segment)
		if segment == "" {
			parts = append(parts, 0)
			continue
		}
		digits := strings.Builder{}
		for _, ch := range segment {
			if ch >= '0' && ch <= '9' {
				digits.WriteRune(ch)
			} else {
				break
			}
		}
		if digits.Len() == 0 {
			parts = append(parts, 0)
			continue
		}
		n, err := strconv.Atoi(digits.String())
		if err != nil {
			parts = append(parts, 0)
			continue
		}
		parts = append(parts, n)
	}
	if len(parts) == 0 {
		return []int{0}
	}
	return parts
}
