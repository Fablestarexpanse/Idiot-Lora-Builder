@echo off
setlocal
title Idiot LoRa Builder - Install
echo.
echo  ============================================
echo   Idiot LoRa Builder - one-time setup
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo  [X] Node.js was not found.
    echo      Install the LTS version from: https://nodejs.org/
    echo      Then run this script again.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo  [OK] Node.js %%v

where cargo >nul 2>nul
if errorlevel 1 (
    echo  [X] Rust was not found.
    echo      Install it from: https://rustup.rs/  ^(default options are fine^)
    echo      Then close this window, open a NEW one, and run this script again.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('cargo --version') do echo  [OK] %%v

echo.
echo  Installing dependencies (this can take a few minutes)...
echo.
cd /d "%~dp0"
call npm install
if errorlevel 1 (
    echo.
    echo  [X] npm install failed. Check the messages above.
    pause
    exit /b 1
)

echo.
echo  [OK] Setup complete. Double-click run.bat to start the app.
echo       (The very first launch compiles the app and takes a few minutes;
echo        after that it starts fast.)
echo.
pause
