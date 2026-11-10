# LCoder 工作树空间工具：共享 Electron 运行时、稀疏检出、清理、占用巡检。
#
# 为什么有它：并行开发线各自一个 worktree，每个树都装一份 node_modules（GB 级、pnpm 硬链接到全局
# store）、各自下载一份 Electron 运行时（downloads 91MB + targets 268MB），磁盘很快见底；清理时
# git worktree remove 又会被超过 MAX_PATH 的嵌套 node_modules 卡住（见 lcoder/PITFALLS.md W-12）。
# 这个脚本把工作树空间优化与重活串行固定成可重复的命令，下次开线直接调用。
#
# 用法：
#   worktree.cmd -Action junction -Name <工作树名>
#       把该工作树的 .desktop-build\downloads 与 \targets 用 NTFS junction（mklink /J）
#       指向主检出同路径。home 与 electron-user-data 不共享，会话仍隔离。
#   worktree.cmd -Action sparse -Name <新树名> -Branch <分支> -Paths packages/lcoder,apps/desktop
#       用 git worktree add --no-checkout 加 cone 模式 sparse-checkout，只检出指定目录。
#       -Paths 用逗号或（PowerShell 数组）传入均可。分支已存在则直接挂上，不存在则新建。
#   worktree.cmd -Action sparse -Name <新树名> -Branch <分支> -Exclude .agents,docs,website
#       同一机制的排除写法：检出除列出的顶层目录以外的全部内容；与 -Paths 互斥。
#       snapshots 与 website 不能排除：pnpm run typecheck 的 host 聚合检查会导入它们。
#   worktree.cmd -Action clean -Name <工作树名>
#       只删构建大件：node_modules、packages\*\*\lib、apps\*\lib、apps\web\dist、
#       apps\desktop\.desktop-build。默认不碰 git（worktree 仍注册、分支保留）。
#   worktree.cmd -Action clean -Name <工作树名> -Remove
#       删完大件后继续 git worktree remove --force 与 git branch -d；
#       分支未合入时不强制删（不会用 -D），报错并保留。
#   worktree.cmd -Action inspect [-WarnGB 8] [-Deep]
#       列出主检出与 .worktrees 下各工作树的占用，拆分 lib 与 .desktop-build。
#       默认有界统计：node_modules 只标"硬链接共享、未逐文件统计"；-Deep 才精确统计它。
#   worktree.cmd -Action provision -Path <工作树> [-TimeoutSec 1800]
#       持机器级锁，在目标工作树跑 pnpm install --offline --frozen-lockfile。
#       目标必须是 git worktree list 里的树；也可用 -Name <名字> 指向 .worktrees\<名字>。
#   worktree.cmd -Action build -Path <工作树> [-TimeoutSec 1800] [-DryRun]
#       持同一把锁做分层重建：优先 lcoder\scripts\rebuild.cmd，缺它才 pnpm run build:artifacts。
#       pnpm/rebuild 的非零退出码原样透传。
#   worktree.cmd -Action lock -Seconds <秒> [-Name LCoder-Heavy]
#       持锁睡眠后释放，用于并发演示。
#   worktree.cmd -Action warm -Name <槽位> [-Base <ref>] [-ForceInstall] [-TimeoutSec 1800]
#       新建或复用预热槽位 .worktrees\<槽位>：完整检出（非稀疏）、junction、按需安装、
#       按需全量产物；池元数据写在 .worktrees\<槽位>.pool.json（不在树内）。
#   worktree.cmd -Action claim -Name <槽位> -Branch <分支> [-Base <ref>] [-ForceInstall]
#       确保槽位已预热，切到分支（不存在则从 Base 建），锁文件哈希不一致就重装，
#       优先 rebuild.cmd 分层重建产物；打印各阶段耗时与就绪提示。
#   worktree.cmd -Action release -Name <槽位> [-StopInstances]
#       清未跟踪文件并回 detached 基线；保留 node_modules 与 apps\desktop\.desktop-build。
#       默认不动进程；-StopInstances 只停本槽位路径下的桌面实例与 mock。
#   inspect 额外列出预热池槽位：分支、锁文件是否匹配、产物是否新鲜、占用体积。
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
  [ValidateSet('help', 'junction', 'sparse', 'clean', 'inspect', 'provision', 'build', 'lock', 'warm', 'claim', 'release')]
  [string]$Action = 'help',
  [string]$Name,
  [string]$Branch,
  [string]$Base,
  [string[]]$Paths,
  [string[]]$Exclude,
  [string]$Target,
  [string]$Path,
  [switch]$Remove,
  [switch]$Force,
  [switch]$ForceInstall,
  [switch]$StopInstances,
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
  # 局部变量不能叫 $path：PowerShell 变量名大小写不敏感，会覆盖脚本级 -Path 参数。
  $candidate = $null
  if ($Path) {
    $candidate = $Path
  } elseif ($Target) {
    $candidate = $Target
  } elseif ($Name) {
    if ($Name -match '[\\/:*?"<>|]') { throw "工作树名不能包含路径分隔符：$Name" }
    $candidate = Join-Path $worktreesRoot $Name
  } else {
    throw '缺少 -Path（或 -Name / -Target）：请给出目标工作树。'
  }
  $full = [IO.Path]::GetFullPath($candidate).TrimEnd('\')
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

# provision/build 的硬约束：目标存在、是工作树根、且在 git worktree list 里。
function Assert-RegisteredWorktree([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  if (-not (Test-Path -LiteralPath $full -PathType Container)) {
    throw "目标工作树不存在：$full"
  }
  $top = Invoke-Git $full @('rev-parse', '--show-toplevel')
  if ($top.Code -ne 0) {
    throw "目标不是 git 工作树：$full（$($top.Lines -join ' ')）"
  }
  $topPath = [IO.Path]::GetFullPath($top.Lines[0].Trim()).TrimEnd('\')
  if ($topPath -ine $full) {
    throw "目标不是工作树根：$full（git 根是 $topPath）"
  }
  # 每次都重新取列表：warm/claim 可能刚创建了本树，启动时的快照已经过期。
  $registered = @((Get-Worktrees) | Where-Object { [IO.Path]::GetFullPath($_.Path).TrimEnd('\') -ieq $full })
  if ($registered.Count -eq 0) {
    throw "目标不在 git worktree list 中：$full"
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
  Set-JunctionForTarget $target
  Write-Host '完成。home 与 electron-user-data 未共享，会话与登录态仍各自独立。' -ForegroundColor Green
}

# warm 复用同一套 junction 逻辑；目标已由调用方校验过。
function Set-JunctionForTarget([string]$Target) {
  $pairs = @(
    @{ Name = 'downloads'; Source = (Join-Path $mainRoot 'apps\desktop\.desktop-build\downloads') },
    @{ Name = 'targets';   Source = (Join-Path $mainRoot 'apps\desktop\.desktop-build\targets') }
  )
  foreach ($pair in $pairs) {
    $source = [IO.Path]::GetFullPath($pair.Source).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $source)) {
      throw "主检出缺少 $($pair.Name)：$source。先在主检出跑一次 dev:desktop 生成运行时。"
    }
    $destination = Join-Path $Target ("apps\desktop\.desktop-build\" + $pair.Name)
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
}
function Invoke-Sparse {
  if (-not $Name) { throw '缺少 -Name：请给出新工作树名。' }
  if (-not $Branch) { throw '缺少 -Branch：请给出分支名。' }
  # powershell -File 与 .cmd 转发时逗号是普通字符，不会自动拆成数组；这里统一再拆一次。
  $directories = New-Object System.Collections.Generic.List[string]
  foreach ($value in @($Paths)) {
    foreach ($piece in ([string]$value -split ',')) {
      $trimmed = $piece.Trim()
      if ($trimmed) { $directories.Add($trimmed) }
    }
  }
  $excluded = New-Object System.Collections.Generic.List[string]
  foreach ($value in @($Exclude)) {
    foreach ($piece in ([string]$value -split ',')) {
      # 容许写成 docs/ 或 docs\：只按顶层目录名比较。
      $trimmed = $piece.Trim().TrimEnd([char[]]@('/', '\'))
      if ($trimmed) { $excluded.Add($trimmed) }
    }
  }
  if ($directories.Count -gt 0 -and $excluded.Count -gt 0) {
    throw '不能同时给 -Paths 与 -Exclude：一个列要检出的目录，一个列要排除的目录。'
  }
  if ($excluded.Count -gt 0) {
    # cone 模式只能按目录给白名单；排除写法在脚本里换算成「全部顶层目录减去清单」。
    foreach ($nameToExclude in $excluded) {
      if ($nameToExclude -match '[\\/]') { throw "只支持排除顶层目录：$nameToExclude。子目录请用 -Paths 给出包含清单。" }
    }
    $top = Invoke-Git $mainRoot @('ls-tree', '-d', '--name-only', 'HEAD')
    if ($top.Code -ne 0) { throw ('读取顶层目录失败：' + ($top.Lines -join ' ')) }
    $tops = @($top.Lines | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $unknown = @($excluded | Where-Object { $candidate = $_; @($tops | Where-Object { $_ -ieq $candidate }).Count -eq 0 })
    if ($unknown.Count -gt 0) {
      throw ('不认识的顶层目录：' + ($unknown -join ', ') + '。可排除的有：' + ($tops -join ', '))
    }
    foreach ($dir in $tops) {
      if (@($excluded | Where-Object { $_ -ieq $dir }).Count -eq 0) { $directories.Add($dir) }
    }
    if ($directories.Count -eq 0) { throw '排除清单覆盖了所有顶层目录，稀疏树会没有源码。' }
  }
  if ($directories.Count -eq 0) { throw '缺少 -Paths 或 -Exclude：请给出目录清单。' }
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
  if ($excluded.Count -gt 0) { Write-Host ("排除目录：" + ($excluded -join ', ')) }
  Write-Host '下一步：树内 pnpm install 与 pnpm run build:artifacts；需要共享 Electron 运行时再跑 -Action junction。' -ForegroundColor DarkGray
}

function Invoke-PnpmInstallLocked([string]$Target) {
  $lock = Enter-HeavyLock 'LCoder-Heavy' $TimeoutSec
  $started = Get-Date
  try {
    $result = Invoke-LockedNative 'pnpm install --offline --frozen-lockfile' 'pnpm' @('install', '--offline', '--frozen-lockfile') $Target
    return [pscustomobject]@{ Code = $result.Code; Elapsed = $result.Elapsed }
  } finally {
    Exit-HeavyLock $lock $started
  }
}

function Invoke-PnpmFullBuildLocked([string]$Target) {
  $lock = Enter-HeavyLock 'LCoder-Heavy' $TimeoutSec
  $started = Get-Date
  try {
    $result = Invoke-LockedNative 'pnpm run build:artifacts（全量）' 'pnpm' @('run', 'build:artifacts') $Target
    return [pscustomobject]@{ Code = $result.Code; Elapsed = $result.Elapsed }
  } finally {
    Exit-HeavyLock $lock $started
  }
}

function Invoke-RebuildLayeredLocked([string]$Target) {
  $rebuild = Join-Path $Target 'lcoder\scripts\rebuild.cmd'
  if (-not (Test-Path -LiteralPath $rebuild)) {
    Write-Host '树内没有 lcoder\scripts\rebuild.cmd，退回全量 artifacts。' -ForegroundColor Yellow
    return (Invoke-PnpmFullBuildLocked $Target)
  }
  $lock = Enter-HeavyLock 'LCoder-Heavy' $TimeoutSec
  $started = Get-Date
  try {
    $result = Invoke-LockedNative 'rebuild.cmd auto（分层）' 'cmd.exe' @('/d', '/c', $rebuild, 'auto') $Target
    return [pscustomobject]@{ Code = $result.Code; Elapsed = $result.Elapsed }
  } finally {
    Exit-HeavyLock $lock $started
  }
}

function Invoke-ProfileGuardLocked([string]$Target) {
  # 构建被跳过时（全量构建或产物已最新）也必须保障 profile：新树缺 package.json 的 link 依赖，
  # 桌面起来就是原版 DSH。走树内 rebuild.cmd 的 profile 层，保证只有一份实现。
  $rebuild = Join-Path $Target 'lcoder\scripts\rebuild.cmd'
  if (-not (Test-Path -LiteralPath $rebuild)) {
    Write-Host '树内没有 lcoder\scripts\rebuild.cmd，无法执行 profile 保障。' -ForegroundColor Red
    return [pscustomobject]@{ Code = 1; Elapsed = 0 }
  }
  $lock = Enter-HeavyLock 'LCoder-Heavy' $TimeoutSec
  $started = Get-Date
  try {
    $result = Invoke-LockedNative 'rebuild.cmd profile（profile 保障）' 'cmd.exe' @('/d', '/c', $rebuild, 'profile') $Target
    return [pscustomobject]@{ Code = $result.Code; Elapsed = $result.Elapsed }
  } finally {
    Exit-HeavyLock $lock $started
  }
}

function Invoke-Provision {
  $target = Resolve-TargetPath -MustExist
  Assert-TargetAllowed $target
  Assert-RegisteredWorktree $target
  $result = Invoke-PnpmInstallLocked $target
  if ($result.Code -ne 0) {
    Write-Host ('provision 失败：pnpm 退出码 ' + $result.Code + '，耗时 ' + $result.Elapsed + ' 秒。离线安装失败多半是本地 pnpm store 缺包，去掉 --offline 联网补一次。') -ForegroundColor Red
  } else {
    Write-Host ('provision 完成：' + $target) -ForegroundColor Green
  }
  return $result.Code
}

function Invoke-Build {
  $target = Resolve-TargetPath -MustExist
  Assert-TargetAllowed $target
  Assert-RegisteredWorktree $target
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
    return 0
  }
  $lock = Enter-HeavyLock 'LCoder-Heavy' $TimeoutSec
  $started = Get-Date
  $code = 0
  try {
    $result = Invoke-LockedNative $label $file $arguments $target
    $code = $result.Code
    if ($code -ne 0) {
      Write-Host ('分层重建失败：退出码 ' + $code + '，耗时 ' + $result.Elapsed + ' 秒。') -ForegroundColor Red
    } else {
      Write-Host 'build 完成。' -ForegroundColor Green
    }
  } finally {
    Exit-HeavyLock $lock $started
  }
  return $code
}

# ── 预热池 ─────────────────────────────────────────────────────────
# 槽位元数据放在 .worktrees\<槽位>.pool.json（树外），避免污染工作区。
function Assert-SlotName {
  if (-not $Name) { throw '缺少 -Name：请给出池槽位名（例如 _pool-a）。' }
  if ($Name -match '[\\/:*?"<>|]') { throw "槽位名不能包含路径分隔符：$Name" }
}

function Get-PoolMetadataPath([string]$Slot) {
  return (Join-Path $worktreesRoot ($Slot + '.pool.json'))
}

function Read-PoolMetadata([string]$Slot) {
  $file = Get-PoolMetadataPath $Slot
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  try {
    return (Get-Content -LiteralPath $file -Raw -Encoding utf8 | ConvertFrom-Json)
  } catch {
    Write-Host ("池元数据无法解析，按缺失处理：" + $file + "（" + $_.Exception.Message + "）") -ForegroundColor Yellow
    return $null
  }
}

function Write-PoolMetadata($Metadata) {
  $file = Get-PoolMetadataPath $Metadata.slot
  $json = ($Metadata | ConvertTo-Json -Depth 5)
  [IO.File]::WriteAllText($file, $json + "`n", [Text.UTF8Encoding]::new($false))
  Write-Host ("池元数据：" + $file) -ForegroundColor DarkGray
}

# 锁文件按内容哈希判断，不看 mtime：同一内容重新落盘不应触发重装。
function Get-LockHash([string]$Target) {
  $file = Join-Path $Target 'pnpm-lock.yaml'
  if (-not (Test-Path -LiteralPath $file)) { throw "缺少锁文件：$file" }
  return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
}

function Get-ShortHash([string]$Hash) {
  if (-not $Hash) { return '(无)' }
  if ($Hash.Length -le 12) { return $Hash }
  return $Hash.Substring(0, 12)
}

function Get-HeadSha([string]$Target) {
  $result = Invoke-Git $Target @('rev-parse', 'HEAD')
  if ($result.Code -ne 0 -or $result.Lines.Count -eq 0) {
    throw ("无法读取 HEAD：" + $Target + "（" + ($result.Lines -join ' ') + "）")
  }
  return $result.Lines[0].Trim()
}

function Resolve-Commit([string]$Ref) {
  $result = Invoke-Git $mainRoot @('rev-parse', '--verify', '--quiet', ($Ref + '^{commit}'))
  if ($result.Code -ne 0) { throw "无法解析基线引用：$Ref" }
  return $result.Lines[0].Trim()
}

# 全量 artifacts 的基线标记；缺它就只能全量重建，不能只重出 lcoder 那几层。
function Test-ArtifactBaseline([string]$Target) {
  return ((Test-Path -LiteralPath (Join-Path $Target 'apps\desktop\lib\main.js')) -and
          (Test-Path -LiteralPath (Join-Path $Target 'packages\lcoder\kernel\lib\index.js')))
}

function Get-ChangedPaths([string]$Target, [string]$From, [string]$To) {
  $result = Invoke-Git $Target @('diff', '--name-only', $From, $To)
  if ($result.Code -ne 0) {
    throw ("无法比较产物基线（" + $From + ".." + $To + "）：" + ($result.Lines -join ' '))
  }
  return @($result.Lines | Where-Object { $_ })
}

function Ensure-SlotWorktree([string]$Slot, [string]$BaseRef) {
  $target = [IO.Path]::GetFullPath((Join-Path $worktreesRoot $Slot)).TrimEnd('\')
  if ($target -ieq $mainRoot) { throw '拒绝：槽位目标是主检出。' }
  if (Test-Path -LiteralPath $target) {
    $list = Get-Worktrees
    $entry = @($list | Where-Object { [IO.Path]::GetFullPath($_.Path).TrimEnd('\') -ieq $target })
    if ($entry.Count -eq 0) {
      throw ("槽位目录已存在但没有注册为工作树：" + $target + "。确认是残留后手工删除（或用 rm-longpath.mjs）再重试。")
    }
    return $target
  }
  $ref = if ($BaseRef) { $BaseRef } else { 'HEAD' }
  $commit = Resolve-Commit $ref
  Write-Host ("首次建槽位（完整检出）：" + $target + " @ " + $ref + "（" + (Get-ShortHash $commit) + "）") -ForegroundColor Cyan
  $started = Get-Date
  $added = Invoke-Git $mainRoot @('worktree', 'add', '--detach', $target, $commit)
  foreach ($line in $added.Lines) { Write-Host ('  ' + $line) }
  if ($added.Code -ne 0) {
    throw ("git worktree add 失败（退出码 " + $added.Code + "）：" + ($added.Lines -join ' '))
  }
  # 槽位必须是完整检出：稀疏目录会让依赖与产物不全，claim 就失去意义。
  $sparse = Invoke-Git $target @('sparse-checkout', 'list')
  if ($sparse.Code -eq 0) {
    Write-Host '槽位仍是稀疏检出，关闭 sparse-checkout 做完整检出。' -ForegroundColor Yellow
    $disabled = Invoke-Git $target @('sparse-checkout', 'disable')
    if ($disabled.Code -ne 0) { throw ("关闭 sparse-checkout 失败：" + ($disabled.Lines -join ' ')) }
  }
  Write-Host ("工作树创建完成：{0} 秒" -f ([int]((Get-Date) - $started).TotalSeconds)) -ForegroundColor Green
  return $target
}

# 只停本槽位路径下的进程：命令行里必须出现该树自己的 electron-user-data / mock / dev.ts。
function Stop-SlotInstances([string]$Target) {
  $electronData = Join-Path $Target 'apps\desktop\.desktop-build\development\electron-user-data'
  $mockScript = Join-Path $Target 'lcoder\scripts\mock-cloud.mjs'
  $devScript = Join-Path $Target 'apps\desktop\scripts\dev.ts'
  $all = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine })
  $matched = @($all | Where-Object {
    ($_.Name -eq 'electron.exe' -and $_.CommandLine -like ('*' + $electronData + '*')) -or
    ($_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $mockScript + '*')) -or
    ($_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $devScript + '*'))
  })
  if ($matched.Count -eq 0) {
    Write-Host '本槽位没有正在运行的桌面实例或 mock。' -ForegroundColor DarkGray
    return @()
  }
  $pids = New-Object System.Collections.Generic.List[int]
  foreach ($p in $matched) {
    Write-Host ("停掉本槽位进程 PID {0}（{1}）" -f $p.ProcessId, $p.Name) -ForegroundColor DarkYellow
    $pids.Add([int]$p.ProcessId)
    & taskkill.exe /PID $p.ProcessId /T /F *> $null
  }
  Start-Sleep -Milliseconds 600
  $alive = @(Get-CimInstance Win32_Process | Where-Object { $pids -contains [int]$_.ProcessId })
  if ($alive.Count -gt 0) {
    throw ("仍有本槽位进程未退出：PID " + (($alive | ForEach-Object { $_.ProcessId }) -join ', '))
  }
  return $pids
}

function Invoke-Warm {
  Assert-SlotName
  $slot = $Name
  $startedAll = Get-Date
  $target = Ensure-SlotWorktree $slot $Base
  Assert-TargetAllowed $target
  Assert-RegisteredWorktree $target

  $meta = Read-PoolMetadata $slot
  $head = Get-HeadSha $target
  $lockHash = Get-LockHash $target

  $junctionStart = Get-Date
  Set-JunctionForTarget $target
  $junctionSec = [int]((Get-Date) - $junctionStart).TotalSeconds

  $installSec = 0
  $installReason = $null
  $hasNodeModules = Test-Path -LiteralPath (Join-Path $target 'node_modules')
  if ($ForceInstall) {
    $installReason = '-ForceInstall'
  } elseif (-not $hasNodeModules) {
    $installReason = 'node_modules 缺失'
  } elseif (-not $meta) {
    $installReason = '缺少池元数据，无法证明依赖与锁文件一致'
  } elseif ($meta.lockHash -ne $lockHash) {
    $installReason = ('锁文件哈希不一致：池内 ' + (Get-ShortHash $meta.lockHash) + '，当前 ' + (Get-ShortHash $lockHash))
  }
  if ($installReason) {
    Write-Host ('需要安装依赖：' + $installReason) -ForegroundColor Yellow
    $installed = Invoke-PnpmInstallLocked $target
    $installSec = $installed.Elapsed
    if ($installed.Code -ne 0) {
      throw ('warm 卡在依赖安装：pnpm 退出码 ' + $installed.Code + '，耗时 ' + $installSec + ' 秒。')
    }
    $lockHash = Get-LockHash $target
  } else {
    Write-Host '依赖已就绪（锁文件哈希一致），跳过安装。' -ForegroundColor DarkGray
  }

  $currentHead = Get-HeadSha $target
  $buildKind = 'none'
  if (-not (Test-ArtifactBaseline $target)) {
    $buildKind = 'full'
  } elseif ($meta -and $meta.artifactCommit -eq $currentHead) {
    $buildKind = 'none'
  } elseif ($meta -and $meta.artifactCommit) {
    $buildKind = 'layered'
  } else {
    $buildKind = 'full'
  }
  if ($installReason -and $buildKind -eq 'none') { $buildKind = 'layered' }

  $buildSec = 0
  if ($buildKind -eq 'full') {
    Write-Host '构建：全量 build:artifacts（缺少基线或没有上次构建记录）。' -ForegroundColor Cyan
    $built = Invoke-PnpmFullBuildLocked $target
    $buildSec = $built.Elapsed
    if ($built.Code -ne 0) {
      throw ('warm 卡在产物构建：全量 build:artifacts 退出码 ' + $built.Code + '，耗时 ' + $buildSec + ' 秒。')
    }
  } elseif ($buildKind -eq 'layered') {
    Write-Host '构建：rebuild.cmd auto 分层重建。' -ForegroundColor Cyan
    $built = Invoke-RebuildLayeredLocked $target
    $buildSec = $built.Elapsed
    if ($built.Code -ne 0) {
      throw ('warm 卡在产物构建：rebuild.cmd 退出码 ' + $built.Code + '，耗时 ' + $buildSec + ' 秒。')
    }
  } else {
    Write-Host '产物与当前提交一致，跳过构建。' -ForegroundColor DarkGray
  }

  # 分层路径的 rebuild.cmd auto 已带 profile 保障；全量与「跳过构建」这两条都要补一次。
  $profileSec = 0
  if ($buildKind -ne 'layered') {
    Write-Host 'profile 保障：检查 package.json 的 link 依赖与 node_modules 链接。' -ForegroundColor Cyan
    $guarded = Invoke-ProfileGuardLocked $target
    $profileSec = $guarded.Elapsed
    if ($guarded.Code -ne 0) {
      throw ('warm 卡在 profile 保障：rebuild.cmd profile 退出码 ' + $guarded.Code + '，耗时 ' + $profileSec + ' 秒。')
    }
  }

  $now = (Get-Date).ToString('o')
  $metaOut = [ordered]@{
    version          = 1
    slot             = $slot
    baseCommit       = if ($meta -and $meta.baseCommit) { $meta.baseCommit } else { $currentHead }
    head             = $currentHead
    lockHash         = $lockHash
    provisionedAt    = if ($installReason) { $now } elseif ($meta -and $meta.provisionedAt) { $meta.provisionedAt } else { $now }
    provisionSeconds = if ($installReason) { $installSec } elseif ($meta -and $null -ne $meta.provisionSeconds) { $meta.provisionSeconds } else { 0 }
    artifactCommit   = $currentHead
    artifactBuiltAt  = if ($buildKind -ne 'none') { $now } elseif ($meta -and $meta.artifactBuiltAt) { $meta.artifactBuiltAt } else { $now }
    buildKind        = $buildKind
    buildSeconds     = $buildSec
    warmedAt         = $now
  }
  Write-PoolMetadata $metaOut

  $totalSec = [int]((Get-Date) - $startedAll).TotalSeconds
  Write-Host ''
  Write-Host ('warm 完成：' + $target) -ForegroundColor Green
  Write-Host ("  junction {0} 秒 | 安装 {1} 秒（{2}） | 构建 {3} 秒（{4}） | 合计 {5} 秒" -f $junctionSec, $installSec, $(if ($installReason) { $installReason } else { '跳过' }), $buildSec, $buildKind, $totalSec)
  Write-Host ("  锁文件 " + (Get-ShortHash $lockHash) + " | HEAD " + (Get-ShortHash $currentHead))
}

function Invoke-Claim {
  Assert-SlotName
  if (-not $Branch) { throw '缺少 -Branch：请给出要切到的分支。' }
  $slot = $Name
  $startedAll = Get-Date
  # 先做分支占用检查：被别的树检出时不必先付建树/安装的代价。
  $slotTarget = [IO.Path]::GetFullPath((Join-Path $worktreesRoot $slot)).TrimEnd('\')
  if ($slotTarget -ieq $mainRoot) { throw '拒绝：槽位目标是主检出。' }
  $list = Get-Worktrees
  $occupied = @($list | Where-Object {
    $_.Branch -eq $Branch -and ([IO.Path]::GetFullPath($_.Path).TrimEnd('\') -ine $slotTarget)
  })
  if ($occupied.Count -gt 0) {
    throw ("分支 " + $Branch + " 已被另一棵工作树检出：" + $occupied[0].Path + "。先在那边 release，或改用别的分支（本工具不强切）。")
  }

  $target = Ensure-SlotWorktree $slot $Base
  Assert-TargetAllowed $target
  Assert-RegisteredWorktree $target

  $meta = Read-PoolMetadata $slot
  $needsWarm = (-not $meta) -or
    (-not (Test-Path -LiteralPath (Join-Path $target 'node_modules'))) -or
    (-not (Test-ArtifactBaseline $target))
  if ($needsWarm) {
    Write-Host '槽位未就绪（缺元数据、依赖或产物基线），先跑 warm 阶段。' -ForegroundColor Yellow
    Invoke-Warm
    $meta = Read-PoolMetadata $slot
  }

  $checkoutStart = Get-Date
  $current = Invoke-Git $target @('rev-parse', '--abbrev-ref', 'HEAD')
  $currentBranch = if ($current.Code -eq 0 -and $current.Lines.Count -gt 0) { $current.Lines[0].Trim() } else { 'HEAD' }
  if ($currentBranch -ne $Branch) {
    $known = (Invoke-Git $mainRoot @('rev-parse', '--verify', '--quiet', "refs/heads/$Branch")).Code -eq 0
    if ($known) {
      Write-Host ('切换到已有分支：' + $Branch) -ForegroundColor Cyan
      $switch = Invoke-Git $target @('checkout', $Branch)
    } else {
      $baseRef = if ($Base) { $Base } else { 'HEAD' }
      $baseCommit = Resolve-Commit $baseRef
      Write-Host ('新建分支：' + $Branch + '（从 ' + $baseRef + ' @ ' + (Get-ShortHash $baseCommit) + '）') -ForegroundColor Cyan
      $switch = Invoke-Git $target @('checkout', '-b', $Branch, $baseCommit)
    }
    if ($switch.Code -ne 0) {
      throw ("切换分支 $Branch 失败。槽位可能有未提交改动或未跟踪文件冲突，先跑 -Action release -Name $slot 再 claim。git 输出：" + ($switch.Lines -join ' '))
    }
  } else {
    Write-Host ('槽位已在该分支：' + $Branch) -ForegroundColor DarkGray
  }
  $checkoutSec = [int]((Get-Date) - $checkoutStart).TotalSeconds

  $lockHash = Get-LockHash $target
  $oldHash = if ($meta -and $meta.lockHash) { $meta.lockHash } else { $null }
  $installSec = 0
  $installNote = '跳过（哈希一致）'
  if ($ForceInstall -or -not $oldHash -or $oldHash -ne $lockHash) {
    if ($oldHash -and $oldHash -ne $lockHash) {
      Write-Host ('锁文件哈希不一致：池内依赖基于 ' + (Get-ShortHash $oldHash) + '，当前树是 ' + (Get-ShortHash $lockHash) + '。') -ForegroundColor Yellow
      Write-Host '必须重装依赖，不会静默沿用旧 node_modules。' -ForegroundColor Yellow
      $installNote = '锁文件变化，已重装'
    } else {
      Write-Host '依赖缺失或强制安装：执行 pnpm install。' -ForegroundColor Yellow
      $installNote = '缺失或强制安装'
    }
    $installed = Invoke-PnpmInstallLocked $target
    $installSec = $installed.Elapsed
    if ($installed.Code -ne 0) {
      throw ('claim 卡在依赖安装：pnpm 退出码 ' + $installed.Code + '，耗时 ' + $installSec + ' 秒。')
    }
    $lockHash = Get-LockHash $target
  } else {
    Write-Host '锁文件哈希一致，跳过安装。' -ForegroundColor DarkGray
  }

  $head = Get-HeadSha $target
  $buildKind = 'none'
  $buildReason = '产物与当前提交一致'
  if (-not (Test-ArtifactBaseline $target)) {
    $buildKind = 'full'
    $buildReason = '缺少产物基线'
  } elseif (-not $meta -or -not $meta.artifactCommit) {
    $buildKind = 'full'
    $buildReason = '没有上次构建记录'
  } elseif ($meta.artifactCommit -eq $head) {
    $buildKind = 'none'
  } else {
    $changed = Get-ChangedPaths $target $meta.artifactCommit $head
    if ($changed.Count -eq 0) {
      $buildKind = 'none'
      $buildReason = '提交树没有变化'
    } else {
      $outside = @($changed | Where-Object { -not ($_ -like 'lcoder/*' -or $_ -like 'apps/desktop/*') })
      if ($outside.Count -gt 0) {
        $buildKind = 'full'
        $buildReason = ('改动触及 lcoder/ 与 apps/desktop/ 之外（' + $outside.Count + ' 个文件，如 ' + $outside[0] + '）')
      } else {
        $buildKind = 'layered'
        $buildReason = ('只有 ' + $changed.Count + ' 个 lcoder/apps/desktop 文件变化')
      }
    }
  }
  if ($installSec -gt 0 -and $buildKind -eq 'none') {
    $buildKind = 'layered'
    $buildReason = '刚重装依赖，重出 lcoder 层'
  }

  $buildSec = 0
  if ($buildKind -eq 'full') {
    Write-Host ('构建：全量 build:artifacts（' + $buildReason + '）。') -ForegroundColor Cyan
    $built = Invoke-PnpmFullBuildLocked $target
    $buildSec = $built.Elapsed
    if ($built.Code -ne 0) {
      throw ('claim 卡在产物构建：全量 build:artifacts 退出码 ' + $built.Code + '，耗时 ' + $buildSec + ' 秒。')
    }
  } elseif ($buildKind -eq 'layered') {
    Write-Host ('构建：rebuild.cmd auto 分层重建（' + $buildReason + '）。') -ForegroundColor Cyan
    $built = Invoke-RebuildLayeredLocked $target
    $buildSec = $built.Elapsed
    if ($built.Code -ne 0) {
      throw ('claim 卡在产物构建：rebuild.cmd 退出码 ' + $built.Code + '，耗时 ' + $buildSec + ' 秒。')
    }
  } else {
    Write-Host ('构建：跳过（' + $buildReason + '）。') -ForegroundColor DarkGray
  }

  # 分层路径的 rebuild.cmd auto 已带 profile 保障；全量与「跳过构建」这两条都要补一次。
  if ($buildKind -ne 'layered') {
    Write-Host 'profile 保障：检查 package.json 的 link 依赖与 node_modules 链接。' -ForegroundColor Cyan
    $guarded = Invoke-ProfileGuardLocked $target
    if ($guarded.Code -ne 0) {
      throw ('claim 卡在 profile 保障：rebuild.cmd profile 退出码 ' + $guarded.Code + '，耗时 ' + $guarded.Elapsed + ' 秒。')
    }
  }

  $now = (Get-Date).ToString('o')
  $metaOut = [ordered]@{
    version          = 1
    slot             = $slot
    baseCommit       = if ($meta -and $meta.baseCommit) { $meta.baseCommit } else { $head }
    head             = $head
    branch           = $Branch
    lockHash         = $lockHash
    provisionedAt    = if ($installSec -gt 0) { $now } elseif ($meta -and $meta.provisionedAt) { $meta.provisionedAt } else { $now }
    provisionSeconds = if ($installSec -gt 0) { $installSec } elseif ($meta -and $null -ne $meta.provisionSeconds) { $meta.provisionSeconds } else { 0 }
    artifactCommit   = $head
    artifactBuiltAt  = if ($buildKind -ne 'none') { $now } elseif ($meta -and $meta.artifactBuiltAt) { $meta.artifactBuiltAt } else { $now }
    buildKind        = $buildKind
    buildSeconds     = $buildSec
    warmedAt         = $now
    claimedAt        = $now
  }
  Write-PoolMetadata $metaOut

  $totalSec = [int]((Get-Date) - $startedAll).TotalSeconds
  Write-Host ''
  Write-Host ('claim 就绪：' + $target) -ForegroundColor Green
  Write-Host ("  分支 {0} | HEAD {1} | 锁文件 {2}" -f $Branch, (Get-ShortHash $head), (Get-ShortHash $lockHash))
  Write-Host ("  切分支 {0} 秒 | 安装 {1} 秒（{2}） | 构建 {3} 秒（{4}） | 合计 {5} 秒" -f $checkoutSec, $installSec, $installNote, $buildSec, $buildKind, $totalSec)
  Write-Host ('  下一步：lcoder\scripts\start-desktop.cmd -Fast（首次起窗口仍需按需准备运行目录）。') -ForegroundColor DarkGray
}

function Invoke-Release {
  Assert-SlotName
  $slot = $Name
  $target = [IO.Path]::GetFullPath((Join-Path $worktreesRoot $slot)).TrimEnd('\')
  Assert-TargetAllowed $target
  Assert-RegisteredWorktree $target
  $meta = Read-PoolMetadata $slot
  $previousBranch = if ($meta -and $meta.branch) { $meta.branch } else { '(无)' }

  if ($StopInstances) {
    $stopped = Stop-SlotInstances $target
  } else {
    Write-Host '默认不动进程；需要停本槽位实例时加 -StopInstances。' -ForegroundColor DarkGray
    $stopped = @()
  }

  $dirty = @((Invoke-Git $target @('status', '--porcelain')).Lines | Where-Object { $_ })
  if ($dirty.Count -gt 0) {
    Write-Host ('清理槽位工作区：' + $dirty.Count + ' 项已跟踪改动或未跟踪文件。') -ForegroundColor Cyan
  } else {
    Write-Host '槽位工作区本来就干净。' -ForegroundColor DarkGray
  }
  $reset = Invoke-Git $target @('reset', '--hard', '--quiet')
  if ($reset.Code -ne 0) { throw ('git reset --hard 失败：' + ($reset.Lines -join ' ')) }
  # 不加 -x：node_modules、apps\desktop\.desktop-build、lib/ 都是 ignored，必须保留。
  $clean = Invoke-Git $target @('clean', '-fd')
  if ($clean.Code -ne 0) { throw ('git clean -fd 失败：' + ($clean.Lines -join ' ')) }
  foreach ($line in $clean.Lines) { Write-Host ('  ' + $line) }

  $baseCommit = if ($meta -and $meta.baseCommit) { $meta.baseCommit } else { Resolve-Commit 'HEAD' }
  $detached = Invoke-Git $target @('checkout', '--detach', $baseCommit)
  if ($detached.Code -ne 0) { throw ('回 detached 基线失败：' + ($detached.Lines -join ' ')) }

  $nodeModules = Join-Path $target 'node_modules'
  $desktopBuild = Join-Path $target 'apps\desktop\.desktop-build'
  if (-not (Test-Path -LiteralPath $nodeModules)) { throw 'release 后 node_modules 丢失：清理误删了依赖，请重跑 warm。' }
  if (-not (Test-Path -LiteralPath $desktopBuild)) { Write-Host '提示：apps\desktop\.desktop-build 不在，下次 warm 会重建 junction。' -ForegroundColor Yellow }

  $now = (Get-Date).ToString('o')
  $metaOut = [ordered]@{
    version          = 1
    slot             = $slot
    baseCommit       = $baseCommit
    head             = $baseCommit
    branch           = ''
    lockHash         = if ($meta -and $meta.lockHash) { $meta.lockHash } else { (Get-LockHash $target) }
    provisionedAt    = if ($meta) { $meta.provisionedAt } else { $now }
    provisionSeconds = if ($meta -and $null -ne $meta.provisionSeconds) { $meta.provisionSeconds } else { 0 }
    artifactCommit   = if ($meta -and $meta.artifactCommit) { $meta.artifactCommit } else { $baseCommit }
    artifactBuiltAt  = if ($meta) { $meta.artifactBuiltAt } else { $now }
    buildKind        = if ($meta) { $meta.buildKind } else { 'none' }
    buildSeconds     = if ($meta -and $null -ne $meta.buildSeconds) { $meta.buildSeconds } else { 0 }
    warmedAt         = if ($meta -and $meta.warmedAt) { $meta.warmedAt } else { $now }
    releasedAt       = $now
  }
  Write-PoolMetadata $metaOut

  Write-Host ''
  Write-Host ('release 完成：' + $target) -ForegroundColor Green
  Write-Host ("  已回 detached " + (Get-ShortHash $baseCommit) + "；node_modules 保留，node_modules 与产物未被 git clean 触碰。")
  if ($stopped.Count -gt 0) { Write-Host ('  已停本槽位进程：PID ' + ($stopped -join ', ')) -ForegroundColor DarkYellow }
  Write-Host ('  分支 ' + $previousBranch + ' 可再次 claim。') -ForegroundColor DarkGray
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
    # 一次传几百个 lib 路径会超过 Windows 命令行上限（CreateProcess 32k）而根本起不来 node；
    # 分批发给同一个删除脚本，退出码与逐条 FAILED 报告的语义不变。
    $failed = @()
    $batchSize = 40
    for ($offset = 0; $offset -lt $paths.Count; $offset += $batchSize) {
      $count = [Math]::Min($batchSize, $paths.Count - $offset)
      $batch = $paths.GetRange($offset, $count)
      $removed = Invoke-Native 'node' (@($rmScript) + $batch.ToArray())
      foreach ($line in $removed.Lines) { Write-Host ('  ' + $line) }
      $failed += @($removed.Lines | Where-Object { $_ -like 'FAILED *' })
    }
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
  Invoke-InspectPools
}

# 预热池状态：槽位、分支、锁文件是否匹配、产物是否新鲜、占用体积。
function Invoke-InspectPools {
  $files = @()
  if (Test-Path -LiteralPath $worktreesRoot) {
    $files = @(Get-ChildItem -LiteralPath $worktreesRoot -File -Force -Filter '*.pool.json' -ErrorAction SilentlyContinue)
  }
  Write-Host ''
  if ($files.Count -eq 0) {
    Write-Host '预热池：没有槽位元数据（warm 后会出现 <槽位>.pool.json）。' -ForegroundColor DarkGray
    return
  }
  Write-Host ('预热池槽位（' + $files.Count + ' 个）') -ForegroundColor Cyan
  foreach ($file in $files) {
    $slot = $file.Name -replace '\.pool\.json$', ''
    $meta = Read-PoolMetadata $slot
    $target = [IO.Path]::GetFullPath((Join-Path $worktreesRoot $slot)).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $target)) {
      Write-Host ("槽位 $slot：目录不存在（元数据残留）")
      continue
    }
    $headResult = Invoke-Git $target @('rev-parse', 'HEAD')
    $head = if ($headResult.Code -eq 0 -and $headResult.Lines.Count -gt 0) { $headResult.Lines[0].Trim() } else { '' }
    $branchResult = Invoke-Git $target @('rev-parse', '--abbrev-ref', 'HEAD')
    $branch = if ($branchResult.Code -eq 0 -and $branchResult.Lines.Count -gt 0) { $branchResult.Lines[0].Trim() } else { '?' }
    if ($branch -eq 'HEAD') { $branch = '(detached)' }

    $lockState = '未知'
    if ($meta -and $meta.lockHash) {
      $nowHash = try { Get-LockHash $target } catch { $null }
      if ($null -eq $nowHash) { $lockState = '锁文件缺失' }
      elseif ($nowHash -eq $meta.lockHash) { $lockState = '匹配 ' + (Get-ShortHash $nowHash) }
      else { $lockState = '不匹配（池内 ' + (Get-ShortHash $meta.lockHash) + ' / 当前 ' + (Get-ShortHash $nowHash) + '）' }
    }
    $fresh = ($meta -and $meta.artifactCommit -and $meta.artifactCommit -eq $head -and (Test-ArtifactBaseline $target))
    $freshText = if ($fresh) { '新鲜' } elseif (-not (Test-ArtifactBaseline $target)) { '缺产物' } else { '过期（产物基于 ' + (Get-ShortHash $(if ($meta) { $meta.artifactCommit } else { '' })) + '）' }

    $size = Get-BoundedTotal $target
    $nm = Join-Path $target 'node_modules'
    $nmText = if (Test-Path -LiteralPath $nm) { '有（未统计，硬链接共享）' } else { '无' }

    Write-Host ("槽位 $slot [$branch] HEAD " + (Get-ShortHash $head))
    Write-Host ("    锁文件 {0} | 产物 {1} | 已统计 {2}（含 .desktop-build " + (Format-Size (Get-TreeSize (Join-Path $target 'apps\desktop\.desktop-build'))) + "） | node_modules {3}" -f $lockState, $freshText, (Format-Size $size), $nmText)
    if ($meta -and $null -ne $meta.provisionSeconds -and $meta.provisionSeconds -gt 0) {
      Write-Host ("    上次安装 " + $meta.provisionSeconds + " 秒；上次构建 " + $meta.buildKind + " " + $meta.buildSeconds + " 秒") -ForegroundColor DarkGray
    }
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
  Write-Host '  worktree.cmd -Action sparse -Name <新树名> -Branch <分支> -Exclude <目录1,目录2>'
  Write-Host '      排除写法：检出除列出顶层目录外的全部内容；与 -Paths 互斥，不认识的名字直接报错。'
  Write-Host '      注意：pnpm run typecheck 会读 snapshots 与 website，排除它们时 host 聚合检查会红。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action clean -Name <工作树名>'
  Write-Host '      删 node_modules、packages\*\*\lib、apps\*\lib、apps\web\dist、.desktop-build。'
  Write-Host '      默认不动 git；加 -Remove 再注销 worktree 并删已合入分支（未合入只报错保留）。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action inspect [-WarnGB 8] [-Deep]'
  Write-Host '      列出主检出与 .worktrees 下各工作树占用，拆分 lib 与 .desktop-build。'
  Write-Host '      默认有界：node_modules 标"硬链接共享、未逐文件统计"；-Deep 才精确统计。'
  Write-Host '      额外列出预热池槽位：分支、锁文件是否匹配、产物是否新鲜、占用体积。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action provision -Path <工作树> [-TimeoutSec 1800]'
  Write-Host '      持机器级锁，在目标工作树跑 pnpm install --offline --frozen-lockfile。'
  Write-Host '      目标必须是 git worktree list 里的树；-Name <名字> 等价于 .worktrees\<名字>。'
  Write-Host '      打印等锁时长、退出码、耗时；pnpm 非零退出码原样透传。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action build -Path <工作树> [-TimeoutSec 1800] [-DryRun]'
  Write-Host '      持同一把锁做分层重建：优先 <树>\lcoder\scripts\rebuild.cmd（只重出过期层）；'
  Write-Host '      树里没有该脚本才 pnpm run build:artifacts。-DryRun 只打印将要执行的命令。'
  Write-Host '      目标同样必须是 git worktree list 里的树；非零退出码原样透传。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action lock -Seconds <秒> [-Name LCoder-Heavy]'
  Write-Host '      持锁睡眠后释放；用来演示互斥：第二条会打印等待，直到第一条释放才继续。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action warm -Name <槽位> [-Base <ref>] [-ForceInstall] [-TimeoutSec 1800]'
  Write-Host '      新建/复用预热槽位 .worktrees\<槽位>：完整检出（非稀疏）、junction、'
  Write-Host '      按需安装依赖、按需全量产物；池元数据写在 .worktrees\<槽位>.pool.json。'
  Write-Host '      首次 warm 仍要付完整检出、安装与构建的代价，之后 claim 才快。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action claim -Name <槽位> -Branch <分支> [-Base <ref>] [-ForceInstall]'
  Write-Host '      确保槽位已预热；切到分支（不存在则从 Base 建，已存在则校验没被别树占用）；'
  Write-Host '      锁文件哈希不一致就重装（不静默沿用旧依赖），产物优先 rebuild.cmd 分层、'
  Write-Host '      缺基线才全量。输出各阶段耗时与就绪提示；分支被别树检出时报错不强切。'
  Write-Host ''
  Write-Host '  worktree.cmd -Action release -Name <槽位> [-StopInstances]'
  Write-Host '      清未跟踪文件、回 detached 基线；保留 node_modules 与 apps\desktop\.desktop-build。'
  Write-Host '      默认不动进程；-StopInstances 只停本槽位路径下的桌面实例与 mock-cloud。'
  Write-Host ''
  Write-Host '重活锁：provision/build/lock/warm/claim/release 共用同一把命名 Mutex，优先 Global\LCoder-Heavy'
  Write-Host '（机器级）；无权限时退回 Local\LCoder-Heavy 并打印说明（只在当前登录会话内互斥）。'
  Write-Host ''
  Write-Host '公共参数：-Target <完整路径> 覆盖默认的 .worktrees\<Name>；-Force 放行 .worktrees 之外的路径。'
  Write-Host '主检出一律拒绝 clean；删除前会逐条打印路径。'
}

try {
  $exitCode = 0
  switch ($Action) {
    'help' { Show-Help }
    'junction' { Invoke-Junction }
    'sparse' { Invoke-Sparse }
    'clean' { Invoke-Clean }
    'inspect' { Invoke-Inspect }
    'provision' { $exitCode = Invoke-Provision }
    'build' { $exitCode = Invoke-Build }
    'lock' { Invoke-Lock }
    'warm' { Invoke-Warm }
    'claim' { Invoke-Claim }
    'release' { Invoke-Release }
  }
} catch {
  Write-Host ('错误：' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
exit $exitCode
