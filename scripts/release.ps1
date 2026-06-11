# Ship a ConnectWatch release to GitHub.
#
# Usage:
#   .\scripts\release.ps1 -Version v1.0.4 -Notes "Bug fixes and improvements."
#   .\scripts\release.ps1 -Version v1.0.4 -Notes "..." -SkipPush

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [string]$Notes,

    [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

Import-Module (Join-Path $PSScriptRoot 'ConnectWatch.Common.psm1') -Force

if ($Version -notmatch '^v\d+\.\d+\.\d+$') {
    throw "Version must look like v1.0.4 (got: $Version)"
}

$gh = Get-GhExecutable
& $gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "gh is not authenticated. Run: gh auth login"
}

$buildPs1 = Join-Path $repoRoot "build.ps1"
$manifestPath = Join-Path $repoRoot "update-manifest.json"

Write-Host "Updating build.ps1 version to $Version..." -ForegroundColor Cyan
$buildContent = Get-Content $buildPs1 -Raw
$buildContent = $buildContent -replace '-X main\.version=v[^ ]+', "-X main.version=$Version"
Set-Content $buildPs1 $buildContent -NoNewline

$downloadUrl = "https://github.com/mdkeenan/ConnectWatch/releases/download/$Version/ConnectWatch.exe"
[ordered]@{
    version      = $Version
    download_url = $downloadUrl
    notes        = $Notes
} | ConvertTo-Json | Set-Content $manifestPath -Encoding utf8

Write-Host "Building ConnectWatch.exe..." -ForegroundColor Cyan
& $buildPs1
if ($LASTEXITCODE -ne 0) {
    throw "build.ps1 failed with exit code $LASTEXITCODE"
}

$exePath = Join-Path $repoRoot "ConnectWatch.exe"
if (-not (Test-Path $exePath)) {
    throw "ConnectWatch.exe was not produced by the build."
}

Write-Host "Committing release metadata..." -ForegroundColor Cyan
git add build.ps1 update-manifest.json
git commit -m "Release $Version" -m $Notes

if (-not $SkipPush) {
    Write-Host "Pushing main and creating tag $Version..." -ForegroundColor Cyan
    git push origin main
    git tag -a $Version -m "Release $Version"
    git push origin $Version

    Write-Host "Creating GitHub release..." -ForegroundColor Cyan
    & $gh release create $Version $exePath --title $Version --notes $Notes
    if ($LASTEXITCODE -ne 0) {
        throw "gh release create failed with exit code $LASTEXITCODE"
    }
} else {
    Write-Host "Skipping push (-SkipPush). Tag and release not created." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Release $Version complete." -ForegroundColor Green
Write-Host "Manifest: https://raw.githubusercontent.com/mdkeenan/ConnectWatch/main/update-manifest.json" -ForegroundColor DarkGray
