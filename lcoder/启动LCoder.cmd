@echo off
chcp 65001 >nul
setlocal
title LCoder 快速重启（Fast + 自动拉起云端 API）

cd /d "%~dp0.."

echo ========================================
echo   正在启动 LCoder（-Fast -StartCloudApi）...
echo   - 若本地云端 5081 未启动，将自动拉起 E:\Projects\LCoder-cloud
echo   - 自动停止本检出旧 Web 与桌面实例并重启
echo ========================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1" -Fast -StartCloudApi
if errorlevel 1 (
  echo.
  echo [失败] 启动失败，请查看上方日志。
  pause
  exit /b 1
)

echo.
echo [完成] LCoder 已启动，窗口将在 3 秒后自动关闭...
timeout /t 3 /nobreak >nul
endlocal
