# 启动 LCoder 桌面端（开发态）。
#
# 为什么有它：dev:desktop 的构建门禁与 vite 输出都是彩色的、且默认重定向到文件后终端一片死寂，
# 中文在 cmd 下还会乱码。这个脚本做三件事——按路径精确停掉本仓的旧实例、把启动放到独立进程、
# 实时把日志按 UTF-8 打印出来（去掉 ANSI 颜色码），就绪后直接给出带 token 的地址。
#
# 用法：
#   lcoder\scripts\start-desktop.cmd                # 停旧实例 → 构建 → 启动 → 跟随到就绪（默认不跑运行时冒烟）
#   lcoder\scripts\start-desktop.cmd -KeepRunning   # 不停旧实例（多开会被单实例锁挡住）
#   lcoder\scripts\start-desktop.cmd -ListOnly      # 只列出会停掉哪些进程，不做任何改动
#   lcoder\scripts\start-desktop.cmd -KeepFollowing # 就绪后继续跟随日志
#   lcoder\scripts\start-desktop.cmd -Smoke         # 连运行时冒烟一起跑（发布验收口径，慢百秒级）
#   lcoder\scripts\start-desktop.cmd -NoBuild       # 跳过构建门禁（改过源码别用）
#   lcoder\scripts\start-desktop.cmd -Fast          # -NoBuild 加跳过冒烟（产物没变时的最快启动）
param(
  [switch]$KeepRunning,
  [switch]$KeepFollowing,
  [switch]$ListOnly,
  [switch]$NoBuild,
  [switch]$Fast,
  [switch]$Smoke,
  [int]$ReadyTimeoutSec = 300
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$OutputEncoding = [Text.UTF8Encoding]::new()

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path $root 'lcoder\logs'
$log = Join-Path $logDir 'desktop-main.log'
. (Join-Path $PSScriptRoot 'lcoder-dev-common.ps1')

# 只认这个检出：electron 的 --user-data-dir 落在本仓，或启动器在跑本仓的 scripts/dev.ts。
$targets = @(Get-RepoDesktopProcesses -Root $root)
if ($ListOnly) {
  if ($targets.Count -eq 0) { Write-Host '没有正在运行的 LCoder 桌面实例。' -ForegroundColor Green }
  else { $targets | ForEach-Object { Write-Host ("会停掉 PID {0}（{1}）" -f $_.ProcessId, $_.Name) } }
  return
}

if (-not $KeepRunning -and @($targets).Count -gt 0) {
  Stop-RepoProcessTrees -Processes $targets
  Start-Sleep -Milliseconds 800
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if (Test-Path $log) { Remove-Item $log -Force }

Write-Host ("启动 {0}" -f $root) -ForegroundColor Cyan
Write-Host ("日志 {0}" -f $log) -ForegroundColor DarkGray
$started = Get-Date
# -NoBuild 走 start:desktop（跳过 26 秒左右的构建门禁）；改过源码不要用它，会跑旧产物。
# 运行时冒烟（python 三条检查加 Office 往返）是发布验收口径，百秒级；开发启动默认跳过，
# 需要复核时加 -Smoke。
Start-DesktopInstance -Root $root -LogPath $log -SkipBuild:($NoBuild -or $Fast) -SkipSmoke:$Smoke | Out-Null

# 超时按「多久没有新输出」算，不按总时长：准备运行时会静默几分钟，那不算卡死。
$deadline = $started.AddSeconds($ReadyTimeoutSec)
$lastOutput = Get-Date
$printed = 0
$stop = $false
Write-Host '---- 实时输出（Ctrl+C 只停止跟随，不影响已启动的实例） ----' -ForegroundColor DarkGray

while (-not $stop) {
  $delta = Read-LogDelta -LogPath $log -From $printed
  if ($delta.Lines.Count -gt 0) {
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
    $lastOutput = Get-Date
  }
  foreach ($raw in $delta.Lines) {
    $line = Remove-AnsiColors -Line $raw
    $elapsed = [int]((Get-Date) - $started).TotalSeconds
    Write-Host ("[{0,3}s] {1}" -f $elapsed, $line)
    if ($line -match 'dsh web:\s*(http://\S+)') {
      $url = $Matches[1]
      Write-Host ''
      Write-Host ("就绪：{0}" -f $url) -ForegroundColor Green
      Write-Host '窗口应已弹出；关窗口即停止。' -ForegroundColor Green
      if (-not $KeepFollowing) { $stop = $true }
    }
  }
  $printed = $delta.Count
  if (-not $stop -and ((Get-Date) - $lastOutput).TotalSeconds -ge 20) {
    $quiet = [int]((Get-Date) - $lastOutput).TotalSeconds
    $elapsed = [int]((Get-Date) - $started).TotalSeconds
    Write-Host ("[{0,3}s] …还在准备（日志已 {1} 秒没有新行，进程仍存活），继续等" -f $elapsed, $quiet) -ForegroundColor DarkGray
    $lastOutput = Get-Date
  }
  if (-not $stop -and (Get-Date) -gt $deadline) {
    Write-Host ("连续 {0} 秒没有新输出、仍未就绪，请把上面最后 20 行发出来。" -f $ReadyTimeoutSec) -ForegroundColor Red
    $stop = $true
  }
  if (-not $stop) { Start-Sleep -Milliseconds 300 }
}
