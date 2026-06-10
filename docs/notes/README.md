# ConnectWatch development notes

Reference material for working on this repo with Cursor and GitHub.

| Document | Purpose |
|----------|---------|
| [cursor-coding-notes.md](cursor-coding-notes.md) | General Cursor agent concepts (rules, skills, CI, Playwright, Plan/Debug modes) |
| [connectwatch-workflow.md](connectwatch-workflow.md) | Five-step workflow mapped to this repo |
| [github-settings.md](github-settings.md) | Manual GitHub settings (Bugbot, branch protection) |

## Repo implementations

| Concept | Location |
|---------|----------|
| Always-on project rules | `.cursor/rules/connectwatch-project.mdc`, `dashboard-grid-layout.mdc` |
| Dynamic skills | `.cursor/skills/connectwatch-*/SKILL.md` |
| Build / restart | `build.ps1`, `update-and-run.ps1` |
| Test | `scripts/test.ps1`, `go test ./...` |
| Release | `scripts/release.ps1`, `update-manifest.json` |
| CI | `.github/workflows/ci.yml` |
| Browser e2e | `tests/e2e/` (Playwright) |
