# --- CONFIGURATION ---
$TargetHost        = "8.8.8.8"
$LogFile           = "CC:\Users\micha\OneDrive\Documents\Network Monitoring\NetworkMonitor_Log.txt" # Change this path if needed
$PingDelay         = 1   # Seconds between normal pings
$TraceRouteInterval= 30  # Seconds between traceroutes during a failure period
$RequiredSuccesses = 5   # Consecutive successful pings required to recover

# --- INITIALIZATION ---
$FirstSuccessTime    = $null
$LastSuccessTime     = $null
$FailureDetected     = $false
$ConsecutiveSuccesses= 0
$LastTracerouteTime  = [DateTime]::MinValue

Write-Host "Starting advanced network monitor for $TargetHost..." -ForegroundColor Cyan
Write-Host "Logging events to: $LogFile" -ForegroundColor Cyan
Write-Host "Press CTRL+C to stop.`n" -ForegroundColor Yellow

# Ensure log file directory exists
$LogDir = Split-Path $LogFile
if ($LogDir -and !(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force > $null }

# --- MAIN LOOP ---
while ($true) {
    # Test connection with a single packet
    $Ping = Test-Connection -ComputerName $TargetHost -Count 1 -ErrorAction SilentlyContinue

    if ($Ping -and $Ping.StatusCode -eq 0) {
        # SUCCESSFUL PING
        $CurrentTime = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        $ConsecutiveSuccesses++

        # Track the very first successful ping since the script started
        if ($null -eq $FirstSuccessTime) { $FirstSuccessTime = $CurrentTime }

        # Update the most recent successful ping
        $LastSuccessTime = $CurrentTime

        # If we were in a failure state, check if we hit the 5-ping recovery threshold
        if ($FailureDetected -and $ConsecutiveSuccesses -ge $RequiredSuccesses) {
            $RecoveryMessage = "[RECOVERED] - $CurrentTime`n" +
                               "-> Received $RequiredSuccesses successful pings in a row.`n" +
                               "-> First Success Since Start: $FirstSuccessTime`n" +
                               "-> Last Success Before Recovery: $LastSuccessTime`n" +
                               "--------------------------------------------------"
            
            Write-Host $RecoveryMessage -ForegroundColor Green
            $RecoveryMessage | Out-File -FilePath $LogFile -Append
            
            # Reset failure state
            $FailureDetected = $false
        }
    } 
    else {
        # FAILED PING
        $CurrentTime = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        $ConsecutiveSuccesses = 0 # Reset recovery streak immediately on any failure

        if (-not $FailureDetected) {
            # FIRST DROP: Initiate the 5-second validation window
            Write-Host "[POTENTIAL DROP] - $CurrentTime - Waiting 5s to verify..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
            
            # Re-test the connection after the 5-second wait
            $VerifyPing = Test-Connection -ComputerName $TargetHost -Count 1 -ErrorAction SilentlyContinue
            
            if ($VerifyPing -and $VerifyPing.StatusCode -eq 0) {
                # It was a blip; connection recovered within the 5 seconds. Skip traceroute.
                Write-Host "-> Connection recovered within 5 seconds. Skipping traceroute." -ForegroundColor Green
                continue
            }
            else {
                # Connection is genuinely down
                $FailureDetected = $true
                $FailureTime = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                
                $AlertMessage = "[FAILURE CONFIRMED] - $FailureTime`n" +
                                "-> Connection down for >5 seconds.`n" +
                                "-> Last Successful Ping Was At: $LastSuccessTime"
                
                Write-Host $AlertMessage -ForegroundColor Red
                $AlertMessage | Out-File -FilePath $LogFile -Append
            }
        }

        # TRACEROUTE LOGIC (Runs if failure is confirmed)
        if ($FailureDetected) {
            $TimeSinceLastTrace = (Get-Date) - $LastTracerouteTime
            
            # Trigger traceroute if it's the initial failure OR if 30 seconds have passed since the last one
            if ($LastTracerouteTime -eq [DateTime]::MinValue -or $TimeSinceLastTrace.TotalSeconds -ge $TraceRouteInterval) {
                $TraceTime = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                $LastTracerouteTime = Get-Date

                Write-Host "-> Running traceroute... (Interval: Every ${TraceRouteInterval}s during outage)" -ForegroundColor Yellow
                
                "=== TRACEROUTE START ($TraceTime) ===" | Out-File -FilePath $LogFile -Append
                tracert $TargetHost | Out-File -FilePath $LogFile -Append
                "=== TRACEROUTE END ===" | Out-File -FilePath $LogFile -Append
                "--------------------------------------------------" | Out-File -FilePath $LogFile -Append
                
                Write-Host "-> Traceroute logged." -ForegroundColor DarkYellow
            }
        }
    }

    Start-Sleep -Seconds $PingDelay
}