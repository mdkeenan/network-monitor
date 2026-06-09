//go:build windows

package autostart

import (
	"fmt"
	"os"
	"strings"

	"golang.org/x/sys/windows/registry"
)

const (
	runKeyPath = `Software\Microsoft\Windows\CurrentVersion\Run`
	valueName  = "NetworkMonitor"
)

func setEnabledPlatform(enabled bool) error {
	if enabled {
		return enableAutostart()
	}
	return disableAutostart()
}

func enableAutostart() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable path: %w", err)
	}

	command := exe
	if strings.Contains(exe, " ") {
		command = `"` + exe + `"`
	}

	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("open Run registry key: %w", err)
	}
	defer key.Close()

	current, _, err := key.GetStringValue(valueName)
	if err == nil && current == command {
		return nil
	}

	if err := key.SetStringValue(valueName, command); err != nil {
		return fmt.Errorf("set Run registry value: %w", err)
	}
	return nil
}

func disableAutostart() error {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("open Run registry key: %w", err)
	}
	defer key.Close()

	if err := key.DeleteValue(valueName); err != nil {
		if err == registry.ErrNotExist {
			return nil
		}
		return fmt.Errorf("remove Run registry value: %w", err)
	}
	return nil
}
