# 二开单包快车道：改动只落在 packages/lcoder 子包时，跳过整仓门禁，只跑触及子包的窄检查。
# 整仓门禁（build:artifacts + build:check + pnpm typecheck）的触发条件见 docs/PROJECT-RULES.md §3。
#
# 用法：
#   lcoder\scripts\fast-check.cmd                          # auto：按 git 改动识别触及子包
#   lcoder\scripts\fast-check.cmd -Scope client            # 指定子包
#   lcoder\scripts\fast-check.cmd -Scope client -Specs packages/lcoder/client/tests/foo.client.spec.tsx
#   lcoder\scripts\fast-check.cmd -Scope client -DryRun     # 只打印将要执行的命令
param(
  [ValidateSet('auto', 'client', 'kernel', 'desktop', 'workspace')]
  [string]$Scope = 'auto',
  [string[]]$Specs = @(),
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$OutputEncoding = [Text.UTF8Encoding]::new()
# 本机 pnpm 的依赖预检会把 worktree 里未在树内登记的依赖误报为缺失；窄检查只读源码，不需要它。
$env:pnpm_config_verify_deps_before_run = 'false'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# 子包 → pnpm filter 与单包 typecheck 参数。client 自带 typecheck 脚本，其余包用 tsc --noEmit 直检。
$packages = @{
  client    = @{ filter = '@maniu/client';    typecheck = @('--filter', '@maniu/client', 'run', 'typecheck') }
  kernel    = @{ filter = '@maniu/kernel';    typecheck = @('--filter', '@maniu/kernel', 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.json') }
  desktop   = @{ filter = '@maniu/desktop';   typecheck = @('--filter', '@maniu/desktop', 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.json') }
  workspace = @{ filter = '@maniu/workspace'; typecheck = @('--filter', '@maniu/workspace', 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.json') }
}

# 原生命令把提示写到 stderr 时，PS 5.1 在 Stop 偏好下会抛 NativeCommandError；退出码统一取 $LASTEXITCODE。
function Invoke-Step([string]$label, [string]$executable, [string[]]$arguments) {
  Write-Host ("▶ " + $label) -ForegroundColor Cyan
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $started = Get-Date
  & $executable @arguments 2>&1 | ForEach-Object { Write-Host ("  " + $_) }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  $elapsed = [int]((Get-Date) - $started).TotalSeconds
  if ($code -ne 0) {
    Write-Host ("✗ " + $label + " 失败（退出码 " + $code + "）") -ForegroundColor Red
    return $false
  }
  Write-Host ("✓ " + $label + "（" + $elapsed + " 秒）") -ForegroundColor Green
  return $true
}

function Get-ChangedPaths {
  $lines = @(& git status --porcelain 2>$null)
  $paths = @()
  foreach ($line in $lines) {
    if ($line.Length -lt 4) { continue }
    $path = $line.Substring(3)
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1] }
    $paths += $path.Trim('"').Replace('/', '\')
  }
  return @($paths)
}

Set-Location $root
$changed = @(Get-ChangedPaths)

if ($Scope -eq 'auto') {
  $outside = @($changed | Where-Object { $_ -notlike 'packages\lcoder\*' })
  if ($outside.Count -gt 0) {
    Write-Host '✗ 改动超出 packages/lcoder，快车道不适用；需走整仓门禁。' -ForegroundColor Red
    foreach ($path in $outside) { Write-Host ('  ' + $path) -ForegroundColor Red }
    Write-Host '  build:artifacts + build:check + pnpm typecheck' -ForegroundColor Red
    exit 2
  }
  $touched = @()
  foreach ($pkg in @('client', 'kernel', 'desktop', 'workspace')) {
    $prefix = 'packages\lcoder\' + $pkg + '\'
    if (@($changed | Where-Object { $_ -like ($prefix + '*') }).Count -gt 0) { $touched += $pkg }
  }
  if ($touched.Count -eq 0) {
    Write-Host '✗ 未检测到 packages/lcoder 子包改动，没有可跑的窄检查。' -ForegroundColor Red
    exit 2
  }
} else {
  $touched = @($Scope)
}

Write-Host ('快车道触及子包：' + ($touched -join '、')) -ForegroundColor Yellow

# oxlint 目标收窄：有未提交改动时只扫改动中位于 packages/lcoder 的 .ts/.tsx；
# 干净树才退回本次 scope 的 src 与 -Specs。删除的文件不再存在，直接过滤掉。
if ($changed.Count -gt 0) {
  $lintTargets = @(
    $changed |
      Where-Object { $_ -like 'packages\lcoder\*' -and ($_.EndsWith('.ts') -or $_.EndsWith('.tsx')) } |
      Where-Object { Test-Path -LiteralPath (Join-Path $root $_) } |
      ForEach-Object { $_.Replace('\', '/') } |
      Select-Object -Unique
  )
} else {
  $fallback = @($touched | ForEach-Object { 'packages/lcoder/' + $_ + '/src' }) + @($Specs | ForEach-Object { $_.Replace('\', '/') })
  $lintTargets = @($fallback | Select-Object -Unique)
}

# -Specs 优先；否则每个触及子包跑自己目录下的全部用例。
$testTargets = if ($Specs.Count -gt 0) { @($Specs | ForEach-Object { $_.Replace('\', '/') }) } else { @($touched | ForEach-Object { 'packages/lcoder/' + $_ }) }
# client 用例挂 LCoder 专属配置（继承根配置 + jsdom polyfill），不碰上游根配置。
$testConfig = if ($touched -contains 'client') { @('--config', (Join-Path $PSScriptRoot 'vitest.client.config.ts').Replace('\', '/')) } else { @() }
$testArguments = @('exec', 'vitest', 'run') + $testTargets + @('--maxWorkers=2') + $testConfig
$rebuildScript = Join-Path $PSScriptRoot 'rebuild.ps1'
$rebuildArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $rebuildScript, '-Layer', 'auto')
if ($DryRun) { $rebuildArguments += '-DryRun' }

if ($DryRun) {
  Write-Host 'DryRun：只打印计划，不执行。' -ForegroundColor DarkGray
  foreach ($pkg in $touched) { Write-Host ('  pnpm ' + ($packages[$pkg].typecheck -join ' ')) }
  if ($lintTargets.Count -eq 0) { Write-Host '  oxlint: 无 .ts/.tsx 目标，跳过' } else { Write-Host ('  pnpm exec oxlint ' + ($lintTargets -join ' ')) }
  Write-Host ('  pnpm ' + ($testArguments -join ' '))
  Write-Host ('  powershell ' + ($rebuildArguments -join ' '))
  exit 0
}

foreach ($pkg in $touched) {
  $info = $packages[$pkg]
  if (-not (Invoke-Step ($info.filter + ' typecheck') 'pnpm' $info.typecheck)) { exit 1 }
}

# 只扫收窄后的目标，空集说明没有需要检查的源码，跳过而不是误报失败。
if ($lintTargets.Count -eq 0) {
  Write-Host '⚠ 没有位于 packages/lcoder 的 .ts/.tsx lint 目标，跳过 oxlint。' -ForegroundColor DarkGray
} elseif (-not (Invoke-Step ('oxlint ' + ($lintTargets -join ' ')) 'pnpm' (@('exec', 'oxlint') + @($lintTargets)))) {
  exit 1
}

if (-not (Invoke-Step ('vitest ' + ($testTargets -join ' ')) 'pnpm' $testArguments)) { exit 1 }

if (-not (Invoke-Step 'rebuild auto' 'powershell' $rebuildArguments)) { exit 1 }

Write-Host ''
Write-Host '快车道全绿。需要重启的话：lcoder\scripts\start-desktop.cmd -Fast' -ForegroundColor Cyan
exit 0
