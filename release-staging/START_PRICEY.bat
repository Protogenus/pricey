@echo off
REM Pricey launcher - starts the Pricey desktop app.
setlocal
cd /d "%~dp0"
if not exist "Pricey.exe" (
  echo ERROR: Pricey.exe was not found.
  echo Make sure you extracted the whole zip, keeping the folder structure.
  echo.
  pause
  exit /b 1
)
start "" "Pricey.exe"
if errorlevel 1 (
  echo ERROR: Pricey failed to start (error %errorlevel%).
  echo.
  pause
  exit /b 1
)
endlocal
