# 按层重建：只重出你改过的那一层，不连上游一起全量构建。
#
# 为什么有它：整仓 build 是聚合构建（实测冷启 108 秒、热启 30 秒），日常改外壳只值 0.2 秒的
# bundle 重建，改 kernel 也只值 1 秒。层级与生效方式不同，别用全量去覆盖日常迭代。
#
# 用法：
#   lcoder\scripts\rebuild.cmd                 # 自动判断哪几层过期，只重建过期的
#   lcoder\scripts\rebuild.cmd workspace       # 只重建外壳（刷新页面即生效）
#   lcoder\scripts\rebuild.cmd kernel          # 只重建 kernel（要重启实例）
#   lcoder\scripts\rebuild.cmd client          # 只重建自研客户端（vite build，刷新窗口即生效）
#   lcoder\scripts\rebuild.cmd desktop         # 只重建桌面主进程（要重启实例）
#   lcoder\scripts\rebuild.cmd lcoder-desktop  # 只重建自研桌面端 preload（要重启实例）
#   lcoder\scripts\rebuild.cmd profile         # 只重拷装配源运行副本（要重启实例）
#   lcoder\scripts\rebuild.cmd all             # 全量 build:artifacts 加 build:check（连上游）
#   lcoder\scripts\rebuild.cmd client -DryRun  # 只说客户端是否过期，不真的构建
param(
  [ValidateSet('auto', 'workspace', 'kernel', 'client', 'desktop', 'lcoder-desktop', 'profile', 'all')]
  [string]$Layer = 'auto',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$OutputEncoding = [Text.UTF8Encoding]::new()

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$profileSource = Join-Path $PSScriptRoot '..\desktop-profile.patch.yml'
$sliceSource = Join-Path $PSScriptRoot '..\desktop-profile.slice.yml'
$profileDir = Join-Path $root 'apps\desktop\.desktop-build\development\home\profiles\desktop'
$profileRuntime = Join-Path $profileDir 'cordis.patch.yml'
$profileManifest = Join-Path $profileDir 'package.json'
$profileWorkspace = Join-Path $profileDir 'pnpm-workspace.yaml'

# 装配源只有 cordis.patch.yml；profile 的 package.json 与 node_modules 链接只能在这里补。
# 缺了它们，外壳的 client 半边不进插件清单，新树启动看到的是原版 DSH。
$profileLinks = @(
  @{ name = '@maniu/kernel';    path = (Join-Path $root 'packages\lcoder\kernel') },
  @{ name = '@maniu/workspace'; path = (Join-Path $root 'packages\lcoder\workspace') }
)

# 与 packages/boot/app-boot 的 initProfile 模板一致：out-of-tree 插件要的 pnpm 设置。
$profilePnpmWorkspace = @"
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
"@

# 运行副本 = 装配源 + 本机本地段（见 lcoder/RUN.md）。重拷时一并写回，否则会话浮层设置会丢。
$profileLocal = @"

# ── 本机运行副本的本地段（不在装配源里）────────────────────────
# 会话浮层的转录视图与设置页开关；上游默认值之外没有别的行为。
- id: ui-chat
  name: "@deepseek-ai/dsh-client-ui-chat"
  config:
    transcriptView: standard
    performanceUsage: detailed
- id: ui-settings
  name: "@deepseek-ai/dsh-client-ui-settings"
  config:
    enabled: true
"@

# 每一层：源码目录、产物文件、重建命令、生效方式。
# script/label 可选：没有 bundle 脚本的包用它们给出等价的窄重建命令；缺省仍走 `run bundle`。
# steps 可选：按顺序跑多条 pnpm 命令；kernel 的宿主路由表来自 typert 生成物，
# 只跑 bundle 会留下没有新路由的旧产物，客户端调用就得到 HTTP 404。
$layers = @(
  @{ name = 'kernel';    source = 'packages\lcoder\kernel\src';    artifact = 'packages\lcoder\kernel\lib\index.js';         filter = '@maniu/kernel';    note = 'kernel 在宿主进程里加载：要重启实例';
     steps = @(
       @('--filter', '@maniu/kernel', 'exec', 'tsc', '-p', 'tsconfig.json'),
       @('exec', 'tsx', 'scripts/generate-typert.ts'),
       @('--filter', '@maniu/kernel', 'run', 'bundle')
     ) },
  @{ name = 'workspace'; source = 'packages\lcoder\workspace\src'; artifact = 'packages\lcoder\workspace\lib\client.js';    filter = '@maniu/workspace'; note = '外壳产物由宿主直出：刷新页面即生效，不用重启' },
  @{ name = 'client';    source = 'packages\lcoder\client\src';    artifact = 'packages\lcoder\client\lib\dist\index.html'; filter = '@maniu/client';    script = @('--filter', '@maniu/client', 'exec', 'vite', 'build'); label = '@maniu/client vite build'; note = '新客户端产物由桌面端直出：刷新窗口即生效，不用重启' },
  @{ name = 'desktop';   source = 'apps\desktop\src';              artifact = 'apps\desktop\lib\main.js';                  filter = '@deepseek-ai/dsh-desktop'; note = '主进程/preload 改动：要重启实例' },
  @{ name = 'lcoder-desktop'; source = 'packages\lcoder\desktop\src'; artifact = 'packages\lcoder\desktop\lib\preload.cjs'; filter = '@maniu/desktop'; note = '桌面主进程/preload 改动：要重启桌面实例' }
)

# 原生命令往 stderr 写提示时，PS 5.1 在 Stop 偏好下会抛 NativeCommandError（哪怕退出码 0）。
function Invoke-Native([string]$label, [string[]]$arguments, [string]$workdir) {
  Write-Host ("▶ " + $label) -ForegroundColor Cyan
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $started = Get-Date
  & pnpm @arguments 2>&1 | ForEach-Object { Write-Host ("  " + $_) }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  $elapsed = [int]((Get-Date) - $started).TotalSeconds
  if ($code -ne 0) { Write-Host ("✗ " + $label + " 失败（退出码 " + $code + "）") -ForegroundColor Red; return $false }
  Write-Host ("✓ " + $label + "（" + $elapsed + " 秒）") -ForegroundColor Green
  return $true
}

# profile 切片的落地与合成校验；stderr 的失败行同样不能让 PS 5.1 抛 NativeCommandError。
function Invoke-ProfileSlice([string[]]$arguments) {
  $label = 'profile-slice.mjs ' + ($arguments -join ' ')
  Write-Host ("▶ " + $label) -ForegroundColor Cyan
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & node (Join-Path $PSScriptRoot 'profile-slice.mjs') @arguments 2>&1 | ForEach-Object { Write-Host ("  " + $_) }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if ($code -ne 0) {
    Write-Host ("✗ " + $label + " 失败（退出码 " + $code + "）：切片落地或合成校验未通过，先核对 lcoder/desktop-profile.slice.yml 与上游包" ) -ForegroundColor Red
    return $false
  }
  return $true
}

function Get-LastWrite([string]$path) {
  if (-not (Test-Path $path)) { return $null }
  $item = Get-Item -LiteralPath $path
  if (-not $item.PSIsContainer) { return $item.LastWriteTime }
  return (Get-ChildItem -LiteralPath $path -Recurse -File | Measure-Object -Property LastWriteTime -Maximum).Maximum
}

function Get-Stale {
  $stale = @()
  foreach ($layer in $layers) {
    $sourceTime = Get-LastWrite (Join-Path $root $layer.source)
    $artifactTime = Get-LastWrite (Join-Path $root $layer.artifact)
    if ($null -ne $sourceTime -and ($null -eq $artifactTime -or $sourceTime -gt $artifactTime)) { $stale += $layer.name }
  }
  $profileTime = Get-LastWrite $profileSource
  $sliceTime = Get-LastWrite $sliceSource
  $runtimeTime = Get-LastWrite $profileRuntime
  $profileStale = (
    ($null -ne $profileTime -and ($null -eq $runtimeTime -or $profileTime -gt $runtimeTime)) -or
    ($null -ne $sliceTime -and ($null -eq $runtimeTime -or $sliceTime -gt $runtimeTime))
  )
  if ($profileStale) { $stale += 'profile' }
  return @($stale)
}

function Get-ProfileManifest {
  # 与主检出已验证的 package.json 同形；两条 link 指向当前树，换 worktree 就换目标。
  $kernel = 'link:' + ($profileLinks[0].path -replace '\\', '/')
  $workspace = 'link:' + ($profileLinks[1].path -replace '\\', '/')
  $text = @"
{
  "name": "dsh-profile-desktop",
  "private": true,
  "dependencies": {
    "@maniu/kernel": "$kernel",
    "@maniu/workspace": "$workspace"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app"
      ]
    }
  }
}
"@
  return $text + "`n"
}

function Test-ProfileLink([string]$linkPath, [string]$expectedPath) {
  if (-not (Test-Path -LiteralPath $linkPath)) { return $false }
  $item = Get-Item -LiteralPath $linkPath -Force -ErrorAction SilentlyContinue
  # 只认重解析点：真实目录拷贝不算链接，桌面按依赖解析会拿不到包的更新。
  if ($null -eq $item -or -not $item.LinkType) { return $false }
  $target = @($item.Target)[0]
  if (-not $target) { return $false }
  $resolved = if ([IO.Path]::IsPathRooted($target)) { $target } else { Join-Path (Split-Path -Parent $linkPath) $target }
  $resolved = [IO.Path]::GetFullPath($resolved).TrimEnd('\')
  return ($resolved -ieq [IO.Path]::GetFullPath($expectedPath).TrimEnd('\'))
}

function Get-ProfileLinkPath([string]$packageName) {
  return Join-Path $profileDir ('node_modules\' + $packageName.Replace('/', '\'))
}

function Sync-Profile {
  if (-not (Test-Path $profileSource)) { Write-Host '✗ 找不到装配源 lcoder/desktop-profile.patch.yml' -ForegroundColor Red; return $false }
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  $content = (Get-Content -LiteralPath $profileSource -Raw -Encoding utf8).TrimEnd("`r", "`n")
  [IO.File]::WriteAllText($profileRuntime, $content + $profileLocal, [Text.UTF8Encoding]::new($false))
  $presets = ([regex]::Matches((Get-Content -LiteralPath $profileRuntime -Raw -Encoding utf8), 'id: preset-lcoder')).Count
  Write-Host ("✓ 运行副本已重拷，preset 数：" + $presets + "（要重启实例）") -ForegroundColor Green
  # 切片是运行副本的追加层：重拷会把它抹掉，所以每次都在这里按源重放（幂等）。
  if (-not (Invoke-ProfileSlice -arguments @('apply', '--all'))) { return $false }

  $desired = Get-ProfileManifest
  $current = if (Test-Path $profileManifest) { Get-Content -LiteralPath $profileManifest -Raw -Encoding utf8 } else { $null }
  $manifestChanged = ($null -eq $current) -or ($current -cne $desired)
  if ($manifestChanged) {
    [IO.File]::WriteAllText($profileManifest, $desired, [Text.UTF8Encoding]::new($false))
    Write-Host '✓ profile/package.json 已写：两条 link 依赖指向本树' -ForegroundColor Green
  }

  if (-not (Test-Path $profileWorkspace)) {
    [IO.File]::WriteAllText($profileWorkspace, $profilePnpmWorkspace, [Text.UTF8Encoding]::new($false))
  }

  $missing = @()
  foreach ($entry in $profileLinks) {
    if (-not (Test-ProfileLink (Get-ProfileLinkPath $entry.name) $entry.path)) { $missing += $entry.name }
  }
  if ($manifestChanged -or $missing.Count -gt 0) {
    $why = if ($missing.Count -gt 0) { '缺链接：' + ($missing -join '、') } else { 'package.json 刚更新' }
    Write-Host ('  需要物化 link 依赖（' + $why + '），在 profile 内跑离线 pnpm install --force') -ForegroundColor DarkGray
    Push-Location $profileDir
    try {
      # node_modules 元数据仍记着已装时，普通 install 会报 up to date 却不补链接；--force 只重链，仍离线。
      $installed = Invoke-Native 'profile pnpm install --offline --force' @('install', '--offline', '--force') $profileDir
    } finally {
      Pop-Location
    }
    if (-not $installed) {
      Write-Host '✗ profile 保障卡在 pnpm install --offline：link 依赖没装上，桌面会退回原版 DSH。' -ForegroundColor Red
      return $false
    }
  } else {
    Write-Host '✓ profile 依赖已就绪（两条 link 均解析到本树），跳过安装' -ForegroundColor Green
  }

  foreach ($entry in $profileLinks) {
    $linkPath = Get-ProfileLinkPath $entry.name
    if (-not (Test-ProfileLink $linkPath $entry.path)) {
      Write-Host ('✗ profile 保障卡在链接物化：' + $linkPath + ' 未指向 ' + $entry.path) -ForegroundColor Red
      return $false
    }
  }
  Write-Host '✓ profile 齐备：package.json、两条 @maniu 链接' -ForegroundColor Green
  # 硬闸：每个切片 id 都要在合成清单里并带上切片的效果，否则升上游后切片会静默失效。
  if (-not (Invoke-ProfileSlice -arguments @('check', '--all'))) { return $false }
  Write-Host '✓ 切片已命中合成清单' -ForegroundColor Green
  return $true
}

Set-Location $root

if ($Layer -eq 'all') {
  if ($DryRun) { Write-Host '会跑全量：build:artifacts + build:check（连上游）。'; exit 0 }
  if (-not (Invoke-Native 'pnpm run build' @('run', 'build') $root)) { exit 1 }
  exit 0
}

$plan = if ($Layer -eq 'auto') { Get-Stale } else { @($Layer) }

if ($plan.Count -eq 0) {
  if ($DryRun) { Write-Host '各层产物都是最新的，装配副本与 profile 依赖未校验（-DryRun 不落盘）。' -ForegroundColor Green; exit 0 }
  # 预热/warm 会走到这条「产物已最新」的短路；profile 依赖仍要保障，否则新树启动仍是原版 DSH。
  if (-not (Sync-Profile)) { exit 1 }
  Write-Host '各层产物都是最新的，装配副本与 profile 依赖已校验。要强制全量就加 all。' -ForegroundColor Green
  exit 0
}
Write-Host ('本次要重建：' + ($plan -join '、')) -ForegroundColor Yellow
if ($DryRun) { exit 0 }

foreach ($name in $plan) {
  if ($name -eq 'profile') { if (-not (Sync-Profile)) { exit 1 }; continue }
  # 变量名不能叫 $layer：PowerShell 变量名大小写不敏感，会和带 ValidateSet 的参数 $Layer 撞上。
  $target = $layers | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if ($null -eq $target) { Write-Host ("✗ 不认识的层：" + $name) -ForegroundColor Red; exit 1 }
  if ($target.ContainsKey('steps')) {
    foreach ($step in $target.steps) {
      if (-not (Invoke-Native ('pnpm ' + ($step -join ' ')) $step $root)) { exit 1 }
    }
  } elseif ($target.ContainsKey('script')) {
    if (-not (Invoke-Native $target.label $target.script $root)) { exit 1 }
  } else {
    if (-not (Invoke-Native ($target.filter + ' bundle') @('--filter', $target.filter, 'run', 'bundle') $root)) { exit 1 }
  }
  Write-Host ('  ' + $target.note) -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '重建完成。需要重启的话：lcoder\scripts\start-desktop.cmd -Fast' -ForegroundColor Cyan
exit 0
