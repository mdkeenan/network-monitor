package server

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
)

func pickFolderPath() (string, error) {
	if runtime.GOOS != "windows" {
		return "", fmt.Errorf("folder picker is only available on Windows; enter the path manually")
	}

	script := strings.Join([]string{
		"Add-Type -AssemblyName System.Windows.Forms",
		"$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
		"$dialog.Description = 'Select a folder for Network Monitor data'",
		"$dialog.ShowNewFolderButton = $true",
		"if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }",
		"[Console]::Out.Write($dialog.SelectedPath)",
	}, "; ")

	cmd := exec.Command("powershell.exe", "-NoProfile", "-STA", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 2 {
			return "", fmt.Errorf("folder selection cancelled")
		}
		return "", fmt.Errorf("folder picker failed: %w", err)
	}

	path := strings.TrimSpace(string(out))
	if path == "" {
		return "", fmt.Errorf("no folder was selected")
	}
	return path, nil
}
