package database

import (
	"database/sql"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type DB struct {
	conn *sql.DB
}

type Ping struct {
	TS     time.Time `json:"ts"`
	OK     bool      `json:"ok"`
	RTTMs  *int      `json:"rtt_ms"`
	Target string    `json:"target"`
}

type Event struct {
	TS          time.Time `json:"ts"`
	Type        string    `json:"type"`
	Detail      string    `json:"detail"`
	DurationSec *int      `json:"duration_sec,omitempty"`
	Downtime    string    `json:"downtime,omitempty"`
}

type Traceroute struct {
	TS     time.Time `json:"ts"`
	Output string    `json:"output"`
	Kind   string    `json:"kind,omitempty"`
}

type SpeedTest struct {
	TS            time.Time `json:"ts"`
	DownloadMbps  *float64  `json:"download_mbps,omitempty"`
	UploadMbps    *float64  `json:"upload_mbps,omitempty"`
	LatencyMs     *int      `json:"latency_ms,omitempty"`
	DownloadBytes *int64    `json:"download_bytes,omitempty"`
	UploadBytes   *int64    `json:"upload_bytes,omitempty"`
	DurationSec   *float64  `json:"duration_sec,omitempty"`
	ServerURL     string    `json:"server_url"`
	Error         string    `json:"error,omitempty"`
}

const (
	TracerouteKindOutage  = "outage"
	TracerouteKindHealthy = "healthy"
)

var historyTables = []string{"pings", "events", "traceroutes", "speedtests"}

type Status struct {
	Target               string     `json:"target"`
	Up                   bool       `json:"up"`
	LastRTTMs            *int       `json:"last_rtt_ms"`
	LastPingAt           *time.Time `json:"last_ping_at"`
	FailureActive        bool       `json:"failure_active"`
	ConsecutiveSuccesses int        `json:"consecutive_successes"`
	LastSuccessAt        *time.Time `json:"last_success_at"`
	LastFailureAt        *time.Time `json:"last_failure_at"`
}

func Open(dataDir string) (*DB, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}

	path := filepath.Join(dataDir, "network.db")
	conn, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(1)

	db := &DB{conn: conn}
	if err := db.migrate(); err != nil {
		conn.Close()
		return nil, err
	}
	return db, nil
}

func (db *DB) Close() error {
	return db.conn.Close()
}

func (db *DB) migrate() error {
	schema := `
CREATE TABLE IF NOT EXISTS pings (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	ts TEXT NOT NULL,
	ok INTEGER NOT NULL,
	rtt_ms INTEGER,
	target TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pings_ts ON pings(ts);

CREATE TABLE IF NOT EXISTS events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	ts TEXT NOT NULL,
	type TEXT NOT NULL,
	detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS traceroutes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	ts TEXT NOT NULL,
	output TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traceroutes_ts ON traceroutes(ts);

CREATE TABLE IF NOT EXISTS speedtests (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	ts TEXT NOT NULL,
	download_mbps REAL,
	upload_mbps REAL,
	latency_ms INTEGER,
	download_bytes INTEGER,
	upload_bytes INTEGER,
	duration_sec REAL,
	server_url TEXT NOT NULL DEFAULT '',
	error TEXT
);
CREATE INDEX IF NOT EXISTS idx_speedtests_ts ON speedtests(ts);

CREATE TABLE IF NOT EXISTS ip_lookup_cache (
	ip TEXT PRIMARY KEY,
	isp TEXT NOT NULL DEFAULT '',
	hostname TEXT NOT NULL DEFAULT '',
	looked_up_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
`
	_, err := db.conn.Exec(schema)
	if err != nil {
		return err
	}
	if err := db.ensureColumn("events", "duration_sec", "INTEGER"); err != nil {
		return err
	}
	return db.ensureColumn("traceroutes", "kind", "TEXT NOT NULL DEFAULT 'outage'")
}

func (db *DB) ensureColumn(table, column, colType string) error {
	rows, err := db.conn.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt any
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	_, err = db.conn.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, colType))
	return err
}

func (db *DB) InsertPing(ts time.Time, ok bool, rttMs *int, target string) error {
	var rtt any
	if rttMs != nil {
		rtt = *rttMs
	}
	_, err := db.conn.Exec(
		`INSERT INTO pings (ts, ok, rtt_ms, target) VALUES (?, ?, ?, ?)`,
		ts.UTC().Format(time.RFC3339Nano), boolToInt(ok), rtt, target,
	)
	return err
}

func (db *DB) InsertEvent(ts time.Time, eventType, detail string, durationSec *int) error {
	var duration any
	if durationSec != nil {
		duration = *durationSec
	}
	_, err := db.conn.Exec(
		`INSERT INTO events (ts, type, detail, duration_sec) VALUES (?, ?, ?, ?)`,
		ts.UTC().Format(time.RFC3339Nano), eventType, detail, duration,
	)
	return err
}

func (db *DB) InsertTraceroute(ts time.Time, output, kind string) error {
	if kind == "" {
		kind = TracerouteKindOutage
	}
	_, err := db.conn.Exec(
		`INSERT INTO traceroutes (ts, output, kind) VALUES (?, ?, ?)`,
		ts.UTC().Format(time.RFC3339Nano), output, kind,
	)
	return err
}

func (db *DB) deleteFromTable(table, where string, args ...any) (int64, error) {
	query := fmt.Sprintf("DELETE FROM %s", table)
	if where != "" {
		query += " WHERE " + where
	}
	res, err := db.conn.Exec(query, args...)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (db *DB) PurgeOlderThan(days int) (int64, error) {
	if days <= 0 {
		return 0, nil
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -days).Format(time.RFC3339Nano)
	var total int64

	for _, table := range historyTables {
		n, err := db.deleteFromTable(table, "ts < ?", cutoff)
		if err != nil {
			return total, err
		}
		total += n
	}
	return total, nil
}

// DataCoverageDays returns how many days ago the oldest ping was recorded.
func (db *DB) DataCoverageDays() (days float64, hasData bool, err error) {
	var minTS sql.NullString
	if err := db.conn.QueryRow(`SELECT MIN(ts) FROM pings`).Scan(&minTS); err != nil {
		return 0, false, fmt.Errorf("query oldest ping: %w", err)
	}
	if !minTS.Valid {
		return 0, false, nil
	}
	minT := parseStoredTimestamp(minTS.String)
	days = time.Since(minT).Hours() / 24
	if days < 0 {
		days = 0
	}
	return days, true, nil
}

// DataSpanDays returns the span in days between the oldest and newest ping, if any.
func (db *DB) DataSpanDays() (days float64, hasData bool, err error) {
	var minTS, maxTS sql.NullString
	if err := db.conn.QueryRow(`SELECT MIN(ts), MAX(ts) FROM pings`).Scan(&minTS, &maxTS); err != nil {
		return 0, false, fmt.Errorf("query data span: %w", err)
	}
	if !minTS.Valid || !maxTS.Valid {
		return 0, false, nil
	}
	minT := parseStoredTimestamp(minTS.String)
	maxT := parseStoredTimestamp(maxTS.String)
	if maxT.Before(minT) {
		return 0, false, nil
	}
	span := maxT.Sub(minT).Hours() / 24
	if span < 0 {
		span = 0
	}
	return span, true, nil
}

// PingTimeBounds returns the oldest and newest ping timestamps, if any.
func (db *DB) PingTimeBounds() (oldest, newest time.Time, hasData bool, err error) {
	var minTS, maxTS sql.NullString
	if err := db.conn.QueryRow(`SELECT MIN(ts), MAX(ts) FROM pings`).Scan(&minTS, &maxTS); err != nil {
		return time.Time{}, time.Time{}, false, fmt.Errorf("query ping bounds: %w", err)
	}
	if !minTS.Valid || !maxTS.Valid {
		return time.Time{}, time.Time{}, false, nil
	}
	oldest = parseStoredTimestamp(minTS.String)
	newest = parseStoredTimestamp(maxTS.String)
	if newest.Before(oldest) {
		return time.Time{}, time.Time{}, false, nil
	}
	return oldest, newest, true, nil
}

// DeleteAll removes every row from pings, events, traceroutes, and speedtests.
func (db *DB) DeleteAll() (pings, events, traceroutes, speedtests int64, err error) {
	counts := make([]int64, len(historyTables))
	for i, table := range historyTables {
		n, execErr := db.deleteFromTable(table, "", nil)
		if execErr != nil {
			err = fmt.Errorf("delete from %s: %w", table, execErr)
			return
		}
		counts[i] = n
	}
	return counts[0], counts[1], counts[2], counts[3], nil
}

func (db *DB) InsertSpeedTest(
	ts time.Time,
	downloadMbps, uploadMbps *float64,
	latencyMs int,
	downloadBytes, uploadBytes int64,
	durationSec float64,
	serverURL, errStr string,
) error {
	var downloadVal, uploadVal any
	if downloadMbps != nil {
		downloadVal = *downloadMbps
	}
	if uploadMbps != nil {
		uploadVal = *uploadMbps
	}
	var latency any
	if latencyMs > 0 {
		latency = latencyMs
	}
	var errVal any
	if errStr != "" {
		errVal = errStr
	}
	_, err := db.conn.Exec(
		`INSERT INTO speedtests (
			ts, download_mbps, upload_mbps, latency_ms,
			download_bytes, upload_bytes, duration_sec, server_url, error
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ts.UTC().Format(time.RFC3339Nano),
		downloadVal, uploadVal, latency,
		downloadBytes, uploadBytes, durationSec, serverURL, errVal,
	)
	return err
}

func (db *DB) ListSpeedTests(from, to time.Time, limit int) ([]SpeedTest, error) {
	if limit <= 0 {
		limit = 5000
	}
	fromBound, toBound := queryTimeBounds(from, to)
	if useBucket, bucketSec := bucketSecForRange(from, to, limit); useBucket {
		return db.listSpeedTestsBucketed(fromBound, toBound, bucketSec)
	}
	return db.listSpeedTestsAll(fromBound, toBound, limit)
}

func (db *DB) listSpeedTestsAll(fromBound, toBound string, limit int) ([]SpeedTest, error) {
	rows, err := db.conn.Query(
		`SELECT ts, download_mbps, upload_mbps, latency_ms,
		        download_bytes, upload_bytes, duration_sec, server_url, error
		 FROM speedtests
		 WHERE ts >= ? AND ts <= ?
		 ORDER BY ts ASC
		 LIMIT ?`,
		fromBound,
		toBound,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSpeedTestRows(rows)
}

func (db *DB) listSpeedTestsBucketed(fromBound, toBound string, bucketSec int) ([]SpeedTest, error) {
	rows, err := db.conn.Query(
		`SELECT s.ts, s.download_mbps, s.upload_mbps, s.latency_ms,
		        s.download_bytes, s.upload_bytes, s.duration_sec, s.server_url, s.error
		 FROM speedtests s
		 INNER JOIN (
		   SELECT MAX(id) AS id
		   FROM speedtests
		   WHERE ts >= ? AND ts <= ?
		   GROUP BY (unixepoch(ts) / ?)
		 ) buckets ON s.id = buckets.id
		 ORDER BY s.ts ASC`,
		fromBound,
		toBound,
		bucketSec,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSpeedTestRows(rows)
}

func scanSpeedTestRows(rows *sql.Rows) ([]SpeedTest, error) {
	out := make([]SpeedTest, 0)
	for rows.Next() {
		var tsStr, serverURL string
		var download, upload, duration sql.NullFloat64
		var latency sql.NullInt64
		var dlBytes, ulBytes sql.NullInt64
		var errText sql.NullString
		if err := rows.Scan(
			&tsStr, &download, &upload, &latency,
			&dlBytes, &ulBytes, &duration, &serverURL, &errText,
		); err != nil {
			return nil, fmt.Errorf("scan speedtest row: %w", err)
		}
		st := SpeedTest{TS: parseStoredTimestamp(tsStr), ServerURL: serverURL}
		if download.Valid {
			v := download.Float64
			st.DownloadMbps = &v
		}
		if upload.Valid {
			v := upload.Float64
			st.UploadMbps = &v
		}
		if latency.Valid {
			v := int(latency.Int64)
			st.LatencyMs = &v
		}
		if dlBytes.Valid {
			v := dlBytes.Int64
			st.DownloadBytes = &v
		}
		if ulBytes.Valid {
			v := ulBytes.Int64
			st.UploadBytes = &v
		}
		if duration.Valid {
			v := duration.Float64
			st.DurationSec = &v
		}
		if errText.Valid {
			st.Error = errText.String
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

func (db *DB) ListPings(from, to time.Time, limit int) ([]Ping, error) {
	if limit <= 0 {
		limit = 5000
	}
	fromBound, toBound := queryTimeBounds(from, to)
	if useBucket, bucketSec := bucketSecForRange(from, to, limit); useBucket {
		return db.listPingsBucketed(fromBound, toBound, bucketSec)
	}
	return db.listPingsAll(fromBound, toBound, limit)
}

func (db *DB) listPingsAll(fromBound, toBound string, limit int) ([]Ping, error) {
	rows, err := db.conn.Query(
		`SELECT ts, ok, rtt_ms, target FROM pings
		 WHERE ts >= ? AND ts <= ?
		 ORDER BY ts ASC
		 LIMIT ?`,
		fromBound,
		toBound,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPingRows(rows)
}

// listPingsBucketed returns one ping per fixed UTC time bucket across the full
// range. Buckets are anchored to absolute epoch time so refreshes stay stable
// as the sliding window moves and new pings arrive (only the newest buckets change).
func (db *DB) listPingsBucketed(fromBound, toBound string, bucketSec int) ([]Ping, error) {
	rows, err := db.conn.Query(
		`SELECT p.ts, p.ok, p.rtt_ms, p.target
		 FROM pings p
		 INNER JOIN (
		   SELECT MAX(id) AS id
		   FROM pings
		   WHERE ts >= ? AND ts <= ?
		   GROUP BY (unixepoch(ts) / ?)
		 ) buckets ON p.id = buckets.id
		 ORDER BY p.ts ASC`,
		fromBound,
		toBound,
		bucketSec,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPingRows(rows)
}

func scanPingRows(rows *sql.Rows) ([]Ping, error) {
	out := make([]Ping, 0)
	for rows.Next() {
		var tsStr string
		var okInt int
		var rtt sql.NullInt64
		var target string
		if err := rows.Scan(&tsStr, &okInt, &rtt, &target); err != nil {
			return nil, fmt.Errorf("scan ping row: %w", err)
		}
		ts := parseStoredTimestamp(tsStr)
		p := Ping{TS: ts, OK: okInt == 1, Target: target}
		if rtt.Valid {
			v := int(rtt.Int64)
			p.RTTMs = &v
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (db *DB) ListEvents(from, to time.Time) ([]Event, error) {
	fromBound, toBound := queryTimeBounds(from, to)
	rows, err := db.conn.Query(
		`SELECT ts, type, detail, duration_sec FROM events
		 WHERE ts >= ? AND ts <= ?
		 ORDER BY ts ASC`,
		fromBound,
		toBound,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Event, 0)
	for rows.Next() {
		var tsStr, eventType, detail string
		var duration sql.NullInt64
		if err := rows.Scan(&tsStr, &eventType, &detail, &duration); err != nil {
			return nil, fmt.Errorf("scan event row: %w", err)
		}
		ts := parseStoredTimestamp(tsStr)
		ev := Event{TS: ts, Type: eventType, Detail: detail}
		if duration.Valid {
			sec := int(duration.Int64)
			ev.DurationSec = &sec
			ev.Downtime = FormatDowntime(sec)
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

func FormatDowntime(totalSec int) string {
	if totalSec < 0 {
		totalSec = 0
	}
	hours := totalSec / 3600
	minutes := (totalSec % 3600) / 60
	seconds := totalSec % 60
	return fmt.Sprintf("%d hours, %d minutes, %d seconds", hours, minutes, seconds)
}

func (db *DB) ListTraceroutesByRange(from, to time.Time) ([]Traceroute, error) {
	fromBound, toBound := queryTimeBounds(from, to)
	rows, err := db.conn.Query(
		`SELECT ts, output, COALESCE(NULLIF(kind, ''), 'outage') FROM traceroutes
		 WHERE ts >= ? AND ts <= ?
		 ORDER BY ts ASC`,
		fromBound,
		toBound,
	)
	if err != nil {
		return nil, fmt.Errorf("query traceroutes: %w", err)
	}
	defer rows.Close()

	out := make([]Traceroute, 0)
	for rows.Next() {
		var tsStr, output, kind string
		if err := rows.Scan(&tsStr, &output, &kind); err != nil {
			return nil, fmt.Errorf("scan traceroute row: %w", err)
		}
		if kind == "" {
			kind = TracerouteKindOutage
		}
		out = append(out, Traceroute{
			TS:     parseStoredTimestamp(tsStr),
			Output: output,
			Kind:   kind,
		})
	}
	return out, rows.Err()
}

func (db *DB) LatestTracerouteByKind(kind string) (*Traceroute, error) {
	var row *sql.Row
	if kind == TracerouteKindOutage {
		row = db.conn.QueryRow(
			`SELECT ts, output, COALESCE(NULLIF(kind, ''), 'outage') FROM traceroutes
			 WHERE kind = 'outage' OR kind IS NULL OR kind = ''
			 ORDER BY ts DESC LIMIT 1`,
		)
	} else {
		row = db.conn.QueryRow(
			`SELECT ts, output, kind FROM traceroutes
			 WHERE kind = ?
			 ORDER BY ts DESC LIMIT 1`,
			kind,
		)
	}

	var tsStr, output, storedKind string
	if err := row.Scan(&tsStr, &output, &storedKind); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("scan traceroute row: %w", err)
	}
	ts := parseStoredTimestamp(tsStr)
	if storedKind == "" {
		storedKind = TracerouteKindOutage
	}
	return &Traceroute{TS: ts, Output: output, Kind: storedKind}, nil
}

func (db *DB) Summary(target string, from, to time.Time) (total, okCount int, avgRTT float64, err error) {
	fromBound, toBound := queryTimeBounds(from, to)
	row := db.conn.QueryRow(
		`SELECT COUNT(*),
		        COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0),
		        COALESCE(AVG(CASE WHEN ok = 1 THEN rtt_ms END), 0)
		 FROM pings
		 WHERE target = ? AND ts >= ? AND ts <= ?`,
		target,
		fromBound,
		toBound,
	)
	if err = row.Scan(&total, &okCount, &avgRTT); err != nil {
		return
	}
	return
}

// PingJitterMs returns the mean absolute difference between consecutive RTT
// values from the last limit successful pings, rounded to one decimal place.
// Returns 0 when fewer than two RTT samples are available.
func (db *DB) PingJitterMs(target string, limit int) (float64, error) {
	if limit < 2 {
		return 0, nil
	}

	rows, err := db.conn.Query(
		`SELECT rtt_ms FROM pings
		 WHERE target = ? AND ok = 1 AND rtt_ms IS NOT NULL
		 ORDER BY ts DESC
		 LIMIT ?`,
		target,
		limit,
	)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	rtts := make([]int, 0, limit)
	for rows.Next() {
		var rtt int
		if err := rows.Scan(&rtt); err != nil {
			return 0, err
		}
		rtts = append(rtts, rtt)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(rtts) < 2 {
		return 0, nil
	}

	for i, j := 0, len(rtts)-1; i < j; i, j = i+1, j-1 {
		rtts[i], rtts[j] = rtts[j], rtts[i]
	}

	var sum float64
	for i := 1; i < len(rtts); i++ {
		diff := float64(rtts[i] - rtts[i-1])
		if diff < 0 {
			diff = -diff
		}
		sum += diff
	}
	return math.Round(sum/float64(len(rtts)-1)*10) / 10, nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func queryTimeBounds(from, to time.Time) (string, string) {
	return from.UTC().Format(time.RFC3339Nano), to.UTC().Format(time.RFC3339Nano)
}

func rangeDurationSec(from, to time.Time) int {
	sec := int(to.Sub(from).Seconds())
	if sec < 1 {
		return 1
	}
	return sec
}

// bucketSecForRange returns whether the query range exceeds limit rows and the
// bucket width in seconds when bucketing is required.
func bucketSecForRange(from, to time.Time, limit int) (useBucket bool, bucketSec int) {
	durationSec := rangeDurationSec(from, to)
	if durationSec <= limit {
		return false, 0
	}
	bucketSec = (durationSec + limit - 1) / limit
	if bucketSec < 1 {
		bucketSec = 1
	}
	return true, bucketSec
}
