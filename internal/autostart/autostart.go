package autostart

// SetEnabled registers or removes the app from Windows startup.
func SetEnabled(enabled bool) error {
	return setEnabledPlatform(enabled)
}
