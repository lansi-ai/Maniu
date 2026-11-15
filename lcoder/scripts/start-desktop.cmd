@echo off
rem LCoder desktop launcher (dev). Chinese docs live in start-desktop.ps1.
rem Default: new client (packages/lcoder/desktop launch). Add -Legacy for the upstream shell.
rem Usage: start-desktop.cmd [-Legacy] [-KeepRunning] [-KeepFollowing] [-ListOnly] [-NoBuild] [-Fast] [-Smoke -Legacy]
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-desktop.ps1" %*
exit /b %ERRORLEVEL%
