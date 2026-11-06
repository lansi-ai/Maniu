@echo off
rem Layer-targeted rebuild. Docs live in rebuild.ps1.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rebuild.ps1" %*
exit /b %ERRORLEVEL%
