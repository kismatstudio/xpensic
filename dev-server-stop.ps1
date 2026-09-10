# dev-server-stop.ps1 — stops the background dev server launched by
# dev-server-start.ps1.
#
# Rather than trusting PID files (which go stale when processes get
# orphaned or the file is deleted), this stops whatever process currently
# owns the static server's port (8765) and the API's port (8790). Port
# ownership is unambiguous: if a port is listening, Get-NetTCPConnection
# returns the real owning PID, regardless of stale PID files.

$ErrorActionPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

$StaticPort = 8765
$ApiPort = 8790

# Stop the static dev-server by killing whatever owns its port.
$killed = $false
$staticOwner = Get-NetTCPConnection -LocalPort $StaticPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($staticOwner) {
  $staticPid = $staticOwner.OwningProcess
  Write-Host "dev-server: stopping process on port $StaticPort (pid $staticPid)"
  Stop-Process -Id $staticPid -Force
  $killed = $true
}

# Stop the authentication API by killing whatever owns its port.
$killedApi = $false
$apiOwner = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($apiOwner) {
  $apiPid = $apiOwner.OwningProcess
  # Don't kill the same process twice if both ports happen to share it.
  if ($apiPid -ne $staticPid) {
    Write-Host "XPENSIC API: stopping process on port $ApiPort (pid $apiPid)"
    Stop-Process -Id $apiPid -Force
    $killedApi = $true
  }
}

# Clean up stale PID files so `npm run start` starts fresh.
Remove-Item 'dev-server.pid' -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $PSScriptRoot 'server\server.pid') -Force -ErrorAction SilentlyContinue

if ($killed -or $killedApi) {
  Write-Host 'dev-server: stopped.'
} else {
  Write-Host 'dev-server: nothing was listening on the static or API ports.'
}
