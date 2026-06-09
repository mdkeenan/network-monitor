//go:build !windows

package server

import "os/exec"

func hideExecCmd(cmd *exec.Cmd) {}
