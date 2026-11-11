# 一条命令拉起本检出的 Web 与桌面端（开发态）。
#
# 为什么有它：Web（3080）与桌面（9222/9229/9230）各有一套启动方式，手工起两份很容易
# 落到别人的端口、别人的 home 或上一次没清干净的进程上。这个脚本按固定顺序做四件事：
# 先按路径停掉本检出的旧实例 → 构建（-Fast 跳过）→ 先起 Web 再起桌面 → 等两边就绪并给出
# 日志位置与带 token 的地址。进程归属只按本检出路径与 user-data-dir 判断，不碰主检出、
# 别的工作树、别处占着端口的 Web。
#
# 用法：
#   lcoder\scripts\start-all.cmd                 # 构建 → 起 Web(3080) → 起桌面(9222/9229/9230)
#   lcoder\scripts\start-all.cmd -Fast           # 跳过构建与冒烟（产物没变时的最快启动）
#   lcoder\scripts\start-all.cmd -NoWeb          # 只起桌面
#   lcoder\scripts\start-all.cmd -NoDesktop      # 只起 Web
#   lcoder\scripts\start-all.cmd -WebPort 3081   # 换 Web 端口
#   lcoder\scripts\start-all.cmd -KeepFollowing  # 就绪后继续跟随两边日志（Ctrl+C 只停跟随）
#   lcoder\scripts\start-all.cmd -ListOnly       # 只列本检出会停掉哪些进程
#   lcoder\scripts\start-all.cmd -Stop           # 停本检出的两边并核对端口释放
#
# 桌面的 inspector 端口沿用上游环境变量：DSH_DESKTOP_MAIN_INSPECT_PORT（9229）、
# DSH_DESKTOP_RENDERER_DEBUG_PORT（9222）、DSH_DESKTOP_HOST_INSPECT_PORT（9230）。
# Web 的 DSH_HOME 默认落到本检出的 .dsh-home（已在 .gitignore），不写用户目录。
param(
  [switch]$Fast,
  [switch]$NoWeb,
  [switch]$NoDesktop,
  [int]$WebPort = 3080,
  [switch]$Stop,
  [switch]$ListOnly,
  [switch]$KeepFollowing,
  [switch]$Help,
  [int]$ReadyTimeoutSec = 300
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$OutputEncoding = [Text.UTF8Encoding]::new()

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path $root 'lcoder\logs'
$webLog = Join-Path $logDir 'web.log'
$desktopLog = Join-Path $logDir 'desktop-main.log'
$statePath = Join-Path $logDir 'start-all-state.json'
. (Join-Path $PSScriptRoot 'lcoder-dev-common.ps1')

function Show-Usage {
  Write-Host @'
start-all：一条命令拉起本检出的 Web 与桌面端（开发态）。

用法
  lcoder\scripts\start-all.cmd [选项]

选项
  -Fast              跳过构建与运行时冒烟，直接用现有产物启动
  -NoWeb             只起桌面
  -NoDesktop         只起 Web
  -WebPort <端口>     Web 端口（默认 3080）
  -Stop              停掉本检出的两边，并核对端口已释放
  -ListOnly          只列出会停掉哪些进程，不做任何改动
  -KeepFollowing     两边就绪后继续跟随日志
  -ReadyTimeoutSec <秒>  单边连续多少秒没有新输出算失败（默认 300）
  -Help              打印本帮助

顺序与产物
  1. 构建：pnpm run build:artifacts，再 pnpm --filter @deepseek-ai/dsh-desktop run build
  2. Web：pnpm run start:web，日志 lcoder\logs\web.log
  3. 桌面：复用 start-desktop 的启动与就绪检测，日志 lcoder\logs\desktop-main.log
  Web 的 DSH_HOME 默认指向本检出 .dsh-home；桌面的 home/userData 沿用 dev.ts 的仓内默认值。

进程归属
  只停 electron --user-data-dir 落在本检出、或命令行带本检出根路径的进程；
  端口上的进程不属于本检出时只报告、不终止。Ctrl+C 只停止跟随，不停已启动的实例。
'@
}

function Assert-WebPort {
  if ($WebPort -lt 1 -or $WebPort -gt 65535) { throw "WebPort 必须是 1..65535 的整数，收到 $WebPort" }
}

# 端口是否有人在听。Get-NetTCPConnection 在 Windows 8+ 可用。
function Test-PortListening {
  param([Parameter(Mandatory = $true)][int]$Port)
  return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0
}

# 列出监听端口的进程；端口空着时返回空数组。
function Get-PortOwnerProcesses {
  param([Parameter(Mandatory = $true)][int]$Port)
  $owners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  $result = @()
  foreach ($pidValue in $owners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
    if ($null -ne $process) { $result += $process }
  }
  return $result
}

# 进程是否属于本检出：命令行走本检出路径，或就是本检出记录在案的启动器。
function Test-ProcessOwnedByCheckout {
  param([Parameter(Mandatory = $true)][object]$Process)
  if (-not $Process.CommandLine) { return $false }
  return $Process.CommandLine -like "*$root*"
}

function Read-StartAllState {
  if (-not (Test-Path -LiteralPath $statePath)) { return $null }
  try { return (Get-Content -LiteralPath $statePath -Raw -Encoding utf8 | ConvertFrom-Json) }
  catch { return $null }   # 状态文件损坏等同于没有记录：下面还有按路径与端口的兜底识别
}

function Save-StartAllState {
  param([int]$LauncherPid, [int]$Port)
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  # 启动器 PID 只用来找回子进程树；归属校验仍然要求命令行带本检出根路径。
  $state = [ordered]@{ root = $root; webPid = $LauncherPid; webPort = $Port; started = (Get-Date).ToString('o') }
  $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
}

function Clear-StartAllState {
  if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath -Force }
}

# 本检出的 Web 进程：记录中的启动器、命令行带根路径的 node 启动器、以及本端口上归属本检出的监听进程。
function Get-RepoWebProcesses {
  param([int]$Port = $WebPort)
  $found = @()
  $state = Read-StartAllState
  if ($null -ne $state -and $null -ne $state.webPid) {
    $recorded = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$state.webPid) -ErrorAction SilentlyContinue
    if ($null -ne $recorded -and (Test-ProcessOwnedByCheckout -Process $recorded)) { $found += $recorded }
  }
  $all = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine })
  $byPath = @($all | Where-Object {
    (Test-ProcessOwnedByCheckout -Process $_) -and
    ($_.CommandLine -like '*apps\cli\src\bin.ts*' -or $_.CommandLine -like '*scripts\dev-web.ts*' -or
     $_.CommandLine -like '*start:web*' -or $_.CommandLine -like '*dev:web*')
  })
  $found += $byPath
  foreach ($owner in (Get-PortOwnerProcesses -Port $Port)) {
    if (Test-ProcessOwnedByCheckout -Process $owner) { $found += $owner }
  }
  $byPid = @{}
  foreach ($process in $found) { $byPid[[int]$process.ProcessId] = $process }
  return @($byPid.Values)
}

# 等端口释放；返回是否已释放。
function Wait-PortReleased {
  param([int]$Port, [int]$TimeoutSec = 20)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (-not (Test-PortListening -Port $Port)) { return $true }
    Start-Sleep -Milliseconds 300
  }
  return (-not (Test-PortListening -Port $Port))
}

# 构建两边共用的产物。命令与 dev.ts 的构建门禁一致：先全量 artifacts，再桌面外壳。
function Invoke-RepoBuild {
  $steps = @(
    @{ Label = 'build:artifacts'; Command = 'pnpm --config.verify-deps-before-run=false run build:artifacts' },
    @{ Label = '桌面外壳 build'; Command = 'pnpm --config.verify-deps-before-run=false --filter @deepseek-ai/dsh-desktop run build' }
  )
  foreach ($step in $steps) {
    Write-Host ("---- 构建 {0}：{1} ----" -f $step.Label, $step.Command) -ForegroundColor Cyan
    $started = Get-Date
    & cmd.exe /d /c $step.Command
    $code = $LASTEXITCODE
    $elapsed = [int]((Get-Date) - $started).TotalSeconds
    if ($code -ne 0) {
      throw ("{0} 失败（退出码 {1}），产物不可用；只改过产物以外的东西时可用 -Fast 跳过构建。" -f $step.Command, $code)
    }
    Write-Host ("✓ {0} 完成（{1} 秒）" -f $step.Label, $elapsed) -ForegroundColor Green
  }
}

# 起 Web（start:web 口径，不带 watch）；DSH_HOME 不写用户目录，只在启动这一下临时设置。
function Start-WebInstance {
  $previousHome = $env:DSH_HOME
  if (-not $previousHome) { $env:DSH_HOME = Join-Path $root '.dsh-home' }
  # pnpm 11 在 node_modules 与锁文件不一致时会先跑一次安装并弹交互确认，隐藏窗口里没有 stdin，
  # 会一直等；依赖由 worktree claim / rebuild 负责，这里不重装。该开关只认 CLI 配置。
  try {
    $process = Start-Process -FilePath 'cmd.exe' `
      -ArgumentList '/d', '/c', "pnpm --config.verify-deps-before-run=false run start:web --port $WebPort --no-open > `"$webLog`" 2>&1" `
      -WorkingDirectory $root -WindowStyle Hidden -PassThru
    return $process.Id
  } finally {
    $env:DSH_HOME = $previousHome
  }
}

# 跟随一边的日志直到出现 ready 行。
# 超时按「多久没有新输出」算，不按总时长：准备运行时会静默几分钟，那不算卡死。
# @returns @{ Ready = bool; Url = string; Tail = string[]; Reason = string }
function Wait-SideReady {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][int]$LauncherPid,
    [Parameter(Mandatory = $true)][datetime]$Started
  )
  $printed = 0
  $lastOutput = Get-Date
  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
  $tail = New-Object System.Collections.Generic.List[string]
  Write-Host ("---- {0} 实时输出（Ctrl+C 只停止跟随，不影响已启动的实例） ----" -f $Name) -ForegroundColor DarkGray
  while ($true) {
    $delta = Read-LogDelta -LogPath $LogPath -From $printed
    if ($delta.Lines.Count -gt 0) {
      $lastOutput = Get-Date
      $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
    }
    foreach ($raw in $delta.Lines) {
      $line = Remove-AnsiColors -Line $raw
      $tail.Add($line)
      if ($tail.Count -gt 30) { $tail.RemoveAt(0) }
      $elapsed = [int]((Get-Date) - $Started).TotalSeconds
      Write-Host ("[{0}] [{1,3}s] {2}" -f $Name, $elapsed, $line)
      if ($line -match 'dsh web:\s*(http://\S+)') {
        return @{ Ready = $true; Url = $Matches[1]; Tail = $tail.ToArray(); Reason = '' }
      }
    }
    $printed = $delta.Count
    if ($null -eq (Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue)) {
      return @{ Ready = $false; Url = ''; Tail = $tail.ToArray(); Reason = '启动器已退出' }
    }
    if (((Get-Date) - $lastOutput).TotalSeconds -ge 20) {
      $quiet = [int]((Get-Date) - $lastOutput).TotalSeconds
      $elapsed = [int]((Get-Date) - $Started).TotalSeconds
      Write-Host ("[{0}] [{1,3}s] …还在准备（日志已 {2} 秒没有新行，进程仍存活），继续等" -f $Name, $elapsed, $quiet) -ForegroundColor DarkGray
      $lastOutput = Get-Date
    }
    if ((Get-Date) -gt $deadline) {
      return @{ Ready = $false; Url = ''; Tail = $tail.ToArray(); Reason = ("连续 {0} 秒没有新输出" -f $ReadyTimeoutSec) }
    }
    Start-Sleep -Milliseconds 300
  }
}

# 从桌面日志里取 inspector 端口那行，供汇总展示。
function Read-DesktopInspectors {
  param([Parameter(Mandatory = $true)][string]$LogPath)
  if (-not (Test-Path -LiteralPath $LogPath)) { return '' }
  $match = Select-String -LiteralPath $LogPath -Pattern 'inspectors main=(\d+), renderer=(\d+), host=(\d+)' -Encoding utf8 |
    Select-Object -Last 1
  if ($null -eq $match) { return '' }
  return ("main={0}, renderer={1}, host={2}" -f $match.Matches[0].Groups[1].Value,
    $match.Matches[0].Groups[2].Value, $match.Matches[0].Groups[3].Value)
}

# 停掉请求的一边或两边，并核对端口释放。返回是否干净。
function Stop-OwnedSides {
  param([bool]$StopWeb, [bool]$StopDesktop)
  $clean = $true
  if ($StopWeb) {
    $web = @(Get-RepoWebProcesses -Port $WebPort)
    $foreign = @(Get-PortOwnerProcesses -Port $WebPort | Where-Object { -not (Test-ProcessOwnedByCheckout -Process $_) })
    if ($web.Count -eq 0) {
      if ($foreign.Count -gt 0) {
        Write-Host ("Web：端口 {0} 被本检出以外的进程占用（PID {1}），不动它。" -f $WebPort, (($foreign | ForEach-Object { $_.ProcessId }) -join ',')) -ForegroundColor Red
        $clean = $false
      } else {
        Write-Host ("Web：本检出没有实例在跑，端口 {0} 空着。" -f $WebPort) -ForegroundColor Green
      }
    } else {
      Stop-RepoProcessTrees -Processes $web
      Clear-StartAllState
      if (Wait-PortReleased -Port $WebPort) {
        Write-Host ("Web：已停止，端口 {0} 已释放。" -f $WebPort) -ForegroundColor Green
      } else {
        Write-Host ("Web：进程已停但端口 {0} 仍被占用。" -f $WebPort) -ForegroundColor Red
        $clean = $false
      }
    }
  }
  if ($StopDesktop) {
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
      $left = @(Get-RepoDesktopProcesses -Root $root)
      if ($left.Count -eq 0) { break }
      Stop-RepoProcessTrees -Processes $left
      Start-Sleep -Milliseconds 500
    }
    $left = @(Get-RepoDesktopProcesses -Root $root)
    if ($left.Count -eq 0) {
      Write-Host '桌面：已停止，没有残留进程。' -ForegroundColor Green
    } else {
      Write-Host ("桌面：仍有残留 PID {0}。" -f (($left | ForEach-Object { $_.ProcessId }) -join ',')) -ForegroundColor Red
      $clean = $false
    }
    $mainPort = 9229
    if ($env:DSH_DESKTOP_MAIN_INSPECT_PORT) { $mainPort = [int]$env:DSH_DESKTOP_MAIN_INSPECT_PORT }
    $rendererPort = 9222
    if ($env:DSH_DESKTOP_RENDERER_DEBUG_PORT) { $rendererPort = [int]$env:DSH_DESKTOP_RENDERER_DEBUG_PORT }
    $hostPort = 9230
    if ($env:DSH_DESKTOP_HOST_INSPECT_PORT) { $hostPort = [int]$env:DSH_DESKTOP_HOST_INSPECT_PORT }
    foreach ($port in @(
      @{ Name = 'main'; Value = $mainPort },
      @{ Name = 'renderer'; Value = $rendererPort },
      @{ Name = 'host'; Value = $hostPort }
    )) {
      if (Test-PortListening -Port $port.Value) {
        $owners = @(Get-PortOwnerProcesses -Port $port.Value | Where-Object { Test-ProcessOwnedByCheckout -Process $_ })
        if ($owners.Count -gt 0) {
          Write-Host ("桌面 inspector {0}={1} 仍被本检出进程占用。" -f $port.Name, $port.Value) -ForegroundColor Red
          $clean = $false
        } else {
          Write-Host ("桌面 inspector {0}={1} 被本检出以外的进程占用，不动它。" -f $port.Name, $port.Value) -ForegroundColor DarkYellow
        }
      } else {
        Write-Host ("桌面 inspector {0}={1} 已释放。" -f $port.Name, $port.Value) -ForegroundColor Green
      }
    }
  }
  return $clean
}

# ==== 主流程 ====

if ($Help) { Show-Usage; return }
Assert-WebPort
$runWeb = -not $NoWeb
$runDesktop = -not $NoDesktop
if (-not $runWeb -and -not $runDesktop) { throw '-NoWeb 与 -NoDesktop 同时给出，没有要处理的一边。' }
$env:PATH = (Join-Path $env:USERPROFILE '.pnpm\bin') + ';' + $env:PATH
$env:NO_COLOR = '1'
$env:FORCE_COLOR = '0'

if ($ListOnly) {
  Write-Host ("本检出 {0}" -f $root) -ForegroundColor Cyan
  if ($runWeb) {
    $web = @(Get-RepoWebProcesses -Port $WebPort)
    if ($web.Count -eq 0) { Write-Host ("Web：没有正在运行的实例（端口 {0}）。" -f $WebPort) -ForegroundColor Green }
    else { $web | ForEach-Object { Write-Host ("Web：会停掉 PID {0}（{1}）" -f $_.ProcessId, $_.Name) } }
  }
  if ($runDesktop) {
    $desktop = @(Get-RepoDesktopProcesses -Root $root)
    if ($desktop.Count -eq 0) { Write-Host '桌面：没有正在运行的实例。' -ForegroundColor Green }
    else { $desktop | ForEach-Object { Write-Host ("桌面：会停掉 PID {0}（{1}）" -f $_.ProcessId, $_.Name) } }
  }
  return
}

if ($Stop) {
  if (-not (Stop-OwnedSides -StopWeb $runWeb -StopDesktop $runDesktop)) { exit 1 }
  return
}

if ($runWeb -and (Test-PortListening -Port $WebPort)) {
  $owners = @(Get-PortOwnerProcesses -Port $WebPort)
  $ours = @($owners | Where-Object { Test-ProcessOwnedByCheckout -Process $_ })
  if ($ours.Count -eq 0) {
    throw ("端口 {0} 已被本检出以外的进程占用（PID {1}）；不动它，换一个 -WebPort。" -f $WebPort, (($owners | ForEach-Object { $_.ProcessId }) -join ','))
  }
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Write-Host ("本检出 {0}" -f $root) -ForegroundColor Cyan
# 先停旧实例：桌面被单实例锁挡住的报错比这难看得多。
Stop-OwnedSides -StopWeb $runWeb -StopDesktop $runDesktop | Out-Null
if ($runWeb) { if (Test-Path -LiteralPath $webLog) { Remove-Item -LiteralPath $webLog -Force } }
if ($runDesktop) { if (Test-Path -LiteralPath $desktopLog) { Remove-Item -LiteralPath $desktopLog -Force } }

if ($Fast) { Write-Host '构建：跳过（-Fast）' -ForegroundColor DarkGray }
else { Invoke-RepoBuild }

$webUrl = ''
$desktopUrl = ''
if ($runWeb) {
  $webStarted = Get-Date
  $webPid = Start-WebInstance
  Save-StartAllState -LauncherPid $webPid -Port $WebPort
  Write-Host ("Web：已启动（PID {0}），日志 {1}" -f $webPid, $webLog) -ForegroundColor Cyan
  $result = Wait-SideReady -Name 'web' -LogPath $webLog -LauncherPid $webPid -Started $webStarted
  if (-not $result.Ready) {
    Write-Host ("Web 未就绪：{0}。最后几行：" -f $result.Reason) -ForegroundColor Red
    $result.Tail | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
    exit 1
  }
  $webUrl = $result.Url
  Write-Host ("Web 就绪：{0}" -f $webUrl) -ForegroundColor Green
}

if ($runDesktop) {
  $desktopStarted = Get-Date
  # 构建已在上一步做完：这里走 start:desktop，不再重复构建；冒烟同 start-desktop 默认值一样不跑。
  $desktopPid = Start-DesktopInstance -Root $root -LogPath $desktopLog -SkipBuild -SkipSmoke
  Write-Host ("桌面：已启动（PID {0}），日志 {1}" -f $desktopPid, $desktopLog) -ForegroundColor Cyan
  $result = Wait-SideReady -Name 'desktop' -LogPath $desktopLog -LauncherPid $desktopPid -Started $desktopStarted
  if (-not $result.Ready) {
    Write-Host ("桌面未就绪：{0}。最后几行：" -f $result.Reason) -ForegroundColor Red
    $result.Tail | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
    exit 1
  }
  $desktopUrl = $result.Url
  Write-Host ("桌面就绪：{0}" -f $desktopUrl) -ForegroundColor Green
}

Write-Host ''
Write-Host '---- 就绪 ----' -ForegroundColor Green
if ($runWeb) { Write-Host ("Web   : {0}" -f $webUrl); Write-Host ("        日志 {0}" -f $webLog) -ForegroundColor DarkGray }
if ($runDesktop) {
  Write-Host ("桌面  : {0}" -f $desktopUrl)
  $inspectors = Read-DesktopInspectors -LogPath $desktopLog
  if ($inspectors) { Write-Host ("        inspectors {0}" -f $inspectors) -ForegroundColor DarkGray }
  Write-Host ("        日志 {0}" -f $desktopLog) -ForegroundColor DarkGray
}
$stopHint = 'lcoder\scripts\start-all.cmd -Stop'
if ($runWeb -and $WebPort -ne 3080) { $stopHint += (" -WebPort {0}" -f $WebPort) }
if (-not $runWeb) { $stopHint += ' -NoWeb' }
if (-not $runDesktop) { $stopHint += ' -NoDesktop' }
Write-Host ("停止：{0}    （Ctrl+C 只停止跟随，不停实例）" -f $stopHint) -ForegroundColor DarkGray

if (-not $KeepFollowing -or (-not $runWeb -and -not $runDesktop)) { return }

$webPrinted = (Read-LogDelta -LogPath $webLog).Count
$desktopPrinted = (Read-LogDelta -LogPath $desktopLog).Count
Write-Host '---- 跟随日志（Ctrl+C 退出；实例继续运行） ----' -ForegroundColor DarkGray
while ($true) {
  if ($runWeb) {
    $delta = Read-LogDelta -LogPath $webLog -From $webPrinted
    foreach ($raw in $delta.Lines) { Write-Host ("[web] {0}" -f (Remove-AnsiColors -Line $raw)) }
    $webPrinted = $delta.Count
  }
  if ($runDesktop) {
    $delta = Read-LogDelta -LogPath $desktopLog -From $desktopPrinted
    foreach ($raw in $delta.Lines) { Write-Host ("[desktop] {0}" -f (Remove-AnsiColors -Line $raw)) }
    $desktopPrinted = $delta.Count
  }
  Start-Sleep -Milliseconds 500
}
