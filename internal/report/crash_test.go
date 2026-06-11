package report

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestSubmitCrashUsesMinimalPayload(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if got := r.Header.Get("X-Instance-ID"); got != "instance-123" {
			t.Fatalf("X-Instance-ID = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"issue_url":"https://github.com/example/issues/1","issue_number":1}`))
	}))
	defer srv.Close()

	result, err := SubmitCrash(context.Background(), srv.URL, "v1.0.0", "instance-123", "test panic", "stack trace")
	if err != nil {
		t.Fatalf("SubmitCrash: %v", err)
	}
	if !result.OK {
		t.Fatalf("result.OK = false")
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d, want 1", calls.Load())
	}
}

func TestCrashReportSentOnce(t *testing.T) {
	resetCrashReportingForTest()

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`{"ok":true,"issue_url":"https://github.com/example/issues/2","issue_number":2}`))
	}))
	defer srv.Close()

	ConfigureCrashReporting(true, srv.URL, "v1.0.0", "instance-456")
	sendCrashReportOnce("panic one", "stack one")
	sendCrashReportOnce("panic two", "stack two")

	if calls.Load() != 1 {
		t.Fatalf("calls = %d, want 1", calls.Load())
	}
}

func TestCrashReportDisabled(t *testing.T) {
	resetCrashReportingForTest()

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
	}))
	defer srv.Close()

	ConfigureCrashReporting(false, srv.URL, "v1.0.0", "instance-789")
	sendCrashReportOnce("panic", "stack")

	if calls.Load() != 0 {
		t.Fatalf("calls = %d, want 0", calls.Load())
	}
}

func resetCrashReportingForTest() {
	crashSentMu.Lock()
	crashSent = false
	crashSentMu.Unlock()
	ConfigureCrashReporting(false, "", "", "")
}
