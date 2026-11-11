@echo off
rem LCoder start-all launcher (dev). Chinese docs live in start-all.ps1.
rem Usage: start-all.cmd [-Fast] [-NoWeb] [-NoDesktop] [-WebPort N] [-Stop] [-ListOnly] [-KeepFollowing] [-CloudApi URL] [-SkipCloudCheck]
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-all.ps1" %*
exit /b %ERRORLEVEL%
