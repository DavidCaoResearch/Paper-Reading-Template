@echo off
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [Setup] Installing dependencies...
    call npm install --silent
)

node launcher.js
pause
