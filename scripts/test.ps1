# Run ConnectWatch Go unit tests.
#
# Usage:
#   .\scripts\test.ps1
#   .\scripts\test.ps1 -Race
#   .\scripts\test.ps1 -ShowVerbose

[CmdletBinding()]
param(
    [switch]$Race,
    [switch]$ShowVerbose
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$go = Get-Command go -ErrorAction SilentlyContinue
if (-not $go) {
    $defaultGo = "C:\Program Files\Go\bin\go.exe"
    if (Test-Path $defaultGo) {
        $go = Get-Item $defaultGo
    } else {
        throw "Go is not installed or not on PATH."
    }
}

$args = @("test", "./...")
if ($Race) {
    $args += "-race"
}
if ($ShowVerbose) {
    $args += "-v"
}

Write-Host "Running: go $($args -join ' ')" -ForegroundColor Cyan
& $go.Source @args
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "All tests passed." -ForegroundColor Green
