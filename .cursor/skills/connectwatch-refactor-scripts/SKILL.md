---
name: connectwatch-refactor-scripts
description: Refactor ConnectWatch PowerShell workflow scripts — consolidate helpers, preserve CLI contracts. Use when refactoring, deduplicating, or cleaning build.ps1, update-and-run.ps1, or scripts/*.ps1.
---

# ConnectWatch PowerShell script refactor

## Scope

**In scope (tracked, CI PSScriptAnalyzer):**

- `build.ps1`
- `update-and-run.ps1`
- `update-and-run.bat` (wrapper only — rarely edited)
- `scripts/test.ps1`
- `scripts/release.ps1`
- `scripts/setup-github-project.ps1`
- `scripts/ConnectWatch.Common.psm1` (shared helpers)

**Out of scope unless explicitly requested:**

- Gitignored guide scripts (`scripts/sync-integration-guide.ps1`, `scripts/build-connectwatch-development-guide.py`)
- `internal/server/web/app.js`, `widgets.js` — stay monolithic; do not split modules
- `window.WidgetDashboard` API and dashboard layout localStorage

## Principles

1. **Consolidate & deduplicate** — shared helpers in `scripts/ConnectWatch.Common.psm1`; remove duplicate Go/gh/config resolution across entry scripts.
2. **Optimize performance** — clarity over micro-opts for PowerShell; no behavior change.
3. **Clean & modernize** — remove dead code; pass PSScriptAnalyzer at Error severity; keep script header usage comments.
4. **Readability & consistency** — match sibling script naming, colors (Cyan steps, Green success, Red errors), and `$ErrorActionPreference = "Stop"`.
5. **Preserve integrity** — stable CLI contracts, exit codes, and build-path semantics (see table below).

## Shared module

Import pattern:

```powershell
# repo root scripts (build.ps1, update-and-run.ps1)
Import-Module (Join-Path $PSScriptRoot 'scripts\ConnectWatch.Common.psm1') -Force

# scripts/*.ps1
Import-Module (Join-Path $PSScriptRoot 'ConnectWatch.Common.psm1') -Force
```

New cross-script helpers go in the module. Any new `.ps1` or `.psm1` under the workflow surface must be added to PSScriptAnalyzer paths in `.github/workflows/ci.yml`.

## Integrity (do not break)

| Surface | Contract |
|---------|----------|
| `build.ps1` | Produces `ConnectWatch.exe`; embeds `-X main.version=…` and `-X main.buildDate=…` via ldflags |
| `update-and-run.ps1` | `-SkipBuild`, `-Background`, `-OpenBrowser`, `-Test`, `-CheckGuide`; dev build **without** version ldflags (binary reports `dev`); exit `1` on failure |
| `update-and-run.bat` | Forwards `%*` to `update-and-run.ps1`; pause on error when not `-Background` |
| `scripts/test.ps1` | `-Race`, `-ShowVerbose`; exit code = `go test` |
| `scripts/release.ps1` | `-Version`, `-Notes`, `-SkipPush`; regex-edits `build.ps1` ldflags; updates `update-manifest.json` |
| `scripts/setup-github-project.ps1` | Idempotent bootstrap; `-ProjectNumber`, `-Owner`, `-Repo` |

**Build paths stay separate:** do not make `update-and-run.ps1` call `build.ps1` — that would embed release version into dev builds.

Process/port lifecycle (`Stop-ConnectWatchInstance`, `Wait-PortFree`, etc.) stays in `update-and-run.ps1` only.

## Verify

```powershell
# PSScriptAnalyzer (mirror CI)
Install-Module PSScriptAnalyzer -Force
$paths = @(
    'build.ps1', 'update-and-run.ps1', 'scripts/ConnectWatch.Common.psm1',
    'scripts/test.ps1', 'scripts/release.ps1', 'scripts/setup-github-project.ps1'
)
$paths | ForEach-Object { Invoke-ScriptAnalyzer -Path $_ -Severity Error }

# Go unit tests
.\scripts\test.ps1
```

Optional smoke (if `ConnectWatch.exe` exists): `.\update-and-run.ps1 -SkipBuild -Background`

After workflow-surface changes, review `docs/notes/connectwatch-development-guide.md` (local) and run `.\scripts\sync-integration-guide.ps1 -Check` if available.
