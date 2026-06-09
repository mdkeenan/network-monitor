//go:build windows

package server

import (
	"bytes"
	"fmt"
	"net"
	"os/exec"
	"strings"
	"syscall"
)

const createNoWindow = 0x08000000

func detectDefaultGateway(ip string) (string, error) {
	script := fmt.Sprintf(
		`$idx = (Get-NetIPAddress -IPAddress '%s' -AddressFamily IPv4 -ErrorAction Stop).InterfaceIndex; (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -InterfaceIndex $idx | Where-Object { $_.AddressFamily -eq 'IPv4' } | Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1 -ExpandProperty NextHop)`,
		ip,
	)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("powershell gateway lookup: %w: %s", err, strings.TrimSpace(stderr.String()))
	}

	gateway := strings.TrimSpace(stdout.String())
	if gateway == "" {
		return "", fmt.Errorf("empty gateway")
	}
	if net.ParseIP(gateway) == nil {
		return "", fmt.Errorf("invalid gateway: %q", gateway)
	}
	return gateway, nil
}
