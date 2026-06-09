package report

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"
)

const maxCrashStackBytes = 8000

type crashSettings struct {
	enabled    bool
	relayURL   string
	version    string
	instanceID string
}

var (
	crashMu     sync.RWMutex
	crashCfg    crashSettings
	crashSent   bool
	crashSentMu sync.Mutex
)

// ConfigureCrashReporting updates in-memory crash report settings.
func ConfigureCrashReporting(enabled bool, relayURL, version, instanceID string) {
	crashMu.Lock()
	defer crashMu.Unlock()
	crashCfg = crashSettings{
		enabled:    enabled,
		relayURL:   strings.TrimSpace(relayURL),
		version:    strings.TrimSpace(version),
		instanceID: strings.TrimSpace(instanceID),
	}
}

// Recover handles a recovered panic, sends one crash report if enabled, and returns true if a panic occurred.
func Recover() bool {
	if r := recover(); r != nil {
		stack := string(debug.Stack())
		log.Printf("panic: %v\n%s", r, stack)
		sendCrashReportOnce(fmt.Sprint(r), stack)
		return true
	}
	return false
}

// Go runs fn in a goroutine with panic recovery and optional crash reporting.
func Go(fn func()) {
	go func() {
		defer Recover()
		fn()
	}()
}

// RecoverHTTPHandler wraps an HTTP handler with panic recovery.
func RecoverHTTPHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer Recover()
		next.ServeHTTP(w, r)
	})
}

func sendCrashReportOnce(panicValue, stack string) {
	crashMu.RLock()
	cfg := crashCfg
	crashMu.RUnlock()
	if !cfg.enabled || cfg.relayURL == "" {
		return
	}

	crashSentMu.Lock()
	if crashSent {
		crashSentMu.Unlock()
		return
	}
	crashSent = true
	crashSentMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if _, err := SubmitCrash(ctx, cfg.relayURL, cfg.version, cfg.instanceID, panicValue, stack); err != nil {
		log.Printf("automatic crash report: %v", err)
	}
}

// SubmitCrash sends a minimal automatic crash report.
func SubmitCrash(ctx context.Context, relayURL, version, instanceID, panicValue, stack string) (Result, error) {
	stack = truncateString(stack, maxCrashStackBytes)
	description := fmt.Sprintf(
		"Automatic crash report (opt-in)\n\nPanic: %s\n\nStack trace:\n%s",
		strings.TrimSpace(panicValue),
		stack,
	)
	return submitPayload(ctx, relayURL, version, instanceID, description, "")
}

func truncateString(s string, max int) string {
	if max < 1 || len(s) <= max {
		return s
	}
	return s[len(s)-max:]
}
