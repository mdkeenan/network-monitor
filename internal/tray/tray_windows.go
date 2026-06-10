//go:build windows

package tray

import (
	"os/exec"
	"syscall"

	"fyne.io/systray"
)

func runPlatform(cfg Config) {
	onQuit := cfg.OnQuit
	if onQuit == nil {
		onQuit = func() {}
	}

	systray.Run(func() {
		systray.SetIcon(iconData)
		systray.SetTitle("ConnectWatch")
		systray.SetTooltip(cfg.Tooltip)

		openItem := systray.AddMenuItem("Open dashboard", "Open the web dashboard in your browser")
		exitItem := systray.AddMenuItem("Exit", "Stop ConnectWatch")

		go func() {
			for {
				select {
				case <-openItem.ClickedCh:
					openDashboard(cfg.DashboardURL)
				case <-exitItem.ClickedCh:
					systray.Quit()
					return
				}
			}
		}()
	}, onQuit)
}

func openDashboard(url string) {
	if url == "" {
		return
	}
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Start()
}
