@echo off
rem LCoder new-client cutover smoke (T-199 C4): twelve named checks. Chinese notes live
rem in smoke-lcoder.mjs. Ports 9822/9829/9830, mock cloud 5091, in-tree DSH_HOME.
chcp 65001 >nul
node "%~dp0smoke-lcoder.mjs" %*
exit /b %ERRORLEVEL%
