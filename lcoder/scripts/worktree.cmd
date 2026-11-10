@echo off
rem LCoder worktree space helper. Chinese docs live in worktree.ps1.
rem Usage: worktree.cmd -Action <help|junction|sparse|clean|inspect|provision|build|lock|warm|claim|release> [options]
rem provision/build select the target with -Path; -Name also works for .worktrees\<name>.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0worktree.ps1" %*
exit /b %ERRORLEVEL%
