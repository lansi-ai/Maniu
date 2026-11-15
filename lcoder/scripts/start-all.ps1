# 一条命令拉起本检出的 Web 与桌面端（开发态）。
#
# 为什么有它：Web（3080）与桌面各有一套启动方式，手工起两份很容易
# 落到别人的端口、别人的 home 或上一次没清干净的进程上。这个脚本按固定顺序做四件事：
# 先停掉本检出的旧实例 → 构建（-Fast 跳过）→ 先起 Web 再起桌面 → 等两边就绪并给出
# 日志位置与地址。进程归属按检出根、状态文件记录的监听 PID 与命令行签名判断，
# 不碰主检出、别的工作树、别处占着端口的 Web。
#
# 桌面默认是新客户端（packages/lcoder/desktop 的 launch.mjs，inspector 9829/9822/9830，
# 就绪行 `lcoder desktop: 宿主已就绪`）；-Legacy 回退旧壳（dev/start:desktop，
# 9229/9222/9230，就绪行是带 token 的 dsh web）。新客户端不依赖 Web，Web 仍按原逻辑起。
# 新客户端的构建只需 build:artifacts；旧壳保持 build:artifacts 加桌面外壳 build 两步。
#
# Web 的归属为什么要状态文件：启动器（cmd → node/pnpm）在 Web 跑着时也会先退掉，
# 只记启动器会留下一个找不回的监听进程占住端口。因此就绪后把端口 owner 的 PID 也写进状态文件；
# 之后只有状态里的 root 与端口都吻合、PID 与命令行签名也对得上时才认。签名同时认
# 构建产物（apps/cli/lib/bin.js web，命令行带检出根）与源码（apps/cli/src/bin.ts web）两种入口。
#
# 用法：
#   lcoder\scripts\start-all.cmd                 # 构建 → 起 Web(3080) → 起新客户端
#   lcoder\scripts\start-all.cmd -Legacy         # 同上，但桌面起旧壳
#   lcoder\scripts\start-all.cmd -Fast           # 跳过构建（产物没变时的最快启动；冒烟本来就不跑）
#   lcoder\scripts\start-all.cmd -NoWeb          # 只起桌面
#   lcoder\scripts\start-all.cmd -NoDesktop      # 只起 Web
#   lcoder\scripts\start-all.cmd -WebPort 3081   # 换 Web 端口
#   lcoder\scripts\start-all.cmd -KeepFollowing  # 就绪后继续跟随两边日志（Ctrl+C 只停跟随）
#   lcoder\scripts\start-all.cmd -ListOnly       # 只列本检出会停掉哪些进程
#   lcoder\scripts\start-all.cmd -Stop           # 停本检出的两边并核对端口释放
#   lcoder\scripts\start-all.cmd -CloudApi http://127.0.0.1:5091/v1  # 换云端地址（默认 5081）
#   lcoder\scripts\start-all.cmd -SkipCloudCheck # 不探测云端，直接启动
#   lcoder\scripts\start-all.cmd -StartCloudApi  # 探测失败时拉起本地 LCoder-cloud API
#
# 云端先于构建探测：由 -CloudApi 去掉末尾 /v1 拼出 /health，2 秒内 GET 到 200 才算可用。
# 可用就把地址写进 LCODER_CLOUD_BASE_URL，Web 与桌面两个子进程都继承；不可用则红字报出
# 检测地址与补救方式并以非零退出——不静默起一个登录不可用的桌面。默认地址 5081 是本机
# LCoder-cloud 的 API；仓库里的 dev-only mock 在 5091，要 mock 就用 -CloudApi 指过去。
#
# -StartCloudApi 把探测失败从「直接中止」改成「先拉起本机 API 再探测」：以 -CloudRepo 为
# 工作目录执行 dotnet run --project src/Api --urls http://localhost:5081，子进程继承当前
# 环境并叠加 -CloudEnvFile（默认 <CloudRepo>\.env，不存在则跳过）解析出的 KEY=VALUE；
# stdout/stderr 落 lcoder\logs\cloud-api.log，1 秒一轮轮询 /health，直到
# -CloudApiTimeoutSec 超时。任何一步失败都打印日志路径与不含密钥的最后几行并非零退出。
# 成功后才继续原有的成功分支（注入地址、起 Web 与桌面）。启动的 PID 记进状态文件，
# -Stop 只停由本脚本拉起且命令行签名吻合的 API，别处起的 API 不动。
#
# 桌面 inspector 端口默认按模式取：新客户端 9829/9822/9830，旧壳 9229/9222/9230；
# 两种模式都认同一组上游环境变量覆盖：DSH_DESKTOP_MAIN_INSPECT_PORT、
# DSH_DESKTOP_RENDERER_DEBUG_PORT、DSH_DESKTOP_HOST_INSPECT_PORT。
# Web 的 DSH_HOME 默认落到本检出的 .dsh-home（已在 .gitignore），不写用户目录。
param(
  [switch]$Fast,
  [switch]$NoWeb,
  [switch]$NoDesktop,
  [switch]$Legacy,
  [int]$WebPort = 3080,
  [switch]$Stop,
  [switch]$ListOnly,
  [switch]$KeepFollowing,
  [string]$CloudApi = 'http://127.0.0.1:5081/v1',
  [switch]$SkipCloudCheck,
  [switch]$StartCloudApi,
  [string]$CloudRepo = 'E:\Projects\LCoder-cloud',
  [string]$CloudEnvFile,
  [ValidateRange(5, 3600)]
  [int]$CloudApiTimeoutSec = 90,
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
$cloudApiLog = Join-Path $logDir 'cloud-api.log'
# -StartCloudApi 固定把本地 API 起在这个地址（与 -CloudApi 默认端口一致）。
$cloudApiListenUrl = 'http://localhost:5081'
$statePath = Join-Path $logDir 'start-all-state.json'
. (Join-Path $PSScriptRoot 'lcoder-dev-common.ps1')

function Show-Usage {
  Write-Host @'
start-all：一条命令拉起本检出的 Web 与桌面端（开发态）。

用法
  lcoder\scripts\start-all.cmd [选项]

选项
  -Fast              跳过构建，直接用现有产物启动（运行时冒烟一律不跑）
  -Legacy            桌面起旧壳（9229/9222/9230）；默认起新客户端（9829/9822/9830）
  -NoWeb             只起桌面
  -NoDesktop         只起 Web
  -WebPort <端口>     Web 端口（默认 3080）
  -Stop              停掉本检出的两边，并核对端口已释放
  -ListOnly          只列出会停掉哪些进程，不做任何改动
  -KeepFollowing     两边就绪后继续跟随日志
  -CloudApi <地址>   云端 /v1 基地址（默认 http://127.0.0.1:5081/v1）
  -SkipCloudCheck    不探测云端，直接启动（-Stop / -ListOnly 本来就不探测）
  -StartCloudApi     探测失败时拉起本地 LCoder-cloud API，成功后再启动
  -CloudRepo <路径>  本地云仓（默认 E:\Projects\LCoder-cloud）
  -CloudEnvFile <路径>  API 子进程的环境文件（默认 <CloudRepo>\.env；不存在则跳过）
  -CloudApiTimeoutSec <秒>  拉起 API 后等 /health 的上限（默认 90）
  -ReadyTimeoutSec <秒>  单边连续多少秒没有新输出算失败（默认 300）
  -Help              打印本帮助

云端探测
  由 -CloudApi 去掉末尾的 /v1 拼出 /health，GET 超时 2 秒；200 视为可用。
  可用：把地址注入 LCODER_CLOUD_BASE_URL，Web 与桌面两个子进程都继承。
  不可用：红字打印检测地址、本地 API 的启动方式与可直接设置的 LCODER_CLOUD_BASE_URL，
  并以退出码 1 中止，不会起一个登录不可用的实例。探测发生在构建与停旧实例之前。
  -CloudApi 没显式给时沿用环境里已有的 LCODER_CLOUD_BASE_URL，再退到默认地址。
  -SkipCloudCheck 跳过探测，但仍会把当前 -CloudApi 注入两个子进程。

拉起本地 API（-StartCloudApi）
  只在探测失败时生效；成功后回到上面的成功分支（注入 LCODER_CLOUD_BASE_URL、起 Web 与桌面）。
  命令：dotnet run --project src/Api --urls http://localhost:5081（工作目录 -CloudRepo）。
  环境：继承当前进程；再解析 -CloudEnvFile（默认 <CloudRepo>\.env，不存在则跳过）里的
  KEY=VALUE 注入子进程。注释与空行忽略，不展开变量，任何值都不打印。
  日志：lcoder\logs\cloud-api.log；1 秒一轮轮询 /health，超时或进程提前退出就打印日志
  路径与不含密钥的最后几行，并以退出码 1 中止。本地 API 固定起在 5081，所以 -CloudApi
  的端口也必须是 5081；要指到别处请自行起 API 后配 -CloudApi 与 -SkipCloudCheck。

顺序与产物
  1. 云端：探测 /health 并注入 LCODER_CLOUD_BASE_URL（-Stop / -ListOnly 跳过）
  2. 构建：新客户端只跑 pnpm run build:artifacts（Host 面产出 desktop lib，Client 面同时
     产出 client/lib/dist）；-Legacy 再加 pnpm --filter @deepseek-ai/dsh-desktop run build
  3. Web：有已构建产物时直接跑 apps/cli/lib/bin.js，否则回退 pnpm run start:web；日志 lcoder\logs\web.log
  4. 桌面：复用 start-desktop 的启动与就绪检测，日志 lcoder\logs\desktop-main.log；
     新客户端等 `lcoder desktop: 宿主已就绪`，旧壳等 `dsh web:` 带 token 行
  Web 的 DSH_HOME 默认指向本检出 .dsh-home；桌面 home/userData 新客户端落本检出
  .dsh-home，旧壳沿用 dev.ts 的仓内默认值。运行时冒烟（python 三条检查加 Office 往返）
  是旧壳的发布验收口径，start-all 不跑；要复核用 lcoder\scripts\start-desktop.cmd -Smoke -Legacy。

进程归属
  停 electron 带本检出 user-data-dir（旧壳）或以本检出 desktop 包为 app 路径（新客户端）
  的进程，以及状态文件记录的 Web 启动器/监听进程（root 与端口都吻合且命令行是 Web 签名）。
  端口上的进程不属于本检出时只报告、不终止。本地 API 同理：-Stop 只停状态文件记录、且命令行是
  dotnet run src/Api 签名的 PID；别处起的 API 与端口占用只报告、不终止。
  Ctrl+C 只停止跟随，不停已启动的实例。
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

# 从云端地址取端口；只用于展示与端口占用判断，解析失败返回 0。
function Get-CloudApiUrlPort {
  param([Parameter(Mandatory = $true)][string]$Url)
  try { return ([Uri]$Url).Port } catch { return 0 }
}

# 解析 KEY=VALUE 环境文件：忽略空行与 # 注释，去掉成对引号，不展开变量。
# 只返回键与值，调用方负责注入并在任何输出里遮掉值。
# @returns @{ Entries = object[]（每项 Key/Value）; Skipped = int }
function Read-DotEnvEntries {
  param([Parameter(Mandatory = $true)][string]$Path)
  $entries = New-Object System.Collections.Generic.List[object]
  $skipped = 0
  foreach ($raw in @(Get-Content -LiteralPath $Path -Encoding utf8)) {
    $line = ([string]$raw).Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    $equals = $line.IndexOf('=')
    if ($equals -le 0) { $skipped++; continue }
    $key = $line.Substring(0, $equals).Trim()
    if ($key.StartsWith('export ')) { $key = $key.Substring(7).Trim() }
    $value = $line.Substring($equals + 1).Trim()
    if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { $skipped++; continue }
    $doubleQuoted = $value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')
    $singleQuoted = $value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")
    if ($doubleQuoted -or $singleQuoted) { $value = $value.Substring(1, $value.Length - 2) }
    $entries.Add([pscustomobject]@{ Key = $key; Value = $value })
  }
  return @{ Entries = $entries.ToArray(); Skipped = $skipped }
}

# 打印前的脱敏：先按本次注入的实际值逐条替换，再兜底遮常见键值对与连接串口令。
function Hide-SecretText {
  param([string]$Text, [string[]]$Secrets)
  if (-not $Text) { return '' }
  $masked = $Text
  foreach ($secret in @($Secrets)) {
    if ($null -ne $secret -and $secret.Length -ge 4) { $masked = $masked.Replace($secret, '***') }
  }
  $masked = [regex]::Replace($masked, '(?i)(password|pwd|secret|token|api[_-]?key|signing[_-]?key)\s*=\s*[^;\s'']+', '$1=***')
  $masked = [regex]::Replace($masked, '(?i)(postgres(?:ql)?://[^:\s/]+:)[^@\s]+@', '$1***@')
  return $masked
}

# 本地 API 启动链的命令行签名：dotnet run 且带 src/Api。cmd 包装器与 dotnet 本身都认，
# 别的宿主只提到这些词时 Name 校验会挡掉。
function Test-CloudApiCommandLineSignature {
  param([string]$CommandLine, [string]$Name)
  if (-not $CommandLine) { return $false }
  if ($Name -and $Name -notin @('cmd.exe', 'dotnet.exe')) { return $false }
  return ($CommandLine -match '(?i)dotnet(\.exe)?"?\s+run\b' -and $CommandLine -match '(?i)src[\\/]Api\b')
}

# 状态文件里记录的、仍存活且命令行签名吻合的 API PID；没有则返回 0。
# 再次启动时原样带入状态，避免把上一次拉起的 API 从 -Stop 的视野里丢掉。
function Get-RecordedCloudApiPid {
  $state = Read-StartAllState
  if ($null -eq $state -or $state.root -ne $root -or $null -eq $state.apiPid) { return 0 }
  $recordedPid = [int]$state.apiPid
  if ($recordedPid -le 0) { return 0 }
  $process = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $recordedPid) -ErrorAction SilentlyContinue
  if ($null -eq $process) { return 0 }
  if (-not (Test-CloudApiCommandLineSignature -CommandLine $process.CommandLine -Name $process.Name)) { return 0 }
  return $recordedPid
}

# 把状态文件里的 apiPid 归零，保留 Web 记录（-Stop 先停 API 再停 Web，不能整份删掉）。
function Clear-StartAllStateApiRecord {
  $state = Read-StartAllState
  if ($null -eq $state -or $state.root -ne $root) { return }
  if ($null -eq $state.apiPid -or [int]$state.apiPid -eq 0) { return }
  $state.apiPid = 0
  $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
}

# 以云仓为工作目录拉起本地 API；继承当前环境并叠加环境文件里的 KEY=VALUE。
# 返回值 @{ Pid; Secrets }；Secrets 只用于后续输出脱敏，不打印。
function Start-CloudApiInstance {
  param(
    [Parameter(Mandatory = $true)][string]$Repo,
    [string]$EnvFile,
    [switch]$EnvFileExplicit
  )
  $projectDir = Join-Path $Repo 'src\Api'
  if (-not (Test-Path -LiteralPath $projectDir)) {
    throw ("云仓缺少 src\Api：{0}。用 -CloudRepo 指向 LCoder-cloud 检出。" -f $Repo)
  }
  $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
  if ($null -eq $dotnet) {
    throw 'PATH 里没有 dotnet；本地 API 需要 .NET SDK。装好后重试，或自行启动 API 后配 -CloudApi 与 -SkipCloudCheck。'
  }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null

  $secrets = New-Object System.Collections.Generic.List[string]
  $entries = @()
  if ($EnvFile -and (Test-Path -LiteralPath $EnvFile)) {
    $parsed = Read-DotEnvEntries -Path $EnvFile
    $entries = @($parsed.Entries)
    foreach ($entry in $entries) { $secrets.Add([string]$entry.Value) }
    Write-Host ("API：从 {0} 注入 {1} 个环境变量（跳过 {2} 行；值不打印）" -f $EnvFile, $entries.Count, $parsed.Skipped) -ForegroundColor Cyan
  } elseif ($EnvFile -and $EnvFileExplicit) {
    throw ("-CloudEnvFile 指定的文件不存在：{0}" -f $EnvFile)
  } else {
    Write-Host ("API：环境文件 {0} 不存在，只继承当前进程环境" -f $EnvFile) -ForegroundColor DarkGray
  }

  $previous = @{}
  foreach ($entry in $entries) {
    $key = [string]$entry.Key
    if (-not $previous.ContainsKey($key)) {
      $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    }
    [Environment]::SetEnvironmentVariable($key, [string]$entry.Value, 'Process')
  }
  try {
    $process = Start-Process -FilePath 'cmd.exe' `
      -ArgumentList '/d', '/c', "dotnet run --project src/Api --urls $cloudApiListenUrl > `"$cloudApiLog`" 2>&1" `
      -WorkingDirectory $Repo -WindowStyle Hidden -PassThru
    return @{ Pid = $process.Id; Secrets = $secrets.ToArray() }
  } finally {
    foreach ($key in $previous.Keys) {
      [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process')
    }
  }
}

# 日志最后几行，打印前按本次注入值脱敏。
function Get-CloudApiLogTail {
  param([string[]]$Secrets, [int]$Lines = 15)
  if (-not (Test-Path -LiteralPath $cloudApiLog)) { return @('（日志尚未生成）') }
  $tail = @(Get-Content -LiteralPath $cloudApiLog -Encoding utf8 -Tail $Lines -ErrorAction SilentlyContinue)
  return @($tail | ForEach-Object { Hide-SecretText -Text ([string]$_) -Secrets $Secrets })
}

# 1 秒一轮轮询 /health，直到可用、进程退出或超时。失败分支打印日志路径与脱敏尾行。
# @returns @{ Ready = bool }
function Wait-CloudApiReady {
  param(
    [Parameter(Mandatory = $true)][string]$HealthUrl,
    [Parameter(Mandatory = $true)][int]$LauncherPid,
    [Parameter(Mandatory = $true)][int]$TimeoutSec,
    [string[]]$Secrets
  )
  $started = Get-Date
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $lastReport = Get-Date
  $detail = ''
  while ($true) {
    $probe = Test-CloudApiAvailable -HealthUrl $HealthUrl
    if ($probe.Available) { return @{ Ready = $true } }
    $detail = $probe.Detail
    if ($null -eq (Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue)) {
      Write-Host ("本地 API 进程已退出，未通过健康检查（{0}）。" -f $detail) -ForegroundColor Red
      Write-Host ("  日志：{0}" -f $cloudApiLog) -ForegroundColor Red
      Get-CloudApiLogTail -Secrets $Secrets | ForEach-Object { Write-Host ("  " + $_) }
      Write-Host '  常见原因：环境文件缺 DATABASE_URL / JWT_SIGNING_KEY 等必填项，或 dotnet 构建失败。' -ForegroundColor Red
      return @{ Ready = $false }
    }
    if (((Get-Date) - $lastReport).TotalSeconds -ge 10) {
      Write-Host ("  本地 API 仍在启动或构建（已 {0} 秒；最后探测 {1}），继续轮询…" -f [int]((Get-Date) - $started).TotalSeconds, $detail) -ForegroundColor DarkYellow
      $lastReport = Get-Date
    }
    if ((Get-Date) -gt $deadline) {
      Write-Host ("本地 API 在 {0} 秒内未通过健康检查（最后探测 {1}）。" -f $TimeoutSec, $detail) -ForegroundColor Red
      Write-Host ("  日志：{0}" -f $cloudApiLog) -ForegroundColor Red
      Get-CloudApiLogTail -Secrets $Secrets | ForEach-Object { Write-Host ("  " + $_) }
      Write-Host '  排查：环境文件是否补齐、数据库是否可达、端口 5081 是否被占用；或加大 -CloudApiTimeoutSec。' -ForegroundColor Red
      return @{ Ready = $false }
    }
    Start-Sleep -Milliseconds 1000
  }
}

# 只停本脚本拉起、且状态文件记录与命令行签名都吻合的 API；外部 API 与端口占用只报告。
# @returns bool：是否干净（没有遗留本脚本的 API）
function Stop-OwnedCloudApi {
  $state = Read-StartAllState
  if ($null -eq $state -or $state.root -ne $root -or $null -eq $state.apiPid -or [int]$state.apiPid -le 0) {
    Write-Host 'API：状态文件没有本脚本记录的实例。' -ForegroundColor DarkGray
    return $true
  }
  $recordedPid = [int]$state.apiPid
  $apiPort = 5081
  if ($null -ne $state.apiPort -and [int]$state.apiPort -gt 0) { $apiPort = [int]$state.apiPort }
  $process = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $recordedPid) -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    Write-Host ("API：记录的 PID {0} 已退出，清掉记录。" -f $recordedPid) -ForegroundColor DarkGray
    Clear-StartAllStateApiRecord
    return $true
  }
  if (-not (Test-CloudApiCommandLineSignature -CommandLine $process.CommandLine -Name $process.Name)) {
    Write-Host ("API：PID {0} 存在但命令行不是本脚本的 dotnet run src/Api 签名，不动它。" -f $recordedPid) -ForegroundColor Red
    return $false
  }
  Stop-RepoProcessTrees -Processes @($process)
  Clear-StartAllStateApiRecord
  if (Wait-PortReleased -Port $apiPort -TimeoutSec 20) {
    Write-Host ("API：已停止，端口 {0} 已释放。" -f $apiPort) -ForegroundColor Green
    return $true
  }
  Write-Host ("API：进程已停但端口 {0} 仍被占用（可能是别处起的 API）。" -f $apiPort) -ForegroundColor Red
  return $false
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
    $CommandLine -match '(?i)apps[\\/]cli[\\/]lib[\\/]bin\.js\s+web(\s|$)' -or
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
# apiPid 是 -StartCloudApi 拉起的本地 API（0 表示没有）；不显式给时沿用同一检出的旧记录。
function Save-StartAllState {
  param([int]$LauncherPid, [int]$Port, [int]$WebPid = 0, [int]$ApiPid = -1, [int]$ApiPort = 5081)
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $existing = Read-StartAllState
  if ($ApiPid -lt 0) {
    $ApiPid = if ($null -ne $existing -and $existing.root -eq $root -and $null -ne $existing.apiPid) { [int]$existing.apiPid } else { 0 }
  }
  if (-not $PSBoundParameters.ContainsKey('ApiPort') -and $null -ne $existing -and $existing.root -eq $root -and $null -ne $existing.apiPort -and [int]$existing.apiPort -gt 0) {
    $ApiPort = [int]$existing.apiPort
  }
  $state = [ordered]@{
    root = $root
    launcherPid = $LauncherPid
    webPid = $WebPid
    webPort = $Port
    apiPid = $ApiPid
    apiPort = $ApiPort
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

# 构建两边共用的产物。新客户端只要 build:artifacts（根 tsdown 的 Host 面产出 desktop lib，
# Client 面同时产出 client/lib/dist，桌面外壳 build 是旧壳的打包产物门禁）；-Legacy 与
# dev.ts 的构建门禁一致：先全量 artifacts，再旧壳桌面 build。
function Invoke-RepoBuild {
  param([switch]$Legacy)
  $steps = @(
    @{ Label = 'build:artifacts'; Command = 'pnpm --config.verify-deps-before-run=false run build:artifacts' }
  )
  if ($Legacy) {
    $steps += @{ Label = '桌面外壳 build'; Command = 'pnpm --config.verify-deps-before-run=false --filter @deepseek-ai/dsh-desktop run build' }
  }
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

# 起 Web（不带 watch）；DSH_HOME 不写用户目录，只在启动这一下临时设置。
# 有已构建产物时直接跑 dsh 的发布入口 apps/cli/lib/bin.js：与 apps/cli/src/bin.ts 同一份代码，
# 但省掉 pnpm 工作区解析与 tsx 的逐文件转译（每次启动都要重做）。-Fast 的语义本就是「产物没变」，
# 与桌面端 -Fast 直接跑构建产物一致；产物缺失时回退到 start:web 的源码口径，行为不变。
function Start-WebInstance {
  $previousHome = $env:DSH_HOME
  if (-not $previousHome) { $env:DSH_HOME = Join-Path $root '.dsh-home' }
  # pnpm 11 在 node_modules 与锁文件不一致时会先跑一次安装并弹交互确认，隐藏窗口里没有 stdin，
  # 会一直等；依赖由 worktree claim / rebuild 负责，这里不重装。该开关只认 CLI 配置。
  $builtEntry = Join-Path $root 'apps\cli\lib\bin.js'
  $webCommand = if (Test-Path $builtEntry) {
    "node `"$builtEntry`" web --port $WebPort --no-open"
  } else {
    "pnpm --config.verify-deps-before-run=false run start:web --port $WebPort --no-open"
  }
  try {
    $process = Start-Process -FilePath 'cmd.exe' `
      -ArgumentList '/d', '/c', "$webCommand > `"$webLog`" 2>&1" `
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
    [Parameter(Mandatory = $true)][datetime]$Started,
    [string]$ReadyPattern = 'dsh web:\s*(http://\S+)'
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
      if ($line -match $ReadyPattern) {
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
# 桌面按当前模式核对 inspector 端口：新客户端 9829/9822/9830，旧壳 9229/9222/9230。
function Stop-OwnedSides {
  param([bool]$StopWeb, [bool]$StopDesktop, [switch]$Legacy)
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
    foreach ($port in @(Get-DesktopInspectorPorts -Legacy:$Legacy)) {
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
$desktopModeLabel = if ($Legacy) { '旧壳（-Legacy）' } else { '新客户端' }
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
$cloudApiPort = Get-CloudApiUrlPort -Url $CloudApi
# 上一次本脚本拉起的 API 仍存活时原样带入状态，别让本次启动把它从 -Stop 的视野里丢掉。
$cloudApiPid = Get-RecordedCloudApiPid

if ($ListOnly) {
  Write-Host ("本检出 {0}（桌面：{1}）" -f $root, $desktopModeLabel) -ForegroundColor Cyan
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
  $apiState = Read-StartAllState
  if ($null -ne $apiState -and $apiState.root -eq $root -and $null -ne $apiState.apiPid -and [int]$apiState.apiPid -gt 0) {
    $apiProcess = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$apiState.apiPid) -ErrorAction SilentlyContinue
    if ($null -eq $apiProcess) {
      Write-Host ("API：状态记录的 PID {0} 已退出（-Stop 会清掉这条记录）。" -f $apiState.apiPid) -ForegroundColor DarkGray
    } elseif (Test-CloudApiCommandLineSignature -CommandLine $apiProcess.CommandLine -Name $apiProcess.Name) {
      Write-Host ("API：会停掉 PID {0}（{1}，本脚本拉起）" -f $apiProcess.ProcessId, $apiProcess.Name)
    } else {
      Write-Host ("API：PID {0} 命令行不吻合，-Stop 不会动它。" -f $apiProcess.ProcessId) -ForegroundColor DarkYellow
    }
  } elseif (Test-PortListening -Port $cloudApiPort) {
    Write-Host ("API：端口 {0} 有监听，但不是本脚本拉起的（状态文件无记录），-Stop 不动它。" -f $cloudApiPort) -ForegroundColor DarkYellow
  } else {
    Write-Host ("API：没有本脚本拉起的实例，端口 {0} 空着。" -f $cloudApiPort) -ForegroundColor Green
  }
  return
}

if ($Stop) {
  # 先停 API：它按状态文件独立识别，随后停 Web 会清整份状态，顺序不能反。
  $apiClean = Stop-OwnedCloudApi
  $sidesClean = Stop-OwnedSides -StopWeb $runWeb -StopDesktop $runDesktop -Legacy:$Legacy
  if (-not $apiClean -or -not $sidesClean) { exit 1 }
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
  if (-not $probe.Available -and $StartCloudApi) {
    # -StartCloudApi：探测不成时改为拉起本地 API，成功后才回到下面的成功分支。
    Write-Host ("云端：探测 {0} 失败（{1}）；-StartCloudApi 已启用，拉起本地 API。" -f $cloudHealthUrl, $probe.Detail) -ForegroundColor Yellow
    if ($cloudApiPort -ne 5081) {
      throw ("-StartCloudApi 固定把本地 API 起在 5081，当前 -CloudApi 端口是 {0}，起了也探测不到。改成 5081，或自行启动 API 后加 -SkipCloudCheck。" -f $cloudApiPort)
    }
    if (Test-PortListening -Port 5081) {
      throw ("端口 5081 已被占用，但 {0} 探测失败（{1}）；不动那个进程。先排查占用者，或自行启动 API 后加 -SkipCloudCheck。" -f $cloudHealthUrl, $probe.Detail)
    }
    $envFile = if ($PSBoundParameters.ContainsKey('CloudEnvFile')) { $CloudEnvFile } else { Join-Path $CloudRepo '.env' }
    $launch = Start-CloudApiInstance -Repo $CloudRepo -EnvFile $envFile -EnvFileExplicit:$PSBoundParameters.ContainsKey('CloudEnvFile')
    $cloudApiPid = [int]$launch.Pid
    Write-Host ("API：已启动（PID {0}），日志 {1}" -f $cloudApiPid, $cloudApiLog) -ForegroundColor Cyan
    $ready = Wait-CloudApiReady -HealthUrl $cloudHealthUrl -LauncherPid $cloudApiPid -TimeoutSec $CloudApiTimeoutSec -Secrets $launch.Secrets
    if (-not $ready.Ready) {
      # 本脚本拉起的进程留在后台会占住 5081，下一次启动又走不成；停掉并说明。
      $leftover = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $cloudApiPid) -ErrorAction SilentlyContinue
      if ($null -ne $leftover) {
        Stop-RepoProcessTrees -Processes @($leftover)
        Write-Host ("  已停掉本次拉起的 API（PID {0}），日志保留：{1}" -f $cloudApiPid, $cloudApiLog) -ForegroundColor Yellow
      }
      exit 1
    }
    $probe = Test-CloudApiAvailable -HealthUrl $cloudHealthUrl
    Write-Host ("云端：本地 API 健康检查通过（{0}）" -f $probe.Detail) -ForegroundColor Green
  }
  if (-not $probe.Available) {
    Write-Host ("云端 API 不可用：GET {0} 失败（{1}；超时 2 秒）。" -f $cloudHealthUrl, $probe.Detail) -ForegroundColor Red
    Write-Host '  登录与模型路由都走它，现在启动只会得到登录不可用的实例，已中止。' -ForegroundColor Red
    Write-Host '  起本地 API（LCoder-cloud 仓）：dotnet run --project src/Api --urls http://localhost:5081' -ForegroundColor Red
    Write-Host '  或加 -StartCloudApi 让本脚本拉起（-CloudRepo / -CloudEnvFile 可改路径，默认 <CloudRepo>\.env）' -ForegroundColor Red
    Write-Host '  或起 dev-only mock（监听 5091）：node lcoder/scripts/mock-cloud.mjs，并用 -CloudApi http://127.0.0.1:5091/v1' -ForegroundColor Red
    Write-Host '  指向别处：-CloudApi https://<host>/v1；也可直接设 LCODER_CLOUD_BASE_URL 后加 -SkipCloudCheck' -ForegroundColor Red
    exit 1
  }
  Write-Host ("云端：探测 {0} → {1}（可用）" -f $cloudHealthUrl, $probe.Detail) -ForegroundColor Green
}
$env:LCODER_CLOUD_BASE_URL = $CloudApi
Write-Host ("云端：已注入 LCODER_CLOUD_BASE_URL={0}（Web 与桌面两个子进程继承）" -f $CloudApi) -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Write-Host ("本检出 {0}（桌面：{1}）" -f $root, $desktopModeLabel) -ForegroundColor Cyan
# 先停旧实例：桌面被单实例锁挡住的报错比这难看得多。
Stop-OwnedSides -StopWeb $runWeb -StopDesktop $runDesktop -Legacy:$Legacy | Out-Null
# 停 Web 会清掉整份状态文件；本地 API 的记录要在那之后补写，-Stop 才认得它。
if ($cloudApiPid -gt 0) {
  Save-StartAllState -LauncherPid 0 -Port $WebPort -ApiPid $cloudApiPid -ApiPort 5081
  Write-Host ("API：PID {0} 已记入状态文件（-Stop 只停这一条记录且签名吻合的进程）" -f $cloudApiPid) -ForegroundColor DarkGray
}
if ($runWeb) { if (Test-Path -LiteralPath $webLog) { Remove-Item -LiteralPath $webLog -Force } }
if ($runDesktop) { if (Test-Path -LiteralPath $desktopLog) { Remove-Item -LiteralPath $desktopLog -Force } }

if ($Fast) { Write-Host '构建：跳过（-Fast）' -ForegroundColor DarkGray }
else { Invoke-RepoBuild -Legacy:$Legacy }

$webUrl = ''
$desktopUrl = ''
if ($runWeb) {
  $webStarted = Get-Date
  $webPid = Start-WebInstance
  Save-StartAllState -LauncherPid $webPid -Port $WebPort -ApiPid $cloudApiPid
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
    Save-StartAllState -LauncherPid $webPid -Port $WebPort -WebPid $listenerPid -ApiPid $cloudApiPid
    Write-Host ("Web：监听进程 PID {0}（已记入状态）" -f $listenerPid) -ForegroundColor DarkGray
  }
  Write-Host ("Web 就绪：{0}" -f $webUrl) -ForegroundColor Green
}

if ($runDesktop) {
  $desktopStarted = Get-Date
  # 构建已在上一步做完：这里走 launch（新客户端）或 start:desktop（旧壳），不再重复构建；
  # 运行时冒烟是旧壳的发布验收口径，start-all 一律不跑（显式复核用 start-desktop -Smoke -Legacy）。
  $desktopPid = Start-DesktopInstance -Root $root -LogPath $desktopLog -SkipBuild -Legacy:$Legacy
  Write-Host ("桌面：已启动（{0}，PID {1}），日志 {2}" -f $desktopModeLabel, $desktopPid, $desktopLog) -ForegroundColor Cyan
  $result = Wait-SideReady -Name 'desktop' -LogPath $desktopLog -LauncherPid $desktopPid -Started $desktopStarted `
    -ReadyPattern (Get-DesktopReadyPattern -Legacy:$Legacy)
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
if ($cloudApiPid -gt 0) { Write-Host ("        本地 API PID {0}（本脚本拉起；日志 {1}）" -f $cloudApiPid, $cloudApiLog) -ForegroundColor DarkGray }
if ($runWeb) { Write-Host ("Web   : {0}" -f $webUrl); Write-Host ("        日志 {0}" -f $webLog) -ForegroundColor DarkGray }
if ($runDesktop) {
  Write-Host ("桌面  : {0}（{1}）" -f $desktopUrl, $desktopModeLabel)
  $inspectors = Read-DesktopInspectors -LogPath $desktopLog
  if ($inspectors) { Write-Host ("        inspectors {0}" -f $inspectors) -ForegroundColor DarkGray }
  Write-Host ("        日志 {0}" -f $desktopLog) -ForegroundColor DarkGray
}
$stopHint = 'lcoder\scripts\start-all.cmd -Stop'
if ($runWeb -and $WebPort -ne 3080) { $stopHint += (" -WebPort {0}" -f $WebPort) }
if (-not $runWeb) { $stopHint += ' -NoWeb' }
if (-not $runDesktop) { $stopHint += ' -NoDesktop' }
if ($runDesktop -and $Legacy) { $stopHint += ' -Legacy' }
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
