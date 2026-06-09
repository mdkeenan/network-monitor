package monitor

import (
	"bytes"
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log"
	mathrand "math/rand"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	speedtestStartupDelay = 5 * time.Minute
	speedtestRunTimeout   = 30 * time.Second
)

type speedTestResult struct {
	DownloadMbps  float64
	UploadMbps    float64
	DownloadBytes int64
	UploadBytes   int64
	DurationSec   float64
	ServerURL     string
	Error         string
}

func (m *Monitor) runSpeedTestScheduler(ctx context.Context) {
	log.Printf("Speed test scheduler: first run in %s", speedtestStartupDelay)

	select {
	case <-ctx.Done():
		return
	case <-time.After(speedtestStartupDelay):
	}

	for {
		if ctx.Err() != nil {
			return
		}

		m.scheduleSpeedTest()

		intervalMin := m.speedtestIntervalMin()
		jitterSec := mathrand.Intn(360) - 180
		nextWait := time.Duration(intervalMin)*time.Minute + time.Duration(jitterSec)*time.Second
		log.Printf(
			"Speed test scheduler: next run in %s (interval %d min, jitter %+ds)",
			nextWait.Round(time.Second),
			intervalMin,
			jitterSec,
		)

		select {
		case <-ctx.Done():
			return
		case <-time.After(nextWait):
		}
	}
}

func (m *Monitor) speedtestIntervalMin() int {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()

	interval := m.cfg.SpeedtestIntervalMin
	if interval < 15 {
		return 60
	}
	return interval
}

func (m *Monitor) speedtestSettings() (downloadURL string, downloadBytes, uploadBytes int, uploadURL string) {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()

	downloadURL = m.cfg.SpeedtestDownloadURL
	uploadURL = m.cfg.SpeedtestUploadURL
	downloadBytes = m.cfg.SpeedtestDownloadBytes
	uploadBytes = m.cfg.SpeedtestUploadBytes
	if downloadBytes < 1_000_000 {
		downloadBytes = 10_000_000
	}
	if uploadBytes < 1_000_000 {
		uploadBytes = 5_000_000
	}
	return downloadURL, downloadBytes, uploadBytes, uploadURL
}

func (m *Monitor) scheduleSpeedTest() {
	m.speedtestMu.Lock()
	if m.speedtestRunning {
		m.speedtestMu.Unlock()
		log.Println("Speed test skipped: already running")
		return
	}
	m.speedtestRunning = true
	m.speedtestMu.Unlock()

	go func() {
		defer func() {
			m.speedtestMu.Lock()
			m.speedtestRunning = false
			m.speedtestMu.Unlock()
		}()
		m.runScheduledSpeedTest()
	}()
}

func (m *Monitor) MeasureUpload(ctx context.Context) (mbps float64, bytesSent int64, durationSec float64, serverURL string, err error) {
	_, _, uploadBytes, uploadURL := m.speedtestSettings()
	mbps, bytesSent, durationSec, err = uploadOnce(ctx, uploadURL, uploadBytes)
	return mbps, bytesSent, durationSec, uploadURL, err
}

func (m *Monitor) runScheduledSpeedTest() {
	downloadURL, downloadBytes, _, _ := m.speedtestSettings()
	testURL := buildSpeedTestURL(downloadURL, downloadBytes)

	ctx := context.Background()
	result := measureDownloadSpeed(ctx, testURL)
	if result.Error == "" {
		uploadMbps, sentBytes, uploadDuration, _, err := m.MeasureUpload(ctx)
		if err != nil {
			result.Error = err.Error()
		} else {
			result.UploadMbps = uploadMbps
			result.UploadBytes = sentBytes
			result.DurationSec += uploadDuration
		}
	}

	var latencyMs int
	status := m.Status()
	if status.LastRTTMs != nil {
		latencyMs = *status.LastRTTMs
	}

	ts := time.Now().UTC()
	var downloadMbps *float64
	if result.DownloadMbps > 0 {
		v := result.DownloadMbps
		downloadMbps = &v
	}
	var uploadMbps *float64
	if result.UploadMbps > 0 {
		v := result.UploadMbps
		uploadMbps = &v
	}
	if err := m.db.InsertSpeedTest(
		ts,
		downloadMbps,
		uploadMbps,
		latencyMs,
		result.DownloadBytes,
		result.UploadBytes,
		result.DurationSec,
		result.ServerURL,
		result.Error,
	); err != nil {
		logDBWriteErr("insert speedtest", err)
	}

	if m.textLog != nil {
		if err := m.textLog.SpeedTest(
			ts,
			result.DownloadMbps,
			result.UploadMbps,
			latencyMs,
			result.ServerURL,
			result.Error,
		); err != nil {
			logTextWriteErr(err)
		}
	}

	if result.Error != "" {
		log.Printf("Scheduled speed test failed: %s", result.Error)
		return
	}
	log.Printf(
		"Scheduled speed test: download %.2f Mbps, upload %.2f Mbps (%d bytes down, %d bytes up, latency %d ms)",
		result.DownloadMbps,
		result.UploadMbps,
		result.DownloadBytes,
		result.UploadBytes,
		latencyMs,
	)
}

func measureDownloadSpeed(ctx context.Context, testURL string) speedTestResult {
	var results []float64
	var bytesTotal int64
	var durationTotal float64

	for i := 0; i < 3; i++ {
		mbps, bytes, durationSec, err := downloadOnce(ctx, testURL)
		if err != nil {
			return speedTestResult{Error: err.Error(), ServerURL: testURL}
		}
		if i > 0 {
			results = append(results, mbps)
			bytesTotal += bytes
			durationTotal += durationSec
		}
	}

	return speedTestResult{
		DownloadMbps:  (results[0] + results[1]) / 2,
		DownloadBytes: bytesTotal / 2,
		DurationSec:   durationTotal,
		ServerURL:     testURL,
	}
}

func downloadOnce(ctx context.Context, rawURL string) (mbps float64, bytesRead int64, durationSec float64, err error) {
	runCtx, cancel := context.WithTimeout(ctx, speedtestRunTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(runCtx, http.MethodGet, appendSpeedTestCacheBuster(rawURL), nil)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("build download request: %w", err)
	}

	client := &http.Client{}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return 0, 0, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, 0, 0, fmt.Errorf("download test failed (HTTP %d)", resp.StatusCode)
	}

	n, err := io.Copy(io.Discard, resp.Body)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("read download body: %w", err)
	}

	durationSec = time.Since(start).Seconds()
	if durationSec <= 0 {
		return 0, 0, 0, fmt.Errorf("download test failed (zero duration)")
	}

	bytesRead = n
	mbps = (float64(bytesRead) * 8) / (durationSec * 1_000_000)
	return mbps, bytesRead, durationSec, nil
}

func uploadOnce(ctx context.Context, uploadURL string, uploadBytes int) (mbps float64, bytesSent int64, durationSec float64, err error) {
	runCtx, cancel := context.WithTimeout(ctx, speedtestRunTimeout)
	defer cancel()

	payload := make([]byte, uploadBytes)
	if _, err := rand.Read(payload); err != nil {
		return 0, 0, 0, fmt.Errorf("generate upload payload: %w", err)
	}

	req, err := http.NewRequestWithContext(
		runCtx,
		http.MethodPost,
		appendSpeedTestCacheBuster(uploadURL),
		bytes.NewReader(payload),
	)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("build upload request: %w", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")

	client := &http.Client{}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return 0, 0, 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, 0, 0, fmt.Errorf("upload test failed (HTTP %d)", resp.StatusCode)
	}

	durationSec = time.Since(start).Seconds()
	if durationSec <= 0 {
		return 0, 0, 0, fmt.Errorf("upload test failed (zero duration)")
	}

	bytesSent = int64(uploadBytes)
	mbps = (float64(bytesSent) * 8) / (durationSec * 1_000_000)
	return mbps, bytesSent, durationSec, nil
}

func setURLQueryParam(rawURL, key, value string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		sep := "?"
		if strings.Contains(rawURL, "?") {
			sep = "&"
		}
		return fmt.Sprintf("%s%s%s=%s", rawURL, sep, key, value)
	}

	query := parsed.Query()
	query.Set(key, value)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func buildSpeedTestURL(baseURL string, downloadBytes int) string {
	return setURLQueryParam(baseURL, "bytes", strconv.Itoa(downloadBytes))
}

func appendSpeedTestCacheBuster(rawURL string) string {
	return setURLQueryParam(rawURL, "nocache", strconv.FormatInt(time.Now().UnixNano(), 10))
}
