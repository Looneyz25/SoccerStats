@echo off
REM auto_push.bat - Soccer Stats auto-commit + push
REM Safe to run repeatedly: no-op if nothing changed.
REM Triggered by Windows Task Scheduler every 15 minutes.

setlocal enabledelayedexpansion
cd /d "C:\Users\lvora\OneDrive\Betting\Soccer Stats" || exit /b 1

REM Identity (only sets if missing)
git config user.name >nul 2>&1 || git config user.name "Looneyz25"
git config user.email >nul 2>&1 || git config user.email "l.vorabouth@gmail.com"

REM Clear stale lock if a previous run was interrupted
if exist .git\index.lock del /f /q .git\index.lock >nul 2>&1

REM Stage files. index.html is the live app on GH Pages.
git add index.html match_data.json predictions_*.json predictions_*.md scripts/ docs/ auto_push.bat run_daily.bat
if errorlevel 1 (
  echo [%date% %time%] git add failed
  exit /b 2
)
if exist .github git add .github/ >nul 2>&1

REM Bail if nothing staged
git diff --cached --quiet
if not errorlevel 1 (
  echo [%date% %time%] nothing to commit
  exit /b 0
)

REM Commit (use PowerShell for timestamp - wmic was removed in newer Windows 11)
for /f "delims=" %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-ddTHH:mm"') do set "STAMP=%%a"
git commit -m "Auto-push %STAMP%: settle results + forecasts" >nul
if errorlevel 1 (
  echo [%date% %time%] commit failed
  exit /b 2
)

REM Fetch + rebase before pushing so GH Actions or other concurrent commits get folded in.
REM Strategy: prefer OUR side for data files (we are the source of truth), accept theirs for everything else.
git fetch origin main
git rebase origin/main
if errorlevel 1 (
  echo [%date% %time%] rebase conflict - resolving by preferring local for data files
  git checkout --ours match_data.json Soccer_Stats_Dashboard.html predictions_*.json predictions_*.md >nul 2>&1
  git add match_data.json Soccer_Stats_Dashboard.html predictions_*.json predictions_*.md >nul 2>&1
  git rebase --continue
  if errorlevel 1 (
    echo [%date% %time%] rebase still failing - aborting and bailing out
    git rebase --abort >nul 2>&1
    exit /b 4
  )
)

git push origin main
if errorlevel 1 (
  echo [%date% %time%] push rejected - running `git pull --rebase` once more and retrying
  git pull --rebase --strategy-option=ours origin main
  git push origin main
  if errorlevel 1 (
    echo [%date% %time%] push failed twice - manual intervention needed
    exit /b 3
  )
)

echo [%date% %time%] pushed to origin/main
exit /b 0
