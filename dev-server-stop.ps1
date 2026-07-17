# dev-server-stop.ps1 — stops the background dev server launched by
# dev-server-start.ps1. Reads the PID from dev-server.pid and kills it.
# Falls back to a name-based search if the recorded PID is stale.

$ErrorActionPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

# First, try the recorded PID.
$killed = $false
if (Test-Path 'dev-server.pid') {
  $pid = (Get-Content 'dev-server.pid' -Raw).Trim()
  $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
  if ($proc) {
    Write-Host "dev-server: stopping pid $pid"
    Stop-Process -Id $pid -Force
    $killed = $true
  } else {
    Write-Host "dev-server: recorded pid $pid is not running; trying name lookup"
  }
  Remove-Item 'dev-server.pid' -Force -ErrorAction SilentlyContinue
}

# Fall back to a name-based search. Handles the case where the recorded
# PID is stale (e.g. the PID file was deleted) and the server is still up.
if (-not $killed) {
  $nodeProc = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*dev-server.cjs*' } |
    Select-Object -First 1
  if ($nodeProc) {
    Write-Host "dev-server: stopping node pid $($nodeProc.ProcessId) (found by name)"
    Stop-Process -Id $nodeProc.ProcessId -Force
    $killed = $true
  }
}

if ($killed) {
  Write-Host 'dev-server: stopped.'
} else {
  Write-Host 'dev-server: no running server found.'
}
