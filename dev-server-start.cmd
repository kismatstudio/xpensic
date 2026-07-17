@echo off
REM dev-server-start.cmd - launches dev-server.cjs detached from the terminal.
REM
REM The cmd file does only orchestration (launch, wait, write PID file);
REM PowerShell does the heavy lifting (PID lookup) since cmd's parsing is
REM too fragile for the multi-condition wmic command.

setlocal
cd /d "%~dp0"

REM If a server is already running, don't start a second one.
if exist dev-server.pid (
  for /f "usebackq" %%P in ("dev-server.pid") do (
    tasklist /FI "PID eq %%P" 2>nul | findstr /R "%%P" >nul
    if not errorlevel 1 (
      echo dev-server: already running (pid %%P). Stop it first with `npm run stop`.
      exit /b 0
    )
  )
)

REM Launch the server detached. /B means "no new window", and the redirects
REM move stdout/stderr to dev-server.log so we can inspect requests later.
start "" /B cmd /c "node dev-server.cjs > dev-server.log 2>&1"

REM Give the server a moment to bind the port and write its banner.
ping -n 2 127.0.0.1 >nul

REM Find the new node.exe process whose command line contains
REM "dev-server.cjs" and write its PID to dev-server.pid. PowerShell's
REM Get-CimInstance is the modern replacement for wmic and parses the
REM command line reliably.
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*dev-server.cjs*' } | Select-Object -First 1).ProcessId"`) do (
  echo %%P > dev-server.pid
)

if exist dev-server.pid (
  for /f "usebackq" %%P in ("dev-server.pid") do (
    echo dev-server: started in the background (pid %%P). Tail the log with:
    echo   Get-Content -Wait .\dev-server.log
    echo Stop it with:
    echo   npm run stop
  )
) else (
  echo dev-server: started, but could not record PID. Stop with:
  echo   taskkill /F /FI "IMAGENAME eq node.exe"
)
endlocal
