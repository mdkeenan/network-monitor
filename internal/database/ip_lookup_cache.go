package database

import (
	"database/sql"
	"fmt"
	"time"
)

type IPLookup struct {
	IP         string
	ISP        string
	Hostname   string
	LookedUpAt time.Time
}

func (db *DB) GetIPLookup(ip string) (*IPLookup, bool, error) {
	var isp, hostname, lookedUpAt string
	err := db.conn.QueryRow(
		`SELECT isp, hostname, looked_up_at FROM ip_lookup_cache WHERE ip = ?`,
		ip,
	).Scan(&isp, &hostname, &lookedUpAt)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("query ip lookup cache: %w", err)
	}
	ts := parseStoredTimestamp(lookedUpAt)
	return &IPLookup{
		IP:         ip,
		ISP:        isp,
		Hostname:   hostname,
		LookedUpAt: ts,
	}, true, nil
}

func (db *DB) UpsertIPLookup(ip, isp, hostname string, lookedUpAt time.Time) error {
	_, err := db.conn.Exec(
		`INSERT INTO ip_lookup_cache (ip, isp, hostname, looked_up_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(ip) DO UPDATE SET
		   isp = excluded.isp,
		   hostname = excluded.hostname,
		   looked_up_at = excluded.looked_up_at`,
		ip,
		isp,
		hostname,
		lookedUpAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return fmt.Errorf("upsert ip lookup cache: %w", err)
	}
	return nil
}
