@echo off
rem LCoder one-shot smoke. English-only wrapper; notes live in lcoder/scripts/smoke.mjs.
chcp 65001 >nul
node "%~dp0smoke.mjs" %*
exit /b %ERRORLEVEL%
