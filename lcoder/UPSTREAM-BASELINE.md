# 上游基线

LCoder 是 **DeepSeek Harness（DSH）的二开**。本文件记录我们跟踪的基线，以及我们改动了上游的哪些地方。

跟踪上游的唯一目的：任何时候都能回答两个问题——
1. 我们现在基于上游哪个版本？
2. 上游升级时，会不会撞到我们改过的地方？

---

## 1. 当前基线

| 项 | 值 |
|---|---|
| 上游仓库 | `https://github.com/deepseek-ai/deepseek-harness` |
| 版本 | `0.2.2-alpha.2` |
| 提交时间 | 2026-10-30 00:13:15 +0800 |
| 提交标题 | `Merge pull request #7552 from deepseek-harness/fix/webworker-live-import-bindings` |
| Node 要求 | `>=24.9.0` |
| 登记日期 | 2026-11-02 |

升级基线 = 改这张表 + 走一遍第 4 节的演练。不写「大概」「差不多」，只写可复核的版本标识。

---

## 2. 远端与分支

```
origin   = 我们自己的仓库（暂未配置，等第一个可运行产物出现后再建）
upstream = deepseek-ai/deepseek-harness
```

| 分支 | 用途 | 规则 |
|---|---|---|
| `master` | 上游镜像，只读 | 只允许 `git pull upstream master`，永不提交 |
| `lcoder/main` | 我们的主线 | 所有工作在这里；永不 rebase，保证历史可追溯 |
| `sync/upstream-<版本>` | 同步上游时的临时分支 | 合并、解决冲突、跑门禁，然后合回 `lcoder/main` |

---

## 3. 接触面清单

规则：**能新增就不修改。** 新增包永不冲突；每改一个上游文件，都要在这里登记一行，并说明为什么非改不可。

### 新增物（不冲突）

| 路径 | 内容 |
|---|---|
| `lcoder/` | 本目录：基线登记、接触面清单、脚本、我们自己的说明 |
| `lcoder/cordis.patch.yml` | 我们的 patch 层：只往浏览器插件清单里插一行工作台，不改上游 patch |
| `packages/lcoder/kernel/` | 规格库、任务状态机、检查器、工具实现（原 LCoder 项目迁入） |
| `packages/lcoder/workspace/` | 三栏工作台的 client UI 插件 |

> 目录必须放在 `packages/<组>/<包>` 两级下——`pnpm-workspace.yaml` 的 glob 是 `packages/*/*`。

### 修改的上游文件（冲突点）

| 文件 | 改什么 | 为什么必须改 |
|---|---|---|
| `pnpm-lock.yaml` | 加依赖后由 `pnpm install` 重写 | 引入 workspace 外的包（`yaml`）必然改动 lock；不提交 lock 会让安装不可复现 |
| `tsconfig.client.json` | 两行：`references` 里加 `./packages/lcoder/workspace`，`include` 里加 `packages/lcoder/*/src/css-modules.d.ts` | client 聚合编译只扫被 reference 的工程。不加这两行，`pnpm typecheck` 根本看不到我们的 client 代码和测试，等于把验收门禁关掉一半；CSS 的模块声明也必须显式进 include，否则聚合程序读我们的 `.module.css` 导入会报错 |
| `tsconfig.host.json` | 一行：`references` 里加 `./packages/lcoder/kernel` | 同理，host 聚合编译靠 references 把包划进工程边界。kernel 的测试被 `packages/*/*/tests/**/*.ts` 收进了 host 聚合，但 kernel 的 src 不在任何工程里，编译直接报 TS6307 |
| `AGENTS.md` | 顶部新增「LCoder 二次开发入口」两行：规则、看板、产品文档指针 | 上游根入口是任何 AI 工具的第一落点；没有这段，工具不会自动读到 LCoder 的治理文件 |
| `apps/desktop/src/locale.ts` | 用户可见品牌串：welcomeTitle / welcomeBrand / welcomeTaglineBrand（加载与欢迎页）、关于菜单、隐藏/退出/打开应用、退出确认、启动失败、更新标题，`DeepSeek Harness` 全部改为 `LCoder`；中英的 welcomeKeyDescription 改成中性说法 | 这是产品品牌面：桌面端欢迎页与系统菜单直接显示上游产品名。该文件是桌面壳文案的单源，没有配置覆盖入口；欢迎页在主进程里先于插件树渲染，装配层换不掉 |
| `apps/desktop/tests/main-startup.spec.ts`、`quit-confirmation.spec.ts`、`tray.spec.ts`、`command-management.spec.ts` 与 `tests/expected/*.json` | 菜单、关于、退出确认、托盘文案与命令清单的期望从 DeepSeek Harness 改为 LCoder；`command-management.spec.ts` 的示例安装路径同步为 `%LOCALAPPDATA%\Programs\LCoder` | 文案单源改名后，行为期望与夹具必须跟着改，否则测试与产品不一致 |
| `apps/desktop/src/main.ts` | Windows 主窗改 `frame: false`，去掉原生 caption 与 `titleBarOverlay`；新增窗口最小化/最大化/关闭与状态查询 IPC，并在 maximize/unmaximize/fullscreen 时推状态；新增项目目录选择 IPC（`properties: ['openDirectory']`）；窗口创建补 `icon`（取 `applicationIconPath()`，关于面板与安装向导同源）；新增 `windowAttention` 处理器，按渲染端报来的等待数与自身焦点状态决定 `flashFrame`；首屏欢迎窗默认关闭（`WELCOME_ENABLED` 由 `DSH_DESKTOP_WELCOME=1` 开启），四处显示入口统一加闸；窗口创建补 `icon`（取新的 `applicationIconPath()`，关于面板与安装向导同源） | LCoder 要求自绘标题栏与项目目录选择。装配层（cordis patch / 插件配置）只能挂插件，改不了 `BrowserWindow` 选项；页面 CSS 也隐藏不了原生 caption。frameless 保留 `thickFrame`，拖边缩放与 Win+方向键不变。不显式给窗口 icon，Windows 任务栏与 Alt-Tab 就显示 Electron 默认图标 |
| `apps/desktop/src/ipc.ts` | 增加 windowCommand / windowState / windowStateChanged / windowAttention / projectDirectoryPick 五个私有通道与 DesktopWindowBridge 类型 | 窗口按钮、最大化态与目录选择需要 `ipcMain` 与 `BrowserWindow`；装配层拿不到这两样，必须由 Desktop 主进程提供通道 |
| `apps/desktop/src/preload-app.ts` | Windows app 文档下暴露 `dshDesktop.window`、标记 `data-lcoder-custom-chrome`，并停用 `syncWindowsAppearance` 的挂载；目录桥增加 `pickProjectDirectory`，窗口桥增加 `attention(awaiting)` | 该能力在隔离的 preload 上下文；profile/插件层无法向渲染进程注入 `contextBridge`，也卸不掉上游注入的 HTML menubar 与 40px 标题栏占位 |
| `packages/client/ui-layout/src/client/AppFrame.tsx` | 读取 `data-lcoder-custom-chrome`，把侧栏折叠宽度从 56px 收成 0 | 自绘标题栏后不再有 caption rail；不收起会留一条空轨道，外壳无法占满窗口 |
| `apps/desktop/tests/main-startup.spec.ts` | 窗口创建断言从 `titleBarOverlay` 改为 `frame: false`，补窗口命令/状态用例 | 行为变更必须由测试钉住 |
| `packages/client/ui-layout/src/client/AppFrame.tsx` | 自绘标题栏生效时（`data-lcoder-custom-chrome`）把左侧栏 rail 宽度归零、不再进 drawer 判定 | 壳自己画窗口按钮与顶部条后，上游那套 Windows caption 与图标 rail 的占位会让主面板缩进去；这是装配层无法覆盖的布局分支 |
| `packages/client/modules/src/assets.ts` | 资源 MIME 表增加 `.woff2` / `.woff` | 客户端资源路由原先只服务图片；LCoder 自托管的 Inter 字体必须由同一路由发出并带字体 MIME，插件/装配层改不了这张路由表 |
| `packages/client/modules/tests/assets.client.spec.ts` | 覆盖 `.woff2` / `.woff` 的 MIME 判定 | 新增字体资源类型必须有门禁钉住，防止路由回退 |
| `scripts/gen-third-party-notices.ts` | 生成物新增「Bundled font assets」段，登记 Inter 4.66、SIL OFL 1.1、来源与许可文件 | 生成器只扫 npm workspace 依赖，非 npm 的自托管字体不会被自动列出；装配层无法改仓库级声明生成器，字体又随包分发，必须在声明中体现 |
| `apps/desktop/tests/preload-app.spec.ts` | 删除 Windows appearance 挂载断言 | 该挂载已停用 |
| `apps/desktop/scripts/dev.ts` | 一行：`preparePrimaryRuntime()` 改成按 `DSH_DESKTOP_SKIP_RUNTIME_SMOKE=1` 传 `deferSmoke` | 运行时冒烟（打包 python 三条检查加 Office 往返）是发布验收口径，每次开发启动跑一遍要 100 到 143 秒；产物没变时的日常开窗需要一条跳过它的通道，装配层与 profile 都够不到 dev 脚本 |
| `apps/desktop/resources/icon.svg`、`icon-windows.svg`、`icon-macos.svg` 与对应 `icon.png`、`icon-windows.png`、`icon-macos.png`、`tray-windows.ico` | 上游鲸标整组换成 LCoder 标记（靛蓝渐变板 + 白色 L + 右上圆点）。`icon.svg` 保持 1104 画布、图块仍在 `translate(40 32)` 的 1024 位（web 侧 `apps/web/scripts/render-app-icons.ts` 按这套常量裁影）；`icon-windows.svg` 保持 1024 画布包 1104 空间并保留 `id="tray-glyph"` 组（托盘管线靠它注入放大） | 这是操作系统层面的产品品牌面：EXE 与任务栏图标、安装向导关于页、Windows 托盘 ICO、macOS dock 全部来自这几个文件。装配层与插件改不了 Electron 打包图标，也没有配置项能覆盖 |
| `apps/desktop/scripts/render-tray-icon.ts` | 只改措辞：文件头与一行注释里的 whale 改为 LCoder mark；管线、`TRAY_ICON_SIZES`、`tray-glyph` 注入与 1.2 倍放大全部不变 | 美术换掉后原措辞会误导下一次改图标的人去找鲸标 |
规矩：改动写在文件里的 `lcoder:` 前缀注释下，方便 grep 定位，也方便升级时用 `git diff upstream/master...HEAD -- <文件>` 一眼看清。

### T-105 开发启动复用（修改 2 个、新增 6 个）

预热态 `start-desktop -NoBuild` 实测 37.4 秒，其中约 35 秒重复做三件与产品无关的事：重建 1572 个 junction 的开发项目目录（2.1–2.9 秒）、重装 254MB 运行时 payload（26–33 秒）、同步拉起 Electron 只问一句 Node 版本（48–395 毫秒）。三处都在 dev 脚本里，装配层与 profile 都在 Electron 起来之后才生效，够不到；运行时侧也没有可挂的插件位。复用判据必须与建链/装配逻辑同源，因此改动只能在脚本内部，不能靠外部开关。输入未变时启动降到 5.9 秒。

| 文件 | 类型 | 改什么 | 为什么必须改 |
|---|---|---|---|
| `apps/desktop/scripts/development-project.ts` | 修改 | `DependencyLinkEntry` 与 `dependencyLinkEntries` 把链接枚举从建链逻辑里抽出来，建链与指纹共用一份；新增 `workspaceDependencyStamps`（workspace 依赖 realpath 与 package.json 戳）、`projectInputsDigest`（release、target、链接集合与链接戳、workspace 依赖戳、host 产物戳、生成器源码戳）、`projectReusable`（记录摘要 + 两处主链接 realpath 校验）；摘要命中直接返回，未命中才删目录重建并在末尾写 `.development-inputs.json`。CLI/Host 版本、`lib/index.js`、pnpm 链接目录的既有校验与报错原样保留 | 这个函数就是每次启动最贵的一步，判据必须与它自己建出来的东西同源（链接集合变了、workspace 依赖版本变了、生成器源码改了都要失效），放在调用方等于把同一套规则写两遍 |
| `apps/desktop/tests/development-project.spec.ts` | 修改 | 追加两个用例：输入未变时复用同一目录（目录 mtime 不变）、hoisted 依赖新增后重链并换摘要；`desktop-runtime.json` 或主链接被删后重建 | 复用是行为变更，没有测试钉住的话，以后改生成逻辑会静默留下过期目录，而开发启动看起来照常成功 |
| `apps/desktop/scripts/development-cache.ts` | 新增 | 缓存原语：`fileStamp`（mtime+大小）、`linkStamp`（不跟随 junction）、`treeDigest`、`inputsDigest`、`readCacheRecord`（缺失/截断/非对象一律当未命中）、`writeCacheRecord`（tmp+rename 原子写） | 三个复用点共用一套判据，避免各写一份戳格式；只服务 desktop 开发脚本，没有插件位可放 |
| `apps/desktop/scripts/electron-node-version.ts` | 新增 | 按 `electron.exe` 路径 + 大小 + mtime 缓存 `process.versions.node`，记录失效才同步拉起 Electron 探测，并对返回值做版本格式校验 | 这是远程模型/界面之外的纯本地探测，每次启动同步起一个 Electron 进程毫无收益；封装成独立函数才能让 dev.ts 少一个 `execFileSync` 依赖 |
| `apps/desktop/scripts/prepare-development-runtime.ts` | 新增 | `cacheInputs` 汇总 target、desktop 版本、pnpm 身份、`lock.json` 全文与戳、组装源码戳（`prepare.ts`、`prune-python-tests.ts`、`tool-workspace-dependencies/src/index.ts`、`prepare-primary-runtime.ts`）、Office 资产树摘要；`payloadReusable` 校验 `runtime.json` 六字段与 pythonPackages 并确认六处入口存在；未命中才动态导入 `prepare-primary-runtime.ts` 重建，`-Smoke` 时再动态导入 smoke 真实执行 payload | 原函数每次 rm 后重装整个 payload，是启动耗时的大头；复用记录放在 `.desktop-build/development/` 而不是 runtime 目录，避免多出一个文件进入打包产物；组装源码进摘要，上游改了装配逻辑会自动失效 |
| `apps/desktop/tests/development-cache.spec.ts` | 新增 | 覆盖戳的缺失/链接语义、记录只认完整对象、原子替换、目录树摘要顺序无关与内容敏感 | 缓存判据错了只会表现为「少重建一次」，没有测试很难发现 |
| `apps/desktop/tests/electron-node-version.spec.ts` | 新增 | 覆盖记录命中只探测一次、可执行文件变化或记录删除后复探、不可用版本报错 | 同上，探测失效会导致 release 指纹写错 Node 版本 |
| `apps/desktop/tests/prepare-development-runtime.spec.ts` | 新增 | 覆盖 `payloadReusable`：清单与入口齐全才复用，版本/`pythonPackages` 不符、缺入口、缺清单、截断 JSON、空目录一律重建 | 复用判据必须证明会拒绝失效 payload，否则会把坏运行时当成就绪 |

`apps/desktop/scripts/dev.ts`（已登记）本次追加：Node 版本探测改用缓存函数、运行时准备改调 `prepareDevelopmentRuntime`，并去掉对 `prepare-primary-runtime.ts` 的静态导入（命中路径不再加载 tar/extract-zip 链）。登记行不重复，改动见上表判据。

### 计划接触面（T-78 至 T-82）

以下文件已在 `contact-surface.txt` 登记。T-78 已落地的行标「已落地」；其余仍待对应任务。T-78 还会扩展上表已登记的 `apps/desktop/src/main.ts`、`ipc.ts`、`preload-app.ts`、`locale.ts`、`tests/main-startup.spec.ts` 与 `tests/expected/*.json`，不重复列行。

落地方式统一为「内部变量 + 上游默认值」：上游脚本读新的内部变量，读不到时保留上游字面量；LCoder 的值由 `apps/desktop/scripts/desktop-product-identity.mjs` 持有，由已登记的 `desktop-package-environment.mjs` 在加载发布配置时注入。这样上游 CI、更新资格自测与既有夹具都不必改动，同步上游时冲突面最小。代价是：只走 `pnpm package:desktop:*` 与 `upload:*` 这些经加载器的路径才拿到 LCoder 身份；绕过加载器直接调打包函数会得到上游身份。

| 文件 | 改什么 | 为什么必须改 |
|---|---|---|
| `apps/desktop/scripts/electron-builder-config.mjs` | 已落地：产品名、协议、产物前缀、更新缓存目录、打包后的产品名、麦克风说明、未签名更新开关 | 应用包身份与协议注册只在这里，插件与 profile 都改不了 |
| `apps/desktop/scripts/desktop-package-environment.mjs` | 已落地：把 `LCODER_*` 映射到内部变量并提供 LCoder 身份；本机默认应用标识改为 `ai.lansi.lcoder` | 目标 dotenv 加载器是本地打包与上传的唯一入口 |
| `apps/desktop/scripts/desktop-auto-update-environment.mjs` | 已落地：生产源改由环境提供（写死的 `download.deepseek.com` 已移除）、`lcoder-desk` 前缀、LCoder 固定下载文件名 | 更新目标与固定下载名由它解析 |
| `apps/desktop/scripts/desktop-auto-update-environment.d.mts` | 已落地：固定下载名声明增加可选 `env` 参数 | 类型面必须与实现同步，否则调用方拿不到新参数 |
| `apps/desktop/scripts/desktop-build-version.mjs` | 已落地：接受不继承上游产品版本的独立 LCoder 发布版本 | 现有校验强制构建版本继承 `0.2.2-alpha.2` |
| `apps/desktop/scripts/desktop-build-version.d.mts` | 已落地：发布版本常量、校验与完整版本校验的声明 | 类型面必须与实现同步 |
| `apps/desktop/scripts/package-target.ts` | 已落地：`lcoder-` 产物名与 macOS 应用路径 | 它命名 DMG 并驱动目标构建 |
| `apps/desktop/scripts/package-macos.ts` | 已落地：`LCoder.app` 包名与产物基名 | 它按名字复制与提升已签名应用 |
| `apps/desktop/scripts/desktop-upload-plan.ts` | 已落地：`lcoder-` 产物基名与固定下载 key | 上传校验会把文件名与已打包发布对齐 |
| `apps/desktop/scripts/desktop-edgeone.ts` | 已落地：固定下载名接收发布环境 | 刷新 URL 必须指向上传的同一个对象 |
| `apps/desktop/scripts/desktop-publish-config.ts` | 已落地：生产源校验从写死的上游下载源改为环境配置的 LCoder 源 | 当前守卫写死上游生产源 |
| `apps/desktop/scripts/desktop-release-tag.ts` | 已落地：`lcoder-v` 发布标签前缀 | 生产上传会给打包提交打标签 |
| `apps/desktop/tests/desktop-auto-update-environment.spec.ts` | 已落地：生产部署改为必须提供公开源 | 行为变更必须由测试钉住 |
| `apps/desktop/tests/desktop-package-environment.spec.ts` | 已落地：本机默认身份与 `LCODER_*` 契约 | 行为变更必须由测试钉住 |
| `apps/desktop/tests/desktop-upload-plan.spec.ts` | 已落地：生产作业环境声明 `DOWNLOAD_PROD_ORIGIN` | 生产源改由环境提供后，上传计划不再有内建默认源 |
| `apps/desktop/tests/upload-target.spec.ts` | 已落地：生产环境与 purge 桩声明 `DOWNLOAD_PROD_ORIGIN` | 同上，缓存刷新 URL 依赖环境提供的生产源 |
| `apps/desktop/tests/desktop-edgeone.spec.ts` | 已落地：生产刷新环境声明 `DOWNLOAD_PROD_ORIGIN` | 同源缺口：生产源改由环境提供 |
| `apps/desktop/src/single-instance.ts` | 第二实例回调带上参数 | 协议 URL 通过第二实例参数到达 |
| `apps/desktop/src/update-presentation.ts` | 呈现已安装版本与通道 | 设置页要显示版本与通道 |
| `apps/desktop/.env.windows.example` | 已落地：`LCODER_*` 变量名与 LCoder 应用标识 | 操作者从示例起步 |
| `apps/desktop/.env.macos.example` | 已落地：`LCODER_*` 变量名、LCoder 应用标识与未签名说明 | 操作者从示例起步 |

T-81 的真实上传、CDN 刷新与 T-82 的签名公证都只改发布配置与打包脚本；上游 CI 工作流首期不动，macOS 打包在用户机器上完成。

只走上游 CI 的产物名解析仍写死上游前缀，本期未改：`desktop-build-version-discovery.ts` 的产物正则、`retain-desktop-ci.ts` 的基名、`smoke-packaged-runtime.ts` 与 `verify-retained-desktop.ts` 的 `DeepSeek Harness.app`、`installed-update-*` 自测命名空间。它们不在 T-78 打包路径上；要让 CI 发布 LCoder 产物时再逐个登记改动。运行时侧 `src/main.ts` 的 `setAsDefaultProtocolClient('dsh')` 与 `dsh://open` 判定也保持上游值：安装包已按 `lcoder` 注册协议，运行时的协议路由与参数转交属 T-79/T-80。

---

## 4. 升级演练（每次上游有新版本时执行）

先跑体检，拿到「多少新提交、撞哪些接触面、哪几个是高危」再动手（退出码 0 表示没有新提交，1 表示有）：

```powershell
lcoder/scripts/upstream-sync-check.cmd
```

```sh
git fetch upstream
git checkout -b sync/upstream-<新版本> lcoder/main
git merge upstream/master
```

冲突处理顺序：

1. 先看冲突是否落在外面的接触面清单里。**不在清单里的冲突 = 有人偷偷改了上游，必须先评审再加进清单。**
2. 只保留我们那段（`lcoder:` 注释标记过的），其余全部接受上游。
3. 解决完跑门禁：

```sh
pnpm install
pnpm build
pnpm exec vitest run packages/lcoder
./lcoder/scripts/upstream-diff.sh
```

4. 全绿后合回 `lcoder/main`，更新第 1 节的基线与第 5 节的演练记录。

门禁没全绿，不许合并。半绿的合并会让"我们改了哪"这件事从此说不清。

---

## 5. 演练记录

| 日期 | 从 → 到 | 上游动了几个我们碰过的文件 | 冲突 | 处理 |
|---|---|---|---|---|
| 2026-11-02 | — | — | — | 初始化，尚未同步过 |

---

## 6. 防漂移的三条硬约束

1. **不直接 import 上游内部路径。** 只用 `@deepseek-ai/*` 的包导出。中间隔一层 `lcoder-kernel` 自己的 adapter——上游重构时只改 adapter，不动业务代码。
2. **改上游只改装配层。** 例如在 `apps/desktop` 的 client 组合里加一行挂载，而不是改它组件的内部实现。
3. **新增接触点必须人工评审。** `upstream-diff.sh` 只能告诉你"上游动了你碰过的东西"，判断不了"你这次是不是改深了"。
