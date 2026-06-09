//go:build !windows

package server

import "fmt"

func detectDefaultGateway(ip string) (string, error) {
	return "", fmt.Errorf("default gateway lookup is only supported on Windows")
}
