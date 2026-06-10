package applog

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
)

// Setup redirects the standard library logger to an append-only file.
func Setup(dataDir string) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("create log directory: %w", err)
	}

	path := filepath.Join(dataDir, "ConnectWatch-app.log")
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("open app log: %w", err)
	}

	log.SetOutput(io.MultiWriter(file))
	log.SetFlags(log.Ldate | log.Ltime)
	log.Printf("Application log: %s", path)
	return nil
}
