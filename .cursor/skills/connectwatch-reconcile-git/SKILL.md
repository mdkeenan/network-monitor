---
name: connectwatch-reconcile-git
description: Reconcile local ConnectWatch changes with GitHub — status, fetch, pull, stage, commit, push, optional PR. Use when the user asks to commit, sync, push, pull, reconcile, or clean up git state.
---

# ConnectWatch git reconcile

## When to use

Use for **commit / sync / push / pull / reconcile** — aligning local work with GitHub.

Use **connectwatch-release** (not this skill) for version ships: `.\scripts\release.ps1 -Version vX.Y.Z -Notes "..."`.

## Agent workflow

1. **Never commit or push without the user asking.**
2. Run **preview first** (no `-Apply`):
   ```powershell
   .\scripts\reconcile-git.ps1 -Sync
   .\scripts\reconcile-git.ps1 -Commit -Message "Draft message" -Sync -All -Test
   ```
3. Show the user the `=== ConnectWatch git reconcile (PREVIEW) ===` output and `[PLAN]` steps.
4. Draft commit message from `git diff` / `git log -1` style (concise, why not what).
5. After explicit approval, rerun with **`-Apply`** (same flags + message).
6. If workflow-surface files changed (see `connectwatch-project.mdc`), remind about local `.\scripts\sync-integration-guide.ps1 -Check` if available.

## Common commands

**Status only (preview):**

```powershell
.\scripts\reconcile-git.ps1
```

**Sync with remote (preview then apply):**

```powershell
.\scripts\reconcile-git.ps1 -Sync
.\scripts\reconcile-git.ps1 -Sync -Apply
```

**Commit all tracked + untracked, test, sync (typical feature work):**

```powershell
.\scripts\reconcile-git.ps1 -Commit -Message "Add git reconcile skill and script" -Sync -All -Test
.\scripts\reconcile-git.ps1 -Commit -Message "Add git reconcile skill and script" -Sync -All -Test -Apply
```

**Feature branch + PR:**

```powershell
.\scripts\reconcile-git.ps1 -Commit -Message "..." -Sync -All -CreatePr -Apply
```

**On `main`:** push goes to `origin/main`. **Other branches:** push sets/uses upstream; `-CreatePr` runs `gh pr create --fill`.

## Parameters

| Flag | Purpose |
|------|---------|
| `-Apply` | Execute mutating steps (default is preview only) |
| `-Sync` | Plan/execute pull (if behind) + push (if ahead) |
| `-Commit` | Stage and commit (requires `-Message`) |
| `-Message` | Commit subject |
| `-Body` | Optional commit body |
| `-All` | `git add -A` (include untracked); without it only `git add -u` |
| `-Test` | Run `.\scripts\test.ps1` before commit on `-Apply` |
| `-CreatePr` | `gh pr create --fill` on non-main branches |
| `-Rebase` | `git pull --rebase` when merge would be needed |
| `-Pull` / `-Push` | Individual sync steps without full `-Sync` |

## Commit message rules

- 1–2 sentences focused on **why**
- Match recent repo style (`git log -5 --oneline`)
- Never commit: `ConnectWatch.exe`, `*.exe`, `.env`, `credentials.json`, `data/` contents
- Never force-push `main`
- Do not `git commit --amend` unless user rules allow (user requested, your commit, not pushed)

## Safety (script-enforced)

- Blocks `-Apply` if blocked paths are in the working tree
- Warns on secret-like filenames
- No `--force` push
- Pull prefers `--ff-only` when only behind (not diverged)
- Stops on test failure when `-Test -Apply -Commit`
- Does not auto-resolve merge conflicts — report conflict files and stop

## Related scripts

| Script | Role |
|--------|------|
| `scripts/reconcile-git.ps1` | This workflow |
| `scripts/test.ps1` | Optional pre-commit gate (`-Test`) |
| `scripts/release.ps1` | Version releases only |
| `scripts/ConnectWatch.Common.psm1` | `Invoke-Git`, `Invoke-Gh` |

## Do not

- Replace `release.ps1` for shipping versions
- Commit without user request
- Force-push `main`
- Auto-merge PRs or resolve conflicts without user involvement
