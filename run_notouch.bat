@echo off
REM run_notouch.bat - unified no-touch Soccer Stats controller.
REM
REM Goal: never miss the 7-day forecast, live-update matches due that day, settle the
REM moment full time is confirmed, self-heal the recurring "stuck upcoming" bug, and
REM raise a desktop notification only when a match is genuinely stuck. Built to run
REM every ~15 min from Task Scheduler; it self-skips cheaply when there is nothing to
REM do, so it is frequent during match windows and near-free overnight.
REM
REM Multiple fallbacks at every layer: settlement reads SofaScore -> LiveScore ->
REM Flashscore; stat backfill retries until real values land (never voids); the
REM results step retries with stale-worker recovery; each stage is independent so one
REM failing never blocks the others. Never commits, pushes, builds, or deploys.
REM
REM NOTE: the filename must NOT contain "soccer_" - the overlap guard pattern matches
REM that token, so a "soccer_" launcher would count itself and skip forever.

setlocal enabledelayedexpansion
cd /d "%~dp0" || exit /b 1
if not exist logs mkdir logs
for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "STAMP=%%a"
set "LOG=logs\notouch_!STAMP!.log"
set "LIVE_EXIT=0"
set "RESULTS_EXIT=0"
set "TOPUP_EXIT=0"
set "STUCK=0"
echo [%date% %time%] === run_notouch start === > "%LOG%"

REM Polite collection defaults: prefer official/API sources and gentle cadence.
if not defined SOCCER_PHASE2_SLEEP set "SOCCER_PHASE2_SLEEP=2.5"
if not defined SOCCER_ODDS_BUDGET set "SOCCER_ODDS_BUDGET=320"
if not defined SOCCER_SPORTSBET_DEEP_BUDGET set "SOCCER_SPORTSBET_DEEP_BUDGET=240"

REM Skip if another Soccer Stats worker is already running (prevents pile-up when a
REM heavy run overruns the 15-minute cadence, and collisions with manual refreshes).
for /f %%p in ('powershell -NoProfile -ExecutionPolicy Bypass -File scripts\soccer-active-workers.ps1 count') do set "SOCCER_ACTIVE=%%p"
if not defined SOCCER_ACTIVE set "SOCCER_ACTIVE=0"
if "%SOCCER_ACTIVE%" NEQ "0" (
  echo [%date% %time%] skipped: %SOCCER_ACTIVE% Soccer Stats process^(es^) already active >> "%LOG%"
  exit /b 0
)

REM --- Stage 1: live in-play scores + early full-time confirmation. -------------------
REM Cheap when no match has started; updates live scores and settles on CONFIRMED full
REM time (never by due-time), closing the "finished match still upcoming" gap early.
echo. >> "%LOG%"
echo [%date% %time%] STAGE 1: live update (soccer_routine --live) >> "%LOG%"
call node scripts/run-python.js scripts/soccer_routine.py --live >> "%LOG%" 2>&1
set "LIVE_EXIT=%ERRORLEVEL%"
echo [%date% %time%] live exit=%LIVE_EXIT% >> "%LOG%"

REM --- Stage 2: settle due results + stat backfill + forecast top-up + upload. ---------
REM The results wrapper has its own planner: it settles due matches, backfills missing
REM cards/corners (retrying, never voiding), tops up the forecast when nothing is due,
REM uploads the live/settled changes flagged by Stage 1, and self-skips when idle.
set "ATTEMPT=1"
:RESULTS_LOOP
echo. >> "%LOG%"
echo [%date% %time%] STAGE 2: get:data:results (attempt %ATTEMPT%/3) >> "%LOG%"
call npm.cmd run get:data:results >> "%LOG%" 2>&1
set "RESULTS_EXIT=%ERRORLEVEL%"
if "%RESULTS_EXIT%"=="0" (
  echo [%date% %time%] results succeeded on attempt %ATTEMPT% >> "%LOG%"
  goto RESULTS_DONE
)
echo [%date% %time%] results failed errorlevel %RESULTS_EXIT% on attempt %ATTEMPT% >> "%LOG%"
for /f "delims=" %%k in ('powershell -NoProfile -ExecutionPolicy Bypass -File scripts\soccer-active-workers.ps1 stop') do set "RECOVERY=%%k"
echo [%date% %time%] recovery killed=%RECOVERY% >> "%LOG%"
set /a ATTEMPT+=1
if %ATTEMPT% LEQ 3 (
  echo [%date% %time%] retrying after 60s backoff >> "%LOG%"
  timeout /t 60 /nobreak >nul
  goto RESULTS_LOOP
)
:RESULTS_DONE

REM --- Stage 3: forecast safety net. ---------------------------------------------------
REM Guarantee the 7-day horizon even if Stage 2 spent its run settling due matches.
set "HAS7=True"
for /f "usebackq delims=" %%h in (`powershell -NoProfile -Command "try { if ((Get-Content 'docs\agent-system\outputs\routine_progress_latest.json' -Raw | ConvertFrom-Json).hasSevenDayForecast) { 'True' } else { 'False' } } catch { 'True' }"`) do set "HAS7=%%h"
if /I "%HAS7%"=="False" (
  echo. >> "%LOG%"
  echo [%date% %time%] STAGE 3: 7-day forecast missing - running get:data:topup >> "%LOG%"
  call npm.cmd run get:data:topup >> "%LOG%" 2>&1
  set "TOPUP_EXIT=!ERRORLEVEL!"
  echo [%date% %time%] topup exit=!TOPUP_EXIT! >> "%LOG%"
) else (
  echo [%date% %time%] STAGE 3: 7-day forecast present >> "%LOG%"
)

REM --- Stage 4: notify on matches stuck upcoming past expected finish. -----------------
for /f "usebackq delims=" %%c in (`powershell -NoProfile -Command "try { (Get-Content 'docs\agent-system\outputs\live_stuck_latest.json' -Raw | ConvertFrom-Json).stuck_count } catch { 0 }"`) do set "STUCK=%%c"
if not defined STUCK set "STUCK=0"
if !STUCK! GTR 0 (
  echo. >> "%LOG%"
  echo [%date% %time%] STAGE 4: !STUCK! match^(es^) stuck upcoming past expected finish - notifying >> "%LOG%"
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\notify-toast.ps1 -Title "Soccer Stats: !STUCK! match(es) stuck" -Message "A finished match is still 'upcoming' past expected finish. The routine keeps retrying every run; a manual result import may be needed if no provider has it." >> "%LOG%" 2>&1
) else (
  echo [%date% %time%] STAGE 4: no stuck matches >> "%LOG%"
)

echo. >> "%LOG%"
echo [%date% %time%] === done (live=%LIVE_EXIT% results=%RESULTS_EXIT% topup=%TOPUP_EXIT% stuck=!STUCK!) === >> "%LOG%"
REM Always exit 0: each stage is best-effort and self-heals next run, so Task Scheduler
REM history stays clean. Per-stage status is recorded in the log above.
exit /b 0
