---
name: connectwatch-dashboard
description: Work on the ConnectWatch embedded dashboard (grid layout, widgets, charts, edit mode). Use for dashboard UI, widgets.js, app.js layout code, or style.css dashboard sections.
---

# ConnectWatch dashboard development

## Files

- `internal/server/web/index.html` — structure
- `internal/server/web/widgets.js` — grid layout, widget prefs, edit mode
- `internal/server/web/app.js` — charts, API polling, settings
- `internal/server/web/style.css` — dashboard grid and panel styles

## Mandatory rules

Read and follow `.cursor/rules/dashboard-grid-layout.mdc` — grid invariants, inset, edit mode, localStorage keys.

## Dev loop

```powershell
.\update-and-run.ps1 -Background -OpenBrowser
```

Open `http://127.0.0.1:8080/` in the IDE browser for visual verification (Design Mode equivalent).

After web file changes: rebuild exe + Ctrl+F5 hard refresh.

## Edit mode entry

Customize dashboard → **Show and edit grid** → Apply / Cancel in header.

## Regression tests

Add or update specs in `tests/e2e/dashboard.spec.ts` and `tests/e2e/grid-edit.spec.ts` for UI behavior changes.

## README screenshots

Capture from the live dashboard → crop/resize → `docs/images/dashboard-preview.png`. Commit separately from code when refreshing marketing assets.
