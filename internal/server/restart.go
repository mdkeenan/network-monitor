package server

import (
	"os"
	"os/exec"
	"time"
)

func restartApplication(baseDir string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}

	cmd := exec.Command(exe)
	cmd.Dir = baseDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}

	go func() {
		time.Sleep(400 * time.Millisecond)
		os.Exit(0)
	}()
	return nil
}
