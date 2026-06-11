# ConnectWatch Git Reconcile — Cheat Sheet

Script: [`scripts/reconcile-git.ps1`](../scripts/reconcile-git.ps1)  
Skill: [`.cursor/skills/connectwatch-reconcile-git/`](../.cursor/skills/connectwatch-reconcile-git/SKILL.md)

## One command (terminal)

**Preview** (always run this first — always safe to run):

```powershell
# Always safe to run — preview only; add -Apply after reviewing [PLAN]
.\scripts\reconcile-git.ps1 -Commit -Message "YOUR MESSAGE HERE" -Sync -All -Test
```

**Apply** (after you review the `[PLAN]` output — mutates git and GitHub):

```powershell
.\scripts\reconcile-git.ps1 -Commit -Message "YOUR MESSAGE HERE" -Sync -All -Test -Apply
```

**Feature branch + PR** (add `-CreatePr` on apply):

```powershell
.\scripts\reconcile-git.ps1 -Commit -Message "YOUR MESSAGE HERE" -Sync -All -Test -CreatePr -Apply
```

**Already committed — push only:**

```powershell
.\scripts\reconcile-git.ps1 -Sync -Apply
```

## One Cursor prompt

```
Reconcile git: run .\scripts\reconcile-git.ps1 -Commit -Message "<draft from diff>" -Sync -All -Test (preview only). Show me the [PLAN] output. After I say -Apply, rerun with -Apply. Use -CreatePr on feature branches if needed. Not for releases — use release.ps1 for those.
```

Shorter:

```
Reconcile git — preview first, then -Apply when I approve.
```

## Rules of thumb

| Situation | Do this |
|-----------|---------|
| Normal work (commit + push) | Preview command → review → same command + `-Apply` |
| New/untracked files | Include `-All` |
| Feature branch | Add `-CreatePr` on apply |
| Version release | `.\scripts\release.ps1 -Version vX.Y.Z -Notes "..."` (not reconcile) |
| Workflow surface commit (rules, scripts, CI, …) | After `-Apply`: edit guide md if needed → `.\scripts\sync-integration-guide.ps1 -RegeneratePdf -MarkSynced` |
| Status only | `.\scripts\reconcile-git.ps1` (always safe to run — preview only) |

**Without `-Apply` = preview only. With `-Apply` = actually commits/pushes.**

**End of session / between sessions:** see development guide § Session bookends (`docs/notes/connectwatch-development-guide.md` — local only).

## After `-Apply` (workflow surface only)

If the commit touched rules, skills, scripts, CI, e2e, or build/release files (see `connectwatch-project.mdc`):

1. Update `docs/notes/connectwatch-development-guide.md` if commands or workflow changed (local, gitignored).
2. Regenerate PDF and reset sync baseline:

```powershell
.\scripts\sync-integration-guide.ps1 -RegeneratePdf -MarkSynced
```

Check drift anytime (no regen — always safe to run):

```powershell
# Always safe to run — read-only workflow drift check
.\scripts\sync-integration-guide.ps1 -Check
```

This is **local-only** — not part of git push. Skip for routine `internal/` app-only commits.

## Flags (quick reference)

| Flag | Purpose |
|------|---------|
| `-Apply` | Execute the plan (default is preview only) |
| `-Sync` | Pull if behind, push if ahead |
| `-Commit` | Stage and commit (requires `-Message`) |
| `-All` | Stage untracked files too |
| `-Test` | Run `.\scripts\test.ps1` before commit on `-Apply` |
| `-CreatePr` | `gh pr create --fill` on non-`main` branches |
| `-Rebase` | Use `git pull --rebase` when merge would be needed |
