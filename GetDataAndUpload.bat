@echo off
setlocal

cd /d "%~dp0"

echo Soccer Stats get:data
echo Working folder: %CD%
echo.
echo This will collect data, run the phase pipeline, refresh local JSON, upload league docs to Firestore, and write logs under:
echo docs\agent-system\outputs\get_data_latest.md
echo docs\agent-system\outputs\get_data_latest.json
echo.

call npm.cmd run get:data
set EXIT_CODE=%ERRORLEVEL%

echo.
if "%EXIT_CODE%"=="0" (
  echo get:data completed successfully.
) else (
  echo get:data failed with exit code %EXIT_CODE%.
)
echo.
echo Latest log:
echo %CD%\docs\agent-system\outputs\get_data_latest.md
echo.

pause
exit /b %EXIT_CODE%
