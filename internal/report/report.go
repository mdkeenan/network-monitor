package report

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

const (
	defaultHTTPTimeout = 20 * time.Second
	defaultMaxLogBytes = 12000
	maxDescriptionLen  = 4000
)

type Payload struct {
	Version     string `json:"version"`
	InstanceID  string `json:"instance_id"`
	Description string `json:"description"`
	AppLog      string `json:"app_log"`
	OS          string `json:"os"`
}

type Result struct {
	OK          bool   `json:"ok"`
	IssueURL    string `json:"issue_url,omitempty"`
	IssueNumber int    `json:"issue_number,omitempty"`
	Message     string `json:"message"`
}

type relayResponse struct {
	OK          bool   `json:"ok"`
	IssueURL    string `json:"issue_url"`
	IssueNumber int    `json:"issue_number"`
}

// Submit sends a bug report to the configured relay URL.
func Submit(ctx context.Context, relayURL, version, instanceID, description, appLogPath string) (Result, error) {
	version = strings.TrimSpace(version)
	if version == "" {
		version = "dev"
	}

	description = strings.TrimSpace(description)
	if len(description) > maxDescriptionLen {
		description = description[:maxDescriptionLen]
	}

	relayURL = strings.TrimSpace(relayURL)
	if relayURL == "" {
		return Result{
			Message: "Bug reporting is not configured.",
		}, nil
	}

	appLog, err := TailFile(appLogPath, defaultMaxLogBytes)
	if err != nil {
		return Result{}, fmt.Errorf("read app log: %w", err)
	}

	return submitPayload(ctx, relayURL, version, instanceID, description, appLog)
}

func submitPayload(ctx context.Context, relayURL, version, instanceID, description, appLog string) (Result, error) {
	version = strings.TrimSpace(version)
	if version == "" {
		version = "dev"
	}

	description = strings.TrimSpace(description)
	if len(description) > maxDescriptionLen {
		description = description[:maxDescriptionLen]
	}

	relayURL = strings.TrimSpace(relayURL)
	if relayURL == "" {
		return Result{
			Message: "Bug reporting is not configured.",
		}, nil
	}

	if len(appLog) > defaultMaxLogBytes {
		appLog = appLog[len(appLog)-defaultMaxLogBytes:]
	}

	payload := Payload{
		Version:     version,
		InstanceID:  strings.TrimSpace(instanceID),
		Description: description,
		AppLog:      appLog,
		OS:          runtime.GOOS + "/" + runtime.GOARCH,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return Result{}, fmt.Errorf("encode bug report: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, relayURL, bytes.NewReader(body))
	if err != nil {
		return Result{}, fmt.Errorf("create bug report request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if instanceID != "" {
		req.Header.Set("X-Instance-ID", instanceID)
	}

	client := &http.Client{Timeout: defaultHTTPTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("send bug report: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Result{}, fmt.Errorf("read bug report response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		msg := strings.TrimSpace(string(respBody))
		if msg == "" {
			msg = fmt.Sprintf("bug report relay returned HTTP %d", resp.StatusCode)
		}
		return Result{}, fmt.Errorf("%s", msg)
	}

	var relay relayResponse
	if err := json.Unmarshal(respBody, &relay); err != nil {
		return Result{}, fmt.Errorf("parse bug report response: %w", err)
	}

	result := Result{
		OK:          relay.OK,
		IssueURL:    strings.TrimSpace(relay.IssueURL),
		IssueNumber: relay.IssueNumber,
	}
	if result.IssueURL != "" {
		result.Message = fmt.Sprintf("Bug report sent. Issue #%d created.", result.IssueNumber)
	} else {
		result.Message = "Bug report sent."
	}
	return result, nil
}

// TailFile returns up to maxBytes from the end of path. Missing files return empty string.
func TailFile(path string, maxBytes int) (string, error) {
	if maxBytes < 1 {
		maxBytes = defaultMaxLogBytes
	}

	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return "", err
	}

	size := info.Size()
	if size == 0 {
		return "", nil
	}

	start := int64(0)
	if size > int64(maxBytes) {
		start = size - int64(maxBytes)
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return "", err
	}

	data, err := io.ReadAll(io.LimitReader(f, int64(maxBytes)))
	if err != nil {
		return "", err
	}
	return string(data), nil
}
