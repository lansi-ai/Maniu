# 按层重建：只重出你改过的那一层，不连上游一起全量构建。
#
# 为什么有它：整仓 build 是聚合构建（实测冷启 108 秒、热启 30 秒），日常改外壳只值 0.2 秒的
# bundle 重建，改 kernel 也只值 1 秒。层级与生效方式不同，别用全量去覆盖日常迭代。
#
# 用法：
#   lcoder\scripts\rebuild.cmd                 # 自动判断哪几层过期，只重建过期的
#   lcoder\scripts\rebuild.cmd workspace       # 只重建外壳（刷新页面即生效）
#   lcoder\scripts\rebuild.cmd kernel          # 只重建 kernel（要重启实例）
#   lcoder\scripts\rebuild.cmd desktop         # 只重建桌面主进程（要重启实例）
#   lcoder\scripts\rebuild.cmd profile         # 只重拷装配源运行副本（要重启实例）
#   lcoder\scripts\rebuild.cmd all             # 全量 build:artifacts 加 build:check（连上游）
#   lcoder\scripts\rebuild.cmd workspace -DryRun  # 只说过期了哪几层，不真的构建
param(
  [ValidateSet('auto', 'workspace', 'kernel', 'desktop', 'profile', 'all')]
  [string]$Layer = 'auto',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$OutputEncoding = [Text.UTF8Encoding]::new()

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$profileSource = Join-Path $PSScriptRoot '..\desktop-profile.patch.yml'
$profileRuntime = Join-Path $root 'apps\desktop\.desktop-build\development\home\profiles\desktop\cordis.patch.yml'

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
$layers = @(
  @{ name = 'kernel';    source = 'packages\lcoder\kernel\src';    artifact = 'packages\lcoder\kernel\lib\index.js';    filter = '@lcoder/kernel';    note = 'kernel 在宿主进程里加载：要重启实例' },
  @{ name = 'workspace'; source = 'packages\lcoder\workspace\src'; artifact = 'packages\lcoder\workspace\lib\client.js'; filter = '@lcoder/workspace'; note = '外壳产物由宿主直出：刷新页面即生效，不用重启' },
  @{ name = 'desktop';   source = 'apps\desktop\src';              artifact = 'apps\desktop\lib\main.js';              filter = '@deepseek-ai/dsh-desktop'; note = '主进程/preload 改动：要重启实例' }
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
  $runtimeTime = Get-LastWrite $profileRuntime
  if ($null -ne $profileTime -and ($null -eq $runtimeTime -or $profileTime -gt $runtimeTime)) { $stale += 'profile' }
  return @($stale)
}

function Sync-Profile {
  if (-not (Test-Path $profileSource)) { Write-Host '✗ 找不到装配源 lcoder/desktop-profile.patch.yml' -ForegroundColor Red; return $false }
  $content = (Get-Content -LiteralPath $profileSource -Raw -Encoding utf8).TrimEnd("`r", "`n")
  [IO.File]::WriteAllText($profileRuntime, $content + $profileLocal, [Text.UTF8Encoding]::new($false))
  $presets = ([regex]::Matches((Get-Content -LiteralPath $profileRuntime -Raw -Encoding utf8), 'id: preset-lcoder')).Count
  Write-Host ("✓ 运行副本已重拷，preset 数：" + $presets + "（要重启实例）") -ForegroundColor Green
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
  Write-Host '三层产物都是最新的，装配副本也没落后。要强制全量就加 all。' -ForegroundColor Green
  exit 0
}
Write-Host ('本次要重建：' + ($plan -join '、')) -ForegroundColor Yellow
if ($DryRun) { exit 0 }

foreach ($name in $plan) {
  if ($name -eq 'profile') { if (-not (Sync-Profile)) { exit 1 }; continue }
  # 变量名不能叫 $layer：PowerShell 变量名大小写不敏感，会和带 ValidateSet 的参数 $Layer 撞上。
  $target = $layers | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if ($null -eq $target) { Write-Host ("✗ 不认识的层：" + $name) -ForegroundColor Red; exit 1 }
  if (-not (Invoke-Native ($target.filter + ' bundle') @('--filter', $target.filter, 'run', 'bundle') $root)) { exit 1 }
  Write-Host ('  ' + $target.note) -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '重建完成。需要重启的话：lcoder\scripts\start-desktop.cmd -Fast' -ForegroundColor Cyan
exit 0
