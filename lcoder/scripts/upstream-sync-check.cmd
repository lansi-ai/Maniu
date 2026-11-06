@echo off
rem Upstream sync health check. Docs live in upstream-sync-check.ps1.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0upstream-sync-check.ps1" %*
exit /b %ERRORLEVEL%
