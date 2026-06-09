$target = "google.com"
$count = 100
$bufferSize = 1400
$timeout = 2000

$results = @()
$seq = 0

Write-Host "`nPinging $target with $bufferSize-byte packets ($count sends)`n" -ForegroundColor Cyan

1..$count | ForEach-Object {
    $seq++
    $ping = New-Object System.Net.NetworkInformation.Ping
    $options = New-Object System.Net.NetworkInformation.PingOptions
    $options.DontFragment = $true
    $buffer = [byte[]]::new($bufferSize)

    $reply = $ping.Send($target, $timeout, $buffer, $options)

    if ($reply.Status -eq "Success") {
        $rtt = $reply.RoundtripTime
        $results += $rtt
        $color = if ($rtt -gt 150) { "Yellow" } elseif ($rtt -gt 300) { "Red" } else { "Green" }
        Write-Host ("Seq {0,-4} | RTT: {1,6} ms | {2}" -f $seq, $rtt, $reply.Address) -ForegroundColor $color
    } else {
        $results += $null
        Write-Host ("Seq {0,-4} | *** {1} ***" -f $seq, $reply.Status) -ForegroundColor Red
    }

    Start-Sleep -Milliseconds 500
}

# Summary
$sent      = $results.Count
$received  = ($results | Where-Object { $_ -ne $null }).Count
$lost      = $sent - $received
$lossRate  = [math]::Round(($lost / $sent) * 100, 1)
$validRtts = $results | Where-Object { $_ -ne $null }
$min       = ($validRtts | Measure-Object -Minimum).Minimum
$max       = ($validRtts | Measure-Object -Maximum).Maximum
$avg       = [math]::Round(($validRtts | Measure-Object -Average).Average, 2)

Write-Host "`n--- Summary ---" -ForegroundColor Cyan
Write-Host ("Sent: {0} | Lost: {1} ({2}%) | Min: {3} ms | Avg: {4} ms | Max: {5} ms" -f $sent, $lost, $lossRate, $min, $avg, $max)