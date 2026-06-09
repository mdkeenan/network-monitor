//go:build !windows

package tray

import (
	"os"
	"os/signal"
	"syscall"
)

func runPlatform(cfg Config) {
	onQuit := cfg.OnQuit
	if onQuit == nil {
		onQuit = func() {}
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	<-sigCh
	onQuit()
}
