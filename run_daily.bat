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
echo [%date% %time%] === run_daily start === > "%LOG%"

REM Polite collection defaults. Use official/API sources first and keep request
REM cadence gentle instead of trying to bypass provider blocking.
if not defined SOCCER_PHASE2_SLEEP set "SOCCER_PHASE2_SLEEP=2.5"
if not defined SOCCER_ODDS_BUDGET set "SOCCER_ODDS_BUDGET=80"
if not defined SOCCER_SPORTSBET_DEEP_BUDGET set "SOCCER_SPORTSBET_DEEP_BUDGET=120"

REM Run the split controller. It preflights due times before touching data.
echo. >> "%LOG%"
echo [%date% %time%] running npm.cmd run get:data:results >> "%LOG%"
call npm.cmd run get:data:results >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] get:data:results failed with errorlevel %errorlevel% >> "%LOG%"
  exit /b 2
)

echo [%date% %time%] === run_daily done === >> "%LOG%"
exit /b 0
