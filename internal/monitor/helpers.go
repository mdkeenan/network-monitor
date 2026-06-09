package monitor

import (
	"log"
	"time"
)

func formatTime(t *time.Time) string {
	if t == nil {
		return "unknown"
	}
	return t.Format("2006-01-02 15:04:05")
}

func logTextWriteErr(err error) {
	if err != nil {
		log.Printf("text log: %v", err)
	}
}

func logDBWriteErr(action string, err error) {
	if err != nil {
		log.Printf("%s: %v", action, err)
	}
}
