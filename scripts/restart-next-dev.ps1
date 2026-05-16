param(
  [int]$Port = 3001,
  [switch]$NoClean,
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$escapedRepoRoot = [regex]::Escape($repoRoot)
$currentPid = $PID

function Get-CommandLineProcess {
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $currentPid -and
      $_.Name -match "^(node|npm|npx|cmd|powershell|pwsh)\.exe$" -and
      $_.CommandLine
    }
}

function Stop-ProcessTree {
  param([int[]]$RootProcessIds)

  if (-not $RootProcessIds -or $RootProcessIds.Count -eq 0) {
    return
  }

  $allProcesses = Get-CimInstance Win32_Process
  $processIds = New-Object System.Collections.Generic.HashSet[int]
  $queue = New-Object System.Collections.Generic.Queue[int]

  foreach ($processId in $RootProcessIds) {
    [void]$processIds.Add($processId)
    $queue.Enqueue($processId)
  }

  while ($queue.Count -gt 0) {
    $parentId = $queue.Dequeue()
    $children = $allProcesses | Where-Object { $_.ParentProcessId -eq $parentId }

    foreach ($child in $children) {
      if ($child.ProcessId -ne $currentPid -and $processIds.Add([int]$child.ProcessId)) {
        $queue.Enqueue([int]$child.ProcessId)
      }
    }
  }

  $orderedIds = @($processIds) | Sort-Object -Descending
  foreach ($processId in $orderedIds) {
    try {
      $process = Get-Process -Id $processId -ErrorAction Stop
      Write-Host "Stopping stale Soccer Stats dev process $processId ($($process.ProcessName))"
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      Write-Host "Process $processId already stopped"
    }
  }
}

$matchingProcesses = Get-CommandLineProcess | Where-Object {
  $commandLine = $_.CommandLine
  $fromRepo = $commandLine -match $escapedRepoRoot
  $isNextDevOnPort = $commandLine -match "\bnext(\.cmd)?\b" -and
    $commandLine -match "\bdev\b" -and
    ($commandLine -match "(-p|--port)\s+$Port\b" -or $commandLine -match "\b$Port\b")
  $isRepoNpmDev = $fromRepo -and $commandLine -match "\bnpm(\.cmd)?\b" -and $commandLine -match "\brun\s+dev\b"

  $fromRepo -or $isNextDevOnPort -or $isRepoNpmDev
}

$portProcessIds = @()
try {
  $portProcessIds = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
    Select-Object -ExpandProperty OwningProcess -Unique
} catch {
  Write-Host "No listening process found on port $Port"
}

$rootProcessIds = @($matchingProcesses | Select-Object -ExpandProperty ProcessId) + @($portProcessIds)
$rootProcessIds = $rootProcessIds | Where-Object { $_ -and $_ -ne $currentPid } | Select-Object -Unique

Stop-ProcessTree -RootProcessIds $rootProcessIds

if (-not $NoClean) {
  $nextDir = Join-Path $repoRoot ".next"
  if (Test-Path $nextDir) {
    Write-Host "Removing stale .next artifacts"
    Remove-Item -LiteralPath $nextDir -Recurse -Force
  }
}

if ($NoStart) {
  Write-Host "Fresh dev cleanup complete. Start manually with: npm.cmd run dev"
  exit 0
}

Write-Host "Starting Soccer Stats dev server on http://localhost:$Port"
Set-Location $repoRoot
& npm.cmd run dev
