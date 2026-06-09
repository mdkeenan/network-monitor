//go:build windows

package server

import (
	"os/exec"
	"syscall"
)

const execNoWindow = 0x08000000

func hideExecCmd(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: execNoWindow,
	}
}
