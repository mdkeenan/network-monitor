package publicip

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const fetchURL = "https://icanhazip.com/"

var fetchHTTPClient = http.DefaultClient

func Fetch(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fetchURL, nil)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}

	resp, err := fetchHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch public IP: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("fetch public IP: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 128))
	if err != nil {
		return "", fmt.Errorf("read public IP: %w", err)
	}

	ip := strings.TrimSpace(string(body))
	if ip == "" {
		return "", fmt.Errorf("empty public IP response")
	}
	return ip, nil
}
