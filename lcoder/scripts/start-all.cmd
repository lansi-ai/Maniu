@echo off
rem LCoder start-all launcher (dev). Chinese docs live in start-all.ps1.
rem Default desktop: new client; add -Legacy for the upstream shell.
rem Usage: start-all.cmd [-Fast] [-Legacy] [-NoWeb] [-NoDesktop] [-WebPort N] [-Stop] [-ListOnly] [-KeepFollowing] [-CloudApi URL] [-SkipCloudCheck] [-StartCloudApi] [-CloudRepo PATH] [-CloudEnvFile PATH] [-CloudApiTimeoutSec N]
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-all.ps1" %*
exit /b %ERRORLEVEL%
