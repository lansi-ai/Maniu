# LCoder 工作树空间工具：共享 Electron 运行时、稀疏检出、清理、占用巡检。
#
# 为什么有它：并行开发线各自一个 worktree，每个树都装一份 node_modules（GB 级、pnpm 硬链接到全局
# store）、各自下载一份 Electron 运行时（downloads 91MB + targets 268MB），磁盘很快见底；清理时
# git worktree remove 又会被超过 MAX_PATH 的嵌套 node_modules 卡住（见 lcoder/PITFALLS.md W-12）。
# 这个脚本把四件事固定成可重复的命令，下次开线直接调用。
#
# 用法：
#   worktree.cmd -Action junction -Name <工作树名>
#       把该工作树的 .desktop-build\downloads 与 \targets 用 NTFS junction（mklink /J）
#       指向主检出同路径。home 与 electron-user-data 不共享，会话仍隔离。
#   worktree.cmd -Action sparse -Name <新树名> -Branch <分支> -Paths packages/lcoder,apps/desktop
#       用 git worktree add --no-checkout 加 cone 模式 sparse-checkout，只检出指定目录。
#       -Paths 用逗号或（PowerShell 数组）传入均可。分支已存在则直接挂上，不存在则新建。
#   worktree.cmd -Action clean -Name <工作树名>
#       只删构建大件：node_modules、packages\*\*\lib、apps\*\lib、apps\web\dist、
#       apps\desktop\.desktop-build。默认不碰 git（worktree 仍注册、分支保留）。
#   worktree.cmd -Action clean -Name <工作树名> -Remove
#       删完大件后继续 git worktree remove --force 与 git branch -d；
#       分支未合入时不强制删（不会用 -D），报错并保留。
#   worktree.cmd -Action inspect [-WarnGB 8] [-Deep]
#       列出主检出与 .worktrees 下各工作树的占用，拆分 lib 与 .desktop-build。
#       默认有界统计：node_modules 只标"硬链接共享、未逐文件统计"；-Deep 才精确统计它。
#   worktree.cmd -Action provision -Name <工作树名> [-TimeoutSec 1800]
#       持机器级锁，在目标工作树跑 pnpm install --offline --frozen-lockfile。
#   worktree.cmd -Action build -Name <工作树名> [-TimeoutSec 1800] [-DryRun]
#       持同一把锁做分层重建：优先 lcoder\scripts\rebuild.cmd，缺它才 pnpm run build:artifacts。
#   worktree.cmd -Action lock -Seconds <秒> [-Name LCoder-Heavy]
#       持锁睡眠后释放，用于并发演示。
#
# 重活互斥：install 与分层重建都会抢同一批磁盘和 CPU，并发跑会互相拖死。provision/build/lock
# 统一取机器级命名 Mutex（优先 Global\LCoder-Heavy；无权限时退回 Local\LCoder-Heavy 并说明）。
# -TimeoutSec 只约束等锁的上限，命令本身跑完为止（不中途杀进程）。
#   worktree.cmd -Action help
#
# 安全约定：
#   - 目标默认解析到主检出的 .worktrees\<Name>；不在 .worktrees 下需要 -Force。
#   - clean 一律拒绝主检出（-Force 也不放行）。
#   - 删除前逐条打印路径；不删 .spec 产品数据与源码。
param(
  [ValidateSet('help', 'junction', 'sparse', 'clean', 'inspect', 'provision', 'build', 'lock')]
  [string]$Action = 'help',
  [string]$Name,
  [string]$Branch,
  [string[]]$Paths,
  [string]$Target,
  [switch]$Remove,
  [switch]$Force,
  [switch]$Deep,
  [switch]$DryRun,
  [ValidateRange(1, 86400)]
  [int]$TimeoutSec = 1800,
  [ValidateRange(1, 3600)]
  [int]$Seconds = 6,
  [double]$WarnGB = 8
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$OutputEncoding = [Text.UTF8Encoding]::new()

$scriptRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $scriptRoot '..\..')).Path

# 原生命令往 stderr 写提示时，PS 5.1 在 Stop 偏好下会抛 NativeCommandError（哪怕退出码 0）。
function Invoke-Native([string]$FilePath, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $lines = @(& $FilePath @Arguments 2>&1 | ForEach-Object { "$_" })
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  return @{ Code = $code; Lines = $lines }
}

function Invoke-Git([string]$WorkDir, [string[]]$Arguments) {
  return Invoke-Native 'git' (@('-C', $WorkDir) + $Arguments)
}

# git worktree list 的第一项就是主检出；其余是各并行线。分支只作展示，不参与路径解析。
function Get-Worktrees {
  $result = Invoke-Git $repoRoot @('worktree', 'list', '--porcelain')
  if ($result.Code -ne 0) {
    throw ('无法读取 git worktree list：' + ($result.Lines -join ' '))
  }
  $list = New-Object System.Collections.Generic.List[object]
  $current = $null
  foreach ($line in $result.Lines) {
    if ($line -like 'worktree *') {
      if ($current) { $list.Add($current) }
      $current = [pscustomobject]@{ Path = $line.Substring(9); Branch = '(detached)' }
    } elseif ($line -like 'branch refs/heads/*') {
      if ($current) { $current.Branch = $line.Substring(18) }
    } elseif ($line -eq '' -and $current) {
      $list.Add($current)
      $current = $null
    }
  }
  if ($current) { $list.Add($current) }
  return $list
}

$worktrees = Get-Worktrees
if ($worktrees.Count -eq 0) { throw 'git worktree list 为空，无法识别主检出。' }
$mainRoot = [IO.Path]::GetFullPath($worktrees[0].Path).TrimEnd('\')
$worktreesRoot = [IO.Path]::GetFullPath((Join-Path $mainRoot '.worktrees')).TrimEnd('\')

function Resolve-TargetPath([switch]$MustExist) {
  $path = $null
  if ($Target) {
    $path = $Target
  } elseif ($Name) {
    if ($Name -match '[\\/:*?"<>|]') { throw "工作树名不能包含路径分隔符：$Name" }
    $path = Join-Path $worktreesRoot $Name
  } else {
    throw '缺少 -Name（或 -Target）：请给出工作树名。'
  }
  $full = [IO.Path]::GetFullPath($path).TrimEnd('\')
  if ($MustExist -and -not (Test-Path -LiteralPath $full)) {
    throw "目标工作树不存在：$full"
  }
  return $full
}

# 主检出绝对拒绝；其余目标必须落在 .worktrees 下，除非显式 -Force。
function Assert-TargetAllowed([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  if ($full -ieq $mainRoot) {
    throw "拒绝：目标是主检出（$mainRoot）。本工具不改动主检出。"
  }
  $under = $full.StartsWith($worktreesRoot + '\', [StringComparison]::OrdinalIgnoreCase)
  if (-not $under -and -not $Force) {
    throw "拒绝：目标不在主检出 .worktrees 下（$full）。确认无误后加 -Force。"
  }
}

# PS 5.1 的 Get-Item 对 junction 给出 Target；正常目录返回 $null。
function Get-ReparseTarget([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { return $null }
  $targets = @($item.Target)
  if ($targets.Count -lt 1 -or -not $targets[0]) { return $null }
  $raw = $targets[0].ToString()
  $raw = $raw.Replace('\\?\', '').Replace('\??\', '')
  return ([IO.Path]::GetFullPath($raw)).TrimEnd('\')
}

function Invoke-Junction {
  $target = Resolve-TargetPath -MustExist
  Assert-TargetAllowed $target
  $pairs = @(
    @{ Name = 'downloads'; Source = (Join-Path $mainRoot 'apps\desktop\.desktop-build\downloads') },
    @{ Name = 'targets';   Source = (Join-Path $mainRoot 'apps\desktop\.desktop-build\targets') }
  )
  foreach ($pair in $pairs) {
    $source = [IO.Path]::GetFullPath($pair.Source).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $source)) {
      throw "主检出缺少 $($pair.Name)：$source。先在主检出跑一次 dev:desktop 生成运行时。"
    }
    $destination = Join-Path $target ("apps\desktop\.desktop-build\" + $pair.Name)
    New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null

    if (Test-Path -LiteralPath $destination) {
      $existing = Get-ReparseTarget $destination
      if ($existing) {
        if ($existing -ieq $source) {
          Write-Host "已是正确 junction，跳过：$destination" -ForegroundColor DarkGray
          continue
        }
        throw "已存在指向别处的 junction：$destination -> $existing。请先手工删除该链接再重跑。"
      }
      $count = @(Get-ChildItem -LiteralPath $destination -Force -ErrorAction SilentlyContinue).Count
      if ($count -gt 0) {
        throw "目标已存在且非空：$destination（$count 项）。拒绝覆盖，请先清理。"
      }
      Remove-Item -LiteralPath $destination -Force | Out-Null
      Write-Host "已删除空目录：$destination" -ForegroundColor DarkGray
    }

    $made = Invoke-Native 'cmd.exe' @('/d', '/c', 'mklink', '/J', $destination, $source)
    foreach ($line in $made.Lines) { Write-Host ('  ' + $line) }
    if ($made.Code -ne 0) {
      throw "mklink /J 失败（退出码 $($made.Code)）：$destination"
    }
    Write-Host "已建立 junction：$destination -> $source" -ForegroundColor Green
  }
  Write-Host '完成。home 与 electron-user-data 未共享，会话与登录态仍各自独立。' -ForegroundColor Green
}
function Invoke-Sparse {
  if (-not $Name) { throw '缺少 -Name：请给出新工作树名。' }
  if (-not $Branch) { throw '缺少 -Branch：请给出分支名。' }
  if (-not $Paths -or @($Paths).Count -eq 0) { throw '缺少 -Paths：请给出至少一个目录（逗号或数组）。' }
  # powershell -File 与 .cmd 转发时逗号是普通字符，不会自动拆成数组；这里统一再拆一次。
  $directories = New-Object System.Collections.Generic.List[string]
  foreach ($value in @($Paths)) {
    foreach ($piece in ([string]$value -split ',')) {
      $trimmed = $piece.Trim()
      if ($trimmed) { $directories.Add($trimmed) }
    }
  }
  if ($directories.Count -eq 0) { throw '缺少 -Paths：请给出至少一个目录（逗号或数组）。' }
  $target = Resolve-TargetPath
  Assert-TargetAllowed $target
  if (Test-Path -LiteralPath $target) {
    throw "目标已存在：$target。稀疏检出不覆盖已有目录。"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null

  $known = (Invoke-Git $mainRoot @('rev-parse', '--verify', '--quiet', "refs/heads/$Branch")).Code -eq 0
  $addArguments = @('worktree', 'add', '--no-checkout')
  if ($known) { $addArguments += @($target, $Branch) }
  else { $addArguments += @('-b', $Branch, $target) }
  $added = Invoke-Git $mainRoot $addArguments
  if ($added.Code -ne 0) {
    throw ('git worktree add 失败：' + ($added.Lines -join ' '))
  }

  $initialized = Invoke-Git $target @('sparse-checkout', 'init', '--cone')
  if ($initialized.Code -ne 0) {
    throw ('sparse-checkout init 失败：' + ($initialized.Lines -join ' '))
  }
  $set = Invoke-Git $target (@('sparse-checkout', 'set') + $directories.ToArray())
  if ($set.Code -ne 0) {
    throw ('sparse-checkout set 失败：' + ($set.Lines -join ' '))
  }
  $checkedOut = Invoke-Git $target @('checkout')
  if ($checkedOut.Code -ne 0) {
    throw ('checkout 失败：' + ($checkedOut.Lines -join ' '))
  }

  Write-Host "已建稀疏工作树：$target" -ForegroundColor Green
  Write-Host ("分支：$Branch；包含目录：" + ($directories -join ', '))
  Write-Host '下一步：树内 pnpm install 与 pnpm run build:artifacts；需要共享 Electron 运行时再跑 -Action junction。' -ForegroundColor DarkGray
}

function Invoke-Provision {
  $target = Resolve-TargetPath -MustExist
  Assert-TargetAllowed $target
  $lock = Enter-HeavyLock 'LCoder-Heavy' $TimeoutSec
  $started = Get-Date
  try {
    $result = Invoke-LockedNative 'pnpm install --offline --frozen-lockfile' 'pnpm' @('install', '--offline', '--frozen-lockfile') $target
    if ($result.Code -ne 0) {
      throw ('pnpm install 失败：退出码 ' + $result.Code + '，耗时 ' + $result.Elapsed + ' 秒。离线安装失败多半是本地 pnpm store 缺包，去掉 --offline 联网补一次。')
    }
    Write-Host ('provision 完成：' + $target) -ForegroundColor Green
  } finally {
    Exit-HeavyLock $lock $started
  }
}

function Invoke-Build {
  $target = Resolve-TargetPath -MustExist
  Assert-TargetAllowed $target
  # 分层重建优先用树内 rebuild.cmd（只重出过期的那几层）；树里没有脚本才退回全量 artifacts。
  $rebuild = Join-Path $target 'lcoder\scripts\rebuild.cmd'
  if (Test-Path -LiteralPath $rebuild) {
    $label = 'rebuild.cmd 分层重建（auto）'
    $file = 'cmd.exe'
    $arguments = @('/d', '/c', $rebuild)
  } else {
    $label = 'pnpm run build:artifacts（全量）'
    $file = 'pnpm'
    $arguments = @('run', 'build:artifacts')
  }
  Write-Host ('目标工作树：' + $target)
  if ($DryRun) {
    Write-Host ('-DryRun：将执行 ' + $label) -ForegroundColor Yellow
    Write-Host ('  命令：' + $file + ' ' + ($arguments -join ' '))
    Write-Host ('  工作目录：' + $target)
    Write-Host '  -DryRun 不取锁、不构建。' -ForegroundColor DarkGray
    return
  }
  $lock = Enter-HeavyLock 'LCoder-Heavy' $TimeoutSec
  $started = Get-Date
  try {
    $result = Invoke-LockedNative $label $file $arguments $target
    if ($result.Code -ne 0) {
      throw ('分层重建失败：退出码 ' + $result.Code + '，耗时 ' + $result.Elapsed + ' 秒。')
    }
    Write-Host 'build 完成。' -ForegroundColor Green
  } finally {
    Exit-HeavyLock $lock $started
  }
}

# 并发演示用：-Name 是锁名标签（默认 LCoder-Heavy），不解析工作树路径。
function Invoke-Lock {
  $label = if ($Name) { $Name } else { 'LCoder-Heavy' }
  if ($label -match '[\\/]') { throw "锁名不能包含路径分隔符：$label" }
  $lock = Enter-HeavyLock $label $TimeoutSec
  $started = Get-Date
  try {
    Write-Host ('[{0:HH:mm:ss.fff}] {1} 开始持锁 {2} 秒' -f (Get-Date), $label, $Seconds) -ForegroundColor Cyan
    Start-Sleep -Seconds $Seconds
    Write-Host ('[{0:HH:mm:ss.fff}] 持锁睡眠结束，准备释放' -f (Get-Date)) -ForegroundColor DarkGray
  } finally {
    Exit-HeavyLock $lock $started
  }
}

# 重活锁：provision/build/lock 共用同一把命名 Mutex。Global\ 是机器级（跨登录会话），
# 创建它需要 SeCreateGlobalPrivilege；普通用户拿不到时退回 Local\（仅当前登录会话内互斥）
# 并明确说明范围变化，避免"以为机器级其实只在会话内"。
function Open-HeavyLock([string]$Label) {
  try {
    $mutex = New-Object System.Threading.Mutex($false, ('Global\' + $Label))
    return [pscustomobject]@{ Mutex = $mutex; Scope = 'Global'; Label = $Label }
  } catch {
    Write-Host ('无法创建 Global\' + $Label + '：' + $_.Exception.Message) -ForegroundColor Yellow
    Write-Host ('退回 Local\' + $Label + '：只在当前登录会话内互斥，跨会话不互斥。') -ForegroundColor Yellow
    $mutex = New-Object System.Threading.Mutex($false, ('Local\' + $Label))
    return [pscustomobject]@{ Mutex = $mutex; Scope = 'Local'; Label = $Label }
  }
}

function Enter-HeavyLock([string]$Label, [int]$TimeoutSec) {
  $lock = Open-HeavyLock $Label
  $started = Get-Date
  Write-Host ('[{0:HH:mm:ss.fff}] 取锁 {1}\{2}（等锁上限 {3} 秒；命令本身跑完为止）' -f $started, $lock.Scope, $Label, $TimeoutSec)
  $acquired = $false
  $nextReport = 5
  while (-not $acquired) {
    try {
      $acquired = $lock.Mutex.WaitOne(1000, $false)
    } catch [System.Threading.AbandonedMutexException] {
      $acquired = $true
      Write-Host '上一持有者未正常释放（进程退出），锁已接管。' -ForegroundColor Yellow
    }
    if ($acquired) { break }
    $waited = [int]((Get-Date) - $started).TotalSeconds
    if ($waited -ge $TimeoutSec) {
      $lock.Mutex.Dispose()
      throw ('等锁超时：' + $TimeoutSec + ' 秒内没拿到 ' + $lock.Scope + '\' + $Label + '。另有一条重活线在跑，等它结束或加大 -TimeoutSec。')
    }
    if ($waited -ge $nextReport) {
      Write-Host ('[{0:HH:mm:ss.fff}] 仍在等待锁（已 {1} 秒），持有者尚未释放' -f (Get-Date), $waited) -ForegroundColor DarkYellow
      $nextReport += 5
    }
  }
  $took = [int]((Get-Date) - $started).TotalSeconds
  if ($took -gt 0) { Write-Host ('[{0:HH:mm:ss.fff}] 已拿到锁（等了 {1} 秒）' -f (Get-Date), $took) -ForegroundColor Green }
  else { Write-Host ('[{0:HH:mm:ss.fff}] 已拿到锁（无等待）' -f (Get-Date)) -ForegroundColor Green }
  return [pscustomobject]@{ Mutex = $lock.Mutex; Scope = $lock.Scope; Label = $Label; Started = $started; Waited = $took }
}

function Exit-HeavyLock($Lock, [datetime]$JobStarted) {
  $held = [int]((Get-Date) - $JobStarted).TotalSeconds
  try {
    $Lock.Mutex.ReleaseMutex()
  } finally {
    $Lock.Mutex.Dispose()
  }
  Write-Host ('[{0:HH:mm:ss.fff}] 已释放锁 {1}\{2}（本次持锁 {3} 秒，等锁 {4} 秒）' -f (Get-Date), $Lock.Scope, $Lock.Label, $held, $Lock.Waited) -ForegroundColor Green
}

# 持锁跑一条原生命令并打印退出码与耗时；调用方负责在 finally 里释放锁。
function Invoke-LockedNative([string]$Label, [string]$FilePath, [string[]]$Arguments, [string]$WorkDir) {
  Write-Host ('[{0:HH:mm:ss.fff}] 执行：{1}（工作目录 {2}）' -f (Get-Date), ($FilePath + ' ' + ($Arguments -join ' ')), $WorkDir) -ForegroundColor Cyan
  $previousLocation = $null
  $previousPreference = $ErrorActionPreference
  $started = Get-Date
  try {
    $previousLocation = Get-Location
    Set-Location -LiteralPath $WorkDir
    $ErrorActionPreference = 'Continue'
    $lines = @(& $FilePath @Arguments 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
    if ($previousLocation) { Set-Location -LiteralPath $previousLocation.Path }
  }
  foreach ($line in $lines) { Write-Host ('  ' + $line) }
  $elapsed = [int]((Get-Date) - $started).TotalSeconds
  if ($code -ne 0) {
    Write-Host ('[{0:HH:mm:ss.fff}] ✗ {1} 失败：退出码 {2}，耗时 {3} 秒' -f (Get-Date), $Label, $code, $elapsed) -ForegroundColor Red
  } else {
    Write-Host ('[{0:HH:mm:ss.fff}] ✓ {1} 完成：退出码 0，耗时 {2} 秒' -f (Get-Date), $Label, $elapsed) -ForegroundColor Green
  }
  return [pscustomobject]@{ Code = $code; Elapsed = $elapsed }
}

# 只删固定构建目录，不碰源码与 .spec；junction 先解除，避免顺着链接删到主检出的共享内容。
function Invoke-Clean {
  $target = Resolve-TargetPath -MustExist
  Assert-TargetAllowed $target

  $paths = New-Object System.Collections.Generic.List[string]
  $nodeModules = Join-Path $target 'node_modules'
  if (Test-Path -LiteralPath $nodeModules) { $paths.Add($nodeModules) }

  $packages = Join-Path $target 'packages'
  if (Test-Path -LiteralPath $packages) {
    foreach ($group in Get-ChildItem -LiteralPath $packages -Directory -Force) {
      foreach ($package in Get-ChildItem -LiteralPath $group.FullName -Directory -Force -ErrorAction SilentlyContinue) {
        $lib = Join-Path $package.FullName 'lib'
        if (Test-Path -LiteralPath $lib) { $paths.Add($lib) }
      }
    }
  }

  $apps = Join-Path $target 'apps'
  if (Test-Path -LiteralPath $apps) {
    foreach ($app in Get-ChildItem -LiteralPath $apps -Directory -Force) {
      $lib = Join-Path $app.FullName 'lib'
      if (Test-Path -LiteralPath $lib) { $paths.Add($lib) }
    }
    $webDist = Join-Path $apps 'web\dist'
    if (Test-Path -LiteralPath $webDist) { $paths.Add($webDist) }
  }

  $desktopBuild = Join-Path $target 'apps\desktop\.desktop-build'
  if (Test-Path -LiteralPath $desktopBuild) {
    foreach ($shared in @('downloads', 'targets')) {
      $link = Join-Path $desktopBuild $shared
      if (Get-ReparseTarget $link) {
        Write-Host "解除 junction（只删链接，不动主检出内容）：$link" -ForegroundColor DarkYellow
        $unlinked = Invoke-Native 'cmd.exe' @('/d', '/c', 'rmdir', $link)
        if ($unlinked.Code -ne 0) {
          throw "解除 junction 失败：$link（退出码 $($unlinked.Code)）"
        }
      }
    }
    $paths.Add($desktopBuild)
  }

  if ($paths.Count -eq 0) {
    Write-Host '没有可删的构建大件。' -ForegroundColor DarkGray
  } else {
    Write-Host '将删除以下路径：' -ForegroundColor Cyan
    foreach ($path in $paths) { Write-Host ('  ' + $path) }
    $rmScript = Join-Path $scriptRoot 'rm-longpath.mjs'
    $removed = Invoke-Native 'node' (@($rmScript) + $paths.ToArray())
    foreach ($line in $removed.Lines) { Write-Host ('  ' + $line) }
    $failed = @($removed.Lines | Where-Object { $_ -like 'FAILED *' })
    if ($failed.Count -gt 0) {
      throw "有 $($failed.Count) 项删除失败（见上）。多半是实例仍在占用文件，关掉该树的桌面/web 实例后重跑。"
    }
  }

  if (-not $Remove) {
    Write-Host '默认不动 git：worktree 仍注册在 git worktree list，分支保留。需要注销时加 -Remove。' -ForegroundColor DarkGray
    return
  }

  $branch = $null
  $head = Invoke-Git $target @('rev-parse', '--abbrev-ref', 'HEAD')
  if ($head.Code -eq 0 -and $head.Lines.Count -gt 0) {
    $branch = $head.Lines[0].Trim()
  }

  $detached = Invoke-Git $mainRoot @('worktree', 'remove', '--force', $target)
  if ($detached.Code -ne 0) {
    Write-Host ('git worktree remove 失败：' + ($detached.Lines -join ' ')) -ForegroundColor Yellow
    Invoke-Git $mainRoot @('worktree', 'prune') | Out-Null
    if (Test-Path -LiteralPath $target) {
      throw "worktree 目录仍在：$target。用 node lcoder/scripts/rm-longpath.mjs <路径> 删除后重跑 -Remove。"
    }
  }
  Write-Host "已注销 worktree：$target" -ForegroundColor Green

  if (-not $branch -or $branch -eq 'HEAD') {
    Write-Host '未识别到分支名（detached HEAD），跳过分支删除。' -ForegroundColor Yellow
    return
  }
  $deleted = Invoke-Git $mainRoot @('branch', '-d', $branch)
  if ($deleted.Code -ne 0) {
    Write-Host "分支未合入，按约定保留：$branch" -ForegroundColor Yellow
    foreach ($line in $deleted.Lines) { Write-Host ('  ' + $line) }
    throw "分支 $branch 未合入，未删除（本工具不会用 -D 强制删）。确认可弃后手工 git branch -D $branch。"
  }
  Write-Host "已删除已合入分支：$branch" -ForegroundColor Green
}
# 体积统计：inspect 专用。PS 5.1 逐文件递归 node_modules 实测 68 秒；
# 这里用 Win32 FindFirstFileEx（LARGE_FETCH，与 robocopy 同款枚举）在扩展路径下统计，
# 9.5GB 的 node_modules 约 2 秒。默认仍有界：不逐文件统计 node_modules（见 Invoke-Inspect）。
$sizeSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class LcoderWorktreeSize
{
    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint Low;
        public uint High;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WIN32_FIND_DATA
    {
        public uint dwFileAttributes;
        public FILETIME ftCreationTime;
        public FILETIME ftLastAccessTime;
        public FILETIME ftLastWriteTime;
        public uint nFileSizeHigh;
        public uint nFileSizeLow;
        public uint dwReserved0;
        public uint dwReserved1;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string cFileName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string cAlternateFileName;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindFirstFileEx(string lpFileName, int fInfoLevelId, out WIN32_FIND_DATA data, int fSearchOp, IntPtr filter, int flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool FindNextFile(IntPtr handle, out WIN32_FIND_DATA data);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FindClose(IntPtr handle);

    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x10;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x400;

    public static long Get(string root)
    {
        long total = 0;
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            string dir = stack.Pop();
            WIN32_FIND_DATA data;
            IntPtr handle = FindFirstFileEx(dir + "\\*", 1, out data, 0, IntPtr.Zero, 2);
            if (handle == new IntPtr(-1)) { continue; }
            try
            {
                do
                {
                    if (data.cFileName == "." || data.cFileName == "..") { continue; }
                    if ((data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) { continue; }
                    if ((data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0)
                    {
                        stack.Push(dir + "\\" + data.cFileName);
                    }
                    else
                    {
                        total += ((long)data.nFileSizeHigh << 32) | data.nFileSizeLow;
                    }
                }
                while (FindNextFile(handle, out data));
            }
            finally
            {
                FindClose(handle);
            }
        }
        return total;
    }
}
'@
if (-not ('LcoderWorktreeSize' -as [type])) {
  Add-Type -TypeDefinition $sizeSource -Language CSharp
}

function Get-TreeSize([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return [long]0 }
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  return [LcoderWorktreeSize]::Get('\\?\' + $full)
}

function Format-Size([long]$Bytes) {
  if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
  if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
  return ('{0:N0} KB' -f ($Bytes / 1KB))
}

# 有界口径：顶层逐项统计，但跳过 node_modules 整棵子树（pnpm 硬链接，且递归最慢）。
function Get-BoundedTotal([string]$Root) {
  $total = [long]0
  foreach ($item in Get-ChildItem -LiteralPath $Root -Force -ErrorAction SilentlyContinue) {
    # .git 与 .worktrees 不计入：前者是仓库元数据，后者会重复统计所有并行线。
    if ($item.Name -in @('node_modules', '.git', '.worktrees')) { continue }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    if ($item.PSIsContainer) { $total += Get-TreeSize $item.FullName }
    else { $total += $item.Length }
  }
  return $total
}

function Get-LibSize([string]$Root) {
  $total = [long]0
  $packages = Join-Path $Root 'packages'
  if (Test-Path -LiteralPath $packages) {
    foreach ($group in Get-ChildItem -LiteralPath $packages -Directory -Force -ErrorAction SilentlyContinue) {
      foreach ($package in Get-ChildItem -LiteralPath $group.FullName -Directory -Force -ErrorAction SilentlyContinue) {
        $lib = Join-Path $package.FullName 'lib'
        if (Test-Path -LiteralPath $lib) { $total += Get-TreeSize $lib }
      }
    }
  }
  $apps = Join-Path $Root 'apps'
  if (Test-Path -LiteralPath $apps) {
    foreach ($app in Get-ChildItem -LiteralPath $apps -Directory -Force -ErrorAction SilentlyContinue) {
      $lib = Join-Path $app.FullName 'lib'
      if (Test-Path -LiteralPath $lib) { $total += Get-TreeSize $lib }
    }
  }
  return $total
}

function Invoke-Inspect {
  $entries = New-Object System.Collections.Generic.List[object]
  foreach ($wt in $worktrees) {
    $full = [IO.Path]::GetFullPath($wt.Path).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $entries.Add([pscustomobject]@{ Path = $full; Branch = $wt.Branch; Registered = $true })
  }
  if (Test-Path -LiteralPath $worktreesRoot) {
    foreach ($dir in Get-ChildItem -LiteralPath $worktreesRoot -Directory -Force -ErrorAction SilentlyContinue) {
      $full = [IO.Path]::GetFullPath($dir.FullName).TrimEnd('\')
      $known = @($entries | Where-Object { $_.Path -ieq $full })
      if ($known.Count -eq 0) {
        $entries.Add([pscustomobject]@{ Path = $full; Branch = '(未注册)'; Registered = $false })
      }
    }
  }

  $scope = if ($Deep) { '精确统计（含 node_modules）' } else { '有界统计：node_modules 未逐文件统计' }
  Write-Host ("工作树占用（$scope；WarnGB=$WarnGB）") -ForegroundColor Cyan
  Write-Host ''

  $over = New-Object System.Collections.Generic.List[string]
  foreach ($entry in $entries) {
    $total = Get-BoundedTotal $entry.Path
    $lib = Get-LibSize $entry.Path
    $build = Get-TreeSize (Join-Path $entry.Path 'apps\desktop\.desktop-build')
    $nodeModules = Join-Path $entry.Path 'node_modules'
    $hasNodeModules = Test-Path -LiteralPath $nodeModules

    $nmText = '—'
    if ($hasNodeModules) {
      if ($Deep) {
        $nmBytes = Get-TreeSize $nodeModules
        $total += $nmBytes
        $nmText = (Format-Size $nmBytes)
      } else {
        $top = @(Get-ChildItem -LiteralPath $nodeModules -Force -ErrorAction SilentlyContinue).Count
        $nmText = "未统计（顶层 $top 项，硬链接共享）"
      }
    }

    $isMain = $entry.Path -ieq $mainRoot
    $label = if ($isMain) { '主检出' } else { '工作树' }
    $registered = if ($entry.Registered) { '' } else { '（目录残留，未注册）' }
    Write-Host ("$label $($entry.Path) [$($entry.Branch)]$registered")
    Write-Host ("    已统计 {0} | lib {1} | .desktop-build {2} | node_modules {3}" -f (Format-Size $total), (Format-Size $lib), (Format-Size $build), $nmText)
    if (($total / 1GB) -ge $WarnGB) {
      $over.Add($entry.Path)
      Write-Host ("    ! 超过 WarnGB=$WarnGB：建议 clean" + $(if (-not $entry.Registered) { '，或直接删残留目录' } else { '' })) -ForegroundColor Yellow
    }
  }

  Write-Host ''
  Write-Host '注意：node_modules 由 pnpm 从全局 store 硬链接，逐文件统计（-Deep）会显著高于实际磁盘占用。' -ForegroundColor DarkGray
  Write-Host '      junction 的 downloads/targets 已跳过，不重复计入本树；有界口径下 node_modules 不计入"已统计"。' -ForegroundColor DarkGray
  if ($over.Count -gt 0) {
    Write-Host ("超过 WarnGB=$WarnGB 的树：" + ($over -join '；')) -ForegroundColor Yellow
  }
}

function Show-Help {
  Write-Host 'LCoder 工作树空间工具'
  Write-Host ''
  Write-Host '  worktree.cmd -Action junction -Name <工作树名>'
  Write-Host '      把 .desktop-build\downloads 与 \targets 用 junction 指向主检出（共享 Electron 运行时）。'
  Write-Host '      home 与 electron-user-data 不共享，会话仍隔离。非空目标拒绝覆盖。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action sparse -Name <新树名> -Branch <分支> -Paths <目录1,目录2>'
  Write-Host '      建只含指定目录的稀疏工作树（cone 模式）；目标已存在时报错。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action clean -Name <工作树名>'
  Write-Host '      删 node_modules、packages\*\*\lib、apps\*\lib、apps\web\dist、.desktop-build。'
  Write-Host '      默认不动 git；加 -Remove 再注销 worktree 并删已合入分支（未合入只报错保留）。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action inspect [-WarnGB 8] [-Deep]'
  Write-Host '      列出主检出与 .worktrees 下各工作树占用，拆分 lib 与 .desktop-build。'
  Write-Host '      默认有界：node_modules 标"硬链接共享、未逐文件统计"；-Deep 才精确统计。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action provision -Name <工作树名> [-TimeoutSec 1800]'
  Write-Host '      持机器级锁，在目标工作树跑 pnpm install --offline --frozen-lockfile。'
  Write-Host '      打印等锁时长、退出码、耗时；等锁超时直接报错，不杀正在跑的命令。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action build -Name <工作树名> [-TimeoutSec 1800] [-DryRun]'
  Write-Host '      持同一把锁做分层重建：优先 <树>\lcoder\scripts\rebuild.cmd（只重出过期层）；'
  Write-Host '      树里没有该脚本才 pnpm run build:artifacts。-DryRun 只打印将要执行的命令。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action lock -Seconds <秒> [-Name LCoder-Heavy]'
  Write-Host '      持锁睡眠后释放；用来演示互斥：第二条会打印等待，直到第一条释放才继续。'
  Write-Host ''
  Write-Host '重活锁：provision/build/lock 抢同一把命名 Mutex，优先 Global\LCoder-Heavy（机器级）；'
  Write-Host '无权限时退回 Local\LCoder-Heavy 并打印说明（只在当前登录会话内互斥）。'
  Write-Host ''
  Write-Host '公共参数：-Target <完整路径> 覆盖默认的 .worktrees\<Name>；-Force 放行 .worktrees 之外的路径。'
  Write-Host '主检出一律拒绝 clean；删除前会逐条打印路径。'
}

try {
  switch ($Action) {
    'help' { Show-Help }
    'junction' { Invoke-Junction }
    'sparse' { Invoke-Sparse }
    'clean' { Invoke-Clean }
    'inspect' { Invoke-Inspect }
    'provision' { Invoke-Provision }
    'build' { Invoke-Build }
    'lock' { Invoke-Lock }
  }
} catch {
  Write-Host ('错误：' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
exit 0
