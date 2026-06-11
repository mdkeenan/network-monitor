//go:build !windows

package server

import "fmt"

func pickFolderPath() (string, error) {
	return "", fmt.Errorf("folder picker is only available on Windows; enter the path manually")
}
