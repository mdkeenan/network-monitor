package tray

// Config controls the system tray on supported platforms.
type Config struct {
	Tooltip      string
	DashboardURL string
	OnQuit       func()
}

// Run blocks until the user exits from the tray menu or the platform requests shutdown.
func Run(cfg Config) {
	runPlatform(cfg)
}
