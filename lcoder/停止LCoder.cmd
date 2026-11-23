@echo off
chcp 65001 >nul
setlocal
title 停止 LCoder

cd /d "%~dp0.."

echo ========================================
echo   正在停止 LCoder 所有实例并释放端口...
echo ========================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1" -Stop
if errorlevel 1 (
  echo.
  echo [失败] 停止出错，请查看上方日志。
  pause
  exit /b 1
)

echo.
echo [完成] 已停止，窗口将在 2 秒后自动关闭...
timeout /t 2 /nobreak >nul
endlocal
