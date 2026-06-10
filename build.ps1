# Build a portable single-file executable (Windows amd64).
# Requires Go 1.22+: https://go.dev/dl/

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Downloading Go module dependencies..." -ForegroundColor Cyan
go mod tidy

Write-Host "Building ConnectWatch.exe (background app, no console window)..." -ForegroundColor Cyan
$buildDate = Get-Date -Format 'yyyyMMdd'
$env:CGO_ENABLED = "0"
go build -ldflags "-s -w -H windowsgui -X main.version=v1.0.2 -X main.buildDate=$buildDate" -o ConnectWatch.exe .

if ($LASTEXITCODE -eq 0) {
    Write-Host "Done. Run .\update-and-run.ps1 -Background to rebuild, restart, and launch." -ForegroundColor Green
    Write-Host "The app runs in the system tray (no console window). Right-click the tray icon to exit." -ForegroundColor Green
    Write-Host "Dashboard: http://127.0.0.1:8080/" -ForegroundColor Green
    Write-Host "Portable: ConnectWatch.exe only (creates config.yaml and data\ on first run)" -ForegroundColor Green
} else {
    exit $LASTEXITCODE
}
