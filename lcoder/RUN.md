# 让工作台跑起来

三步：Node 版本 → 把两个包接进 profile → 起服务。

**全程用仓库内的隔离环境。** `DSH_HOME` 一律指向仓内目录，不指向 `~/.dsh`；开发与验证既不依赖本机装没装桌面版 / `dsh`，也不改变本机已装的那些应用（不写 `AppData`、不动注册表、不装卸应用、不杀不是本次拉起的进程）。仓根的 `.dsh-home/` 已被 `.gitignore` 忽略，worktree 用各自仓内的 home。下面所有命令都按这个前提写。

## 1. Node 版本

仓库要求 `>=24.9.0`（`package.json` 的 `engines`）。本机若是 22，用 pnpm 自带的版本管理装一个，不要动系统 Node：

```sh
pnpm setup                 # 第一次：把 ~/.pnpm/bin 加进 PATH（需重开终端）
pnpm env use --global 24   # 装 Node 24，链接到 ~/.pnpm/bin/node.exe
```

之后每条命令都要让这个 Node 走在最前面：

```sh
export PATH="$HOME/.pnpm/bin:$PATH"   # Git Bash
node -v                               # 期望 v24.x
```

## 2. 把 `@lcoder/*` 接进 profile

插件行是按**包名**解析的，解析基准是 profile 目录（`<DSH_HOME>/profiles/web/`），不是仓库。
仓库里的 workspace 包在那儿看不见，所以两行都会 "failed to import"。
用 `link:` 接进去（上游 `docs/user/develop/basic/publish.md` 的做法）。先给仓内 home 起个名，
下面都用它：

```sh
DSH_HOME='E:\Projects\LCoder\.dsh-home'        # Windows 形式；Git Bash 里 $HOME 展开的路径会让 profile 静默起不来
mkdir -p "$DSH_HOME"
cd "E:/Projects/LCoder/.dsh-home/profiles/web"   # 第一次启动后 dsh 会自动建出这个目录
pnpm add "link:E:/Projects/LCoder/packages/lcoder/kernel" \
         "link:E:/Projects/LCoder/packages/lcoder/workspace"
```

profile 目录不存在时先空跑一次（`DSH_HOME=… pnpm dsh web --no-open --port 3080` 起来后 Ctrl+C），
或者用 `--from-default-profile web` 让 dsh 从出厂模板建一份。重建 home 目录后，这一步要重做。

> 警告里会提到 `@lcoder/workspace` 的 peer 依赖 `@deepseek-ai/cordis` 不解析——
> 无妨：cordis 由宿主提供，浏览器侧插件不自己解析它。

## 3. 起服务

```sh
cd E:/Projects/LCoder
DSH_HOME='E:\Projects\LCoder\.dsh-home' pnpm dsh web --patch lcoder/cordis.patch.yml --no-open --port 3080
```

首次要构建前端产物（`pnpm run build:artifacts`，几分钟）。之后可以用
`DSH_HOME='E:\Projects\LCoder\.dsh-home' pnpm dev:web --poll --patch lcoder/cordis.patch.yml` 起带 watch 的开发循环。
注意 `--patch` 这类 launcher 参数要紧跟在 `dsh web` 之后、其它 app 参数之前，放到后面会被当成转发给应用而被拒。

改了 `packages/lcoder/*/src` 后，重打一次产物即可（服务会 stat-poll 到并广播 reload）：

```sh
pnpm --filter @lcoder/workspace bundle
pnpm --filter @lcoder/kernel bundle
```

## 怎么确认真的起来了

按顺序看四件事：

1. **服务活着**：日志里有 `dsh web: http://127.0.0.1:3080/?token=…`
2. **kernel 挂上了**：selfCheck 那行 `[lcoder] 已注册 12 个工具与 /contract_sign、/task_bind、/task_contract 命令；角色 …`
   打到**宿主 stderr**，桌面实例里采不到它——宿主子进程的 stdout 不并入 `dev:desktop` 日志，
   而且 kernel 是 Agent 作用域**懒装载**，`apply()` 要到起回合才发生，无钥匙实例里这行出现 0 次。
   桌面端改判两条：会话头 `agentPreset` 是 `lcoder*`（不要钥匙，实测可采），以及真点一次
   「签署契约」看宿主是否落盘。要数注册计数就另起一份 web 判别器跑同码。
3. **规格根对着目标仓库**：`[lcoder] 规格根：<仓库>/.spec` 同样走宿主 stderr，桌面里采不到；
   判它看落盘位置——`task_draft` 或 `/task_bind` 写完去目标仓库找 `.spec/tasks/`，落在 profile 目录就是错的。
4. **没有激活失败**：不应该出现 `N entries did not activate`
5. **工作台进了浏览器清单**：带会话取首页，插件组合 URL 里要有
   `@lcoder/workspace/client.js`

```sh
TOKEN=$(grep -o "token=[A-Za-z0-9_-]*" lcoder/web.log | head -1 | cut -d= -f2)
curl -s -c /tmp/cj -b /tmp/cj -L "http://127.0.0.1:3080/?token=$TOKEN" | grep -o "@lcoder/workspace/client.js"
```

浏览器里打开 `http://127.0.0.1:3080/?token=…`（token 从日志取），右侧栏的
页签列表里应该多出「工作台」。三栏要出数据，会话还得绑定一个工作区目录——
仓库根有一份示例 `.spec/`（`DR-01`/`DR-02` 两条规则、`DEMO-01` 一个任务），
可以直接选仓库根。它是产品示例数据，不是开发台账；开发进度见 `docs/tasks.yaml`。

## 规格根从哪来

kernel 按下面的顺序确定 `.spec` 目录：

1. 有会话时：`session.header.cwd/.spec`，即会话创建时绑定的仓库；
2. 没有会话 cwd（headless、启动自检）：`LCODER_SPEC_ROOT` 或 patch 里的 `root`；
3. 都没有：`process.cwd()/.spec`。

桌面端宿主子进程的 cwd 是 profile 目录，不是目标仓库，所以只能靠会话工作区定位真实规格库。`LCODER_SPEC_ROOT` 通过 `lcoder/cordis.patch.yml` 的 `!!js` 注入，只作兜底或显式覆盖。

## 桌面端

验收只认桌面端实例，web 实例只当判别器用。

```sh
cd E:/Projects/LCoder
pnpm run dev:desktop > lcoder/desktop.log 2>&1     # 不要接管道；也不要设 DSH_HOME

更省事的是 `lcoder\scripts\start-desktop.cmd`：它先按路径停掉**本检出**的旧实例（不会碰 worktree 或其他 electron 应用）、把启动放到独立进程、按 UTF-8 实时打印每个构建阶段并去掉 ANSI 颜色码，就绪后直接给出带 token 的地址。`-ListOnly` 只列会停哪些进程、`-KeepRunning` 不停旧实例、`-KeepFollowing` 就绪后继续跟随。默认**构建但不跑运行时冒烟**（冒烟是发布验收口径、百秒级）；`-Smoke` 连冒烟一起跑，`-NoBuild` 跳过构建，`-Fast` 是「不构建 + 不冒烟」的最快启动。改过源码就别用 `-NoBuild`/`-Fast`，会跑旧产物。看不到进度时先用它，不要手拼 `Get-Content`——`.ps1` 必须带 UTF-8 BOM，否则 Windows PowerShell 5.1 会按 GBK 读中文并把脚本解析坏。
```

不设 `DSH_HOME` 是关键：`apps/desktop/scripts/dev.ts:66` 会把它默认到
`apps/desktop/.desktop-build/development/home`，`userData` 默认到同级 `electron-user-data`，
两者都在仓内、都被忽略。显式设成 `~/.dsh` 会让这次验证直接写本机安装态，禁止。

### 一条命令起两边：`start-all.cmd`

Web 与桌面要一起验时用 `lcoder\scripts\start-all.cmd`：先探测本地云端 → 停本检出的旧实例 → 构建（`build:artifacts` 加桌面外壳）→ 先起 Web（3080）再起桌面（9222/9229/9230）→ 两边就绪后打印日志位置与带 token 的地址。云端探测由 `-CloudApi`（默认 `http://127.0.0.1:5081/v1`）去掉末尾 `/v1` 拼出 `/health`，2 秒内 GET 到 200 才算可用；可用就把地址写进 `LCODER_CLOUD_BASE_URL`，Web 与桌面两个子进程都继承。不可用时红字打印检测地址、本地 API 的启动方式与可直接设置的 `LCODER_CLOUD_BASE_URL`，以退出码 1 中止且不启动任何一边——不会得到一个登录不可用的实例。探测发生在构建与停旧实例之前；`-Stop` 与 `-ListOnly` 不做探测，`-SkipCloudCheck` 跳过探测但仍按当前 `-CloudApi` 注入。日志固定落 `lcoder/logs/web.log` 与 `lcoder/logs/desktop-main.log`。`-Fast` 跳过构建与冒烟、`-NoWeb`/`-NoDesktop` 只起一边、`-WebPort` 换 Web 端口、`-Stop` 停本检出的两边并核对端口释放、`-ListOnly` 只列进程、`-KeepFollowing` 就绪后继续跟随（Ctrl+C 只停跟随）。Web 的 `DSH_HOME` 默认落本检出 `.dsh-home`；桌面 inspector 端口沿用 `DSH_DESKTOP_MAIN_INSPECT_PORT` / `DSH_DESKTOP_RENDERER_DEBUG_PORT` / `DSH_DESKTOP_HOST_INSPECT_PORT`。进程归属按检出根、状态文件里记录的 Web 监听 PID 与命令行签名判断：Web 就绪后会把实际监听端口的进程连同启动器一起记进 `lcoder/logs/start-all-state.json`（pnpm 用相对路径带起 node，启动器退了以后只靠命令行认不出它），下次 `-Stop` 或再启动就能停掉；端口上的进程不属于本检出时只报告、不终止，主检出与别的工作树的实例不会被带走。探测失败时加 `-StartCloudApi` 可让脚本自己拉起本机 API：以 `-CloudRepo`（默认 `E:\Projects\LCoder-cloud`）为工作目录执行 `dotnet run --project src/Api --urls http://localhost:5081`，子进程继承当前环境并叠加 `-CloudEnvFile`（默认 `<CloudRepo>\.env`，不存在就跳过）里的 `KEY=VALUE`（忽略注释与空行，任何值都不打印），stdout/stderr 落 `lcoder/logs/cloud-api.log`，1 秒一轮轮询 `/health`，`-CloudApiTimeoutSec`（默认 90）内没通过就打印日志路径与脱敏后的最后几行并以退出码 1 中止（环境缺 `DATABASE_URL`/`JWT_SIGNING_KEY` 等必填项时，dotnet 会在这里退出，日志里能看到缺哪一项）；通过后才回到成功分支，注入 `LCODER_CLOUD_BASE_URL` 并起 Web 与桌面。拉起的 PID 记进状态文件（`apiPid`），`-Stop` 只停这条记录且命令行是 `dotnet run src/Api` 签名的进程，别处起的 API 与端口占用只报告、不动它；`-ListOnly` 会一并显示 API 状态。本地 API 固定起在 5081，所以这条路径要求 `-CloudApi` 的端口也是 5081。

对话还需要模型钥匙，而它不会跟着 home 走：仓内那份 `.credentials.yaml` 只有 web 登录态记录，
没有 provider 凭据。缺它的现象是「发了没反应」——宿主把消息收进入队就返回接受，回合才失败，
会话日志里连 `user/message` 都没有。外壳会提示「宿主侧没有可用模型」并拦住发送，配法是把钥匙
交进宿主进程的环境，别写进任何会被提交的文件：

```sh
export DEEPSEEK_API_KEY=…            # 只在本机环境里；仓库根的 .env 已被 .gitignore 忽略
pnpm run dev:desktop > lcoder/desktop.log 2>&1
```

`dev.ts` 用 `...process.env` 起子进程，环境变量会传到宿主；改完必须重启实例。

LCoder 的挂载写进那份仓内 home 的 profile（`apps/desktop/.desktop-build/development/home/profiles/desktop/`）：
`cordis.patch.yml` 放 LCoder 段，`package.json` 里用 `link:` 指向**当前检出**的
`packages/lcoder/kernel` 与 `packages/lcoder/workspace`（worktree 里就跑 worktree 的包，别指回主仓）。`lcoder\scripts\rebuild.cmd profile` 会自动写这份 `package.json` 与 `node_modules/@lcoder` 两条链接，`warm`/`claim` 在跳过构建时也会执行同一步。

### 本机必读：桌面 profile 要配 `documentsDirectory`

在本机这类环境里，宿主向操作系统问「文档目录在哪」会挂住不返回（同一条命令在 Git Bash 里
0.17 秒返回），于是首启动的 `workspace/initializeDefault` 永不 settle，并把注册表队列占死——
之后「打开仓库」也一起没应答，宿主日志零报错。实测的对照是同一份代码、同一个仓内 home、
只改这一行：不配时 `initializeDefault` 与 `create` 都无应答、`storages/workspace.json` 停在
227 字节且 `workspaceIds` 为空；配了之后 22 个请求全部应答、文件变成 758 字节并登记出默认工作区。

```yaml
# home/profiles/desktop/cordis.patch.yml
- id: workspace-controller
  name: "@deepseek-ai/dsh-api-workspace-controller"
  config:
    documentsDirectory: 'E:\Projects\LCoder\apps\desktop\.desktop-build\development\docs'
```

目录要真实存在（上面那行指向 dev.ts 同级的 `docs/`）。这一行是**规避**，不是修复：队头卡住后 workspace 命名空间不会自愈属设计特征（`commands.ts` 里没有 deadline），而「10 秒超时没兜住」一项未经证实、已按 T-16 降级；配置命中后
`initializeDefault` 会在该目录下建出 `deepseek-harness/default-workspace`。web 侧可以用
`--dump-config` 证明这行命中，桌面侧 CLI 拒绝 profile 名 `desktop`，所以桌面的判据是落盘数字。

```sh
pnpm run dev:desktop          # 构建产物后启动（改过 src 用这个）
pnpm run start:desktop        # 同上但跳过重建
pnpm --filter @lcoder/workspace bundle   # 只重打外壳产物；start:desktop 不会替你做
```

启动日志里按顺序确认两件事：`desktop development: DSH_HOME=<仓内路径>` 与
`inspectors main=9229, renderer=9222, host=9230`、`dsh web: http://127.0.0.1:<port>/?token=…`
的 ready 行。第三件事不在日志里——kernel 的注册行走宿主 stderr 且不并日志，改判会话头
`agentPreset` 是不是 `lcoder*`（见「怎么确认真的起来了」第 2 条）。两条齐才算宿主活着。
一条桌面线一个 worktree：feature worktree 用 `DSH_DESKTOP_MAIN_INSPECT_PORT` /
`DSH_DESKTOP_RENDERER_DEBUG_PORT` / `DSH_DESKTOP_HOST_INSPECT_PORT` 换一组预留端口，
端口号写进该任务的台账备注；主窗保留默认 9229/9222/9230。

## 并联工作树

并行窗口用独立 worktree 时，web 用 worktree 自己的仓内 home（`DSH_HOME='<worktree>\.dsh-home'`），桌面用 worktree 自带的 `apps/desktop/.desktop-build/development/home`；两者都不碰主窗口共用的目录。smoke 的端口换 3081，桌面按上一节的三件套换一组预留 inspector。首次先 `pnpm install`、`pnpm run build:artifacts`（新 worktree 只 `pnpm install` 会因缺 `lib/` 产物而起不来）；profile 的 `package.json` 两条 `link:` 与 `node_modules/@lcoder` 两条链接由 `lcoder\scripts\rebuild.cmd profile` 自动写成本 tree，不必手抄。

装完先核一条再判门禁，`grep -o 'InstallationProbe = .*' node_modules/.pnpm/@botiverse+oar@0.67.0_patch_*/node_modules/@botiverse/oar/dist/contracts/installation.d.ts` 要带 `options?`——`pnpm-workspace.yaml` 给这个依赖打了补丁，新 tree 的 `pnpm install` 可能静默不应用，症状是 `packages/experimental/subagent-oar/src/run.ts:253` 报 TS2554、host compiler 退出 1、桌面产物链全断。`pnpm install --force` 即解；别把它记成上游类型错误（`lcoder/PITFALLS.md` W-09）。

装配源进仓后，worktree 的桌面 profile 由脚本装配，不再手抄。`lcoder/desktop-profile.patch.yml` 是十个角色 preset 与 LCoder 段的唯一可审阅源，`rebuild.cmd profile`（`warm`/`claim` 在跳过构建时也会跑）把它连同本机本地段拷进本 worktree 的 `…/home/profiles/desktop/cordis.patch.yml`，并写出 `package.json` 的两条 `link:` 与 `node_modules/@lcoder/{kernel,workspace}` 链接。仍要手工核三件：`documentsDirectory` 指向一个真实存在的目录、两条 `link:` 解析到**本 worktree** 的两个包（不是主检出）、十个 preset 的 `role` 各就各位（`dev` / `intake` / `architect` / `pm` / `git` / `ops` / `review` / `scheduler` / `flow` / `manager`；kernel 只挂在 preset 内，没有全局行）。十个 preset 各挂 `ask-user` 与一个 `isolate` 组里的 `compaction-basic`——web-app 在宿主面禁用了 compaction，preset 必须自己挂，且 compaction 是 isolate 服务。改过装配源后重跑一次 `rebuild.cmd profile`，否则角色名册里看不到新角色。

还有一条本机偏离：worktree 首启动时 `@electron/get` 下载 Electron 会对本机 GitHub 超时，先对拷主仓 `apps/desktop/.desktop-build/downloads` 缓存并设 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`，否则 `start:desktop` 以 `aborted due to timeout` 退出。web 冒烟用的 `.dsh-home/profiles/web` 同样要装两条 `link:`，少一条就报 `2 entries did not activate`。

## 云端 mock（dev-only）

登录、匿名立项与云端模型路由需要一个本机云端。仓库里有一份不打包进产物的 mock：

```sh
node lcoder/scripts/mock-cloud.mjs          # 监听 127.0.0.1:5091
```

- 端点与 `LCoder-cloud/docs/api/openapi.yaml` 的桌面接入面一致：`/v1/auth/sms/send`、`register`、`login/sms`、`login/password`、`refresh`、`logout`、`/v1/me`、`/v1/guest/sessions`、`/v1/guest/session`、`/v1/models`、`/v1/chat/completions`（SSE）。
- 短信验证码固定 `123456`；access token 默认 900 秒，refresh token 每次刷新轮换。
- 错误开关：
  ```sh
  curl -X POST http://127.0.0.1:5091/_mock/control -H 'content-type: application/json' \
    -d '{"mode":"quota_exhausted"}'        # banned / upstream_unavailable / upstream_timeout / guest_quota_exhausted / rate_limited / null
  curl -X POST http://127.0.0.1:5091/_mock/control -H 'content-type: application/json' \
    -d '{"expireAccess":true}'             # 下一次模型请求 401 token_expired，宿主刷新后重试
  curl http://127.0.0.1:5091/_mock/state   # 登录/刷新/对话/匿名领取计数
  curl -X POST http://127.0.0.1:5091/_mock/control -H 'content-type: application/json' -d '{"reset":true}'
  ```
- 桌面与 web 的 profile 把两条 provider 路由的 BaseURL 默认指到 `http://127.0.0.1:5091/v1`，只在不经 `start-all` 启动时生效；`start-all.cmd` 会用探测通过的 `-CloudApi`（默认 5081）覆盖它。要用这份 mock 就加 `-CloudApi http://127.0.0.1:5091/v1`，不要改源码。真云端同理只换这个参数或环境变量。

## 踩过的坑

- **kill 掉 dev:web 不会带走子进程**（Windows）。`TaskStop` / Ctrl+C 只杀到 shell，
  tsc / tsdown / vite 那几个还在跑，会和下一个实例抢写 `lib/`。换实例前先按
  进程树清干净，再确认端口没人占。
- **`dev:web` 的输出别接管道**（`| tail`）。管道会缓冲到进程结束，而 serve 不会
  结束——你会整整十分钟看不到任何日志。直接 `> lcoder/web.log 2>&1` 再读文件。
- **插件路径不是 `plugins/<name>/client.js`**，是批量 combo URL
  （`plugins/??a/client.js,b/client.js&rev=…`），单独请求那个路径只会 404。
- **别把 `DSH_HOME` 指到 `~/.dsh`。** 指过去之后，宿主会往本机安装态写 profile、
  凭据与 storage，验证就跑在一台“有副作用”的机器上，结论分不清是产品行为还是本机状态。
  要判别也用仓内 home，桌面端保持 `dev.ts` 的默认值。
