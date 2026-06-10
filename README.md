# ConnectWatch

![ConnectWatch banner](docs/images/readme-banner.png)

**Self-contained Windows connectivity monitoring** — ping, traceroute, speed tests, and a local browser dashboard. No installer, no cloud account, no external database.

[![Go 1.22](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![Windows](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Overview

ConnectWatch is a portable Windows application that runs quietly in the system tray and records internet health over time. It pings a configurable target every second, runs traceroutes on a schedule (and during confirmed outages), performs periodic speed tests, and stores everything locally in SQLite.

Open the built-in dashboard at `http://127.0.0.1:8080/` to review latency history, availability, jitter, route changes, public IP shifts, and export your data.

![Dashboard preview](docs/images/dashboard-preview.png)

---

## Features

### Monitoring
- **Continuous ping** — 1-second interval by default; configurable target host
- **Outage detection** — requires consecutive failures before marking DOWN; optional verification delay
- **Traceroute** — routine healthy-path traces plus captures during confirmed outages
- **Speed tests** — scheduled and on-demand download/upload tests via configurable CDN endpoints
- **Public IP tracking** — detects public IP changes with provider echo-service status
- **Private IP display** — local address, subnet mask, and default gateway in the dashboard header

### Dashboard
- **Summary cards** — status, availability, avg RTT, jitter, last outage, speed test results (customizable)
- **Network Status Timeline** — interactive RTT chart with outage highlighting; optional pop-out view
- **Up/Down breakdown** — pie chart for the selected time range
- **Event list** — outages, recoveries, public IP changes, and more
- **Traceroute panels** — last successful path vs. latest outage trace
- **Customizable layout** — show/hide widgets, drag-and-resize grid in edit mode; preferences saved in the browser

### Application
- **System tray** — background operation with no console window
- **Single instance** — prevents duplicate copies fighting for the same port
- **Portable** — single `ConnectWatch.exe`; creates `config.yaml` and `data\` on first run
- **Local-only** — dashboard binds to `127.0.0.1`; data never leaves your machine unless you export it
- **Retention** — automatic purge of records older than configured days (default 365)
- **Text log** — human-readable append-only log alongside SQLite
- **Update checks** — optional manifest-based update checking with instance ID header
- **Windows autostart** — optional “Run at Windows startup” in Settings

---

## Architecture

![Architecture diagram](docs/images/architecture.png)

| Layer | Technology |
|-------|------------|
| Core app | Go 1.22, `CGO_ENABLED=0`, pure Go |
| Storage | SQLite (`modernc.org/sqlite`) + text log |
| Web UI | Embedded HTML/CSS/JS, Chart.js |
| Tray | `fyne.io/systray` |

The web UI is embedded in the binary (`//go:embed`). The dashboard talks to a local REST API; the monitor goroutine writes probe results to the database independently.

---

## Quick start

### Requirements
- **Windows 10/11** (amd64)
- No separate runtime — the release build is a single `.exe`

### Run
1. Download or build `ConnectWatch.exe`
2. Double-click `ConnectWatch.exe` — it appears in the system tray
3. Open **http://127.0.0.1:8080/** in your browser

On first run the app creates `config.yaml`, a `data\` folder, the SQLite database, and log files next to the executable. No installer and no separate config file to ship.

Right-click the tray icon to exit.

### Portable layout
After first run:
```
ConnectWatch/
├── ConnectWatch.exe
├── config.yaml              (created on first launch)
└── data/                    (created on first launch)
    ├── network.db
    ├── ConnectWatch_Log.txt
    └── ConnectWatch-app.log
```

---

## Build from source

Requires [Go 1.22+](https://go.dev/dl/).

```powershell
git clone https://github.com/mdkeenan/ConnectWatch.git
cd ConnectWatch
.\build.ps1
```

This produces `ConnectWatch.exe` with version `v1.0.0` and today's build date baked in via ldflags.

### Rebuild and restart (development)
```powershell
.\update-and-run.ps1 -Background -OpenBrowser
```

| Flag | Effect |
|------|--------|
| `-Background` | Run detached (no console) |
| `-OpenBrowser` | Open dashboard after start |
| `-SkipBuild` | Restart without recompiling |
| `-Test` | Run `go test ./...` after build, before start |

### Development

- **Run tests:** `.\scripts\test.ps1`
- **Ship a release:** `.\scripts\release.ps1 -Version v1.0.4 -Notes "..."` (requires `gh auth login`)
- **Dashboard e2e:** `cd tests\e2e && npm install && npm test` (app must be running on port 8080)

---

## Configuration

Settings live in `config.yaml` next to the executable. Key options:

| Setting | Default | Description |
|---------|---------|-------------|
| `target` | `8.8.8.8` | Host or IP to ping |
| `ping_interval_sec` | `1` | Seconds between pings |
| `trace_interval_sec` | `30` | Traceroute interval during instability |
| `healthy_trace_interval_sec` | `300` | Traceroute interval when UP |
| `required_successes` | `5` | Consecutive successes before UP |
| `verify_delay_sec` | `5` | Delay before outage verification trace |
| `web_port` | `8080` | Dashboard port (`127.0.0.1` only) |
| `data_dir` | `data` | SQLite and logs directory |
| `retention_days` | `365` | Auto-purge age for stored records |
| `speedtest_interval_min` | `60` | Minutes between scheduled speed tests |
| `auto_check_updates` | `true` | Check for updates on startup |
| `run_at_startup` | `true` | Register app in Windows login startup |
| `update_manifest_url` | See `config.yaml` | URL of JSON update manifest ([`update-manifest.json`](update-manifest.json)) |

Most settings can also be changed from **Settings** in the dashboard UI. The manifest URL is configured in `config.yaml` only.

---

## API (local)

All endpoints are on `http://127.0.0.1:<web_port>/api/`.

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Current monitor state |
| `GET /api/summary` | Summary metrics (availability, RTT, jitter, …) |
| `GET /api/pings` | Ping history for charts |
| `GET /api/events` | Event log |
| `GET /api/version` | Version and instance ID |
| `GET /api/public-ip` | Public IP and ISP info |
| `GET /api/private-ip` | Local network info |
| `GET /api/speedtest/*` | Speed test config, results, upload |
| `GET /api/export` | Data export |
| `GET /api/settings` | Read/write settings |

---

## Instance ID

Each installation has a compound instance ID shown in **Settings → About**:

```
<INSTANCE>-<VERSION>-<BUILD>-<INTEGRITY>
```

Only the instance segment is persisted; version, build date, and integrity hash are recomputed at startup. The full ID is sent as `X-Instance-ID` when checking for updates.

---

## Development

```powershell
go test ./...
.\build.ps1
```

### Project layout
```
├── main.go                 Entry point, tray, HTTP server
├── config.yaml             Default configuration
├── build.ps1               Production build script
├── update-manifest.json    Update manifest for in-app version checks
├── internal/
│   ├── monitor/            Ping, traceroute, speed test loops
│   ├── database/           SQLite schema and queries
│   ├── server/             HTTP API + embedded web UI
│   ├── config/             YAML config load/save
│   ├── instanceid/         Compound instance ID
│   ├── updates/            Update manifest checking
│   ├── publicip/             Public IP watcher
│   └── tray/                 System tray icon
└── docs/images/            README screenshots and diagrams
```

---

## Releasing

ConnectWatch checks for updates by fetching [`update-manifest.json`](update-manifest.json) from GitHub. The app compares the manifest `version` to the version baked into `ConnectWatch.exe` at build time.

### Manifest format

```json
{
  "version": "v1.0.0",
  "download_url": "https://github.com/mdkeenan/ConnectWatch/releases/download/v1.0.0/ConnectWatch.exe",
  "notes": "Optional message shown in Settings when an update is available."
}
```

The manifest is served from:

`https://raw.githubusercontent.com/mdkeenan/ConnectWatch/main/update-manifest.json`

Users point `update_manifest_url` in `config.yaml` at that URL (included in the repo template).

### Ship a new version

1. **Bump the build version** in `build.ps1`:
   ```powershell
   # Change: -X main.version=v1.0.0
   # To:     -X main.version=v1.0.1
   ```
2. **Build** the executable:
   ```powershell
   .\build.ps1
   ```
3. **Create a GitHub Release** tagged `v1.0.1` and upload `ConnectWatch.exe` as a release asset.
4. **Update `update-manifest.json`** on `main` with the new version and download URL:
   ```json
   {
     "version": "v1.0.1",
     "download_url": "https://github.com/mdkeenan/ConnectWatch/releases/download/v1.0.1/ConnectWatch.exe",
     "notes": "Describe what changed."
   }
   ```
5. **Commit and push** the manifest change.

Installations with `auto_check_updates: true` will see the update on next startup or when the user clicks **Check for updates** in Settings. The app does not auto-install — it reports the `download_url` in the status message.

### Verify update checking

1. Ensure `config.yaml` includes `update_manifest_url` (see repo template).
2. Open the dashboard → **Settings**.
3. Click **Check for updates**.

| Result | Meaning |
|--------|---------|
| “You are running the latest version” | Manifest version matches your build |
| “Update available: …” | A newer version is published in the manifest |
| “No update source is configured” | `update_manifest_url` is empty |
| HTTP or parse error | Manifest not pushed yet, repo is private, or JSON is invalid |

> **Note:** Builds without ldflags report version `dev` (treated as older than any `v1.x.x` release). Use `.\build.ps1` when testing update checks.

---

## License

MIT — see [LICENSE](LICENSE).

Copyright © 2026 [Michael Keenan](https://www.linkedin.com/in/michaeldkeenan/)

---

## Author

Built by **Michael Keenan** — feedback and contributions welcome via [GitHub Issues](https://github.com/mdkeenan/ConnectWatch/issues).
