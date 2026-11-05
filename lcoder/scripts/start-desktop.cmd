@echo off
rem 启动 LCoder 桌面端（开发态）。中文与实时进度见同目录的 start-desktop.ps1。
rem 用法：start-desktop.cmd [-KeepRunning] [-KeepFollowing] [-ListOnly]
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-desktop.ps1" %*
