#Requires -Version 5.1
<#
.SYNOPSIS
  Check staleness of the local Cursor integration guide and regenerate PDF/HTML.

.DESCRIPTION
  Compares a fingerprint of workflow-related repo files against docs/notes/.integration-guide-sync.
  Does not edit markdown — only detects drift and runs build-integration-guide-pdf.py when asked.

.EXAMPLE
  .\scripts\sync-integration-guide.ps1 -Check
  .\scripts\sync-integration-guide.ps1 -RegeneratePdf -MarkSynced
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$RegeneratePdf,
    [switch]$MarkSynced
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$NotesDir = Join-Path $RepoRoot "docs\notes"
$SidecarPath = Join-Path $NotesDir ".integration-guide-sync"
$GuideMd = Join-Path $NotesDir "cursor-integration-guide.md"
$PdfBuilder = Join-Path $RepoRoot "scripts\build-integration-guide-pdf.py"

function Get-WarrantedGuideFilePaths {
    $paths = [System.Collections.Generic.List[string]]::new()

    $scanDirs = @(
        (Join-Path $RepoRoot ".cursor\rules"),
        (Join-Path $RepoRoot ".cursor\skills"),
        (Join-Path $RepoRoot "scripts"),
        (Join-Path $RepoRoot ".github\workflows"),
        (Join-Path $RepoRoot "tests\e2e")
    )
    foreach ($dir in $scanDirs) {
        if (-not (Test-Path -LiteralPath $dir)) {
            continue
        }
        Get-ChildItem -LiteralPath $dir -Recurse -File | ForEach-Object {
            $paths.Add($_.FullName)
        }
    }

    $rootFiles = @(
        "build.ps1",
        "update-and-run.ps1",
        "update-and-run.bat",
        "update-manifest.json"
    )
    foreach ($name in $rootFiles) {
        $full = Join-Path $RepoRoot $name
        if (Test-Path -LiteralPath $full) {
            $paths.Add($full)
        }
    }

    return @($paths | Sort-Object -Unique)
}

function Get-GuideWorkflowFingerprint {
    $entries = [System.Collections.Generic.List[string]]::new()
    foreach ($path in (Get-WarrantedGuideFilePaths)) {
        $item = Get-Item -LiteralPath $path
        $relative = $item.FullName.Substring($RepoRoot.Length).TrimStart('\', '/')
        $entries.Add("$relative|$($item.LastWriteTimeUtc.Ticks)|$($item.Length)")
    }

    $combined = ($entries | Sort-Object) -join [Environment]::NewLine
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($combined)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha.ComputeHash($bytes)
    } finally {
        $sha.Dispose()
    }
    return [BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()
}

function Read-StoredFingerprint {
    if (-not (Test-Path -LiteralPath $SidecarPath)) {
        return $null
    }
    $line = Get-Content -LiteralPath $SidecarPath -TotalCount 1 -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($line)) {
        return $null
    }
    return $line.Trim()
}

function Write-StoredFingerprint {
    param([string]$Fingerprint)
    if (-not (Test-Path -LiteralPath $NotesDir)) {
        New-Item -ItemType Directory -Path $NotesDir -Force | Out-Null
    }
    $stamp = (Get-Date).ToUniversalTime().ToString("o")
    @(
        $Fingerprint,
        "marked_utc=$stamp"
    ) | Set-Content -LiteralPath $SidecarPath -Encoding utf8
}

function Invoke-GuideStaleCheck {
    $current = Get-GuideWorkflowFingerprint
    $stored = Read-StoredFingerprint

    if (-not $stored) {
        Write-Host "Integration guide sync: no baseline (.integration-guide-sync missing)." -ForegroundColor Yellow
        Write-Host "Workflow files may have changed. Update docs/notes/cursor-integration-guide.md, then:" -ForegroundColor Yellow
        Write-Host "  .\scripts\sync-integration-guide.ps1 -RegeneratePdf -MarkSynced" -ForegroundColor Yellow
        exit 1
    }

    if ($current -ne $stored) {
        Write-Host "Integration guide sync: STALE (workflow files changed since last -MarkSynced)." -ForegroundColor Yellow
        Write-Host "Review docs/notes/cursor-integration-guide.md, update if needed, then:" -ForegroundColor Yellow
        Write-Host "  .\scripts\sync-integration-guide.ps1 -RegeneratePdf -MarkSynced" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "Integration guide sync: up to date." -ForegroundColor Green
    exit 0
}

function Invoke-GuidePdfRegenerate {
    if (-not (Test-Path -LiteralPath $GuideMd)) {
        throw "Guide source not found: $GuideMd"
    }
    if (-not (Test-Path -LiteralPath $PdfBuilder)) {
        throw "PDF builder not found: $PdfBuilder"
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) {
        throw "Python not found. Install Python 3 and: pip install markdown"
    }

    Write-Host "Regenerating integration guide PDF/HTML..." -ForegroundColor Cyan
    & $python.Source $PdfBuilder
    if ($LASTEXITCODE -ne 0) {
        throw "build-integration-guide-pdf.py failed with exit code $LASTEXITCODE"
    }
    Write-Host "Wrote docs/notes/cursor-integration-guide.pdf and .html" -ForegroundColor Green
}

Set-Location $RepoRoot

if ($RegeneratePdf) {
    Invoke-GuidePdfRegenerate
    if ($MarkSynced) {
        $fingerprint = Get-GuideWorkflowFingerprint
        Write-StoredFingerprint -Fingerprint $fingerprint
        Write-Host "Marked integration guide baseline at current workflow fingerprint." -ForegroundColor Green
    }
    exit 0
}

if ($MarkSynced) {
    $fingerprint = Get-GuideWorkflowFingerprint
    Write-StoredFingerprint -Fingerprint $fingerprint
    Write-Host "Marked integration guide baseline at current workflow fingerprint." -ForegroundColor Green
    exit 0
}

if ($Check -or -not ($RegeneratePdf -or $MarkSynced)) {
    Invoke-GuideStaleCheck
}
