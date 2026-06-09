package autostart

// EnsureEnabled registers the app to launch automatically when Windows starts.
func EnsureEnabled() error {
	return ensureEnabledPlatform()
}
