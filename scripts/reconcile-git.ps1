# Reconcile local ConnectWatch changes with GitHub (preview by default).
#
# Usage:
#   .\scripts\reconcile-git.ps1                    Status + fetch only (preview)
#   .\scripts\reconcile-git.ps1 -Sync              Preview pull + push plan
#   .\scripts\reconcile-git.ps1 -Sync -Apply       Execute pull + push
#   .\scripts\reconcile-git.ps1 -Commit -Message "..." -Sync -Test -Apply

#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$Sync,
    [switch]$Pull,
    [switch]$Push,
    [switch]$Commit,
    [string]$Message,
    [string]$Body,
    [switch]$Test,
    [switch]$CreatePr,
    [switch]$Rebase,
    [switch]$All
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

Import-Module (Join-Path $PSScriptRoot 'ConnectWatch.Common.psm1') -Force

$git = Get-GitExecutable
$modeLabel = if ($Apply) { 'APPLY' } else { 'PREVIEW' }
$script:planSteps = [System.Collections.Generic.List[string]]::new()
$script:warnings = [System.Collections.Generic.List[string]]::new()
$blocked = $false

function Write-Plan {
    param([string]$Line)
    Write-Host "[PLAN] $Line" -ForegroundColor DarkGray
    $script:planSteps.Add($Line) | Out-Null
}

function Write-Warn {
    param([string]$Line)
    Write-Host "WARN: $Line" -ForegroundColor Yellow
    $script:warnings.Add($Line) | Out-Null
}

function Invoke-GitRead {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$ArgumentList
    )

    $prevErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $git @ArgumentList 2>$null
        if ($LASTEXITCODE -ne 0) {
            return $null
        }

        if ($output -is [System.Array]) {
            return ($output | ForEach-Object { "$_" }) -join "`n"
        }

        return "$output"
    } finally {
        $ErrorActionPreference = $prevErrorAction
    }
}

function Test-BlockedPath {
    param([string]$Path)

    $normalized = $Path -replace '\\', '/'
    if ($normalized -match '(?i)(^|/)ConnectWatch\.exe$') { return $true }
    if ($normalized -match '(?i)\.exe$') { return $true }
    if ($normalized -match '(?i)(^|/)\.env$') { return $true }
    if ($normalized -match '(?i)credentials\.json$') { return $true }
    if ($normalized -match '(?i)^data/') { return $true }
    return $false
}

function Test-SecretLikePath {
    param([string]$Path)

    $normalized = $Path -replace '\\', '/'
    if ($normalized -match '(?i)(secret|password|apikey|api_key|\.pem$|\.key$|token)') {
        return $true
    }
    return $false
}

Write-Host "=== ConnectWatch git reconcile ($modeLabel) ===" -ForegroundColor Cyan
Write-Host ""

Invoke-Git fetch --prune

$branch = (Invoke-GitRead rev-parse --abbrev-ref HEAD).Trim()
if (-not $branch) {
    throw 'Could not determine current branch.'
}

$upstream = Invoke-GitRead rev-parse --abbrev-ref '@{u}'
$upstreamRef = $null
$remoteName = 'origin'
$hasUpstream = $false

if ($upstream) {
    $upstream = $upstream.Trim()
    if ($upstream -match '^([^/]+)/(.+)$') {
        $remoteName = $Matches[1]
        $upstreamRef = $upstream
        $hasUpstream = $true
    }
} else {
    $upstreamRef = "$remoteName/$branch"
    Write-Warn "No upstream configured; comparing against $upstreamRef"
}

$ahead = 0
$behind = 0
$counts = Invoke-GitRead rev-list --left-right --count "HEAD...$upstreamRef"
if ($counts) {
    $parts = $counts.Trim() -split '\s+'
    if ($parts.Count -ge 2) {
        $ahead = [int]$parts[0]
        $behind = [int]$parts[1]
    }
}

Write-Host "Branch: $branch @ $upstreamRef" -ForegroundColor Cyan
Write-Host "Ahead: $ahead  Behind: $behind" -ForegroundColor DarkGray
Write-Host ""

Write-Host 'Remotes:' -ForegroundColor DarkGray
Invoke-Git remote -v | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
Write-Host ''

$statusLines = @(Invoke-GitRead status --short --branch) -split "`n" | Where-Object { $_ }
Write-Host 'Status:' -ForegroundColor DarkGray
if ($statusLines.Count -eq 0) {
    Write-Host '  (clean)' -ForegroundColor DarkGray
} else {
    foreach ($line in $statusLines) {
        Write-Host "  $line" -ForegroundColor DarkGray
    }
}
Write-Host ''

$porcelain = @(Invoke-GitRead status --porcelain) -split "`n" | Where-Object { $_ }
$dirtyPaths = @()
foreach ($line in $porcelain) {
    if ($line.Length -lt 4) { continue }
    $path = $line.Substring(3).Trim()
    if ($path -match ' -> ') {
        $path = ($path -split ' -> ')[-1].Trim()
    }
    $dirtyPaths += $path
}

$blockedPaths = @($dirtyPaths | Where-Object { Test-BlockedPath -Path $_ })
if ($blockedPaths.Count -gt 0) {
    $blocked = $true
    Write-Host 'BLOCKED paths (must not be committed):' -ForegroundColor Red
    foreach ($p in $blockedPaths) {
        Write-Host "  $p" -ForegroundColor Red
    }
    Write-Host ''
}

$secretLike = @($dirtyPaths | Where-Object { Test-SecretLikePath -Path $_ })
foreach ($p in $secretLike) {
    if ($blockedPaths -contains $p) { continue }
    Write-Warn "Path looks sensitive: $p"
}

$doPull = $Pull -or $Sync
$doPush = $Push -or $Sync
$doCommit = $Commit

if ($Commit -and -not $Message) {
    throw '-Commit requires -Message.'
}

if ($Apply -and $Commit -and -not $Message) {
    throw '-Commit -Apply requires -Message.'
}

if ($blocked -and $Apply) {
    throw 'Cannot -Apply while blocked paths are present. Remove or gitignore them first.'
}

# Pull
if ($doPull) {
    if ($behind -eq 0) {
        Write-Plan "git pull (skipped - up to date with $upstreamRef)"
    } elseif ($ahead -eq 0) {
        Write-Plan "git pull --ff-only $remoteName $branch"
        if ($Apply) {
            Invoke-Git pull --ff-only $remoteName $branch
            Write-Host 'Pull succeeded (fast-forward).' -ForegroundColor Green
        }
    } elseif ($Rebase) {
        Write-Plan "git pull --rebase $remoteName $branch"
        if ($Apply) {
            Invoke-Git pull --rebase $remoteName $branch
            Write-Host 'Pull succeeded (rebase).' -ForegroundColor Green
        }
    } else {
        Write-Plan "git pull $remoteName $branch"
        if ($Apply) {
            Invoke-Git pull $remoteName $branch
            Write-Host 'Pull succeeded (merge).' -ForegroundColor Green
        }
    }
}

# Commit
if ($doCommit -and $dirtyPaths.Count -gt 0) {
    if ($All) {
        Write-Plan 'git add -A'
        if ($Apply) { Invoke-Git add '--all' }
    } else {
        Write-Plan 'git add -u'
        if ($Apply) { Invoke-Git add '-u' }
        $untracked = @($porcelain | Where-Object { $_.StartsWith('??') })
        if ($untracked.Count -gt 0) {
            Write-Warn 'Untracked files exist; use -All to stage them.'
        }
    }

    $commitPreview = if ($Body) {
        "git commit -m `"$Message`" -m `"$Body`""
    } else {
        "git commit -m `"$Message`""
    }
    Write-Plan $commitPreview

    if ($Apply) {
        if ($Test) {
            Write-Host 'Running tests (-Test)...' -ForegroundColor Cyan
            & (Join-Path $PSScriptRoot 'test.ps1')
            if ($LASTEXITCODE -ne 0) {
                throw "Tests failed with exit code $LASTEXITCODE; commit aborted."
            }
        }

        if ($Body) {
            Invoke-Git commit -m $Message -m $Body
        } else {
            Invoke-Git commit -m $Message
        }
        Write-Host 'Commit succeeded.' -ForegroundColor Green

        $counts = Invoke-GitRead rev-list --left-right --count "HEAD...$upstreamRef"
        if ($counts) {
            $parts = $counts.Trim() -split '\s+'
            if ($parts.Count -ge 2) {
                $ahead = [int]$parts[0]
                $behind = [int]$parts[1]
            }
        }
    }
} elseif ($doCommit -and $dirtyPaths.Count -eq 0) {
    Write-Plan 'git commit (skipped - working tree clean)'
}

# Push
if ($doPush) {
    if ($ahead -eq 0) {
        Write-Plan 'git push (skipped - nothing to push)'
    } elseif ($upstream -or $hasUpstream) {
        Write-Plan "git push $remoteName $branch"
        if ($Apply) {
            Invoke-Git push $remoteName $branch
            Write-Host 'Push succeeded.' -ForegroundColor Green
        }
    } else {
        Write-Plan "git push -u $remoteName HEAD"
        if ($Apply) {
            Invoke-Git push -u $remoteName HEAD
            Write-Host 'Push succeeded (upstream set).' -ForegroundColor Green
        }
    }
}

# PR (feature branches)
$isMain = ($branch -eq 'main' -or $branch -eq 'master')
if ($CreatePr) {
    if ($isMain) {
        Write-Plan 'gh pr create (skipped - already on main)'
    } elseif ($ahead -eq 0 -and -not $Apply) {
        Write-Plan 'gh pr create --fill (after push; branch not ahead yet in preview)'
    } else {
        Write-Plan 'gh pr create --fill'
        if ($Apply) {
            if (-not $isMain) {
                $gh = Get-GhExecutable
                & $gh auth status | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    throw 'gh is not authenticated. Run: gh auth login'
                }
                Invoke-Gh pr create --fill
                Write-Host 'Pull request created.' -ForegroundColor Green
            }
        }
    }
}

Write-Host ''
if (-not $Apply) {
    if ($script:planSteps.Count -eq 0) {
        Write-Host 'No mutating steps planned. Pass -Sync, -Commit, -Pull, or -Push to plan actions.' -ForegroundColor DarkGray
    } else {
        $applyArgs = @('.\scripts\reconcile-git.ps1')
        if ($Sync) { $applyArgs += '-Sync' }
        if ($Pull) { $applyArgs += '-Pull' }
        if ($Push) { $applyArgs += '-Push' }
        if ($Commit) { $applyArgs += '-Commit'; $applyArgs += "-Message `"$Message`"" }
        if ($Body) { $applyArgs += "-Body `"$Body`"" }
        if ($Test) { $applyArgs += '-Test' }
        if ($CreatePr) { $applyArgs += '-CreatePr' }
        if ($Rebase) { $applyArgs += '-Rebase' }
        if ($All) { $applyArgs += '-All' }
        $applyArgs += '-Apply'
        Write-Host 'Run with -Apply to execute:' -ForegroundColor Cyan
        Write-Host ($applyArgs -join ' ') -ForegroundColor White
    }
} else {
    Write-Host 'Reconcile apply complete.' -ForegroundColor Green
}
