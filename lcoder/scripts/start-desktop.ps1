# 启动 LCoder 桌面端（开发态）。
#
# 为什么有它：dev:desktop 的构建门禁与 vite 输出都是彩色的、且默认重定向到文件后终端一片死寂，
# 中文在 cmd 下还会乱码。这个脚本做三件事——按路径精确停掉本仓的旧实例、把启动放到独立进程、
# 实时把日志按 UTF-8 打印出来（去掉 ANSI 颜色码），就绪后直接给出带 token 的地址。
#
# 用法：
#   lcoder\scripts\start-desktop.cmd                # 停旧实例 → 启动 → 实时跟随到就绪
#   lcoder\scripts\start-desktop.cmd -KeepRunning   # 不停旧实例（多开会被单实例锁挡住）
#   lcoder\scripts\start-desktop.cmd -ListOnly      # 只列出会停掉哪些进程，不做任何改动
#   lcoder\scripts\start-desktop.cmd -KeepFollowing # 就绪后继续跟随日志
#   lcoder\scripts\start-desktop.cmd -NoBuild       # 跳过构建门禁（改过源码别用）
param(
  [switch]$KeepRunning,
  [switch]$KeepFollowing,
  [switch]$ListOnly,
  [switch]$NoBuild,
  [int]$ReadyTimeoutSec = 300
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$OutputEncoding = [Text.UTF8Encoding]::new()

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path $root 'lcoder\logs'
$log = Join-Path $logDir 'desktop-main.log'
$electronData = Join-Path $root 'apps\desktop\.desktop-build\development\electron-user-data'

function Get-RepoDevProcesses {
  # 只认这个检出：electron 的 --user-data-dir 落在本仓，或启动器在跑本仓的 scripts/dev.ts。
  $all = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine }
  $all | Where-Object {
    ($_.Name -eq 'electron.exe' -and $_.CommandLine -like "*$electronData*") -or
    ($_.Name -eq 'node.exe' -and $_.CommandLine -like "*$root*" -and $_.CommandLine -like '*scripts*dev.ts*')
  }
}

$targets = Get-RepoDevProcesses
if ($ListOnly) {
  if ($targets.Count -eq 0) { Write-Host '没有正在运行的 LCoder 桌面实例。' -ForegroundColor Green }
  else { $targets | ForEach-Object { Write-Host ("会停掉 PID {0}（{1}）" -f $_.ProcessId, $_.Name) } }
  return
}

if (-not $KeepRunning -and $targets.Count -gt 0) {
  foreach ($p in $targets) {
    Write-Host ("停掉旧实例 PID {0}（{1}）" -f $p.ProcessId, $p.Name) -ForegroundColor DarkYellow
    & taskkill.exe /PID $p.ProcessId /T /F *> $null
  }
  Start-Sleep -Milliseconds 800
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if (Test-Path $log) { Remove-Item $log -Force }

$env:PATH = (Join-Path $env:USERPROFILE '.pnpm\bin') + ';' + $env:PATH
$env:NO_COLOR = '1'          # 让 vite / 门禁不再吐 ANSI，日志本身就干净
$env:FORCE_COLOR = '0'

Write-Host ("启动 {0}" -f $root) -ForegroundColor Cyan
Write-Host ("日志 {0}" -f $log) -ForegroundColor DarkGray
$started = Get-Date
# -NoBuild 走 start:desktop（跳过 26 秒左右的构建门禁）；改过源码不要用它，会跑旧产物。
$scriptName = if ($NoBuild) { 'start:desktop' } else { 'dev:desktop' }
Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/d', '/c', "pnpm run $scriptName > `"$log`" 2>&1" `
  -WorkingDirectory $root -WindowStyle Hidden | Out-Null

$esc = [string][char]27
$ansi = [regex]($esc + '\[[0-9;?]*[a-zA-Z]')
$deadline = $started.AddSeconds($ReadyTimeoutSec)
$printed = 0
$stop = $false
Write-Host '---- 实时输出（Ctrl+C 只停止跟随，不影响已启动的实例） ----' -ForegroundColor DarkGray

while (-not $stop) {
  if (Test-Path $log) {
    $lines = @(Get-Content -LiteralPath $log -Encoding utf8 -ErrorAction SilentlyContinue)
    for ($i = $printed; $i -lt $lines.Count; $i++) {
      $line = $ansi.Replace($lines[$i], '')
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
    $printed = $lines.Count
  }
  if (-not $stop -and (Get-Date) -gt $deadline) {
    Write-Host ("超过 {0} 秒仍未就绪，请把上面最后 20 行发出来。" -f $ReadyTimeoutSec) -ForegroundColor Red
    $stop = $true
  }
  if (-not $stop) { Start-Sleep -Milliseconds 300 }
}
