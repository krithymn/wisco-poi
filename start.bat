@echo off
title WISCO POI Server
color 0A

:: Always change to the folder where this bat file lives
cd /d "%~dp0"

echo.
echo  ========================================
echo   WISCO POI Server - Starting...
echo  ========================================
echo.
echo  Working folder: %cd%
echo.

:: Check if node is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  ERROR: Node.js is not installed!
    echo  Please download and install from: https://nodejs.org
    echo.
    pause
    exit /b
)

:: Install packages if node_modules missing
if not exist "node_modules" (
    echo  Installing packages for first time... please wait...
    npm install
    echo.
)

:: Start server on port 80
echo  Server is starting on port 80...
echo.
node server.js

pause
