@echo off
REM CS2 AI Chatter - double-click launcher
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed. Get it from https://nodejs.org (v18 or newer^) and run this again.
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed - check the output above.
        pause
        exit /b 1
    )
)

if not exist config.json (
    echo No config found - running the setup wizard first...
    call npm run setup
    if not exist config.json (
        echo Setup did not complete. Run start.bat again when ready.
        pause
        exit /b 1
    )
)

node start.js
pause
