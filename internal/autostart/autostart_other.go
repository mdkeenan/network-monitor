//go:build !windows

package autostart

func setEnabledPlatform(enabled bool) error {
	return nil
}
