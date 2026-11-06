# 上游同步体检：拉一次 upstream，报「有多少新提交、会撞哪些接触面」。
#
# 为什么有它：上游是深改二开的基线，真正难的不是合并冲突，而是上游悄悄改掉我们依赖的
# 形状（remote API、工具名、profile 键、会话格式）——这类改动不会报红，只会让功能失效。
# 这个脚本把「有没有新东西、撞不撞接触面、撞的是不是高危文件」一次性说清，再用退出码
# 交给定时任务：0 表示没有新提交，1 表示有。
#
# 用法：
#   lcoder\scripts\upstream-sync-check.cmd             # 拉取并体检
#   lcoder\scripts\upstream-sync-check.cmd -NoFetch    # 不联网，用本地已有的 upstream/master
#   lcoder\scripts\upstream-sync-check.cmd -Quiet      # 只在有动静时输出
param(
  [switch]$NoFetch,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$OutputEncoding = [Text.UTF8Encoding]::new()

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$contactPath = Join-Path $PSScriptRoot '..\contact-surface.txt'
$localBranch = 'lcoder/main'
$upstreamRef = 'upstream/master'

# 高危接触面：这些文件被上游改动时，冲突只是表象，我们的行为假设很可能一起变了。
$highRisk = @(
  'apps/desktop/src/main.ts',
  'apps/desktop/src/locale.ts',
  'apps/desktop/src/ipc.ts',
  'apps/desktop/src/preload-app.ts',
  'apps/desktop/scripts/dev.ts',
  'packages/client/ui-layout/src/client/AppFrame.tsx',
  'packages/client/modules/src/assets.ts',
  'AGENTS.md',
  'pnpm-lock.yaml',
  'tsconfig.client.json',
  'tsconfig.host.json'
)

# 原生命令往 stderr 写东西时，PS 5.1 在 Stop 偏好下会抛 NativeCommandError，
# 哪怕退出码是 0（提示、warning 都算）。这里临时放行，只看退出码判成败。
function Invoke-Git([string[]]$arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & git -C $root @arguments 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if ($code -ne 0) { throw ("git " + ($arguments -join ' ') + " 失败：" + ($output -join "`n")) }
  return @($output)
}

function Say([string]$text, [string]$color = 'Gray') {
  if (-not $Quiet) { Write-Host $text -ForegroundColor $color }
}

if (-not $NoFetch) {
  Say '拉取 upstream…' DarkGray
  try { Invoke-Git @('fetch', '--quiet', 'upstream') }
  catch { Write-Host ("拉取失败（可能没有网络或没配 upstream）：" + $_) -ForegroundColor Red; exit 2 }
}

try { $null = Invoke-Git @('rev-parse', '--verify', $upstreamRef) }
catch {
  Write-Host ("读不到 $upstreamRef（先 git fetch upstream 或检查远程名）：" + $_) -ForegroundColor Red
  exit 2
}

$base = (Invoke-Git @('merge-base', $localBranch, $upstreamRef) | Select-Object -First 1).Trim()
$behind = [int]((Invoke-Git @('rev-list', '--count', ($base + '..' + $upstreamRef))) | Select-Object -First 1)
$ahead = [int]((Invoke-Git @('rev-list', '--count', ($base + '..' + $localBranch))) | Select-Object -First 1)

if ($behind -eq 0) {
  Say ("上游没有新提交（本地领先 {0} 个）。" -f $ahead) Green
  exit 0
}

$incomingFiles = Invoke-Git @('diff', '--name-only', $base, $upstreamRef) | Where-Object { $_ -ne '' }
$contact = Get-Content -LiteralPath $contactPath -Encoding utf8 |
  Where-Object { $_ -ne '' -and -not $_.StartsWith('#') } |
  ForEach-Object { $_.Trim() }
$collisions = @($incomingFiles | Where-Object { $contact -contains $_ })
$danger = @($collisions | Where-Object { $highRisk -contains $_ })
$incomingCommits = Invoke-Git @('log', '--oneline', '--no-decorate', "$base..$upstreamRef")

Write-Host ''
Write-Host ("上游有 {0} 个新提交，本地领先 {1} 个；上游这次改了 {2} 个文件。" -f $behind, $ahead, $incomingFiles.Count) -ForegroundColor Yellow
Write-Host ("基线：" + $base.Substring(0, [Math]::Min(12, $base.Length))) -ForegroundColor DarkGray
Write-Host ''
Write-Host '新提交（最多 20 条）：' -ForegroundColor Cyan
$incomingCommits | Select-Object -First 20 | ForEach-Object { Write-Host ("  " + $_) }
if ($incomingCommits.Count -gt 20) { Write-Host ("  …其余 " + ($incomingCommits.Count - 20) + " 条") -ForegroundColor DarkGray }

if ($collisions.Count -eq 0) {
  Write-Host ''
  Write-Host '不撞接触面：合并大概率干净，但仍要跑全链门禁。' -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host ("会撞 {0} 个接触面文件：" -f $collisions.Count) -ForegroundColor Yellow
  $collisions | ForEach-Object {
    $mark = if ($highRisk -contains $_) { '  [!] ' } else { '  -   ' }
    Write-Host ($mark + $_)
  }
  if ($danger.Count -gt 0) {
    Write-Host ''
    Write-Host ("其中 {0} 个高危：上游很可能一并改了行为假设，合并后必须桌面冒烟，不能只看编译过。" -f $danger.Count) -ForegroundColor Red
  }
}

Write-Host ''
Write-Host '下一步：git checkout -b sync/upstream-<版本> lcoder/main && git merge upstream/master' -ForegroundColor Cyan
Write-Host '冲突只保留 lcoder: 标记段，其余接受上游；跑 pnpm install + pnpm build + vitest packages/lcoder + upstream-diff.sh，全绿再合回。' -ForegroundColor DarkGray
exit 1
