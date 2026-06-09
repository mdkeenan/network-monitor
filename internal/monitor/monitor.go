package monitor

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"network-monitor/internal/config"
	"network-monitor/internal/database"
	"network-monitor/internal/publicip"
	"network-monitor/internal/textlog"
)

type LiveStatus struct {
	mu                   sync.RWMutex
	Target               string
	Up                   bool
	LastRTTMs            *int
	LastPingAt           time.Time
	FailureActive        bool
	ConsecutiveSuccesses int
	LastSuccessAt        *time.Time
	LastFailureAt        *time.Time
	OutageStartedAt      *time.Time
	FirstSuccessAt       *time.Time
}

func (s *LiveStatus) snapshot() database.Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st := database.Status{
		Target:               s.Target,
		Up:                   s.Up,
		LastRTTMs:            s.LastRTTMs,
		FailureActive:        s.FailureActive,
		ConsecutiveSuccesses: s.ConsecutiveSuccesses,
		LastSuccessAt:        s.LastSuccessAt,
		LastFailureAt:        s.LastFailureAt,
	}
	if !s.LastPingAt.IsZero() {
		t := s.LastPingAt
		st.LastPingAt = &t
	}
	return st
}

type Monitor struct {
	cfgMu            sync.RWMutex
	cfg              config.Config
	db               *database.DB
	textLog          *textlog.Logger
	status           *LiveStatus
	publicIP         *publicip.Watcher
	traceMu          sync.Mutex
	traceRunning     bool
	speedtestMu      sync.Mutex
	speedtestRunning bool
}

func New(cfg config.Config, db *database.DB, textLog *textlog.Logger) *Monitor {
	return &Monitor{
		cfg:      cfg,
		db:       db,
		textLog:  textLog,
		publicIP: publicip.NewWatcher(db, textLog),
		status: &LiveStatus{
			Target: cfg.Target,
			Up:     true,
		},
	}
}

func (m *Monitor) Status() database.Status {
	return m.status.snapshot()
}

func (m *Monitor) Target() string {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return m.cfg.Target
}

func (m *Monitor) SetTarget(target string) {
	m.cfgMu.Lock()
	m.cfg.Target = target
	m.cfgMu.Unlock()

	m.status.mu.Lock()
	m.status.Target = target
	m.status.mu.Unlock()
}

func (m *Monitor) Intervals() (traceSec, healthyTraceSec int) {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()
	return m.cfg.TraceIntervalSec, m.cfg.HealthyTraceIntervalSec
}

func (m *Monitor) Run(ctx context.Context) {
	log.Printf("Monitoring %s (ping every %ds)", m.Target(), m.cfg.PingIntervalSec)
	go m.runSpeedTestScheduler(ctx)
	if m.textLog != nil {
		if err := m.textLog.SessionStart(
			m.Target(),
			m.cfg.PingIntervalSec,
			m.cfg.VerifyDelaySec,
			m.cfg.RequiredSuccesses,
			m.cfg.TraceIntervalSec,
			m.cfg.HealthyTraceIntervalSec,
		); err != nil {
			logTextWriteErr(err)
		}
	}

	var lastOutageTraceroute time.Time
	var lastHealthyTraceroute time.Time
	ticker := time.NewTicker(time.Duration(m.cfg.PingIntervalSec) * time.Second)
	defer ticker.Stop()

	go func() {
		startCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		m.publicIP.RunStartupCheck(startCtx)
	}()

	for {
		m.tick(ctx, &lastOutageTraceroute, &lastHealthyTraceroute)

		select {
		case <-ctx.Done():
			log.Println("Monitor stopped.")
			return
		case <-ticker.C:
		}
	}
}

func (m *Monitor) tick(ctx context.Context, lastOutageTraceroute, lastHealthyTraceroute *time.Time) {
	target := m.Target()
	ok, rttMs, ttl := pingHost(target)
	now := time.Now().UTC()

	m.status.mu.Lock()
	m.status.LastPingAt = now
	m.status.Up = ok
	m.status.LastRTTMs = rttMs
	failureActive := m.status.FailureActive
	m.status.mu.Unlock()

	if err := m.db.InsertPing(now, ok, rttMs, target); err != nil {
		logDBWriteErr("insert ping", err)
	}

	if ok {
		m.handleSuccess(ctx, now, ttl, lastHealthyTraceroute)
		if m.publicIP.NotePingTTL(ttl) {
			m.publicIP.CheckAfterTTLChange(ctx)
		}
		m.publicIP.MaybePeriodicCheck(ctx, true, failureActive)
		return
	}

	m.handleFailure(ctx, now, lastOutageTraceroute)
}

func (m *Monitor) handleSuccess(ctx context.Context, now time.Time, ttl *int, lastHealthyTraceroute *time.Time) {
	var shouldTrace bool

	m.status.mu.Lock()

	m.status.ConsecutiveSuccesses++
	t := now
	m.status.LastSuccessAt = &t
	if m.status.FirstSuccessAt == nil {
		m.status.FirstSuccessAt = &t
	}

	if m.status.FailureActive && m.status.ConsecutiveSuccesses >= m.cfg.RequiredSuccesses {
		m.recordRecovery(ctx, now)
	}

	if !m.status.FailureActive {
		shouldTrace = traceIntervalDue(*lastHealthyTraceroute, m.cfg.HealthyTraceIntervalSec)
	}

	m.status.mu.Unlock()

	if shouldTrace {
		m.scheduleTraceroute(ctx, lastHealthyTraceroute, database.TracerouteKindHealthy)
	}
}

func (m *Monitor) recordRecovery(ctx context.Context, now time.Time) {
	var downtimeSec int
	var downtimeStr string
	if m.status.OutageStartedAt != nil {
		downtimeSec = int(now.Sub(*m.status.OutageStartedAt).Round(time.Second).Seconds())
		downtimeStr = database.FormatDowntime(downtimeSec)
	}

	detail := fmt.Sprintf(
		"Received %d successful ping(s) in a row. First success since monitor started: %s",
		m.cfg.RequiredSuccesses,
		formatTime(m.status.FirstSuccessAt),
	)

	var durationPtr *int
	if m.status.OutageStartedAt != nil {
		durationPtr = &downtimeSec
	}
	if err := m.db.InsertEvent(now, "recovered", detail, durationPtr); err != nil {
		logDBWriteErr("insert event", err)
	}
	if m.textLog != nil {
		logTextWriteErr(m.textLog.Recovered(now, m.cfg.RequiredSuccesses, formatTime(m.status.FirstSuccessAt), downtimeStr))
	}
	log.Printf("[RECOVERED] %s (down for %s)", now.Format(time.RFC3339), downtimeStr)
	m.status.FailureActive = false
	m.status.OutageStartedAt = nil
	m.publicIP.CheckAfterRecovery(ctx)
}

func (m *Monitor) handleFailure(ctx context.Context, now time.Time, lastOutageTraceroute *time.Time) {
	m.status.mu.Lock()
	wasActive := m.status.FailureActive
	m.status.ConsecutiveSuccesses = 0
	m.status.Up = false
	m.status.mu.Unlock()

	if !wasActive {
		log.Printf("[POTENTIAL DROP] %s - waiting %ds to verify...", now.Format(time.RFC3339), m.cfg.VerifyDelaySec)
		if m.textLog != nil {
			logTextWriteErr(m.textLog.PotentialDrop(now, m.cfg.VerifyDelaySec))
		}

		select {
		case <-time.After(time.Duration(m.cfg.VerifyDelaySec) * time.Second):
		case <-ctx.Done():
			return
		}

		target := m.Target()
		ok, rttMs, _ := pingHost(target)
		verifyTime := time.Now().UTC()
		_ = m.db.InsertPing(verifyTime, ok, rttMs, target)

		if ok {
			log.Println("-> Connection recovered within verify window. Skipping traceroute.")
			m.markSuccessfulProbe(verifyTime, rttMs)
			if err := m.db.InsertEvent(verifyTime, "blip", "recovered within verify window", nil); err != nil {
				logDBWriteErr("insert event", err)
			}
			if m.textLog != nil {
				logTextWriteErr(m.textLog.Blip(verifyTime))
			}
			m.publicIP.CheckAfterBlip(ctx)
			return
		}

		m.status.mu.Lock()
		m.status.FailureActive = true
		t := verifyTime
		m.status.LastFailureAt = &t
		m.status.OutageStartedAt = &t
		lastSuccess := formatTime(m.status.LastSuccessAt)
		m.status.mu.Unlock()

		detail := fmt.Sprintf("connection down for >%ds; last success: %s", m.cfg.VerifyDelaySec, lastSuccess)
		if err := m.db.InsertEvent(verifyTime, "failure_confirmed", detail, nil); err != nil {
			logDBWriteErr("insert event", err)
		}
		if m.textLog != nil {
			logTextWriteErr(m.textLog.FailureConfirmed(verifyTime, m.cfg.VerifyDelaySec, lastSuccess))
		}
		log.Printf("[FAILURE CONFIRMED] %s (%s)", verifyTime.Format(time.RFC3339), detail)
		*lastOutageTraceroute = time.Time{}
	}

	m.status.mu.RLock()
	active := m.status.FailureActive
	m.status.mu.RUnlock()
	if !active {
		return
	}

	if traceIntervalDue(*lastOutageTraceroute, m.cfg.TraceIntervalSec) {
		m.scheduleTraceroute(ctx, lastOutageTraceroute, database.TracerouteKindOutage)
	}
}

func traceIntervalDue(last time.Time, intervalSec int) bool {
	return last.IsZero() || time.Since(last) >= time.Duration(intervalSec)*time.Second
}

func (m *Monitor) scheduleTraceroute(ctx context.Context, last *time.Time, kind string) {
	m.traceMu.Lock()
	if m.traceRunning {
		m.traceMu.Unlock()
		return
	}
	m.traceRunning = true
	m.traceMu.Unlock()

	go func() {
		defer func() {
			m.traceMu.Lock()
			m.traceRunning = false
			m.traceMu.Unlock()
		}()
		m.runTraceroute(ctx, last, kind)
	}()
}

func (m *Monitor) runTraceroute(ctx context.Context, last *time.Time, kind string) {
	label := "routine path check"
	if kind == database.TracerouteKindOutage {
		label = "during outage"
	}
	log.Printf("-> Running traceroute to %s (%s)...", m.Target(), label)
	output, err := traceroute(m.Target())
	if strings.TrimSpace(output) == "" {
		if err != nil {
			output = fmt.Sprintf("traceroute error: %v", err)
		} else {
			output = "traceroute produced no output"
		}
	}
	ts := time.Now().UTC()
	if err := m.db.InsertTraceroute(ts, output, kind); err != nil {
		logDBWriteErr("insert traceroute", err)
	}
	if m.textLog != nil {
		var logErr error
		switch kind {
		case database.TracerouteKindHealthy:
			logErr = m.textLog.TracerouteHealthy(ts, m.Target(), output)
		default:
			logErr = m.textLog.TracerouteOutage(ts, m.Target(), output)
		}
		logTextWriteErr(logErr)
	}
	*last = ts
	log.Println("-> Traceroute logged.")

	if kind == database.TracerouteKindHealthy {
		if m.publicIP.NoteHealthyTraceroute(output) {
			m.publicIP.CheckAfterTracerouteChange(ctx)
		}
	}
}

func (m *Monitor) markSuccessfulProbe(at time.Time, rttMs *int) {
	m.status.mu.Lock()
	defer m.status.mu.Unlock()

	m.status.Up = true
	m.status.LastRTTMs = rttMs
	m.status.LastPingAt = at
	m.status.ConsecutiveSuccesses = 1
	t := at
	m.status.LastSuccessAt = &t
	if m.status.FirstSuccessAt == nil {
		m.status.FirstSuccessAt = &t
	}
}
