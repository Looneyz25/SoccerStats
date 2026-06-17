param(
  [ValidateSet("count", "stop")]
  [string]$Action = "count"
)

$pattern = "soccer_routine|soccer_|get-data-with-log|upload_match_data|cache_badges|run-python.js"
$currentPid = $PID

$workers = @(Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $currentPid -and
  $_.CommandLine -and
  $_.CommandLine -match $pattern
})

if ($Action -eq "stop") {
  foreach ($worker in $workers) {
    Stop-Process -Id $worker.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

Write-Output $workers.Count
