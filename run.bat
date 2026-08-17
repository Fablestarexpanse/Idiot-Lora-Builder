@echo off
setlocal
title Idiot LoRa Builder
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo  [X] Node.js was not found. Run install.bat first.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  First run detected - running setup...
    call install.bat
    if errorlevel 1 exit /b 1
)

echo  Starting Idiot LoRa Builder...
echo  (First launch compiles the app - give it a few minutes. Keep this
echo   window open while the app is running; close it to stop the app.)
echo.
call npm run tauri dev
if errorlevel 1 (
    echo.
    echo  [X] The app failed to start. Check the messages above.
    pause
    exit /b 1
)
