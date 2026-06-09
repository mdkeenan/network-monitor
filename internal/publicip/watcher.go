package publicip

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"network-monitor/internal/database"
	"network-monitor/internal/iplookup"
	"network-monitor/internal/textlog"
)

const (
	stateKey              = "last_public_ip"
	checkInterval         = 10 * time.Minute
	fetchTimeout          = 15 * time.Second
	EventTypePublicIPChange = "public_ip_change"
)

type persistedState struct {
	IP  string `json:"ip"`
	ISP string `json:"isp"`
}

type Watcher struct {
	db      *database.DB
	textLog *textlog.Logger
	mu      sync.Mutex

	lastIP                string
	lastISP               string
	initialized           bool
	lastCheck             time.Time
	baselineTTL           *int
	lastTraceFingerprint  string
	checkMu               sync.Mutex
}

func NewWatcher(db *database.DB, textLog *textlog.Logger) *Watcher {
	return &Watcher{db: db, textLog: textLog}
}

func (w *Watcher) RunStartupCheck(ctx context.Context) {
	w.Check(ctx, "application startup")
}

func (w *Watcher) CheckAfterRecovery(ctx context.Context) {
	w.Check(ctx, "network recovery")
}

func (w *Watcher) CheckAfterBlip(ctx context.Context) {
	w.Check(ctx, "network blip")
}

func (w *Watcher) CheckAfterTTLChange(ctx context.Context) {
	w.Check(ctx, "ping TTL change")
}

func (w *Watcher) CheckAfterTracerouteChange(ctx context.Context) {
	w.Check(ctx, "traceroute path change")
}

func (w *Watcher) MaybePeriodicCheck(ctx context.Context, up, failureActive bool) {
	if !up || failureActive {
		return
	}
	w.mu.Lock()
	due := w.lastCheck.IsZero() || time.Since(w.lastCheck) >= checkInterval
	w.mu.Unlock()
	if !due {
		return
	}
	w.Check(ctx, "scheduled check while UP")
}

func (w *Watcher) NotePingTTL(ttl *int) bool {
	if ttl == nil {
		return false
	}
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.baselineTTL == nil {
		v := *ttl
		w.baselineTTL = &v
		return false
	}
	if TTLChangedSignificantly(w.baselineTTL, ttl) {
		v := *ttl
		w.baselineTTL = &v
		return true
	}
	return false
}

func (w *Watcher) NoteHealthyTraceroute(output string) bool {
	fingerprint := TracerouteFingerprint(output)
	w.mu.Lock()
	defer w.mu.Unlock()

	previous := w.lastTraceFingerprint
	w.lastTraceFingerprint = fingerprint
	if previous == "" {
		return false
	}
	return TracerouteChangedSignificantly(previous, output)
}

func (w *Watcher) Check(ctx context.Context, reason string) {
	w.checkMu.Lock()
	defer w.checkMu.Unlock()
	defer func() {
		w.mu.Lock()
		w.lastCheck = time.Now().UTC()
		w.mu.Unlock()
	}()

	checkCtx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()

	currentIP, err := Fetch(checkCtx)
	if err != nil {
		log.Printf("public IP check (%s): %v", reason, err)
		return
	}

	currentISP := w.lookupISP(checkCtx, currentIP)
	now := time.Now().UTC()

	w.mu.Lock()
	previousIP := w.lastIP
	previousISP := w.lastISP
	firstSessionCheck := !w.initialized
	w.mu.Unlock()

	if firstSessionCheck {
		if stored, ok := w.loadPersistedState(); ok && stored.IP != "" && stored.IP != currentIP {
			w.recordChange(now, stored.IP, stored.ISP, currentIP, currentISP, reason)
		}
		w.setCurrent(currentIP, currentISP)
		w.persistState(currentIP, currentISP)
		return
	}

	if previousIP == "" {
		w.setCurrent(currentIP, currentISP)
		w.persistState(currentIP, currentISP)
		return
	}

	if previousIP == currentIP {
		if currentISP != "" && previousISP == "" {
			w.mu.Lock()
			w.lastISP = currentISP
			w.mu.Unlock()
			w.persistState(currentIP, currentISP)
		}
		return
	}

	w.recordChange(now, previousIP, previousISP, currentIP, currentISP, reason)
	w.setCurrent(currentIP, currentISP)
	w.persistState(currentIP, currentISP)
}

func (w *Watcher) lookupISP(ctx context.Context, ip string) string {
	info, err := iplookup.Lookup(ctx, w.db, ip)
	if err != nil {
		log.Printf("public IP ISP lookup for %s: %v", ip, err)
		return ""
	}
	return info.ISP
}

func (w *Watcher) recordChange(at time.Time, oldIP, oldISP, newIP, newISP, reason string) {
	oldLabel := formatEndpoint(oldIP, oldISP)
	newLabel := formatEndpoint(newIP, newISP)
	detail := fmt.Sprintf(
		"Source public IP changed: %s → %s (trigger: %s)",
		oldLabel,
		newLabel,
		reason,
	)

	if err := w.db.InsertEvent(at, EventTypePublicIPChange, detail, nil); err != nil {
		log.Printf("insert public IP change event: %v", err)
	}
	if w.textLog != nil {
		if err := w.textLog.PublicIPChange(at, oldLabel, newLabel, reason); err != nil {
			log.Printf("text log public IP change: %v", err)
		}
	}
	log.Printf("[PUBLIC IP CHANGE] %s — %s", at.Format(time.RFC3339), detail)
}

func formatEndpoint(ip, isp string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return "unknown"
	}
	provider := iplookup.FormatProvider(isp)
	return fmt.Sprintf("%s (%s)", ip, provider)
}

func (w *Watcher) setCurrent(ip, isp string) {
	w.mu.Lock()
	w.lastIP = ip
	w.lastISP = isp
	w.initialized = true
	w.mu.Unlock()
}

func (w *Watcher) loadPersistedState() (persistedState, bool) {
	if w.db == nil {
		return persistedState{}, false
	}
	raw, ok, err := w.db.GetAppState(stateKey)
	if err != nil {
		log.Printf("load public IP state: %v", err)
		return persistedState{}, false
	}
	if !ok || raw == "" {
		return persistedState{}, false
	}
	var state persistedState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		log.Printf("decode public IP state: %v", err)
		return persistedState{}, false
	}
	return state, true
}

func (w *Watcher) persistState(ip, isp string) {
	if w.db == nil {
		return
	}
	payload, err := json.Marshal(persistedState{IP: ip, ISP: isp})
	if err != nil {
		log.Printf("encode public IP state: %v", err)
		return
	}
	if err := w.db.SetAppState(stateKey, string(payload)); err != nil {
		log.Printf("persist public IP state: %v", err)
	}
}
