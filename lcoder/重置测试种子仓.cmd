@echo off
chcp 65001 >nul
setlocal
title 重置 LCoder 测试种子仓

cd /d "%~dp0.."

echo ========================================
echo   正在重建并还原 LCoder 测试种子仓...
echo ========================================
node "%~dp0scripts\seed-sandbox.mjs" --reset
if errorlevel 1 (
  echo.
  echo [失败] 种子仓重置失败，请查看上方日志。
  pause
  exit /b 1
)

echo.
echo 按任意键关闭窗口...
pause >nul
endlocal
