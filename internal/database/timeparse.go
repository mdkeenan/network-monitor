package database

import "time"

func parseStoredTimestamp(tsStr string) time.Time {
	ts, err := time.Parse(time.RFC3339Nano, tsStr)
	if err != nil {
		ts, _ = time.Parse(time.RFC3339, tsStr)
	}
	return ts
}
