package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"network-monitor/internal/applog"
	"network-monitor/internal/autostart"
	"network-monitor/internal/config"
	"network-monitor/internal/database"
	"network-monitor/internal/monitor"
	"network-monitor/internal/paths"
	"network-monitor/internal/report"
	"network-monitor/internal/server"
	"network-monitor/internal/singleinstance"
	"network-monitor/internal/textlog"
	"network-monitor/internal/tray"
	"network-monitor/internal/updates"
	"network-monitor/internal/winutil"
)

var (
	version   = "dev"
	buildDate string
)

func main() {
	exitCode := run()
	os.Exit(exitCode)
}

func run() (exitCode int) {
	defer func() {
		if report.Recover() {
			exitCode = 1
		}
	}()

	if !singleinstance.TryAcquire() {
		singleinstance.ShowAlreadyRunning()
		return 0
	}
	defer singleinstance.Release()

	baseDir := paths.BaseDir()
	cfg, err := config.Load(baseDir)
	if err != nil {
		winutil.ShowError("ConnectWatch", fmt.Sprintf("Could not load config from %s:\n\n%v", filepath.Join(baseDir, "config.yaml"), err))
		return 1
	}

	dataDir := filepath.Join(baseDir, cfg.DataDir)
	if err := applog.Setup(dataDir); err != nil {
		winutil.ShowError("ConnectWatch", err.Error())
		return 1
	}

	if err := autostart.SetEnabled(cfg.RunAtStartup); err != nil {
		log.Printf("autostart: %v", err)
	}

	db, err := database.Open(dataDir)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	if n, err := db.PurgeOlderThan(cfg.RetentionDays); err != nil {
		log.Printf("retention purge: %v", err)
	} else if n > 0 {
		log.Printf("purged %d old records (retention %d days)", n, cfg.RetentionDays)
	}

	textLogPath := cfg.TextLogPath(baseDir)
	textLog, err := textlog.Open(textLogPath)
	if err != nil {
		log.Fatalf("open text log: %v", err)
	}
	log.Printf("Text log: %s", textLogPath)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	mon := monitor.New(cfg, db, textLog)
	report.Go(func() { mon.Run(ctx) })

	srv, err := server.New(baseDir, version, buildDate, cfg, db, mon, textLog)
	if err != nil {
		log.Fatalf("server: %v", err)
	}
	report.ConfigureCrashReporting(cfg.AutoSendCrashReports, cfg.BugReportURL, version, srv.InstanceID())

	addr := fmt.Sprintf("127.0.0.1:%d", cfg.WebPort)
	dashboardURL := fmt.Sprintf("http://%s/", addr)
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	if cfg.AutoCheckUpdates {
		report.Go(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			result, err := updates.Check(ctx, cfg.UpdateManifestURL, version, srv.InstanceID())
			if err != nil {
				log.Printf("automatic update check: %v", err)
				return
			}
			if result.UpdateAvailable {
				log.Printf("update available: %s (current %s)", result.LatestVersion, result.CurrentVersion)
			}
		})
	}

	report.Go(func() {
		log.Printf("Dashboard: %s", dashboardURL)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			msg := fmt.Sprintf("Port %d is already in use. Stop the other ConnectWatch copy (system tray → Exit) or change web_port in config.yaml.", cfg.WebPort)
			log.Printf("web server: %v", err)
			winutil.ShowError("ConnectWatch", msg)
			os.Exit(1)
		}
	})

	var shutdownOnce sync.Once
	shutdown := func() {
		shutdownOnce.Do(func() {
			log.Println("Shutting down...")
			if textLog != nil {
				if err := textLog.Shutdown(time.Now()); err != nil {
					log.Printf("text log: %v", err)
				}
			}
			cancel()

			shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer shutdownCancel()
			_ = httpServer.Shutdown(shutdownCtx)
		})
	}

	tray.Run(tray.Config{
		Tooltip:      fmt.Sprintf("ConnectWatch — %s", dashboardURL),
		DashboardURL: dashboardURL,
		OnQuit:       shutdown,
	})

	return 0
}
