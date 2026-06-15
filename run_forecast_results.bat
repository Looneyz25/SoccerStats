@echo off
REM run_forecast_results.bat - on-demand / scheduled Soccer Stats controller.
REM Goal:
REM   1) Collect the 7-day match forecast for the project leagues and upload it to Firestore.
REM   2) Settle results for matches that are due (result schedule built from Firestore state)
REM      and upload those results to Firestore.
REM Both stages run the project's existing wrappers, which finish by uploading league
REM docs to Firestore. Stages run independently: a results-stage intervention stop does
REM not suppress forecast collection. Never commits, pushes, builds, or deploys.

setlocal enabledelayedexpansion
cd /d "%~dp0" || exit /b 1

if not exist logs mkdir logs
for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddTHHmm"') do set "DT=%%a"
set "STAMP=!DT:~0,8!_!DT:~8,4!"
set "LOG=logs\forecast_results_!STAMP!.log"
set "FORECAST_EXIT=0"
set "RESULTS_EXIT=0"
echo [%date% %time%] === run_forecast_results start === > "%LOG%"

REM Polite collection defaults. Prefer official/API sources and gentle cadence over
REM trying to bypass provider blocking. Only set if the caller has not already.
if not defined SOCCER_PHASE2_SLEEP set "SOCCER_PHASE2_SLEEP=2.5"
if not defined SOCCER_ODDS_BUDGET set "SOCCER_ODDS_BUDGET=320"
if not defined SOCCER_SPORTSBET_DEEP_BUDGET set "SOCCER_SPORTSBET_DEEP_BUDGET=240"

REM Skip when another Soccer Stats routine/upload/cache worker is already active, so we
REM never collide with run_daily or a manual refresh mid-flight.
for /f %%p in ('powershell -NoProfile -ExecutionPolicy Bypass -File scripts\soccer-active-workers.ps1 count') do set "SOCCER_ACTIVE=%%p"
if not defined SOCCER_ACTIVE set "SOCCER_ACTIVE=0"
if "%SOCCER_ACTIVE%" NEQ "0" (
  echo [%date% %time%] skipped due to overlap: %SOCCER_ACTIVE% Soccer Stats process^(es^) in progress >> "%LOG%"
  exit /b 0
)

REM ---------------------------------------------------------------------------
REM Stage 1: 7-day forecast horizon -> Firestore
REM get:data:topup runs the top-up wrapper (SOCCER_FIXTURE_DAYS=7), verifies settled
REM markets, caches badges, then uploads the league docs to Firestore.
REM ---------------------------------------------------------------------------
echo. >> "%LOG%"
echo [%date% %time%] STAGE 1: collecting 7-day forecast (npm.cmd run get:data:topup) >> "%LOG%"
call npm.cmd run get:data:topup >> "%LOG%" 2>&1
set "FORECAST_EXIT=%ERRORLEVEL%"
if "%FORECAST_EXIT%"=="0" (
  echo [%date% %time%] STAGE 1 forecast collected and uploaded >> "%LOG%"
) else (
  echo [%date% %time%] STAGE 1 failed with errorlevel %FORECAST_EXIT% >> "%LOG%"
  call :UPLOAD_RECOVERY FORECAST_EXIT
)

REM ---------------------------------------------------------------------------
REM Stage 2: settle due results -> Firestore
REM get:data:results reads the result schedule, settles matches that are due, runs the
REM review/calibration/verify steps, caches badges, then uploads results to Firestore.
REM It stops with agent_intervention_required (exit 1) if a match is still pending past
REM its expected finish - that is a signal to investigate, not a forecast failure.
REM ---------------------------------------------------------------------------
echo. >> "%LOG%"
echo [%date% %time%] STAGE 2: settling due results (npm.cmd run get:data:results) >> "%LOG%"
call npm.cmd run get:data:results >> "%LOG%" 2>&1
set "RESULTS_EXIT=%ERRORLEVEL%"
if "%RESULTS_EXIT%"=="0" (
  echo [%date% %time%] STAGE 2 results settled and uploaded >> "%LOG%"
) else (
  echo [%date% %time%] STAGE 2 failed with errorlevel %RESULTS_EXIT% ^(may be agent_intervention_required^) >> "%LOG%"
  call :UPLOAD_RECOVERY RESULTS_EXIT
)

echo. >> "%LOG%"
echo [%date% %time%] === run_forecast_results done (forecast=%FORECAST_EXIT% results=%RESULTS_EXIT%) === >> "%LOG%"

if "%FORECAST_EXIT%" NEQ "0" exit /b %FORECAST_EXIT%
if "%RESULTS_EXIT%" NEQ "0" exit /b %RESULTS_EXIT%
exit /b 0

REM ---------------------------------------------------------------------------
REM :UPLOAD_RECOVERY <exit-var>
REM When a stage leaves local data changed but the Firestore upload did not complete,
REM the wrapper writes result_pending_upload_latest.json. Retry the upload directly and,
REM if it succeeds, clear this stage's failure so the data still reaches Firestore.
REM ---------------------------------------------------------------------------
:UPLOAD_RECOVERY
if not exist docs\agent-system\outputs\result_pending_upload_latest.json goto :eof
echo [%date% %time%] pending upload marker exists - attempting direct Firestore upload recovery >> "%LOG%"
call node scripts/upload_match_data_to_firestore.mjs >> "%LOG%" 2>&1
if "%ERRORLEVEL%"=="0" (
  echo [%date% %time%] direct upload recovery succeeded >> "%LOG%"
  set "%~1=0"
) else (
  echo [%date% %time%] direct upload recovery failed with errorlevel %ERRORLEVEL% >> "%LOG%"
)
goto :eof
