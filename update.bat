@echo off
setlocal
title Idiot LoRa Builder - Update
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update.ps1"
set "update_result=%errorlevel%"
echo.
pause
exit /b %update_result%
