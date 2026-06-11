# Rebuild ConnectWatch, stop any running copy (including port conflicts), and start fresh.
#
# Usage:
#   .\update-and-run.ps1                 Build, stop old instance, run in this window
#   .\update-and-run.ps1 -OpenBrowser    Same, then open the dashboard
#   .\update-and-run.ps1 -Background     Build, stop old instance, run detached
#   .\update-and-run.ps1 -SkipBuild      Restart only (no compile)
#   .\update-and-run.ps1 -SkipBuild -Background -OpenBrowser
#   .\update-and-run.ps1 -Background -Test
#   .\update-and-run.ps1 -CheckGuide

[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$Background,
    [switch]$OpenBrowser,
    [switch]$Test,
    [switch]$CheckGuide
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}
Set-Location $PSScriptRoot

function Get-GoExecutable {
    $go = Get-Command go -ErrorAction SilentlyContinue
    if ($go) {
        return $go.Source
    }

    $defaultGo = "C:\Program Files\Go\bin\go.exe"
    if (Test-Path $defaultGo) {
        return $defaultGo
    }

    throw "Go is not installed or not on PATH. Install from https://go.dev/dl/ and restart your terminal."
}

function Get-WebPortFromConfig {
    param(
        [string]$ConfigPath,
        [int]$DefaultPort = 8080
    )

    if (-not (Test-Path $ConfigPath)) {
        return $DefaultPort
    }

    $content = Get-Content -Path $ConfigPath -Raw
    if ($content -match '(?m)^web_port:\s*(\d+)\s*$') {
        return [int]$Matches[1]
    }

    return $DefaultPort
}

function Stop-ProcessTree {
    param(
        [int]$ProcessId,
        [int]$TimeoutSec = 10
    )

    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        return $true
    }

    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    } catch {
        if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
            return $true
        }
    }

    if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
        Start-Process -FilePath "$env:SystemRoot\System32\taskkill.exe" `
            -ArgumentList "/PID", $ProcessId, "/F", "/T" `
            -Wait -NoNewWindow -ErrorAction SilentlyContinue | Out-Null
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
            return $true
        }
        Start-Sleep -Milliseconds 300
    }

    return -not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Test-ConnectWatchProcess {
    param(
        [System.Diagnostics.Process]$Process
    )

    if ($Process.ProcessName -eq "ConnectWatch") {
        return $true
    }

    return ($Process.Path -and ($Process.Path -like "*ConnectWatch*"))
}

function Stop-ConnectWatchInstance {
    param(
        [int]$Port
    )

    $targetIds = @()

    Get-Process -Name "ConnectWatch" -ErrorAction SilentlyContinue | ForEach-Object {
        $targetIds += $_.Id
    }

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    foreach ($conn in $listeners) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if (-not $proc) {
            continue
        }

        if (Test-ConnectWatchProcess -Process $proc) {
            if ($proc.Id -notin $targetIds) {
                $targetIds += $proc.Id
            }
            continue
        }

        throw "Port $Port is already in use by $($proc.ProcessName) (PID $($proc.Id)). Stop that program or change web_port in config.yaml."
    }

    if ($targetIds.Count -eq 0) {
        Write-Host "No running ConnectWatch instance found." -ForegroundColor DarkGray
        return
    }

    foreach ($processId in ($targetIds | Sort-Object -Unique)) {
        if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            continue
        }

        Write-Host "Stopping ConnectWatch (PID $processId)..." -ForegroundColor Yellow
        if (-not (Stop-ProcessTree -ProcessId $processId)) {
            throw @"
Could not stop ConnectWatch (PID $processId).
Close the other monitor window with Ctrl+C, then run this script again.
If it still will not stop, reboot or sign out/in, then retry.
"@
        }
    }

    $remaining = @(
        Get-Process -Name "ConnectWatch" -ErrorAction SilentlyContinue
    )
    if ($remaining.Count -eq 0) {
        Write-Host "Stopped existing ConnectWatch instance(s)." -ForegroundColor Green
    } else {
        Write-Host "Stopped ConnectWatch instance(s). $($remaining.Count) may still be exiting." -ForegroundColor Green
    }
}

function Wait-PortFree {
    param(
        [int]$Port,
        [int]$TimeoutSec = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $listening = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        if ($listening.Count -eq 0) {
            return $true
        }

        $blockers = @($listening | ForEach-Object {
            Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
        } | Where-Object { $_ })

        if ($blockers.Count -eq 0) {
            Start-Sleep -Milliseconds 400
            continue
        }

        $nonApp = @($blockers | Where-Object { -not (Test-ConnectWatchProcess -Process $_) })
        if ($nonApp.Count -gt 0) {
            $proc = $nonApp[0]
            throw "Port $Port is still in use by $($proc.ProcessName) (PID $($proc.Id))."
        }

        Start-Sleep -Milliseconds 400
    }

    $stillListening = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    return ($stillListening.Count -eq 0)
}

function Build-ConnectWatch {
    $go = Get-GoExecutable

    Write-Host "Downloading Go module dependencies..." -ForegroundColor Cyan
    & $go mod tidy
    if ($LASTEXITCODE -ne 0) {
        throw "go mod tidy failed with exit code $LASTEXITCODE"
    }

    Write-Host "Building ConnectWatch.exe (background app, no console window)..." -ForegroundColor Cyan
    $env:CGO_ENABLED = "0"
    & $go build -ldflags "-H windowsgui -s -w" -o ConnectWatch.exe .
    if ($LASTEXITCODE -ne 0) {
        throw "go build failed with exit code $LASTEXITCODE"
    }

    Write-Host "Build succeeded." -ForegroundColor Green
}

function Start-ConnectWatchApp {
    param(
        [int]$Port,
        [switch]$RunInBackground,
        [switch]$LaunchBrowser
    )

    $exePath = Join-Path $PSScriptRoot "ConnectWatch.exe"
    if (-not (Test-Path $exePath)) {
        throw "ConnectWatch.exe was not found. Run without -SkipBuild first."
    }

    $dashboardUrl = "http://127.0.0.1:$Port/"

    if ($RunInBackground) {
        Write-Host "Starting ConnectWatch in the background..." -ForegroundColor Cyan
        Start-Process -FilePath $exePath -WorkingDirectory $PSScriptRoot | Out-Null

        $deadline = (Get-Date).AddSeconds(10)
        while ((Get-Date) -lt $deadline) {
            $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
            if ($listening) {
                break
            }
            Start-Sleep -Milliseconds 300
        }

        if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
            throw "ConnectWatch did not start listening on port $Port. Check data\ConnectWatch-app.log for errors."
        }

        Write-Host "ConnectWatch is running in the system tray." -ForegroundColor Green
        Write-Host "Dashboard: $dashboardUrl" -ForegroundColor Green

        if ($LaunchBrowser) {
            Start-Process $dashboardUrl | Out-Null
        }

        return
    }

    Write-Host "Starting ConnectWatch (runs in the system tray; use tray icon -> Exit to stop)..." -ForegroundColor Cyan
    Write-Host "Dashboard: $dashboardUrl" -ForegroundColor Green

    if ($LaunchBrowser) {
        Start-Job -ScriptBlock {
            param($Url)
            Start-Sleep -Seconds 1
            Start-Process $Url
        } -ArgumentList $dashboardUrl | Out-Null
    }

    Start-Process -FilePath $exePath -WorkingDirectory $PSScriptRoot -Wait | Out-Null
}

$configPath = Join-Path $PSScriptRoot "config.yaml"
$webPort = Get-WebPortFromConfig -ConfigPath $configPath

Write-Host "ConnectWatch - update and run" -ForegroundColor Cyan
Write-Host "Web port: $webPort" -ForegroundColor DarkGray
Write-Host ""

try {
    Stop-ConnectWatchInstance -Port $webPort

    if (-not (Wait-PortFree -Port $webPort)) {
        throw "Port $webPort is still in use after stopping ConnectWatch. Wait a moment and try again."
    }

    if (-not $SkipBuild) {
        Build-ConnectWatch
    } else {
        Write-Host "Skipping build (-SkipBuild)." -ForegroundColor DarkGray
    }

    if ($Test) {
        Write-Host "Running tests (-Test)..." -ForegroundColor Cyan
        & (Join-Path $PSScriptRoot "scripts\test.ps1")
        if ($LASTEXITCODE -ne 0) {
            throw "Tests failed with exit code $LASTEXITCODE"
        }
    }

    Start-ConnectWatchApp -Port $webPort -RunInBackground:$Background -LaunchBrowser:$OpenBrowser

    if ($CheckGuide) {
        $syncScript = Join-Path $PSScriptRoot "scripts\sync-integration-guide.ps1"
        if (Test-Path -LiteralPath $syncScript) {
            & $syncScript -Check
            if ($LASTEXITCODE -ne 0) {
                Write-Host ""
                Write-Host "Tip: update docs/notes/cursor-integration-guide.md if workflow changed, then run .\scripts\sync-integration-guide.ps1 -RegeneratePdf -MarkSynced" -ForegroundColor Yellow
            }
        }
    }
}
catch {
    Write-Host ""
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
