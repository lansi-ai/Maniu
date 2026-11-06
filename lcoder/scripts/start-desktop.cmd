@echo off
rem LCoder desktop launcher (dev). Chinese docs live in start-desktop.ps1.
rem Usage: start-desktop.cmd [-KeepRunning] [-KeepFollowing] [-ListOnly] [-NoBuild]
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-desktop.ps1" %*
exit /b %ERRORLEVEL%
