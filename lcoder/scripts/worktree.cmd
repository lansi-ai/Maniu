@echo off
rem LCoder worktree space helper. Chinese docs live in worktree.ps1.
rem Usage: worktree.cmd -Action <help|junction|sparse|clean|inspect> [options]
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0worktree.ps1" %*
exit /b %ERRORLEVEL%
