package textlog

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Logger struct {
	path string
	mu   sync.Mutex
}

var legacyTextLogNames = []string{
	"ConnectWatch.log",
	"NetworkMonitor_Log.txt",
	"NetworkMonitor.log",
}

// MigrateLegacyPath renames an older text log file in the same directory when target is missing.
func MigrateLegacyPath(target string) error {
	if _, err := os.Stat(target); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}

	dir := filepath.Dir(target)
	for _, name := range legacyTextLogNames {
		legacyPath := filepath.Join(dir, name)
		if _, err := os.Stat(legacyPath); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		return os.Rename(legacyPath, target)
	}

	return nil
}

func Open(path string) (*Logger, error) {
	dir := filepath.Dir(path)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	return &Logger{path: path}, nil
}

func (l *Logger) Path() string {
	return l.path
}

func (l *Logger) Info() (size int64, modified time.Time, err error) {
	info, err := os.Stat(l.path)
	if err != nil {
		return 0, time.Time{}, err
	}
	return info.Size(), info.ModTime(), nil
}

func (l *Logger) Clear() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	return os.WriteFile(l.path, []byte{}, 0o644)
}

func (l *Logger) SessionStart(target string, pingSec, verifySec, recoverCount, outageTraceSec, healthyTraceSec int) error {
	body := fmt.Sprintf(`%s
  CONNECTWATCH — SESSION STARTED
%s
  Time     : %s
  Target   : %s
  Ping     : every %d second(s)
  Verify   : %d second(s) before confirming an outage
  Recover  : %d consecutive successful ping(s)
  Traceroute during outage: every %d second(s)
  Traceroute while healthy: every %d second(s)
%s

`, sep(), sep(), formatLocal(time.Now()), target, pingSec, verifySec, recoverCount, outageTraceSec, healthyTraceSec, sep())
	return l.write(body)
}

func (l *Logger) PotentialDrop(at time.Time, verifySec int) error {
	body := fmt.Sprintf(`
[%s] POTENTIAL DROP
  A ping to the target failed.
  Waiting %d second(s) to verify before treating this as an outage.

`, formatLocal(at), verifySec)
	return l.write(body)
}

func (l *Logger) Blip(at time.Time) error {
	body := fmt.Sprintf(`
[%s] BLIP — NO OUTAGE
  Connection recovered within the verify window.
  This was a brief drop, not a confirmed outage.

`, formatLocal(at))
	return l.write(body)
}

func (l *Logger) PublicIPChange(at time.Time, oldLabel, newLabel, reason string) error {
	body := fmt.Sprintf(`
[%s] PUBLIC IP CHANGE
  Previous: %s
  Current:  %s
  Trigger:  %s

`, formatLocal(at), oldLabel, newLabel, reason)
	return l.write(body)
}

func (l *Logger) FailureConfirmed(at time.Time, verifySec int, lastSuccess string) error {
	body := fmt.Sprintf(`
[%s] FAILURE CONFIRMED
  Connection has been down for more than %d second(s).
  Last successful ping: %s

`, formatLocal(at), verifySec, lastSuccess)
	return l.write(body)
}

func (l *Logger) Recovered(at time.Time, requiredSuccesses int, firstSuccess, downtime string) error {
	downtimeLine := "  Connection was down for: unknown\n"
	if downtime != "" {
		downtimeLine = fmt.Sprintf("  Connection was down for: %s\n", downtime)
	}

	body := fmt.Sprintf(`
[%s] RECOVERED
%s  Received %d successful ping(s) in a row.
  Connection is healthy again.
  First success since monitor started: %s

`, formatLocal(at), downtimeLine, requiredSuccesses, firstSuccess)
	return l.write(body)
}

func (l *Logger) TracerouteOutage(at time.Time, target, output string) error {
	return l.traceroute(at, target, output, "TRACEROUTE — DURING OUTAGE")
}

func (l *Logger) TracerouteHealthy(at time.Time, target, output string) error {
	return l.traceroute(at, target, output, "TRACEROUTE — ROUTINE PATH CHECK")
}

func (l *Logger) traceroute(at time.Time, target, output, title string) error {
	lines := strings.Split(strings.TrimRight(output, "\r\n"), "\n")
	var indented strings.Builder
	for _, line := range lines {
		indented.WriteString("  ")
		indented.WriteString(line)
		indented.WriteByte('\n')
	}

	body := fmt.Sprintf(`%s
  %s
  Time: %s
  Target: %s
%s
%s
`, subsep(), title, formatLocal(at), target, subsep(), indented.String())
	return l.write(body)
}

func (l *Logger) SpeedTest(at time.Time, downloadMbps, uploadMbps float64, latencyMs int, serverURL, errStr string) error {
	errLine := ""
	if errStr != "" {
		errLine = fmt.Sprintf("  Error: %s\n", errStr)
	}
	latencyLine := "  Latency: —\n"
	if latencyMs > 0 {
		latencyLine = fmt.Sprintf("  Latency: %d ms\n", latencyMs)
	}
	body := fmt.Sprintf(`
[%s] SPEED TEST
  Download: %.2f Mbps
  Upload:   %.2f Mbps
%s  Server:   %s
  Duration: measured in browser
%s
`, formatLocal(at), downloadMbps, uploadMbps, latencyLine, serverURL, errLine)
	return l.write(body)
}

func (l *Logger) Shutdown(at time.Time) error {
	body := fmt.Sprintf(`
[%s] MONITOR STOPPED
  Session ended.

`, formatLocal(at))
	return l.write(body)
}

func (l *Logger) write(text string) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	f, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = f.WriteString(text)
	return err
}

func formatLocal(t time.Time) string {
	return t.Local().Format("2006-01-02 15:04:05")
}

func sep() string {
	return strings.Repeat("=", 78)
}

func subsep() string {
	return strings.Repeat("-", 78)
}
