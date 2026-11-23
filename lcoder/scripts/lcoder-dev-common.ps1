# 本检出开发脚本共用的小函数（start-desktop / start-all 共用）。
#
# 只被其它脚本 dot-source，不能单独运行：本文件没有参数块、没有主流程。
# 这里给桌面端与通用场景用：归属判定按路径，electron 必须带本检出的 --user-data-dir
# （旧壳）或以本检出的 desktop 包为 app 路径（新客户端），node 启动器必须带本检出根路径；
# 不按进程名（同机别的工作树与安装版都有同名进程）。Web 的监听进程是例外：pnpm 以相对路径
# 带起 node，命令行不含检出根，由 start-all.ps1 结合状态文件里记录的监听 PID 判定。

# 返回旧壳（上游 dev.ts）的桌面 user-data-dir（dev.ts 的默认值，见 apps/desktop/scripts/dev.ts）。
function Get-DesktopDevelopmentUserData {
  param([Parameter(Mandatory = $true)][string]$Root)
  return (Join-Path $Root 'apps\desktop\.desktop-build\development\electron-user-data')
}

# 返回新客户端的 electron user-data-dir（launch.mjs 的默认值：<DSH_HOME>\electron-user-data）。
function Get-ClientDevelopmentUserData {
  param([Parameter(Mandatory = $true)][string]$Root)
  return (Join-Path $Root '.dsh-home\electron-user-data')
}

# 列出属于本检出的桌面进程。
# 旧壳：electron 带旧 user-data-dir，或 node 跑本仓 apps/desktop/scripts/dev.ts。
# 新客户端：launch.mjs 以本检出 packages\lcoder\desktop 为 app 路径、把 <DSH_HOME>\electron-user-data
# 传给 electron，宿主子进程也带本检出的 host-entry.js；主进程与宿主都按这两条路径认。
function Get-RepoDesktopProcesses {
  param([Parameter(Mandatory = $true)][string]$Root)
  $electronData = Get-DesktopDevelopmentUserData -Root $Root
  $clientData = Get-ClientDevelopmentUserData -Root $Root
  $clientApp = Join-Path $Root 'packages\lcoder\desktop'
  $all = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine }
  return @($all | Where-Object {
    ($_.Name -eq 'electron.exe' -and (
        $_.CommandLine -like "*$electronData*" -or
        $_.CommandLine -like "*$clientData*" -or
        $_.CommandLine -like "*$clientApp*"
      )) -or
    ($_.Name -eq 'node.exe' -and $_.CommandLine -like "*$Root*" -and (
        $_.CommandLine -like '*scripts*dev.ts*' -or
        $_.CommandLine -like '*host-entry.js*'
      ))
  })
}

# 桌面就绪行：旧壳等带 token 的 dsh web 行；新客户端等主进程打印的宿主就绪行。
# 新客户端日志里宿主自己也会打 dsh web 行，所以两种模式各用各的，不混判。
function Get-DesktopReadyPattern {
  param([switch]$Legacy)
  if ($Legacy) { return 'dsh web:\s*(http://\S+)' }
  return 'lcoder desktop: 宿主已就绪\s+(http://\S+)'
}

# 桌面 inspector 端口：旧壳 9229/9222/9230，新客户端 9829/9822/9830；环境变量覆盖两者通用。
# @returns @{ Name; Value }[]，Name 为 main / renderer / host。
function Get-DesktopInspectorPorts {
  param([switch]$Legacy)
  $defaults = if ($Legacy) {
    @{ main = 9229; renderer = 9222; host = 9230 }
  } else {
    @{ main = 9829; renderer = 9822; host = 9830 }
  }
  $envNames = @{ main = 'DSH_DESKTOP_MAIN_INSPECT_PORT'; renderer = 'DSH_DESKTOP_RENDERER_DEBUG_PORT'; host = 'DSH_DESKTOP_HOST_INSPECT_PORT' }
  $ports = @()
  foreach ($name in @('main', 'renderer', 'host')) {
    $value = $defaults[$name]
    $raw = [Environment]::GetEnvironmentVariable($envNames[$name], 'Process')
    if ($raw) { $value = [int]$raw }
    $ports += @{ Name = $name; Value = $value }
  }
  return $ports
}

# 停掉给定进程及其整棵子进程树。
# 枚举与终止之间子进程可能已被父进程的 /T 带走：taskkill 报 not found 属预期，
# 因此这里临时把 Stop 偏好降为 Continue，免得一条预期内的失败中断整次启动。
function Stop-RepoProcessTrees {
  param([object[]]$Processes)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    foreach ($p in @($Processes)) {
      if ($null -eq $p) { continue }
      Write-Host ("停掉旧实例 PID {0}（{1}）" -f $p.ProcessId, $p.Name) -ForegroundColor DarkYellow
      & taskkill.exe /PID $p.ProcessId /T /F *> $null
    }
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

# 在独立进程里启动桌面端（先按层增量重建，返回启动器 PID）。
# 日志由调用方先准备好；这里只负责命令与环境的拼装，不做就绪判定。
# 默认启动新客户端（packages/lcoder/desktop 的 launch.mjs）；-Legacy 回退旧壳的 dev/start:desktop。
# 新客户端启动前跑 rebuild.cmd 按层增量重建：只重编源码比产物新的层，装配源与 profile 依赖一并保障。
function Start-DesktopInstance {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [switch]$SkipBuild,
    [switch]$RunSmoke,
    [switch]$Legacy
  )
  $previousPath = $env:PATH
  $previousNoColor = $env:NO_COLOR
  $previousForceColor = $env:FORCE_COLOR
  $previousSkipSmoke = $env:DSH_DESKTOP_SKIP_RUNTIME_SMOKE
  $env:PATH = (Join-Path $env:USERPROFILE '.pnpm\bin') + ';' + $env:PATH
  $env:NO_COLOR = '1'          # 让 vite / 门禁不再吐 ANSI，日志本身就干净
  $env:FORCE_COLOR = '0'
  # pnpm 11 在 node_modules 与锁文件不一致时会先跑一次安装并弹交互确认，隐藏窗口里没有 stdin，
  # 会一直等（worktree 的依赖由 claim/rebuild 负责，不在这里重装）。
  # verify-deps-before-run 只认 CLI 配置，环境变量无效。
  $pnpm = 'pnpm --config.verify-deps-before-run=false'
  # 运行时冒烟（python 三条检查加 Office 往返）是旧壳的发布验收口径，新客户端没有这一步；
  # 开发启动默认跳过，只有调用方显式要求复核（start-desktop -Smoke -Legacy）才不设置。
  if ($RunSmoke) { Remove-Item Env:\DSH_DESKTOP_SKIP_RUNTIME_SMOKE -ErrorAction SilentlyContinue }
  else { $env:DSH_DESKTOP_SKIP_RUNTIME_SMOKE = '1' }
  try {
    if ($Legacy) {
      # -SkipBuild 走 start:desktop（跳过构建门禁）；改过源码不要用它，会跑旧产物。
      $scriptName = if ($SkipBuild) { 'start:desktop' } else { 'dev:desktop' }
      $command = "$pnpm run $scriptName"
    } else {
      $launch = "$pnpm --filter @maniu/desktop run launch"
      # 启动前先按层增量重建：各层产物都是最新时 rebuild 0.2 秒跳过，改过哪层就只重编哪层。
      # -SkipBuild（start-desktop -Fast）也走这条：它省掉的是整仓 build:artifacts，不是新的源码。
      $rebuild = 'call "' + (Join-Path $Root 'lcoder\scripts\rebuild.cmd') + '"'
      $command = "$rebuild && $launch"
    }
    $process = Start-Process -FilePath 'cmd.exe' `
      -ArgumentList '/d', '/c', "$command > `"$LogPath`" 2>&1" `
      -WorkingDirectory $Root -WindowStyle Hidden -PassThru
    return $process.Id
  } finally {
    $env:PATH = $previousPath
    $env:NO_COLOR = $previousNoColor
    $env:FORCE_COLOR = $previousForceColor
    if ($null -eq $previousSkipSmoke) { Remove-Item Env:\DSH_DESKTOP_SKIP_RUNTIME_SMOKE -ErrorAction SilentlyContinue }
    else { $env:DSH_DESKTOP_SKIP_RUNTIME_SMOKE = $previousSkipSmoke }
  }
}

# 把一行日志去掉 ANSI 颜色码（日志多半已由 NO_COLOR 管住，这里是兜底）。
function Remove-AnsiColors {
  param([string]$Line)
  $esc = [string][char]27
  return ([regex]($esc + '\[[0-9;?]*[a-zA-Z]')).Replace($Line, '')
}

# 读日志相对上次的增量行。
# @returns @{ Lines = string[]; Count = int }，Count 供下次作为起点。
function Read-LogDelta {
  param(
    [Parameter(Mandatory = $true)][string]$LogPath,
    [int]$From = 0
  )
  if (-not (Test-Path -LiteralPath $LogPath)) { return @{ Lines = @(); Count = $From } }
  $lines = @(Get-Content -LiteralPath $LogPath -Encoding utf8 -ErrorAction SilentlyContinue)
  if ($lines.Count -le $From) { return @{ Lines = @(); Count = $lines.Count } }
  return @{ Lines = @($lines[$From..($lines.Count - 1)]); Count = $lines.Count }
}
