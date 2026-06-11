#Requires -Version 5.1
<#
.SYNOPSIS
  Bootstrap the ConnectWatch GitHub Project (labels, fields, repo link).

.DESCRIPTION
  Idempotent where possible. Requires gh auth with project scope:
    gh auth refresh -h github.com -s project,read:project

  Creates project "ConnectWatch" if missing; adds custom fields and repo labels.
  Status column extensions and automations are documented in docs/notes/github-settings.md
  (UI steps - not fully available via gh CLI).

.EXAMPLE
  .\scripts\setup-github-project.ps1
  .\scripts\setup-github-project.ps1 -ProjectNumber 3
#>
[CmdletBinding()]
param(
    [string]$Owner = "mdkeenan",
    [string]$Repo = "ConnectWatch",
    [int]$ProjectNumber = 0
)

$ErrorActionPreference = "Stop"
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    $ghPath = "C:\Program Files\GitHub CLI\gh.exe"
    if (-not (Test-Path $ghPath)) { throw "GitHub CLI (gh) not found. Install: winget install GitHub.cli" }
    $gh = $ghPath
} else {
    $gh = $gh.Source
}

function Invoke-Gh {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & $gh @Args
    if ($LASTEXITCODE -ne 0) { throw "gh failed: gh $($Args -join ' ')" }
}

Write-Host "Checking gh project scope..."
$auth = & $gh auth status 2>&1 | Out-String
if ($auth -notmatch "project") {
    Write-Host "Refreshing token scopes (complete device login if prompted)..."
    Invoke-Gh auth refresh -h github.com -s project,read:project
}

if ($ProjectNumber -le 0) {
    $existing = & $gh project list --owner $Owner --format json 2>$null | ConvertFrom-Json
    $match = $existing.projects | Where-Object { $_.title -eq "ConnectWatch" } | Select-Object -First 1
    if ($match) {
        $ProjectNumber = [int]$match.number
        Write-Host "Using existing project number $ProjectNumber"
    } else {
        Write-Host "Creating project ConnectWatch..."
        $created = Invoke-Gh project create --owner $Owner --title "ConnectWatch" --format json | ConvertFrom-Json
        $ProjectNumber = [int]$created.number
        Write-Host "Created project number $ProjectNumber - $($created.url)"
    }
}

Invoke-Gh project link $ProjectNumber --owner $Owner --repo "$Owner/$Repo"

$description = "ConnectWatch backlog, releases, and bugs. Link issues/PRs here; CI gates merge on main."
Invoke-Gh project edit $ProjectNumber --owner $Owner --description $description

$labels = @(
    @{ name = "dashboard"; color = "1D76DB"; description = "Dashboard UI, grid, widgets, charts" },
    @{ name = "release";   color = "FBCA04"; description = "Version bumps, manifest, GitHub Releases" },
    @{ name = "infra";     color = "5319E7"; description = "CI, scripts, build tooling" },
    @{ name = "monitor";   color = "0E8A16"; description = "Ping, traceroute, probes, speed tests" },
    @{ name = "api";       color = "006B75"; description = "REST API and server handlers" }
)
$existingLabels = @((& $gh label list --repo "$Owner/$Repo" --limit 100 --json name | ConvertFrom-Json).name)
foreach ($l in $labels) {
    if ($existingLabels -contains $l.name) {
        Write-Host "Label exists: $($l.name)"
        continue
    }
    Invoke-Gh label create $l.name --repo "$Owner/$Repo" --color $l.color --description $l.description
    Write-Host "Label: $($l.name)"
}

function Ensure-SelectField {
    param([string]$Name, [string[]]$Options)
    $fields = Invoke-Gh project field-list $ProjectNumber --owner $Owner --format json | ConvertFrom-Json
    if ($fields.fields | Where-Object { $_.name -eq $Name }) {
        Write-Host "Field exists: $Name"
        return
    }
    $optArg = ($Options -join ",")
    Invoke-Gh project field-create $ProjectNumber --owner $Owner --name $Name --data-type SINGLE_SELECT --single-select-options $optArg
    Write-Host "Field created: $Name"
}

Ensure-SelectField -Name "Type" -Options @("Bug", "Feature", "Chore", "Release")
Ensure-SelectField -Name "Priority" -Options @("P0", "P1", "P2", "P3")
Ensure-SelectField -Name "Area" -Options @("Monitor", "Dashboard", "API", "CI", "Infra", "Release")

$fields = Invoke-Gh project field-list $ProjectNumber --owner $Owner --format json | ConvertFrom-Json
if (-not ($fields.fields | Where-Object { $_.name -eq "Target version" })) {
    Invoke-Gh project field-create $ProjectNumber --owner $Owner --name "Target version" --data-type TEXT
    Write-Host "Field created: Target version"
}

Write-Host ""
Write-Host "Project ready: https://github.com/users/$Owner/projects/$ProjectNumber"
Write-Host 'Finish in GitHub UI: Status options (Backlog, In review) and automations - see docs/notes/github-settings.md section 5.'
