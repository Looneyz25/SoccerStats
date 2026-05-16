@echo off
REM run_daily.bat - full daily pipeline. Schedule via Windows Task Scheduler.
REM 1. Run scripts\soccer_routine.py against latest store
REM 2. Commit + push via auto_push.bat
REM 3. Log everything to logs\run_<date>.log

setlocal enabledelayedexpansion
cd /d "%~dp0" || exit /b 1

if not exist logs mkdir logs
for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddTHHmm"') do set "DT=%%a"
set "STAMP=!DT:~0,8!_!DT:~8,4!"
set "LOG=logs\run_!STAMP!.log"
if exist ".venv-local\Scripts\python.exe" (
  set "PYTHON=.venv-local\Scripts\python.exe"
) else (
  set "PYTHON=py -3"
)

echo [%date% %time%] === run_daily start === > "%LOG%"
echo [%date% %time%] python command: !PYTHON! >> "%LOG%"

REM Ensure dependencies
!PYTHON! -c "import curl_cffi, tzdata" >nul 2>&1
if errorlevel 1 (
  !PYTHON! -m pip install --quiet --upgrade curl_cffi tzdata >> "%LOG%" 2>&1
)

REM Run the master routine
echo. >> "%LOG%"
echo [%date% %time%] running soccer_routine.py (live dashboard pipeline) >> "%LOG%"
!PYTHON! scripts\soccer_routine.py >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] routine failed with errorlevel %errorlevel% >> "%LOG%"
  exit /b 2
)

REM Run the agent-system orchestrator (Phases 1-8 + result review + calibration). Non-fatal if it fails;
REM the live dashboard above is the source of truth for index.html.
echo. >> "%LOG%"
echo [%date% %time%] running soccer_phases_routine.py (Phases 1-8 + result review + calibration) >> "%LOG%"
!PYTHON! scripts\soccer_phases_routine.py >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] phases routine failed with errorlevel %errorlevel% (continuing) >> "%LOG%"
)

REM Publish dashboard data to Firestore. Non-fatal; static JSON remains fallback.
echo. >> "%LOG%"
echo [%date% %time%] uploading match_data.json to Firestore >> "%LOG%"
call npm.cmd run data:firebase >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] Firestore data upload failed with errorlevel %errorlevel% (continuing with JSON fallback) >> "%LOG%"
)

REM Push changes
echo. >> "%LOG%"
echo [%date% %time%] running auto_push.bat >> "%LOG%"
call "%~dp0auto_push.bat" >> "%LOG%" 2>&1

echo [%date% %time%] === run_daily done === >> "%LOG%"
exit /b 0
