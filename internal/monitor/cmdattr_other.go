//go:build !windows

package monitor

import "os/exec"

func configureHiddenCommand(_ *exec.Cmd) {}
