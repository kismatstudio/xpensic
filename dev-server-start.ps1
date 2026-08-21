# dev-server-start.ps1 — launches dev-server.cjs detached from the terminal.
#
# Why PowerShell and not cmd? Two reasons:
#   1. PowerShell quoting for `start /B` is much less brittle than cmd's
#      (cmd's pre-parser eats the `&` in `2>&1` and the `"` around the
#      command, leading to `. was unexpected at this time` errors).
#   2. PowerShell has `Get-CimInstance Win32_Process`, which is the modern
#      replacement for wmic and parses the command line reliably — no
#      escaping headaches.
#
# Usage:
#   npm run start   (from the project root; package.json wraps this script)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Start the authentication API first when its dependencies are installed.
# The client login gate depends on this service at http://127.0.0.1:8787.
$serverRoot = Join-Path $PSScriptRoot 'server'
$apiPort = 8787
$apiPidPath = Join-Path $serverRoot 'server.pid'

function Test-ApiListening {
  param([int]$Port, [int]$TimeoutMs = 2000)
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
      return $true
    }
    Start-Sleep -Milliseconds 100
  }
  return $false
}

function Get-ApiProcess {
  # Match the actual command line: `node src/server.js` (launched from server/).
  # The previous pattern `*server*src*server.js*` failed because the command
  # line doesn't contain the literal word "server" — only the path segments.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*src/server.js*' } |
    Select-Object -First 1
}

if (-not (Test-Path (Join-Path $serverRoot 'node_modules'))) {
  Write-Host "XPENSIC API dependencies are missing. Run: cd server; npm.cmd install"
} elseif (Test-ApiListening -Port $apiPort) {
  Write-Host "XPENSIC API: already listening on port $apiPort."
  # Refresh the PID file so `npm run stop` can find it.
  $apiProc = Get-ApiProcess
  if ($apiProc) { $apiProc.ProcessId | Out-File $apiPidPath -Encoding ASCII -NoNewline }
} else {
  # Clean up any stale PID file before starting.
  if (Test-Path $apiPidPath) { Remove-Item $apiPidPath -Force }

  # If something else is holding the port (a zombie from a prior session),
  # surface it instead of silently failing.
  $portHolder = Get-NetTCPConnection -LocalPort $apiPort -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($portHolder) {
    Write-Host "XPENSIC API: port $apiPort is held by pid $($portHolder.OwningProcess). Stop it first."
  } else {
    Start-Process `
      -FilePath 'node' `
      -ArgumentList 'src/server.js' `
      -WorkingDirectory $serverRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $serverRoot 'server.log') `
      -RedirectStandardError (Join-Path $serverRoot 'server-error.log')

    # Poll for the port to come up (up to ~5s) instead of a fixed sleep.
    if (Test-ApiListening -Port $apiPort -TimeoutMs 5000) {
      $apiProc = Get-ApiProcess
      if ($apiProc) {
        $apiProc.ProcessId | Out-File $apiPidPath -Encoding ASCII -NoNewline
        Write-Host "XPENSIC API: started (pid $($apiProc.ProcessId)) on http://127.0.0.1:$apiPort"
      } else {
        Write-Host "XPENSIC API: listening on $apiPort but could not record PID."
      }
    } else {
      Write-Host "XPENSIC API: failed to start within 5s. Check server\server-error.log"
    }
  }
}

# Don't start a second static server if one's already running.
if (Test-Path 'dev-server.pid') {
  $existingPid = (Get-Content 'dev-server.pid' -Raw).Trim()
  $running = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
  if ($running) {
    Write-Host "dev-server: already running (pid $existingPid)."
  } else {
    # Stale PID file; clean it up.
    Remove-Item 'dev-server.pid' -Force
  }
}

if (-not (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)) {

# Launch the server detached. -WindowStyle Hidden prevents a console window
# from popping up. We use cmd's `>` to merge stdout and stderr into a single
# log file (PowerShell's Start-Process requires stdout and stderr to go to
# different files, which is awkward — the cmd /c trick is simpler).
#
# We have to go through `cmd /c` because Start-Process's PowerShell
# process-execution model makes the child a grandchild: the recorded PID
# is the cmd wrapper, which exits immediately, leaving us with no handle
# to the real node process. The cmd /c route keeps node as a direct
# child we can find.
Start-Process `
  -FilePath 'cmd' `
  -ArgumentList '/c', 'node dev-server.cjs > dev-server.log 2>&1' `
  -WorkingDirectory $PSScriptRoot `
  -WindowStyle Hidden

# Give the server a moment to bind the port and write its banner.
Start-Sleep -Seconds 1

# Find the actual node.exe process running dev-server.cjs. There's a brief
# race: if multiple node servers were ever running, the first match wins;
# `npm run start` guards against that by bailing out if a PID file is
# present and the recorded process is alive.
$nodeProc = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*dev-server.cjs*' } |
  Select-Object -First 1

if ($nodeProc) {
  $nodeProc.ProcessId | Out-File 'dev-server.pid' -Encoding ASCII -NoNewline
  Write-Host "dev-server: started in the background (pid $($nodeProc.ProcessId))."
  Write-Host "  Tail the log:  Get-Content -Wait .\dev-server.log"
  Write-Host "  Stop it:       npm run stop"
} else {
  Write-Host "dev-server: started, but could not find the node process. Stop with:"
  Write-Host "  taskkill /F /FI ""IMAGENAME eq node.exe"""
}
} else {
  Write-Host "dev-server: already listening on port 8765."
}
