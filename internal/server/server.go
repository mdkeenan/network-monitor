package server

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"network-monitor/internal/config"
	"network-monitor/internal/database"
	"network-monitor/internal/instanceid"
	"network-monitor/internal/monitor"
	"network-monitor/internal/textlog"
	"network-monitor/internal/updates"
)

//go:embed web/*
var webFS embed.FS

type Server struct {
	baseDir    string
	version    string
	instanceID string
	cfg        config.Config
	db         *database.DB
	monitor    *monitor.Monitor
	textLog    *textlog.Logger
}

func New(baseDir string, version string, buildDate string, cfg config.Config, db *database.DB, mon *monitor.Monitor, textLog *textlog.Logger) (*Server, error) {
	instanceSeg, err := instanceid.GetOrCreate(
		func(key string) (string, error) {
			value, ok, err := db.GetAppState(key)
			if err != nil {
				return "", err
			}
			if !ok {
				return "", nil
			}
			return value, nil
		},
		db.SetAppState,
	)
	if err != nil {
		return nil, fmt.Errorf("instance id: %w", err)
	}

	fullID := instanceid.Compose(
		instanceSeg,
		instanceid.ComputeVersionSegment(version),
		instanceid.BuildDateSegment(buildDate),
	)

	return &Server{
		baseDir:    baseDir,
		version:    version,
		instanceID: fullID,
		cfg:        cfg,
		db:         db,
		monitor:    mon,
		textLog:    textLog,
	}, nil
}

func (s *Server) InstanceID() string {
	return s.instanceID
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/version", s.handleVersion)
	mux.HandleFunc("/api/pings", s.handlePings)
	mux.HandleFunc("/api/events", s.handleEvents)
	mux.HandleFunc("/api/summary", s.handleSummary)
	mux.HandleFunc("/api/traceroute/latest", s.handleLatestTraceroute)
	mux.HandleFunc("/api/traceroute/latest-successful", s.handleLatestSuccessfulTraceroute)
	mux.HandleFunc("/api/log/info", s.handleLogInfo)
	mux.HandleFunc("/api/log/download", s.handleLogDownload)
	mux.HandleFunc("/api/data/delete", s.handleDeleteData)
	mux.HandleFunc("/api/app/reset", s.handleAppReset)
	mux.HandleFunc("/api/settings", s.handleSettings)
	mux.HandleFunc("/api/updates/check", s.handleUpdatesCheck)
	mux.HandleFunc("/api/settings/test-target", s.handleTestTarget)
	mux.HandleFunc("/api/settings/pick-folder", s.handlePickFolder)
	mux.HandleFunc("/api/speedtest/result", s.handleSpeedTestResult)
	mux.HandleFunc("/api/speedtest/upload", s.handleSpeedTestUpload)
	mux.HandleFunc("/api/speedtest/history", s.handleSpeedTestHistory)
	mux.HandleFunc("/api/speedtest/config", s.handleSpeedTestConfig)
	mux.HandleFunc("/api/public-ip", s.handlePublicIP)
	mux.HandleFunc("/api/ip-echo-services", s.handleIPEchoServices)
	mux.HandleFunc("/api/private-ip", s.handlePrivateIP)
	mux.HandleFunc("/api/target-info", s.handleTargetInfo)
	mux.HandleFunc("/api/export", s.handleExport)

	webRoot, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("web fs: %v", err)
	}
	mux.Handle("/", http.FileServer(http.FS(webRoot)))

	return mux
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{
		"version":     s.version,
		"instance_id": s.instanceID,
	})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	resp := struct {
		database.Status
		OldestPingAt *time.Time `json:"oldest_ping_at,omitempty"`
		NewestPingAt *time.Time `json:"newest_ping_at,omitempty"`
	}{
		Status: s.monitor.Status(),
	}
	if oldest, newest, ok, err := s.db.PingTimeBounds(); err == nil && ok {
		resp.OldestPingAt = &oldest
		resp.NewestPingAt = &newest
	}
	writeJSON(w, resp)
}

func (s *Server) handlePings(w http.ResponseWriter, r *http.Request) {
	from, to := parseRange(r, 1*time.Hour)
	limit := queryInt(r, "limit", 5000)

	pings, err := s.db.ListPings(from, to, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("list pings: %w", err))
		return
	}
	writeJSON(w, pings)
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	from, to := parseRange(r, 24*time.Hour)
	events, err := s.db.ListEvents(from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("list events: %w", err))
		return
	}
	writeJSON(w, events)
}

func (s *Server) handleSummary(w http.ResponseWriter, r *http.Request) {
	from, to := parseRange(r, 1*time.Hour)
	target := s.monitor.Target()
	total, okCount, avgRTT, err := s.db.Summary(target, from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("summary: %w", err))
		return
	}
	jitterMs, err := s.db.PingJitterMs(target, 60)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("ping jitter: %w", err))
		return
	}
	availability := 0.0
	if total > 0 {
		availability = float64(okCount) / float64(total) * 100
	}
	writeJSON(w, map[string]any{
		"from":         from,
		"to":           to,
		"total_pings":  total,
		"ok_pings":     okCount,
		"availability": availability,
		"avg_rtt_ms":   avgRTT,
		"jitter_ms":    jitterMs,
	})
}

func (s *Server) handleLatestTraceroute(w http.ResponseWriter, r *http.Request) {
	s.writeLatestTraceroute(w, database.TracerouteKindOutage)
}

func (s *Server) handleLatestSuccessfulTraceroute(w http.ResponseWriter, r *http.Request) {
	s.writeLatestTraceroute(w, database.TracerouteKindHealthy)
}

func (s *Server) writeLatestTraceroute(w http.ResponseWriter, kind string) {
	tr, err := s.db.LatestTracerouteByKind(kind)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("latest traceroute: %w", err))
		return
	}
	writeJSON(w, tr)
}

func (s *Server) handleLogInfo(w http.ResponseWriter, r *http.Request) {
	if s.textLog == nil {
		writeJSON(w, map[string]any{"available": false})
		return
	}

	size, modified, err := s.textLog.Info()
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, map[string]any{
				"available":  true,
				"path":       s.textLog.Path(),
				"size_bytes": 0,
				"modified":   nil,
			})
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	writeJSON(w, map[string]any{
		"available":    true,
		"path":         s.textLog.Path(),
		"size_bytes":   size,
		"modified":     modified.UTC(),
		"download_url": "/api/log/download",
	})
}

func (s *Server) handleLogDownload(w http.ResponseWriter, r *http.Request) {
	if s.textLog == nil {
		writeError(w, http.StatusNotFound, os.ErrNotExist)
		return
	}

	path := s.textLog.Path()
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	filename := filepath.Base(path)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	http.ServeFile(w, r, path)
}

func (s *Server) handleDeleteData(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}

	pings, events, traces, speedtests, err := s.db.DeleteAll()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("delete stored data: %w", err))
		return
	}

	logCleared := false
	if s.textLog != nil {
		if err := s.textLog.Clear(); err != nil && !os.IsNotExist(err) {
			writeError(w, http.StatusInternalServerError, fmt.Errorf("clear text log: %w", err))
			return
		}
		logCleared = true
	}

	writeJSON(w, map[string]any{
		"ok":                  true,
		"pings_deleted":       pings,
		"events_deleted":      events,
		"traceroutes_deleted": traces,
		"speedtests_deleted":  speedtests,
		"log_cleared":         logCleared,
	})
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		payload, err := s.buildSettingsGETResponse()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, payload)
	case http.MethodPost:
		var body struct {
			Target            string `json:"target"`
			WebPort           int    `json:"web_port"`
			DataDir           string `json:"data_dir"`
			RetentionDays     int    `json:"retention_days"`
			AutoCheckUpdates  bool   `json:"auto_check_updates"`
			ForceDeleteData   bool   `json:"force_delete_data"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid request body"))
			return
		}

		coverageDays, hasData, err := s.db.DataCoverageDays()
		if err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Errorf("data coverage: %w", err))
			return
		}
		if hasData && body.RetentionDays > 0 && float64(body.RetentionDays) < coverageDays && !body.ForceDeleteData {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error":              fmt.Sprintf("stored data goes back %.0f days, which is longer than the %d-day retention setting", math.Ceil(coverageDays), body.RetentionDays),
				"code":               "retention_shorter_than_data",
				"data_coverage_days": coverageDays,
			})
			return
		}

		prevPort := s.cfg.WebPort
		prevDataDir := s.cfg.DataDir

		cfg, err := config.UpdateSettings(s.baseDir, config.SettingsUpdate{
			Target:           body.Target,
			WebPort:          body.WebPort,
			DataDir:          body.DataDir,
			RetentionDays:    body.RetentionDays,
			AutoCheckUpdates: body.AutoCheckUpdates,
		}, s.cfg.WebPort)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if body.ForceDeleteData {
			if err := s.deleteStoredData(); err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
		}

		s.cfg = cfg
		s.monitor.SetTarget(cfg.Target)

		if _, err := s.db.PurgeOlderThan(cfg.RetentionDays); err != nil {
			log.Printf("retention purge after settings save: %v", err)
		}

		restartRequired := cfg.WebPort != prevPort || cfg.DataDir != prevDataDir
		redirectURL := fmt.Sprintf("http://127.0.0.1:%d/", cfg.WebPort)

		if restartRequired {
			if err := restartApplication(s.baseDir); err != nil {
				writeError(w, http.StatusInternalServerError, fmt.Errorf("restart application: %w", err))
				return
			}
		}

		writeJSON(w, map[string]any{
			"ok":                 true,
			"target":             cfg.Target,
			"web_port":           cfg.WebPort,
			"data_dir":           cfg.DataDir,
			"retention_days":     cfg.RetentionDays,
			"auto_check_updates": cfg.AutoCheckUpdates,
			"restart_required":   restartRequired,
			"redirect_url":       redirectURL,
		})
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
}

func (s *Server) handlePickFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}

	path, err := pickFolderPath()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	normalized, err := config.ValidateDataDirInput(s.baseDir, path)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	writeJSON(w, map[string]any{
		"path": normalized,
	})
}

func (s *Server) buildSettingsGETResponse() (map[string]any, error) {
	traceSec, healthyTraceSec := s.monitor.Intervals()
	coverageDays, hasData, err := s.db.DataCoverageDays()
	if err != nil {
		return nil, fmt.Errorf("data coverage: %w", err)
	}
	spanDays, _, err := s.db.DataSpanDays()
	if err != nil {
		return nil, fmt.Errorf("data span: %w", err)
	}
	return map[string]any{
		"target":                     s.monitor.Target(),
		"web_port":                   s.cfg.WebPort,
		"data_dir":                   s.cfg.DataDir,
		"retention_days":             s.cfg.RetentionDays,
		"auto_check_updates":         s.cfg.AutoCheckUpdates,
		"trace_interval_sec":         traceSec,
		"healthy_trace_interval_sec": healthyTraceSec,
		"data_coverage_days":         coverageDays,
		"data_span_days":             spanDays,
		"has_data":                   hasData,
	}, nil
}

func (s *Server) handleUpdatesCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	result, err := updates.Check(ctx, s.cfg.UpdateManifestURL, s.version, s.instanceID)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("check for updates: %w", err))
		return
	}
	writeJSON(w, result)
}

func (s *Server) deleteStoredData() error {
	if _, _, _, _, err := s.db.DeleteAll(); err != nil {
		return fmt.Errorf("delete stored data: %w", err)
	}
	if s.textLog != nil {
		if err := s.textLog.Clear(); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("clear text log: %w", err)
		}
	}
	return nil
}

func (s *Server) handleAppReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}

	if err := s.deleteStoredData(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	cfg, err := config.ResetToDefaults(s.baseDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("reset config: %w", err))
		return
	}

	s.cfg = cfg
	s.monitor.SetTarget(cfg.Target)

	if _, err := s.db.PurgeOlderThan(cfg.RetentionDays); err != nil {
		log.Printf("retention purge after app reset: %v", err)
	}

	redirectURL := fmt.Sprintf("http://127.0.0.1:%d/", cfg.WebPort)
	if err := restartApplication(s.baseDir); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("restart application: %w", err))
		return
	}

	writeJSON(w, map[string]any{
		"ok":           true,
		"redirect_url": redirectURL,
	})
}

func (s *Server) handleSpeedTestConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}
	writeJSON(w, map[string]any{
		"download_url":   s.cfg.SpeedtestDownloadURL,
		"download_bytes": s.cfg.SpeedtestDownloadBytes,
		"upload_url":     s.cfg.SpeedtestUploadURL,
		"upload_bytes":   s.cfg.SpeedtestUploadBytes,
		"interval_min":   s.cfg.SpeedtestIntervalMin,
	})
}

func (s *Server) handleSpeedTestHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}
	from, to := parseRange(r, 24*time.Hour)
	limit := queryInt(r, "limit", 500)
	tests, err := s.db.ListSpeedTests(from, to, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("list speedtests: %w", err))
		return
	}
	writeJSON(w, tests)
}

func (s *Server) handleSpeedTestUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}
	_, _ = io.Copy(io.Discard, r.Body)

	ctx, cancel := context.WithTimeout(r.Context(), 35*time.Second)
	defer cancel()

	mbps, bytesSent, durationSec, serverURL, err := s.monitor.MeasureUpload(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("upload test: %w", err))
		return
	}

	writeJSON(w, map[string]any{
		"ok":           true,
		"upload_mbps":  mbps,
		"upload_bytes": bytesSent,
		"duration_sec": durationSec,
		"server_url":   serverURL,
	})
}

func (s *Server) handleSpeedTestResult(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}

	var body struct {
		DownloadMbps  *float64 `json:"download_mbps"`
		UploadMbps    *float64 `json:"upload_mbps"`
		LatencyMs     *int     `json:"latency_ms"`
		DownloadBytes *int64   `json:"download_bytes"`
		UploadBytes   *int64   `json:"upload_bytes"`
		DurationSec   *float64 `json:"duration_sec"`
		ServerURL     string   `json:"server_url"`
		Error         string   `json:"error"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid request body"))
		return
	}

	ts := time.Now().UTC()
	latencyMs := intValue(body.LatencyMs)
	downloadBytes := int64Value(body.DownloadBytes)
	uploadBytes := int64Value(body.UploadBytes)
	durationSec := float64Value(body.DurationSec)

	if err := s.db.InsertSpeedTest(
		ts,
		body.DownloadMbps,
		body.UploadMbps,
		latencyMs,
		downloadBytes,
		uploadBytes,
		durationSec,
		body.ServerURL,
		body.Error,
	); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("insert speedtest: %w", err))
		return
	}

	if s.textLog != nil {
		if err := s.textLog.SpeedTest(ts, float64Value(body.DownloadMbps), float64Value(body.UploadMbps), latencyMs, body.ServerURL, body.Error); err != nil {
			log.Printf("text log speedtest: %v", err)
		}
	}

	writeJSON(w, map[string]any{"ok": true})
}

func float64Value(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}

func int64Value(v *int64) int64 {
	if v == nil {
		return 0
	}
	return *v
}

func intValue(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}

func (s *Server) handleTestTarget(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}

	var body struct {
		Target string `json:"target"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid request body"))
		return
	}

	normalized, err := config.ValidateTarget(body.Target)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	const attempts = 3
	successes := monitor.PingTargetNTimes(normalized, attempts)
	writeJSON(w, map[string]any{
		"target":    normalized,
		"attempts":  attempts,
		"successes": successes,
		"reachable": successes == attempts,
	})
}

func parseTimeParam(v string) (time.Time, error) {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.999Z07:00",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, v); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid time %q", v)
}

func parseRange(r *http.Request, defaultRange time.Duration) (time.Time, time.Time) {
	to := time.Now().UTC()
	from := to.Add(-defaultRange)

	fromParam := r.URL.Query().Get("from")
	toParam := r.URL.Query().Get("to")
	if fromParam != "" && toParam != "" {
		if t, err := parseTimeParam(fromParam); err == nil {
			from = t
		}
		if t, err := parseTimeParam(toParam); err == nil {
			to = t
		}
		return from, to
	}

	if fromParam != "" {
		if t, err := parseTimeParam(fromParam); err == nil {
			from = t
		}
	}
	if toParam != "" {
		if t, err := parseTimeParam(toParam); err == nil {
			to = t
		}
	}

	if minutes := queryInt(r, "minutes", 0); minutes > 0 {
		from = to.Add(-time.Duration(minutes) * time.Minute)
	} else if hours := queryInt(r, "hours", 0); hours > 0 {
		from = to.Add(-time.Duration(hours) * time.Hour)
	}
	return from, to
}

func queryInt(r *http.Request, key string, fallback int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func writeError(w http.ResponseWriter, code int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}
