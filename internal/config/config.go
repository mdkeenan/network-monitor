package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Target                  string `yaml:"target"`
	PingIntervalSec         int    `yaml:"ping_interval_sec"`
	TraceIntervalSec        int    `yaml:"trace_interval_sec"`
	HealthyTraceIntervalSec int    `yaml:"healthy_trace_interval_sec"`
	RequiredSuccesses       int    `yaml:"required_successes"`
	VerifyDelaySec          int    `yaml:"verify_delay_sec"`
	WebPort                 int    `yaml:"web_port"`
	DataDir                 string `yaml:"data_dir"`
	TextLogFile             string `yaml:"text_log_file"`
	RetentionDays           int    `yaml:"retention_days"`
	SpeedtestDownloadURL    string `yaml:"speedtest_download_url"`
	SpeedtestDownloadBytes  int    `yaml:"speedtest_download_bytes"`
	SpeedtestUploadURL      string `yaml:"speedtest_upload_url"`
	SpeedtestUploadBytes    int    `yaml:"speedtest_upload_bytes"`
	SpeedtestIntervalMin    int    `yaml:"speedtest_interval_min"`
	AutoCheckUpdates        bool   `yaml:"auto_check_updates"`
	UpdateManifestURL       string `yaml:"update_manifest_url"`
	BugReportURL            string `yaml:"bug_report_url"`
	AutoSendCrashReports    bool   `yaml:"auto_send_crash_reports"`
	RunAtStartup            bool   `yaml:"run_at_startup"`
}

func (c Config) TextLogPath(baseDir string) string {
	if c.TextLogFile == "" {
		return filepath.Join(baseDir, c.DataDir, "NetworkMonitor.log")
	}
	if filepath.IsAbs(c.TextLogFile) {
		return c.TextLogFile
	}
	return filepath.Join(baseDir, c.TextLogFile)
}

const (
	defaultUpdateManifestURL = "https://raw.githubusercontent.com/mdkeenan/network-monitor/main/update-manifest.json"
	defaultBugReportURL      = "https://reports.swift-raven.org/network-monitor/bug"
)

func Defaults() Config {
	return Config{
		Target:                  "8.8.8.8",
		PingIntervalSec:         1,
		TraceIntervalSec:        30,
		HealthyTraceIntervalSec: 300,
		RequiredSuccesses:       5,
		VerifyDelaySec:          5,
		WebPort:                 8080,
		DataDir:                 "data",
		TextLogFile:             "data/NetworkMonitor.log",
		RetentionDays:           365,
		SpeedtestDownloadURL:    "https://speed.cloudflare.com/__down",
		SpeedtestDownloadBytes:  10_000_000,
		SpeedtestUploadURL:      "https://speed.cloudflare.com/__up",
		SpeedtestUploadBytes:    5_000_000,
		SpeedtestIntervalMin:    60,
		AutoCheckUpdates:        true,
		UpdateManifestURL:       defaultUpdateManifestURL,
		BugReportURL:            defaultBugReportURL,
		AutoSendCrashReports:    false,
		RunAtStartup:            true,
	}
}

func Load(baseDir string) (Config, error) {
	path := filepath.Join(baseDir, "config.yaml")
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return Config{}, err
		}
		cfg := normalizeConfig(Defaults())
		if saveErr := Save(baseDir, cfg); saveErr != nil {
			return Config{}, saveErr
		}
		return cfg, nil
	}

	cfg := Defaults()
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return Config{}, err
	}
	if !strings.Contains(string(data), "run_at_startup") {
		cfg.RunAtStartup = true
	}
	if !strings.Contains(string(data), "bug_report_url") {
		cfg.BugReportURL = defaultBugReportURL
	}
	return normalizeConfig(cfg), nil
}

func normalizeConfig(cfg Config) Config {
	if cfg.PingIntervalSec < 1 {
		cfg.PingIntervalSec = 1
	}
	if cfg.RequiredSuccesses < 1 {
		cfg.RequiredSuccesses = 1
	}
	if cfg.WebPort < 1 {
		cfg.WebPort = 8080
	}
	if cfg.DataDir == "" {
		cfg.DataDir = "data"
	}
	if cfg.HealthyTraceIntervalSec < 30 {
		cfg.HealthyTraceIntervalSec = Defaults().HealthyTraceIntervalSec
	}
	if cfg.TraceIntervalSec < 1 {
		cfg.TraceIntervalSec = 30
	}
	if cfg.SpeedtestDownloadURL == "" {
		cfg.SpeedtestDownloadURL = Defaults().SpeedtestDownloadURL
	}
	if cfg.SpeedtestUploadURL == "" {
		cfg.SpeedtestUploadURL = Defaults().SpeedtestUploadURL
	}
	if cfg.SpeedtestIntervalMin < 15 {
		cfg.SpeedtestIntervalMin = 60
	}
	if cfg.SpeedtestDownloadBytes < 1_000_000 {
		cfg.SpeedtestDownloadBytes = 10_000_000
	}
	if cfg.SpeedtestUploadBytes < 1_000_000 {
		cfg.SpeedtestUploadBytes = 5_000_000
	}
	return cfg
}

func Save(baseDir string, cfg Config) error {
	path := filepath.Join(baseDir, "config.yaml")
	out, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	if err := os.WriteFile(path, out, 0o644); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	return nil
}
