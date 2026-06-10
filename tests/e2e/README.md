# ConnectWatch Playwright e2e tests

Dashboard smoke tests against a running ConnectWatch instance.

## Prerequisites

- Node.js 22+
- ConnectWatch listening on `http://127.0.0.1:8080` (default `web_port`)

## Run locally

```powershell
# Terminal 1
.\update-and-run.ps1 -Background

# Terminal 2
cd tests\e2e
npm install
npx playwright install chromium
npm test
```

Override base URL:

```powershell
$env:CONNECTWATCH_BASE_URL = "http://127.0.0.1:9090"
npm test
```

## CI

The `windows-e2e` job in `.github/workflows/ci.yml` builds the exe, starts it, and runs this suite.
