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

# Don't start a second server if one's already running.
if (Test-Path 'dev-server.pid') {
  $existingPid = (Get-Content 'dev-server.pid' -Raw).Trim()
  $running = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
  if ($running) {
    Write-Host "dev-server: already running (pid $existingPid). Stop it first with \`npm run stop\`."
    exit 0
  } else {
    # Stale PID file; clean it up.
    Remove-Item 'dev-server.pid' -Force
  }
}

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
