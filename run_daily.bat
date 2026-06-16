@echo off
REM run_daily.bat - scheduled Soccer Stats result controller.
REM This is intentionally the small automation loop:
REM - Settle/upload only when matches are due.
REM - Seed/top up only when the wrapper decides it is needed.
REM - Never commit, push, build, or deploy.

setlocal enabledelayedexpansion
cd /d "%~dp0" || exit /b 1

if not exist logs mkdir logs
for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddTHHmm"') do set "DT=%%a"
set "STAMP=!DT:~0,8!_!DT:~8,4!"
set "LOG=logs\run_!STAMP!.log"
set "MAX_ATTEMPTS=3"
set "ATTEMPT=1"
set "LAST_EXIT=0"
echo [%date% %time%] === run_daily start === > "%LOG%"

REM Polite collection defaults. Use official/API sources first and keep request
REM cadence gentle instead of trying to bypass provider blocking.
if not defined SOCCER_PHASE2_SLEEP set "SOCCER_PHASE2_SLEEP=2.5"
if not defined SOCCER_ODDS_BUDGET set "SOCCER_ODDS_BUDGET=80"
if not defined SOCCER_SPORTSBET_DEEP_BUDGET set "SOCCER_SPORTSBET_DEEP_BUDGET=120"

REM Skip when another Soccer Stats routine/upload/cache worker is already active.
for /f %%p in ('powershell -NoProfile -ExecutionPolicy Bypass -File scripts\soccer-active-workers.ps1 count') do set "SOCCER_ACTIVE=%%p"
if not defined SOCCER_ACTIVE set "SOCCER_ACTIVE=0"
if "%SOCCER_ACTIVE%" NEQ "0" (
  echo [%date% %time%] skipped due to overlap: %SOCCER_ACTIVE% Soccer Stats process^(es^) in progress >> "%LOG%"
  echo [%date% %time%] overlap check command found %SOCCER_ACTIVE% active worker process^(es^) >> "%LOG%"
  exit /b 0
)

REM Run the split controller with retries. It preflights due times before touching data.
echo. >> "%LOG%"
:RUN_LOOP
if %ATTEMPT% GTR %MAX_ATTEMPTS% (
  echo [%date% %time%] get:data:results failed after %MAX_ATTEMPTS% attempts.>> "%LOG%"
  echo [%date% %time%] giving up.>> "%LOG%"
  exit /b 2
)

echo [%date% %time%] running npm.cmd run get:data:results (attempt %ATTEMPT%/%MAX_ATTEMPTS%) >> "%LOG%"
call npm.cmd run get:data:results >> "%LOG%" 2>&1
set "LAST_EXIT=%ERRORLEVEL%"

if "%LAST_EXIT%"=="0" (
  echo [%date% %time%] get:data:results succeeded on attempt %ATTEMPT% >> "%LOG%"
  goto ROUTINE_SUCCESS
)

echo [%date% %time%] get:data:results failed with errorlevel %LAST_EXIT% on attempt %ATTEMPT% >> "%LOG%"
echo [%date% %time%] recovery: stopping stale Soccer Stats worker processes >> "%LOG%"
for /f "delims=" %%k in ('powershell -NoProfile -ExecutionPolicy Bypass -File scripts\soccer-active-workers.ps1 stop') do set "RECOVERY=%%k"
echo [%date% %time%] killed=%RECOVERY% >> "%LOG%"

if exist docs\agent-system\outputs\result_pending_upload_latest.json (
  echo [%date% %time%] pending upload marker exists - attempting direct upload recovery >> "%LOG%"
  call node scripts/upload_match_data_to_firestore.mjs >> "%LOG%" 2>&1
  if "%ERRORLEVEL%"=="0" (
    echo [%date% %time%] direct upload recovery succeeded >> "%LOG%"
    set "LAST_EXIT=0"
    goto ROUTINE_SUCCESS
  ) else (
    echo [%date% %time%] direct upload recovery failed with errorlevel %ERRORLEVEL% >> "%LOG%"
  )
)

set /a ATTEMPT=ATTEMPT+1
if %ATTEMPT% LEQ %MAX_ATTEMPTS% (
  echo [%date% %time%] retrying after 60 second backoff >> "%LOG%"
  timeout /t 60 /nobreak >nul
  goto RUN_LOOP
)

exit /b %LAST_EXIT%

:ROUTINE_SUCCESS
echo [%date% %time%] === run_daily done === >> "%LOG%"
exit /b 0
