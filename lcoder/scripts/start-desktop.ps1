# 启动 LCoder 桌面端（开发态）。
#
# 为什么有它：构建门禁与 vite 输出都是彩色的、且默认重定向到文件后终端一片死寂，
# 中文在 cmd 下还会乱码。这个脚本做三件事——按路径精确停掉本仓的旧实例、把启动放到独立进程、
# 实时把日志按 UTF-8 打印出来（去掉 ANSI 颜色码），就绪后直接给出宿主地址。
#
# 默认拉起新客户端（packages/lcoder/desktop 的 launch.mjs，宿主监听随机端口，inspector
# 9829/9822/9830）；-Legacy 回退旧壳（dev:desktop，9229/9222/9230，就绪行是带 token 的 dsh web）。
# 新客户端的构建只跑 build:artifacts（Host 面产出 desktop lib，Client 面同时产出 client/lib/dist）。
#
# 用法：
#   lcoder\scripts\start-desktop.cmd                # 停旧实例 → 构建 → 启动新客户端 → 跟随到宿主就绪
#   lcoder\scripts\start-desktop.cmd -Legacy        # 同上，但启动旧壳
#   lcoder\scripts\start-desktop.cmd -KeepRunning   # 不停旧实例（多开会被单实例锁挡住）
#   lcoder\scripts\start-desktop.cmd -ListOnly      # 只列出会停掉哪些进程，不做任何改动
#   lcoder\scripts\start-desktop.cmd -KeepFollowing # 就绪后继续跟随日志
#   lcoder\scripts\start-desktop.cmd -Smoke -Legacy # 连旧壳的运行时冒烟一起跑（发布验收口径，慢百秒级）
#   lcoder\scripts\start-desktop.cmd -NoBuild       # 跳过构建门禁（改过源码别用）
#   lcoder\scripts\start-desktop.cmd -Fast          # -NoBuild（产物没变时的最快启动）
param(
  [switch]$KeepRunning,
  [switch]$KeepFollowing,
  [switch]$ListOnly,
  [switch]$NoBuild,
  [switch]$Fast,
  [switch]$Smoke,
  [switch]$Legacy,
  [int]$ReadyTimeoutSec = 300
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$OutputEncoding = [Text.UTF8Encoding]::new()

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path $root 'lcoder\logs'
$log = Join-Path $logDir 'desktop-main.log'
. (Join-Path $PSScriptRoot 'lcoder-dev-common.ps1')

# 只认这个检出：electron 的 --user-data-dir 落在本仓（旧壳）或以本检出 desktop 包为 app 路径（新客户端），
# 或启动器在跑本仓的 scripts/dev.ts / host-entry.js。
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

$modeLabel = if ($Legacy) { '旧壳（-Legacy）' } else { '新客户端' }
Write-Host ("启动 {0}：{1}" -f $modeLabel, $root) -ForegroundColor Cyan
Write-Host ("日志 {0}" -f $log) -ForegroundColor DarkGray
$inspectors = (Get-DesktopInspectorPorts -Legacy:$Legacy | ForEach-Object { "{0}={1}" -f $_.Name, $_.Value }) -join ', '
Write-Host ("inspector {0}" -f $inspectors) -ForegroundColor DarkGray
if ($Smoke -and -not $Legacy) {
  Write-Host '-Smoke 只对旧壳生效（新客户端没有运行时冒烟步骤），已忽略；需要冒烟请加 -Legacy。' -ForegroundColor Yellow
}
$started = Get-Date
# -NoBuild/-Fast 跳过构建：新客户端用 build:artifacts 一次产出两边产物，旧壳走 dev:desktop 的构建门禁。
# 运行时冒烟只在 -Legacy 下有意义，且是发布验收口径、百秒级；开发启动默认跳过。
Start-DesktopInstance -Root $root -LogPath $log -SkipBuild:($NoBuild -or $Fast) -RunSmoke:($Smoke -and $Legacy) -Legacy:$Legacy | Out-Null

# 超时按「多久没有新输出」算，不按总时长：准备运行时会静默几分钟，那不算卡死。
$deadline = $started.AddSeconds($ReadyTimeoutSec)
$lastOutput = Get-Date
$printed = 0
$stop = $false
$readyPattern = Get-DesktopReadyPattern -Legacy:$Legacy
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
    if ($line -match $readyPattern) {
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
