# ConnectWatch five-step Cursor workflow

Mapped from [cursor-coding-notes.md](cursor-coding-notes.md) §8 to this repository.

## 1. Understand the codebase

- Core app: `main.go`, `internal/monitor/`, `internal/server/`
- Embedded dashboard: `internal/server/web/` (`app.js`, `widgets.js`, `style.css`, `index.html`)
- Config and paths: `internal/config/`, `config.yaml`, `data/`
- Ask the agent to trace a feature end-to-end (API handler → DB → dashboard widget) before large edits.

## 2. Plan the feature

Use **Plan mode** (Shift+Tab) when the change touches multiple files, layout/versioning, or API contracts.

Good Plan-mode tasks:

- New dashboard widgets or grid layout migrations
- Settings / config schema changes
- Export or retention behavior

Skip Plan mode for one-line fixes and typo edits.

For **dashboard UI**, follow planning with the IDE browser at `http://127.0.0.1:8080/` after `.\update-and-run.ps1 -Background`.

## 3. Debug a failing edge case

Use **Debug mode** when the bug is reproducible but the cause is unclear.

Evidence sources:

- `data/ConnectWatch-app.log` — application log
- `data/ConnectWatch_Log.txt` — human-readable probe/outage log
- Browser devtools / IDE browser for dashboard issues
- Paste full errors to the agent; do not summarize stack traces.

## 4. Review and test

Before opening a PR:

```powershell
.\scripts\test.ps1
.\update-and-run.ps1 -Background
cd tests\e2e && npm test
```

- **Go unit tests** — `internal/**/**/*_test.go`
- **Playwright** — dashboard smoke tests in `tests/e2e/`
- **CI** — GitHub Actions on every push/PR
- **Bugbot** — automated PR review (enable per [github-settings.md](github-settings.md))

Challenge prompts before merging large agent diffs:

- "Is this really the root cause?"
- "Are there other cases we haven't considered?"

## 5. Write a rule

When a gotcha repeats, capture it in `.cursor/rules/` (short, specific) or a `.cursor/skills/` procedure.

Examples already in-repo:

- Dashboard grid invariants → `dashboard-grid-layout.mdc`
- Build, test, release conventions → `connectwatch-project.mdc`

## Release (not auto-push)

Ship versions explicitly — never auto-push `main` from the agent:

```powershell
.\scripts\release.ps1 -Version v1.0.4 -Notes "Describe what changed."
```

See `.cursor/skills/connectwatch-release/SKILL.md`.
