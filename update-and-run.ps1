# Rebuild NetworkMonitor, stop any running copy (including port conflicts), and start fresh.
#
# Usage:
#   .\update-and-run.ps1                 Build, stop old instance, run in this window
#   .\update-and-run.ps1 -OpenBrowser    Same, then open the dashboard
#   .\update-and-run.ps1 -Background     Build, stop old instance, run detached
#   .\update-and-run.ps1 -SkipBuild      Restart only (no compile)
#   .\update-and-run.ps1 -SkipBuild -Background -OpenBrowser

[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$Background,
    [switch]$OpenBrowser
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

function Stop-NetworkMonitorInstance {
    param(
        [int]$Port
    )

    $targetIds = @()

    Get-Process -Name "NetworkMonitor" -ErrorAction SilentlyContinue | ForEach-Object {
        $targetIds += $_.Id
    }

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    foreach ($conn in $listeners) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if (-not $proc) {
            continue
        }

        $isMonitor = ($proc.ProcessName -eq "NetworkMonitor") -or
            ($proc.Path -and ($proc.Path -like "*Network Monitoring*"))

        if ($isMonitor) {
            if ($proc.Id -notin $targetIds) {
                $targetIds += $proc.Id
            }
            continue
        }

        throw "Port $Port is already in use by $($proc.ProcessName) (PID $($proc.Id)). Stop that program or change web_port in config.yaml."
    }

    if ($targetIds.Count -eq 0) {
        Write-Host "No running NetworkMonitor instance found." -ForegroundColor DarkGray
        return
    }

    foreach ($processId in ($targetIds | Sort-Object -Unique)) {
        if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            continue
        }

        Write-Host "Stopping NetworkMonitor (PID $processId)..." -ForegroundColor Yellow
        if (-not (Stop-ProcessTree -ProcessId $processId)) {
            throw @"
Could not stop NetworkMonitor (PID $processId).
Close the other monitor window with Ctrl+C, then run this script again.
If it still will not stop, reboot or sign out/in, then retry.
"@
        }
    }

    $remaining = @(Get-Process -Name "NetworkMonitor" -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) {
        Write-Host "Stopped existing NetworkMonitor instance(s)." -ForegroundColor Green
    } else {
        Write-Host "Stopped NetworkMonitor instance(s). $($remaining.Count) may still be exiting." -ForegroundColor Green
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

        $nonMonitor = @($blockers | Where-Object { $_.ProcessName -ne "NetworkMonitor" })
        if ($nonMonitor.Count -gt 0) {
            $proc = $nonMonitor[0]
            throw "Port $Port is still in use by $($proc.ProcessName) (PID $($proc.Id))."
        }

        Start-Sleep -Milliseconds 400
    }

    $stillListening = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    return ($stillListening.Count -eq 0)
}

function Build-NetworkMonitor {
    $go = Get-GoExecutable

    Write-Host "Downloading Go module dependencies..." -ForegroundColor Cyan
    & $go mod tidy
    if ($LASTEXITCODE -ne 0) {
        throw "go mod tidy failed with exit code $LASTEXITCODE"
    }

    Write-Host "Building NetworkMonitor.exe (background app, no console window)..." -ForegroundColor Cyan
    $env:CGO_ENABLED = "0"
    & $go build -ldflags "-H windowsgui -s -w" -o NetworkMonitor.exe .
    if ($LASTEXITCODE -ne 0) {
        throw "go build failed with exit code $LASTEXITCODE"
    }

    Write-Host "Build succeeded." -ForegroundColor Green
}

function Start-NetworkMonitorApp {
    param(
        [int]$Port,
        [switch]$RunInBackground,
        [switch]$LaunchBrowser
    )

    $exePath = Join-Path $PSScriptRoot "NetworkMonitor.exe"
    if (-not (Test-Path $exePath)) {
        throw "NetworkMonitor.exe was not found. Run without -SkipBuild first."
    }

    $dashboardUrl = "http://127.0.0.1:$Port/"

    if ($RunInBackground) {
        Write-Host "Starting NetworkMonitor in the background..." -ForegroundColor Cyan
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
            throw "NetworkMonitor did not start listening on port $Port. Check data\NetworkMonitor-app.log for errors."
        }

        Write-Host "NetworkMonitor is running in the system tray." -ForegroundColor Green
        Write-Host "Dashboard: $dashboardUrl" -ForegroundColor Green

        if ($LaunchBrowser) {
            Start-Process $dashboardUrl | Out-Null
        }

        return
    }

    Write-Host "Starting NetworkMonitor (runs in the system tray; use tray icon -> Exit to stop)..." -ForegroundColor Cyan
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

Write-Host "Network Monitor - update and run" -ForegroundColor Cyan
Write-Host "Web port: $webPort" -ForegroundColor DarkGray
Write-Host ""

try {
    Stop-NetworkMonitorInstance -Port $webPort

    if (-not (Wait-PortFree -Port $webPort)) {
        throw "Port $webPort is still in use after stopping NetworkMonitor. Wait a moment and try again."
    }

    if (-not $SkipBuild) {
        Build-NetworkMonitor
    } else {
        Write-Host "Skipping build (-SkipBuild)." -ForegroundColor DarkGray
    }

    Start-NetworkMonitorApp -Port $webPort -RunInBackground:$Background -LaunchBrowser:$OpenBrowser
}
catch {
    Write-Host ""
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
