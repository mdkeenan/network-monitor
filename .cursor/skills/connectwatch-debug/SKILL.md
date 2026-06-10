---
name: connectwatch-debug
description: Debug ConnectWatch runtime issues — outages, probes, API errors, tray app crashes. Use when investigating bugs, failed pings, dashboard errors, or intermittent failures.
---

# ConnectWatch debugging

## Reproduce first

1. Run `.\update-and-run.ps1 -Background` (or reproduce on the user's installed copy).
2. Trigger the bug with specific steps; note target host, port, and time.

## Evidence (paste full output to the agent)

| Source | Path / URL |
|--------|------------|
| App log | `data/ConnectWatch-app.log` |
| Text log | `data/ConnectWatch_Log.txt` |
| Live status | `GET http://127.0.0.1:8080/api/status` |
| Config | `config.yaml` next to the executable |

## Debug mode loop

1. Form hypotheses (race, port conflict, DB lock, probe timeout, JS error).
2. Instrument or inspect — Go logs, browser console, network tab.
3. User reproduces while agent watches evidence.
4. Targeted fix; remove temporary instrumentation.
5. Add regression test (`*_test.go` or Playwright).

## Common issues

- **Port in use** — another process on `web_port`; `update-and-run.ps1` stops ConnectWatch listeners first.
- **Stale dashboard** — embedded assets; rebuild exe after web changes.
- **Single instance** — second copy blocked; check system tray.

## Go debugging

```powershell
go test ./internal/... -run TestName -v
.\scripts\test.ps1
```

For dashboard-only bugs, prefer Playwright + IDE browser over guessing from static JS.
