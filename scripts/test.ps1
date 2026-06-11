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

Import-Module (Join-Path $PSScriptRoot 'ConnectWatch.Common.psm1') -Force

$go = Get-GoExecutable

$args = @("test", "./...")
if ($Race) {
    $args += "-race"
}
if ($ShowVerbose) {
    $args += "-v"
}

Write-Host "Running: go $($args -join ' ')" -ForegroundColor Cyan
& $go @args
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "All tests passed." -ForegroundColor Green
