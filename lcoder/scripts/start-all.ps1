# 一条命令拉起本检出的 Web 与桌面端（开发态）。
#
# 为什么有它：Web（3080）与桌面（9222/9229/9230）各有一套启动方式，手工起两份很容易
# 落到别人的端口、别人的 home 或上一次没清干净的进程上。这个脚本按固定顺序做四件事：
# 先停掉本检出的旧实例 → 构建（-Fast 跳过）→ 先起 Web 再起桌面 → 等两边就绪并给出
# 日志位置与带 token 的地址。进程归属按检出根、状态文件记录的监听 PID 与命令行签名判断，
# 不碰主检出、别的工作树、别处占着端口的 Web。
#
# Web 的归属为什么要状态文件：pnpm 以相对路径带起 node（apps/cli/src/bin.ts web），
# 监听进程的命令行不含检出根，而启动器（cmd → pnpm）在 Web 跑着时也会先退掉。只记启动器
# 会留下一个找不回的监听进程占住端口。因此就绪后把端口 owner 的 PID 也写进状态文件；
# 之后只有状态里的 root 与端口都吻合、PID 与命令行签名也对得上时才认。
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
#   lcoder\scripts\start-all.cmd -CloudApi http://127.0.0.1:5091/v1  # 换云端地址（默认 5081）
#   lcoder\scripts\start-all.cmd -SkipCloudCheck # 不探测云端，直接启动
#
# 云端先于构建探测：由 -CloudApi 去掉末尾 /v1 拼出 /health，2 秒内 GET 到 200 才算可用。
# 可用就把地址写进 LCODER_CLOUD_BASE_URL，Web 与桌面两个子进程都继承；不可用则红字报出
# 检测地址与补救方式并以非零退出——不静默起一个登录不可用的桌面。默认地址 5081 是本机
# LCoder-cloud 的 API；仓库里的 dev-only mock 在 5091，要 mock 就用 -CloudApi 指过去。
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
  [string]$CloudApi = 'http://127.0.0.1:5081/v1',
  [switch]$SkipCloudCheck,
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
  -CloudApi <地址>   云端 /v1 基地址（默认 http://127.0.0.1:5081/v1）
  -SkipCloudCheck    不探测云端，直接启动（-Stop / -ListOnly 本来就不探测）
  -ReadyTimeoutSec <秒>  单边连续多少秒没有新输出算失败（默认 300）
  -Help              打印本帮助

云端探测
  由 -CloudApi 去掉末尾的 /v1 拼出 /health，GET 超时 2 秒；200 视为可用。
  可用：把地址注入 LCODER_CLOUD_BASE_URL，Web 与桌面两个子进程都继承。
  不可用：红字打印检测地址、本地 API 的启动方式与可直接设置的 LCODER_CLOUD_BASE_URL，
  并以退出码 1 中止，不会起一个登录不可用的实例。探测发生在构建与停旧实例之前。
  -CloudApi 没显式给时沿用环境里已有的 LCODER_CLOUD_BASE_URL，再退到默认地址。
  -SkipCloudCheck 跳过探测，但仍会把当前 -CloudApi 注入两个子进程。

顺序与产物
  1. 云端：探测 /health 并注入 LCODER_CLOUD_BASE_URL（-Stop / -ListOnly 跳过）
  2. 构建：pnpm run build:artifacts，再 pnpm --filter @deepseek-ai/dsh-desktop run build
  3. Web：pnpm run start:web，日志 lcoder\logs\web.log
  4. 桌面：复用 start-desktop 的启动与就绪检测，日志 lcoder\logs\desktop-main.log
  Web 的 DSH_HOME 默认指向本检出 .dsh-home；桌面的 home/userData 沿用 dev.ts 的仓内默认值。

进程归属
  停 electron --user-data-dir 落在本检出、命令行带本检出根路径的进程，以及状态文件
  记录的 Web 启动器/监听进程（root 与端口都吻合且命令行是 Web 签名）。端口上的进程
  不属于本检出时只报告、不终止。Ctrl+C 只停止跟随，不停已启动的实例。
'@
}

function Assert-WebPort {
  if ($WebPort -lt 1 -or $WebPort -gt 65535) { throw "WebPort 必须是 1..65535 的整数，收到 $WebPort" }
}

# 由 /v1 基地址推出健康检查地址：去掉末尾的 /v1，再拼 /health。
function Get-CloudHealthUrl {
  param([Parameter(Mandatory = $true)][string]$BaseUrl)
  $trimmed = $BaseUrl.TrimEnd('/')
  if ($trimmed -match '/v1$') { $trimmed = $trimmed.Substring(0, $trimmed.Length - 3).TrimEnd('/') }
  return ($trimmed + '/health')
}

# 2 秒内 GET 健康检查；只有 200 视为可用。超时、拒连与非 200 都落到 Detail，不抛错。
# @returns @{ Available = bool; Detail = string }
function Test-CloudApiAvailable {
  param([Parameter(Mandatory = $true)][string]$HealthUrl)
  try {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    $code = [int]$response.StatusCode
    if ($code -eq 200) { return @{ Available = $true; Detail = 'HTTP 200' } }
    return @{ Available = $false; Detail = ("HTTP {0}" -f $code) }
  } catch {
    $detail = $_.Exception.Message
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $detail = ("HTTP {0}" -f [int]$_.Exception.Response.StatusCode)
    }
    return @{ Available = $false; Detail = $detail }
  }
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

# 进程是否属于本检出：命令行带本检出根路径。
function Test-ProcessOwnedByCheckout {
  param([Parameter(Mandatory = $true)][object]$Process)
  if (-not $Process.CommandLine) { return $false }
  return $Process.CommandLine -like "*$root*"
}

# 沿 ParentProcessId 向上找命令行带检出根的祖先，最多八层。
# 只对候选进程调用：每层都要查一次 CIM，全量进程逐个走会明显拖慢启动。
function Test-ProcessOwnedByCheckoutViaAncestors {
  param(
    [Parameter(Mandatory = $true)][object]$Process,
    [int]$MaxDepth = 8
  )
  $visited = @{}
  $current = $Process
  for ($depth = 0; $depth -lt $MaxDepth; $depth++) {
    $parentId = [int]$current.ParentProcessId
    if ($parentId -le 0 -or $visited.ContainsKey($parentId)) { return $false }
    $visited[$parentId] = $true
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction SilentlyContinue
    if ($null -eq $parent) { return $false }
    if (Test-ProcessOwnedByCheckout -Process $parent) { return $true }
    $current = $parent
  }
  return $false
}

# Web 启动链的命令行签名。pnpm 用相对路径带起 node，这类命令行不含检出根，
# 只能靠子命令与脚本名识别；路径分隔符两种都认。只认 cmd.exe / node.exe：
# 别的宿主进程（powershell、bash）的命令行里可能只是提到了这些词，不能据此停它。
function Test-WebCommandLineSignature {
  param([string]$CommandLine, [string]$Name)
  if (-not $CommandLine) { return $false }
  if ($Name -and $Name -notin @('node.exe', 'cmd.exe')) { return $false }
  return (
    $CommandLine -match '(?i)apps[\\/]cli[\\/]src[\\/]bin\.ts\s+web(\s|$)' -or
    $CommandLine -match '(?i)scripts[\\/]dev-web\.ts(\s|$)' -or
    $CommandLine -match '(?i)\b(start|dev):web\b'
  )
}

# 命令行声明的 Web 端口；没有 --port 时按默认 3080。
# 端口不同的 Web 不参与本次 -Stop / 启动：换端口不能带走另一端口上的实例。
function Get-WebCommandLinePort {
  param([string]$CommandLine)
  if (-not $CommandLine) { return 0 }
  $match = [regex]::Match($CommandLine, '(?i)(?:^|\s)--?port(?:=|\s+)(\d{1,5})(?:[\s"'']|$)')
  if ($match.Success) { return [int]$match.Groups[1].Value }
  return 3080
}

# Web 进程是否属于本检出：
#   1. 命令行直接带检出根；
#   2. 命令行是 Web 签名，且祖先链里有命令行带检出根的过程（启动器还在时）；
#   3. 命令行是 Web 签名，且 PID 就是状态文件为本检出、本端口记录的监听进程或启动器。
# 第 3 条覆盖启动器退掉之后的监听 node：没有它，只靠命令行判归属会把本检出的
# 遗留 Web 当成别人的进程。
function Test-RepoWebProcess {
  param([object]$Process, [int]$Port)
  if ($null -eq $Process) { return $false }
  if (Test-ProcessOwnedByCheckout -Process $Process) { return $true }
  if (-not (Test-WebCommandLineSignature -CommandLine $Process.CommandLine -Name $Process.Name)) { return $false }
  if (Test-ProcessOwnedByCheckoutViaAncestors -Process $Process) { return $true }
  $state = Read-MatchingStartAllState -Port $Port
  if ($null -eq $state) { return $false }
  $pidValue = [int]$Process.ProcessId
  foreach ($field in @('webPid', 'launcherPid')) {
    $recorded = $state.$field
    if ($null -ne $recorded -and [int]$recorded -gt 0 -and [int]$recorded -eq $pidValue) { return $true }
  }
  return $false
}

function Read-StartAllState {
  if (-not (Test-Path -LiteralPath $statePath)) { return $null }
  try { return (Get-Content -LiteralPath $statePath -Raw -Encoding utf8 | ConvertFrom-Json) }
  catch { return $null }   # 状态文件损坏等同于没有记录：下面还有按路径与端口的兜底识别
}

# 状态文件同时属于本检出与本端口时才返回；否则返回 null，避免拿别处或旧端口的记录判归属。
function Read-MatchingStartAllState {
  param([int]$Port)
  $state = Read-StartAllState
  if ($null -eq $state) { return $null }
  if ($state.root -ne $root) { return $null }
  if ($null -eq $state.webPort -or [int]$state.webPort -ne $Port) { return $null }
  return $state
}

# 写状态：launcherPid 是拉起 Web 的 cmd/pnpm（会先退出）；webPid 是就绪后实际监听端口的
# 进程，0 表示尚未取到。归属校验要求 root 与端口吻合，再核对 PID 与命令行签名。
function Save-StartAllState {
  param([int]$LauncherPid, [int]$Port, [int]$WebPid = 0)
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $state = [ordered]@{
    root = $root
    launcherPid = $LauncherPid
    webPid = $WebPid
    webPort = $Port
    started = (Get-Date).ToString('o')
  }
  $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
}

function Clear-StartAllState {
  if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath -Force }
}

# 本检出的 Web 进程：状态文件记录的启动器与监听进程、命令行带根路径的启动器、
# 以及本端口上归属本检出的监听进程。
function Get-RepoWebProcesses {
  param([int]$Port = $WebPort)
  $found = @()
  $state = Read-MatchingStartAllState -Port $Port
  if ($null -ne $state) {
    foreach ($recordedPid in @($state.launcherPid, $state.webPid)) {
      if ($null -eq $recordedPid -or [int]$recordedPid -le 0) { continue }
      $recorded = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$recordedPid) -ErrorAction SilentlyContinue
      if ($null -ne $recorded -and (Test-RepoWebProcess -Process $recorded -Port $Port)) { $found += $recorded }
    }
  }
  $all = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine })
  $bySignature = @($all | Where-Object {
    (Test-WebCommandLineSignature -CommandLine $_.CommandLine -Name $_.Name) -and
    ((Get-WebCommandLinePort -CommandLine $_.CommandLine) -eq $Port)
  })
  foreach ($process in $bySignature) {
    if (Test-RepoWebProcess -Process $process -Port $Port) { $found += $process }
  }
  foreach ($owner in (Get-PortOwnerProcesses -Port $Port)) {
    if (Test-RepoWebProcess -Process $owner -Port $Port) { $found += $owner }
  }
  $byPid = @{}
  foreach ($process in $found) { $byPid[[int]$process.ProcessId] = $process }
  return @($byPid.Values)
}

# 就绪后从端口 owner 取实际监听进程；优先命令行是 Web 签名的那一个。
function Get-WebListenerPid {
  param([int]$Port)
  $owners = @(Get-PortOwnerProcesses -Port $Port)
  $signed = @($owners | Where-Object { Test-WebCommandLineSignature -CommandLine $_.CommandLine -Name $_.Name })
  if ($signed.Count -gt 0) { return [int]$signed[0].ProcessId }
  if ($owners.Count -gt 0) { return [int]$owners[0].ProcessId }
  return 0
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
    $foreign = @(Get-PortOwnerProcesses -Port $WebPort | Where-Object { -not (Test-RepoWebProcess -Process $_ -Port $WebPort) })
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

# 云端地址：显式 -CloudApi 优先；没给时沿用环境里已有的 LCODER_CLOUD_BASE_URL，再退到默认。
if (-not $PSBoundParameters.ContainsKey('CloudApi') -and $env:LCODER_CLOUD_BASE_URL) {
  $CloudApi = $env:LCODER_CLOUD_BASE_URL
}
$CloudApi = $CloudApi.Trim().TrimEnd('/')
if ($CloudApi -notmatch '^https?://') { throw ("-CloudApi 必须是 http(s) 地址，收到 {0}" -f $CloudApi) }
$cloudHealthUrl = Get-CloudHealthUrl -BaseUrl $CloudApi

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
  $ours = @($owners | Where-Object { Test-RepoWebProcess -Process $_ -Port $WebPort })
  if ($ours.Count -eq 0) {
    throw ("端口 {0} 已被本检出以外的进程占用（PID {1}）；不动它，换一个 -WebPort。" -f $WebPort, (($owners | ForEach-Object { $_.ProcessId }) -join ','))
  }
}

# 云端探测放在构建与停旧实例之前：地址不通就尽早失败，别先花掉一轮构建、也别拆掉在跑的实例。
if ($SkipCloudCheck) {
  Write-Host ("云端：跳过探测（-SkipCloudCheck），待注入地址 {0}" -f $CloudApi) -ForegroundColor DarkYellow
} else {
  $probe = Test-CloudApiAvailable -HealthUrl $cloudHealthUrl
  if (-not $probe.Available) {
    Write-Host ("云端 API 不可用：GET {0} 失败（{1}；超时 2 秒）。" -f $cloudHealthUrl, $probe.Detail) -ForegroundColor Red
    Write-Host '  登录与模型路由都走它，现在启动只会得到登录不可用的实例，已中止。' -ForegroundColor Red
    Write-Host '  起本地 API（LCoder-cloud 仓）：dotnet run --project src/Api --urls http://localhost:5081' -ForegroundColor Red
    Write-Host '  或起 dev-only mock（监听 5091）：node lcoder/scripts/mock-cloud.mjs，并用 -CloudApi http://127.0.0.1:5091/v1' -ForegroundColor Red
    Write-Host '  指向别处：-CloudApi https://<host>/v1；也可直接设 LCODER_CLOUD_BASE_URL 后加 -SkipCloudCheck' -ForegroundColor Red
    exit 1
  }
  Write-Host ("云端：探测 {0} → {1}（可用）" -f $cloudHealthUrl, $probe.Detail) -ForegroundColor Green
}
$env:LCODER_CLOUD_BASE_URL = $CloudApi
Write-Host ("云端：已注入 LCODER_CLOUD_BASE_URL={0}（Web 与桌面两个子进程继承）" -f $CloudApi) -ForegroundColor Cyan

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
  # 就绪后补记监听进程：启动器（cmd → pnpm）会先退，命令行又不含检出根，
  # 只记启动器会让下一次 -Stop / 启动把端口 owner 当成本检出以外的进程。
  $listenerPid = Get-WebListenerPid -Port $WebPort
  if ($listenerPid -gt 0) {
    Save-StartAllState -LauncherPid $webPid -Port $WebPort -WebPid $listenerPid
    Write-Host ("Web：监听进程 PID {0}（已记入状态）" -f $listenerPid) -ForegroundColor DarkGray
  }
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
$cloudProbeLabel = if ($SkipCloudCheck) { '跳过探测' } else { '健康检查 200' }
Write-Host ("云端  : {0}（{1}）" -f $CloudApi, $cloudProbeLabel)
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
