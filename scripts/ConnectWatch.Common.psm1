#Requires -Version 5.1

function Get-GoExecutable {
    $go = Get-Command go -ErrorAction SilentlyContinue
    if ($go) {
        return $go.Source
    }

    $defaultGo = 'C:\Program Files\Go\bin\go.exe'
    if (Test-Path $defaultGo) {
        return $defaultGo
    }

    throw 'Go is not installed or not on PATH. Install from https://go.dev/dl/ and restart your terminal.'
}

function Get-GhExecutable {
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if ($gh) {
        return $gh.Source
    }

    $defaultGh = 'C:\Program Files\GitHub CLI\gh.exe'
    if (Test-Path $defaultGh) {
        return $defaultGh
    }

    throw 'GitHub CLI (gh) is not installed. Install from https://cli.github.com/ and run: gh auth login'
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

function Invoke-Gh {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$ArgumentList
    )

    $gh = Get-GhExecutable
    & $gh @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "gh failed: gh $($ArgumentList -join ' ')"
    }
}

function Get-GitExecutable {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        return $git.Source
    }

    $defaultGit = 'C:\Program Files\Git\bin\git.exe'
    if (Test-Path $defaultGit) {
        return $defaultGit
    }

    throw 'Git is not installed or not on PATH. Install from https://git-scm.com/download/win'
}

function Invoke-Git {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$ArgumentList
    )

    $git = Get-GitExecutable
    & $git @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "git failed: git $($ArgumentList -join ' ')"
    }
}

Export-ModuleMember -Function Get-GoExecutable, Get-GhExecutable, Get-GitExecutable, Get-WebPortFromConfig, Invoke-Gh, Invoke-Git
