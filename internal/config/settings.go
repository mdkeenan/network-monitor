package config

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const MinRetentionDays = 1

type SettingsUpdate struct {
	Target           string
	WebPort          int
	DataDir          string
	RetentionDays    int
	AutoCheckUpdates     bool
	RunAtStartup         bool
	AutoSendCrashReports bool
}

func ValidateWebPortInput(input string, currentPort int) (int, error) {
	s := strings.TrimSpace(input)
	if s == "" {
		return 0, fmt.Errorf("enter a web port number")
	}
	if !isDigitsOnly(s) {
		return 0, fmt.Errorf("web port must contain numbers only")
	}
	port, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("enter a valid web port number")
	}
	if port < 1 || port > 65535 {
		return 0, fmt.Errorf("web port must be between 1 and 65535")
	}
	if port != currentPort && !isTCPPortAvailable("127.0.0.1", port) {
		return 0, fmt.Errorf("port %d is already in use on this computer", port)
	}
	return port, nil
}

func ValidateDataDirInput(baseDir, input string) (string, error) {
	s := strings.TrimSpace(input)
	if s == "" {
		return "", fmt.Errorf("enter a data directory path")
	}
	if strings.ContainsAny(s, "<>|\"?*") {
		return "", fmt.Errorf("data directory contains invalid characters")
	}

	var abs string
	if filepath.IsAbs(s) {
		abs = filepath.Clean(s)
	} else {
		abs = filepath.Clean(filepath.Join(baseDir, s))
	}

	if err := checkDataDirAccessible(abs); err != nil {
		return "", err
	}

	if filepath.IsAbs(s) {
		return abs, nil
	}
	return filepath.Clean(s), nil
}

func checkDataDirAccessible(absPath string) error {
	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			if mkErr := os.MkdirAll(absPath, 0o755); mkErr != nil {
				return fmt.Errorf("data directory is not accessible: %w", mkErr)
			}
			return nil
		}
		return fmt.Errorf("data directory is not accessible: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("data directory path is not a folder")
	}

	testFile := filepath.Join(absPath, ".nm_write_test")
	if err := os.WriteFile(testFile, []byte("ok"), 0o644); err != nil {
		return fmt.Errorf("data directory is not writable: %w", err)
	}
	_ = os.Remove(testFile)
	return nil
}

func ValidateRetentionDaysInput(input string) (int, error) {
	s := strings.TrimSpace(input)
	if s == "" {
		return 0, fmt.Errorf("enter a retention period in days")
	}
	if !isDigitsOnly(s) {
		return 0, fmt.Errorf("retention days must contain numbers only")
	}
	days, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("enter a valid retention period in days")
	}
	if days < MinRetentionDays {
		return 0, fmt.Errorf("retention must be 24 hours (1 day) or more")
	}
	return days, nil
}

func isDigitsOnly(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func isTCPPortAvailable(host string, port int) bool {
	ln, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}

func UpdateSettings(baseDir string, update SettingsUpdate, currentPort int) (Config, error) {
	target, err := ValidateTarget(update.Target)
	if err != nil {
		return Config{}, err
	}
	webPort, err := ValidateWebPortInput(strconv.Itoa(update.WebPort), currentPort)
	if err != nil {
		return Config{}, err
	}
	dataDir, err := ValidateDataDirInput(baseDir, update.DataDir)
	if err != nil {
		return Config{}, err
	}
	retentionDays, err := ValidateRetentionDaysInput(strconv.Itoa(update.RetentionDays))
	if err != nil {
		return Config{}, err
	}

	cfg, err := Load(baseDir)
	if err != nil {
		return Config{}, fmt.Errorf("load config: %w", err)
	}

	cfg.Target = target
	cfg.WebPort = webPort
	cfg.DataDir = dataDir
	cfg.RetentionDays = retentionDays
	cfg.AutoCheckUpdates = update.AutoCheckUpdates
	cfg.RunAtStartup = update.RunAtStartup
	cfg.AutoSendCrashReports = update.AutoSendCrashReports

	if err := Save(baseDir, cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// ResetToDefaults overwrites config.yaml with factory defaults.
func ResetToDefaults(baseDir string) (Config, error) {
	cfg := Defaults()
	if err := Save(baseDir, cfg); err != nil {
		return Config{}, fmt.Errorf("save default config: %w", err)
	}
	return cfg, nil
}
