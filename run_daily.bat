@echo off
REM run_daily.bat - full daily pipeline. Schedule via Windows Task Scheduler.
REM 1. Run scripts\soccer_routine.py against latest store
REM 2. Commit + push via auto_push.bat
REM 3. Log everything to logs\run_<date>.log

setlocal enabledelayedexpansion
cd /d "C:\Users\lvora\OneDrive\Betting\Soccer Stats" || exit /b 1

if not exist logs mkdir logs
for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddTHHmm"') do set "DT=%%a"
set "STAMP=!DT:~0,8!_!DT:~8,4!"
set "LOG=logs\run_!STAMP!.log"

echo [%date% %time%] === run_daily start === > "%LOG%"

REM Ensure dependencies
python -c "import curl_cffi, tzdata" >nul 2>&1
if errorlevel 1 (
  python -m pip install --quiet --upgrade curl_cffi tzdata >> "%LOG%" 2>&1
)

REM Run the master routine
echo. >> "%LOG%"
echo [%date% %time%] running soccer_routine.py (live dashboard pipeline) >> "%LOG%"
python scripts\soccer_routine.py >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] routine failed with errorlevel %errorlevel% >> "%LOG%"
  exit /b 2
)

REM Run the agent-system orchestrator (Phases 1-7). Non-fatal if it fails;
REM the live dashboard above is the source of truth for index.html.
echo. >> "%LOG%"
echo [%date% %time%] running soccer_phases_routine.py (Phases 1-7) >> "%LOG%"
python scripts\soccer_phases_routine.py >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] phases routine failed with errorlevel %errorlevel% (continuing) >> "%LOG%"
)

REM Push changes
echo. >> "%LOG%"
echo [%date% %time%] running auto_push.bat >> "%LOG%"
call auto_push.bat >> "%LOG%" 2>&1

echo [%date% %time%] === run_daily done === >> "%LOG%"
exit /b 0
