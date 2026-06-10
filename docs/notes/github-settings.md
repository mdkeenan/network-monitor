# GitHub repository settings (manual)

Complete these steps in the GitHub UI for [mdkeenan/ConnectWatch](https://github.com/mdkeenan/ConnectWatch).

## 1. Enable Bugbot

1. Open the repo on GitHub → **Settings**
2. Find **Bugbot** (or Cursor integration / code review) in the sidebar
3. Enable automated PR review for this repository

Bugbot runs on pull requests and flags likely issues before human review.

## 2. Branch protection on `main`

1. **Settings** → **Branches** → **Add branch protection rule**
2. Branch name pattern: `main`
3. Recommended checks:
   - **Require status checks to pass before merging**
   - Select: `go-test` (and `windows-e2e` when stable)
   - **Require branches to be up to date before merging**
4. Optional: require pull request reviews before merging

## 3. Verify CI badges

After the first workflow run, confirm both jobs appear under **Actions**:

- `go-test` — Ubuntu, `go test` + `go vet` + ShellCheck
- `windows-e2e` — Windows, build exe, Playwright dashboard tests

## 4. Release assets

Releases are created with `scripts/release.ps1` or `gh release create`. The executable is **not** stored in git; users download from GitHub Releases via `update-manifest.json`.
