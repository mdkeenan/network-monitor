---
name: connectwatch-release
description: Ship a new ConnectWatch version via GitHub Releases and update-manifest.json. Use when the user asks to release, ship, bump version, or publish ConnectWatch.exe.
---

# ConnectWatch release

## Prerequisites

- `gh auth login` completed
- Working tree clean (or only intentional release file changes)
- Version approved by the user before running the script

## Preferred: release script

```powershell
.\scripts\release.ps1 -Version v1.0.4 -Notes "Describe what changed."
```

The script:

1. Patches `build.ps1` ldflags version and `update-manifest.json`
2. Runs `.\build.ps1`
3. Commits, tags, pushes, and runs `gh release create` with `ConnectWatch.exe`

## Manual checklist

If not using the script:

1. Bump `-X main.version=vX.Y.Z` in `build.ps1`
2. `.\build.ps1`
3. `git tag -a vX.Y.Z -m "Release vX.Y.Z"` and `git push origin vX.Y.Z`
4. `gh release create vX.Y.Z ConnectWatch.exe --title "vX.Y.Z" --notes "..."`
5. Update `update-manifest.json` version, `download_url`, and `notes`; commit and push to `main`

## Verify

- Manifest URL: `https://raw.githubusercontent.com/mdkeenan/ConnectWatch/main/update-manifest.json`
- In-app: Settings → Check for updates

## Do not

- Commit `ConnectWatch.exe` to git
- Force-push `main`
- Bump version without user confirmation
