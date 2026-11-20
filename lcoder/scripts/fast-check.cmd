@echo off
rem Single-package fast lane. Docs live in fast-check.ps1.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fast-check.ps1" %*
exit /b %ERRORLEVEL%
