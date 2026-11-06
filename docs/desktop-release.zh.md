# LCoder 桌面发布

[English](desktop-release.md) | 中文

## 0. 目的与权威

本文件是 LCoder 桌面发布事实的唯一来源：产品身份、更新源、更新体验、签名缺口、发布流程、macOS 适配矩阵、上游接触面，以及落实这些内容的开发任务拆分。代码、打包脚本与发布配置按这些事实实现；上游发布文档若写了不同的目标地址或身份，以本文件为准约束 LCoder 发布。

开发台账仍是 `docs/tasks.yaml`，产品数据仍是 `.spec/`。`apps/desktop/packaging/` 与 `apps/desktop/publishing/` 下的上游文档只描述 DeepSeek Harness 的上游事实，本文件不转抄。下文所有主机名、桶名、账号 ID 与证书主体都是占位值；真实值只存在被忽略的发布配置里，绝不进入本仓库。

## 1. 产品身份

### 1.1 应用身份

| 字段 | LCoder 取值 |
|---|---|
| 产品名 | LCoder |
| Windows 可执行文件 | LCoder.exe |
| macOS 应用包 | LCoder.app |
| 应用标识 | ai.lansi.lcoder |
| URL 协议 | lcoder |
| Windows 安装目录 | %LOCALAPPDATA%\Programs\LCoder |
| macOS 包标识 | ai.lansi.lcoder |
| 图标 | 已登记在接触面里的 LCoder 图标组 |
| 更新缓存目录 | lcoder-updater |
| 版权行 | Copyright © LCoder |

应用标识由 `LCODER_APP_ID` 提供，并映射到现有的 `DSH_DESKTOP_APP_ID` 输入。产品名、协议名与产物前缀是打包配置里的 LCoder 默认值，不是每台机器的设置。Windows 安装器、开始菜单项、卸载项、关于面板、macOS 应用包名与 Dock 名称都从同一个产品名派生，所以只改一处就会改掉全部可见身份。

### 1.2 版本方案

LCoder 发布版本独立于上游基线 `0.2.2-alpha.2`。源码清单保留上游版本，上游同步不会在版本行上冲突；发布版本在打包时由 `LCODER_RELEASE_VERSION` 提供，并成为已安装应用版本、产物版本与 feed 版本。LCoder 从 `0.1.0` 起算。

只有下列形式是合法发布版本：

```
0.1.0
0.1.1
0.1.1-nightly.20261106.1
```

稳定通道只接受不带预发布后缀的版本。nightly 通道接受稳定版本或预发布版本。版本号永不复用，在同一个通道内永不回退。通道在打包时封入安装包；已安装应用保持自己的通道、不切换，所以从 nightly 转到 stable 必须安装稳定包。

关于面板与设置页更新区显示已安装版本、上游基线版本，以及有记录时的打包提交。没有提交记录的构建只显示发布版本。

### 1.3 用户数据、日志与迁移

| 平台 | 应用数据 | 日志 |
|---|---|---|
| Windows | %APPDATA%\LCoder | %APPDATA%\LCoder\logs |
| macOS | ~/Library/Application Support/LCoder | ~/Library/Logs/LCoder |

LCoder 从全新的应用数据开始。它不迁移、不复制、不重命名、不删除 DeepSeek Harness 数据、`~/.dsh` 或任何机器级安装。开发者仍使用 [PROJECT-RULES.zh.md](PROJECT-RULES.zh.md) 所述的仓库内 home 与仓库内 Electron 用户数据，所以开发启动永远不会写已安装应用目录。

崩溃报告、插件操作记录、更新日志与语言缓存都放在应用数据目录下。从旧 DeepSeek Harness 目录手工拷贝不受支持、也未验证，不属于任何发布说明。

### 1.4 深链接与单实例

- 唯一支持的深链接是 `lcoder://open`；它聚焦主窗口，应用没有窗口时创建主窗口。
- 未知的 `lcoder://` 路径同样只聚焦主窗口，绝不执行参数、打开网址或启动任务。任务级路由已预留但未实现。
- Windows 与 Linux 通过第二实例的参数表交付后一次启动；macOS 通过 `open-url` 交付。两条路径汇入同一个处理器，启动完成前到达的 `open-url` 事件会缓存，窗口出现后再重放。
- 单实例锁仍是生命周期第一步。第二个进程转发参数后退出，只有持有者进程读写应用数据。

## 2. 更新源

### 2.1 COS 与 CDN 目标

| 项 | 值 |
|---|---|
| COS 桶 | lcoder-download-0000000000（占位） |
| COS 地域 | ap-shanghai（占位） |
| 公开源 | https://download.example.com（占位） |
| 生产对象前缀 | lcoder-desk/ |
| 测试对象前缀 | lcoder-desk/&lt;release-id&gt;/ |
| 目标 | win-x64、mac-arm64、mac-x64 |

公开源只允许 HTTPS。桶只对发布操作者开放；客户端只读 CDN 源，绝不读 COS 端点。测试与生产使用不同凭据。上传只有在完成包记录、目标、版本、文件名、大小与 SHA-512 都校验通过后才读取凭据。

### 2.2 对象布局

```
lcoder-desk/feeds/win-x64/nightly.yml
lcoder-desk/feeds/win-x64/latest.yml
lcoder-desk/feeds/mac-arm64/nightly-mac.yml
lcoder-desk/feeds/mac-arm64/latest-mac.yml
lcoder-desk/feeds/mac-x64/nightly-mac.yml
lcoder-desk/feeds/mac-x64/latest-mac.yml
lcoder-desk/bin/<target>/lcoder-<version>-<os>-<arch>.<ext>
lcoder-desk/latest/lcoder-latest-windows-x64.exe
lcoder-desk/latest/lcoder-latest-macos-arm64.dmg
lcoder-desk/latest/lcoder-latest-macos-x64.dmg
lcoder-desk/<release-id>/feeds/<target>/*
lcoder-desk/<release-id>/bin/<target>/*
```

- 发布产物名为 `lcoder-<version>-<os>-<arch>.<ext>`，操作系统取 `win` 或 `mac`。Windows 发布 NSIS `.exe`；macOS 发布用于安装的 DMG 与用于更新的 ZIP。
- Windows 与 macOS 的 ZIP 更新载荷旁边都带 `.blockmap`。DMG 不是更新载荷，不带 blockmap。
- 测试 release ID 是 32 位小写十六进制字符。它在打包、上传、重试与升级测试期间保持不变；已安装测试客户端保留该 feed，不会自动发现新 ID。
- 生产发布永不删除旧版本对象。保留它们才能在需要时回滚 feed，而不必重新打包。

### 2.3 通道

| 通道 | 接受的版本 | 受众 | feed 文件 |
|---|---|---|---|
| latest | 仅稳定版 | 内部稳定测试者，T-82 之后面向公众 | latest.yml、latest-mac.yml |
| nightly | 稳定版或预发布版 | 内部测试 | nightly.yml、nightly-mac.yml |

通道封入已安装应用。`allowPrerelease` 只对 nightly 开启，`allowDowngrade` 永远关闭，含预发布版本的 latest feed 在上传前即被拒绝。nightly 构建永远不会通过改 feed 名变成稳定发布；晋升要按稳定版本重新打包同一份源码，并发布新产物。

### 2.4 打包进应用的 app-update.yml

```
provider: generic
url: https://download.example.com/lcoder-desk/feeds/win-x64/
channel: nightly
updaterCacheDirName: lcoder-updater
```

每个包封入一个 generic provider，URL 是该目标的 feed 目录，通道是安装通道。Windows 的该文件由 electron-builder 生成；macOS 在签名前写入、打包后校验。没有该文件的包报告「未配置更新源」，而不是去查默认服务器。未签名包默认不带该文件；§4 所述的实验性开关是唯一例外。

### 2.5 环境变量

| LCoder 变量 | 内部变量 | 用途 |
|---|---|---|
| LCODER_APP_ID | DSH_DESKTOP_APP_ID | 应用标识 |
| LCODER_UPDATE_ENV | DSH_DESKTOP_AUTO_UPDATE_ENV | 选择 test 或 production 目标 |
| LCODER_UPDATE_CHANNEL | DSH_DESKTOP_UPDATE_CHANNEL | 选择 latest 或 nightly |
| LCODER_RELEASE_VERSION | DSH_DESKTOP_BUILD_VERSION | 独立的 LCoder 发布版本 |
| LCODER_DOWNLOAD_ORIGIN | DOWNLOAD_TEST_ORIGIN | 测试公开源 |
| LCODER_DOWNLOAD_BUCKET | DOWNLOAD_TEST_COS_BUCKET 或 DOWNLOAD_PROD_COS_BUCKET | 选中的 COS 桶 |
| LCODER_DOWNLOAD_SECRET_ID | DOWNLOAD_TEST_COS_SECRET_ID 或 DOWNLOAD_PROD_COS_SECRET_ID | 选中的 COS SecretId |
| LCODER_DOWNLOAD_SECRET_KEY | DOWNLOAD_TEST_COS_SECRET_KEY 或 DOWNLOAD_PROD_COS_SECRET_KEY | 选中的 COS SecretKey |
| LCODER_DOWNLOAD_RELEASE_ID | DOWNLOAD_TEST_RELEASE_ID | 测试发布目录 |
| LCODER_DOWNLOAD_EO_ZONE_ID | DOWNLOAD_PROD_EO_ZONE_ID | 生产 CDN 刷新地域 |
| LCODER_PRODUCT_NAME | DSH_DESKTOP_PRODUCT_NAME | 产品名与应用包名 |
| LCODER_PROTOCOL_SCHEME | DSH_DESKTOP_PROTOCOL_SCHEME | 深链接协议 |

LCoder 变量名是发布配置契约。打包环境加载器里的一步别名映射把它们映射到上游脚本已经读取的内部变量名，打包代码的其余输入保持不变。目标 dotenv 文件使用 LCoder 变量名；真实密钥绝不进入仓库。内部变量名只作内部使用，不构成第二份公开契约。

### 2.6 缓存、上传与回滚

- 先传二进制与 blockmap，再传通道 YAML，YAML 最后传。feed 永远不会指向尚不可读的对象。
- feed 与固定下载元数据必须不缓存；二进制与 blockmap 可作为不可变内容缓存一年。缓存策略归 COS 桶与 CDN 配置所有，因为上传器有意不设置 `Cache-Control`。
- 生产固定下载与回滚 feed 需要在上传后提交 CDN 刷新。提交受理不等于刷新完成；发布操作者要先查 CDN 任务历史，再宣布发布。
- feed 回滚是重新发布指向旧二进制的旧 YAML。固定下载回滚是把旧安装器重传到固定对象。两种操作都不删除对象。
- 客户端永不降级。回滚保护的是尚未更新的用户；已经在新版本上的用户要靠更高的热修版本修复。
- 撤下测试批次要删除该发布目录并刷新对应 CDN 目录。release ID 的格式校验不能证明随机性；必须用安全随机生成器。

## 3. 更新体验

### 3.1 自动检查与手动检查

- 首个窗口可见且工作区就绪后，LCoder 先等 20 秒，再加 0 到 10 秒随机抖动，然后执行第一次自动检查。这样启动流量与首屏绘制互不打扰。
- 自动检查每 6 小时一次，检查失败后指数退避，最长 1 小时。应用回到前台或从睡眠恢复时加入同一截止时间，不另起并行请求。
- 设置页与应用菜单都提供手动检查。手动请求绕过截止时间、加入正在进行的检查，并让失败可见。
- 下载或安装进行中不启动检查；关闭应用不会取消用户可见的错误报告。

### 3.2 状态

| 状态 | 显示 | 可用动作 |
|---|---|---|
| idle | 当前版本、上次检查结果 | 立即检查 |
| checking | 检查中指示 | 无；请求加入正在进行的检查 |
| available | 新版本号与发布通道 | 确认后下载 |
| downloading | 百分比与已传大小 | 取消由原生确认框负责 |
| verifying | 正在准备下载的包 | 无 |
| ready | 版本已就绪、需要重启 | 确认后安装并重启 |
| error | 操作、分类原因、可展开的技术细节 | 重试失败的操作 |
| unsupported | 无更新源；未签名或开发构建 | 手动下载说明 |

### 3.3 规则

- 安装永不静默。`autoDownload` 与 `autoInstallOnAppQuit` 保持关闭；用户先确认下载，再单独确认重启。
- 自动检查失败只留一个小状态指示；手动检查失败弹出本地化摘要与可展开技术细节。
- 网络失败与 feed、下载、安装失败分开归类，所以离线机器显示离线提示，而不是「包损坏」。
- 已安装通道与版本始终可见。界面不提供通道切换，因为已安装应用下换 feed 不是受支持的升级路径。
- 未签名内部构建显示「自动更新不可用」，并指向手动下载位置。它绝不说未签名更新已经验证。
- 上游桌面壳的强制更新策略仍是独立的服务端驱动面。它不启用静默安装，也不是 LCoder 的发布通道。

## 4. 签名缺口

### 4.1 Windows 未签名

- 未签名的 NSIS 安装器与可执行文件没有 Authenticode 签名。Windows SmartScreen 会显示未知发布者警告，部分受管机器会按策略阻止下载或启动。
- 安装器是每用户安装、不需要提权，所以用户接受警告后仍可安装并运行未签名构建。
- 更新包按 feed 里的 SHA-512 校验，而不是按代码签名校验。机制上可能装上未签名更新，但本仓库没有验收过这条路，也不作承诺。
- 内部实验可以设置 `LCODER_UNSIGNED_UPDATER=1`，让未签名包封入 feed。该开关默认关闭，不是受支持的分发路径，两端的更新结果仍未验证。
- 未签名 Windows 构建是内部测试产物。它不是公开分发产物，也不得被描述成公开分发产物。

### 4.2 macOS 未签名

- 未签名 macOS 构建使用 ad-hoc 签名。下载后 Gatekeeper 会附加 quarantine 属性，首次正常启动会以「无法验证开发者」拒绝。
- 从 DMG 直接打开应用可能触发 App Translocation，应用从随机只读路径运行。更新无法替换那份副本；用户必须先把应用移入 `/Applications`。
- 用户可以用访达的「打开」绕过 Gatekeeper，或移除 quarantine 属性，但发布说明必须讲清安全后果，且不得把构建说成已公证。
- Squirrel.Mac 在应用更新时比较代码签名。ad-hoc 签名每个构建都不同，所以未签名 macOS 自动更新预计会失败或被拒绝。这条路径未验证，不作承诺。
- 未签名 macOS 构建是内部测试产物。它不是公开分发产物；让它可公开分发所需的 Developer ID 与公证由 T-82 负责。

### 4.3 T-82 的退出条件

- Windows 需要代码签名证书、对安装器与可执行文件的 Authenticode 签名，以及更新元数据里可验证的发布者名。
- macOS 需要 Developer ID Application 证书、强化运行时、公证，以及分发 DMG 与应用上的已 stapling 票据。
- 验收要求 `codesign --verify --deep --strict`、`spctl -a -vv`、`xcrun stapler validate` 全过，带 quarantine 的下载在干净机器上首次启动成功，并从上一个已签名版本升级成功。
- 在 T-82 收口前，所有 LCoder 构建只在内部流转，设置页必须如实写明。

## 5. 发布流程

### 5.1 发布前门禁

- 发布提交上 `pnpm typecheck`、`pnpm lint`、`pnpm exec vitest run packages/lcoder`、`pnpm run build` 与 `pnpm run test:docs` 全绿。
- 一台干净的 Windows 机器与一台干净的 macOS 机器安装候选包，打开仓库、跑一次对话、执行一条已登记命令。
- 上一个已发布版本在同通道升级到候选版本，或在发布说明里注明升级路径未演练。
- 宣布发布前，从公开源读回 feed 文件、blockmap、SHA-512 与固定下载。
- 包记录写明源码提交以及工作区是否脏；脏工作区打出的包永远不发布到 latest。

### 5.2 发布步骤

1. 选定通道与发布版本，并在打包前把两者记入发布历史。
2. 用 LCoder 构建版本与目标通道打包一个目标；不得复用为其他通道打出的产物。
3. T-82 可用时签名并公证；否则把产物标为未签名、仅内部使用。
4. macOS 打包用于安装的 DMG 与用于更新的 ZIP，Windows 打包 NSIS 可执行文件，并把 blockmap 放在更新载荷旁边。
5. 先传二进制与 blockmap，再传通道 YAML；逐个校验公开 URL 与 feed 内容。
6. 在干净机器上安装已发布产物；通道已有用户时，完成一次从上一版本的升级。
7. 最后发布或重指固定下载，提交生产 CDN 刷新，并在公开读回成功后打发布标签。

### 5.3 回滚

- 重新发布上一个通道 YAML，并确认它仍指向可读的二进制；较新的对象原样保留。
- 把固定下载重指到上一个安装器，并对该 URL 提交 CDN 刷新。
- 不删除失败版本。它是下一次修复的证据，也保留诊断已安装客户端的可能。
- 已安装新版本的客户端不能降级。发布更高的热修版本；回滚只服务尚未更新的客户端。

## 6. macOS 适配矩阵

| 方面 | 需要的改动 | 文件 | 验收方式 |
|---|---|---|---|
| 原生窗口 chrome | 保留 `hiddenInset` 红绿灯，在 LCoder 顶栏左侧留出空位，隐藏 Windows 窗口按钮组，保留拖拽区与双击缩放 | apps/desktop/src/main.ts、apps/desktop/src/preload-app.ts、packages/lcoder/workspace/src/client/shell/Shell.tsx、Shell.module.css、window-chrome.ts | 截图里红绿灯不与品牌和项目选择器重叠；拖拽、双击缩放与全屏可用 |
| 应用菜单 | 保留 macOS 应用、文件、编辑与窗口菜单；去掉仅 Windows 的项；每个标签都本地化 | apps/desktop/src/main.ts、apps/desktop/src/locale.ts | 菜单快照测试通过；人工检查没有仅 Windows 的项 |
| Dock 与托盘 | macOS 不装菜单栏托盘；Dock 图标与 Dock 重开是返回路径；关窗后应用保持运行 | apps/desktop/src/main.ts、apps/desktop/resources/icon-macos.png | Dock 图标是 LCoder；关掉最后一个窗口后应用仍在运行；点 Dock 能重开 |
| 键盘快捷键 | 通过原生 role 保留 Cmd+C、Cmd+V、Cmd+A、Cmd+Z、Cmd+W 与 Cmd+Q；不展示仅 Ctrl 的加速键 | apps/desktop/src/main.ts、packages/lcoder/workspace/src/client/shell/Shell.tsx | 每个快捷键在真实窗口可用；标签显示 Cmd 而非 Ctrl |
| 文件对话框 | 项目选择使用原生目录选择 sheet；接受 POSIX 路径且没有盘符 | apps/desktop/src/directory-picker.ts、apps/desktop/src/main.ts、packages/lcoder/workspace/src/client | 项目选择器打开 sheet，选中的路径能加载仓库 |
| 路径大小写与分隔符 | 使用平台路径 API；比较前用原生 realpath 归一工作区路径；不全局小写化 POSIX 路径 | packages/lcoder/workspace/src/client/scheduling.ts、packages/lcoder/kernel/src 的路径辅助 | 用不同大小写打开同一仓库得到同一个工作区；测试覆盖两种分隔符 |
| Shell 与命令执行 | POSIX 使用 `/bin/sh`；登记命令保持 POSIX 兼容；超时时杀掉整个进程组，避免孙进程残留 | packages/lcoder/kernel/src/tools/edit-tools.ts | 会派生子进程的登记命令在超时后不留下孤儿进程 |
| profile 的 documentsDirectory | 把写死的 Windows 路径换成两平台都存在的环境提供目录；Windows 规避保持有效 | lcoder/desktop-profile.patch.yml、lcoder/scripts/start-desktop.sh、lcoder/scripts/prepare-profile.mjs、lcoder/RUN.md | 两平台桌面启动都能应答工作区初始化；`storages/workspace.json` 登记出默认工作区 |
| Git 工具 | 用 `git -C <root>` 加仓库相对路径；不假设 CRLF，也不假设已装 Windows Git | packages/lcoder/kernel/src/tools/git-tools.ts | 状态、差异与提交在 macOS 检出上无路径错误 |
| 字体 | 系统预设先用平台中立字体栈，再列仅 Windows 字体；现代预设保留 Inter 与 Noto Sans SC | packages/lcoder/workspace/src/client/shell/Shell.module.css | macOS 实际渲染为 PingFang SC 或系统 UI 字体；深浅两套截图 |
| 协议注册 | 在 macOS 应用包注册 `lcoder`，并把 `open-url` 路由到单实例处理器 | apps/desktop/scripts/electron-builder-config.mjs、apps/desktop/src/main.ts | 运行中执行 `open lcoder://open` 能聚焦；冷启动也能打开 |
| 单实例 | 把第二次启动的参数（含协议 URL）转给持有者进程 | apps/desktop/src/single-instance.ts、apps/desktop/src/main.ts | 第二次启动不产生第二个窗口，并聚焦持有者 |
| 数据与日志目录 | 验证由产品名派生的 macOS 应用数据与日志路径；不写 `~/.dsh` | apps/desktop/src/main.ts、docs/desktop-release.zh.md | 应用数据出现在 `~/Library/Application Support/LCoder`；日志在 `~/Library/Logs/LCoder` |
| 更新 feed 与安装包格式 | 使用 `*-mac.yml`，ZIP 作更新载荷、DMG 作安装包，DMG 内不放 blockmap | apps/desktop/scripts/package-macos.ts、desktop-auto-update-environment.mjs | feed 指向 ZIP 及其 blockmap；干净 DMG 安装成功 |
| 架构覆盖 | arm64 与 x64 各自匹配 Electron、Node 运行时、ripgrep 与 Office 载荷；记录构建机实际覆盖的架构 | apps/desktop/scripts/package-target.ts、apps/desktop/scripts/prepare-primary-runtime.ts | 两个产物都能启动；捆绑二进制的 `file` 与 `lipo -info` 显示预期架构 |
| quarantine 与 Gatekeeper | 记录未签名首次启动步骤、translocation 与缺少公证；绝不标成已公证 | docs/desktop-release.zh.md、lcoder/RUN.md | 带 quarantine 的未签名 DMG 在干净 Mac 上按步骤可用；界面能看到限制 |

## 7. 接触面

### 7.1 最小接触面规则

- 复用已有的环境驱动应用标识与发布 URL，而不是把 LCoder 值写死进打包脚本。
- 通过带 LCoder 默认值的受校验环境输入注入产品名、协议与产物前缀，让上游默认行为保持可读，并让身份只有一个所有者。
- 增加一步别名映射，把 LCoder 环境变量名映射到上游脚本已读取的内部名；不跨发布脚本重命名内部变量。
- 首期不碰上游组件内部与 CI 工作流。macOS 打包在用户机器上执行；CI 发布是后续决定。
- 每个被修改的上游文件都要在 `lcoder/contact-surface.txt` 与 [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md) §3 登记后才能落地。

### 7.2 上游文件

| 文件 | 计划改动 | 为什么必须改 |
|---|---|---|
| apps/desktop/scripts/electron-builder-config.mjs | 产品名、协议、产物前缀、打包后的产品名、麦克风说明、未签名更新开关 | 该文件拥有应用包身份与协议注册；插件或 profile 都改不了 |
| apps/desktop/scripts/desktop-package-environment.mjs | 把 `LCODER_*` 映射到内部名；修改本机 macOS 默认应用标识 | 目标 dotenv 加载器是本地打包与上传的唯一入口 |
| apps/desktop/scripts/desktop-auto-update-environment.mjs | LCoder 源、`lcoder-desk` 前缀、固定下载文件名 | 该文件解析全部更新目标与固定下载名 |
| apps/desktop/scripts/desktop-build-version.mjs | 接受不继承上游产品版本的独立 LCoder 发布版本 | 上游校验器强制每个构建版本继承 `0.2.2-alpha.2` |
| apps/desktop/scripts/package-target.ts | LCoder 产物名与 macOS 应用路径 | 它命名 DMG 并驱动目标构建 |
| apps/desktop/scripts/package-macos.ts | LCoder 应用包名与产物基名 | 它按名字复制与提升已签名应用 |
| apps/desktop/scripts/desktop-upload-plan.ts | LCoder 产物基名与固定下载 key | 上传校验会把文件名与已打包发布对齐 |
| apps/desktop/scripts/desktop-publish-config.ts | LCoder 生产源校验 | 当前生产守卫要求上游下载源 |
| apps/desktop/scripts/desktop-release-tag.ts | LCoder 发布标签前缀 | 生产上传会给打包提交打标签 |
| apps/desktop/src/main.ts | 协议、参数路由、延迟启动检查、产品名、更新呈现字段 | 主进程拥有协议注册、更新调度与原生窗口 |
| apps/desktop/src/single-instance.ts | 把第二次启动参数传给聚焦回调 | 协议 URL 通过第二实例参数到达 |
| apps/desktop/src/ipc.ts | 在更新呈现里加已安装版本与通道 | LCoder 设置页要显示它们 |
| apps/desktop/src/update-presentation.ts | 投影已安装版本与通道 | 呈现层保持为主进程状态的纯转换 |
| apps/desktop/src/preload-app.ts | 在 macOS 暴露平台标记或窗口桥 | LCoder 外壳需要为红绿灯留位 |
| apps/desktop/src/locale.ts | 更新、版本、未签名、离线与手动检查文案 | 外壳可见文案来自这份桌面文案单源 |
| apps/desktop/.env.windows.example | LCoder 变量名与 LCoder 应用标识 | 该示例是操作者的起点 |
| apps/desktop/.env.macos.example | LCoder 变量名、LCoder 应用标识与未签名说明 | 该示例是操作者的起点 |
| apps/desktop/tests/main-startup.spec.ts | 协议、启动检查与窗口期望 | 行为变化必须由测试钉住 |
| apps/desktop/tests/expected/about-panel.json | LCoder 版本与身份字段 | 关于面板期望跟随身份改动 |
| apps/desktop/tests/expected/application-menu-en-US.json | LCoder 标签与 macOS 菜单形态 | 菜单夹具必须与产品一致 |
| apps/desktop/tests/expected/application-menu-zh-CN.json | LCoder 标签与 macOS 菜单形态 | 菜单夹具必须与产品一致 |

### 7.3 新增的 LCoder 文件

| 文件 | 用途 |
|---|---|
| apps/desktop/scripts/desktop-product-identity.mjs | 产品名、协议、产物前缀与应用标识默认值的唯一受校验来源 |
| lcoder/releases.yaml | LCoder 发布历史：版本、通道、目标、源码提交、产物摘要、日期、状态 |
| lcoder/scripts/start-desktop.sh | macOS 与 Linux 开发启动脚本，配置仓库内 home 与 profile |
| lcoder/scripts/prepare-profile.mjs | 跨平台拷贝 profile，解析文档目录与包链接 |
| docs/desktop-release.md | 本事实源及其中文配对 |

## 8. 任务拆分

| 任务 | 范围 | 依赖 | 验收 |
|---|---|---|---|
| T-77 | 本设计包：身份、更新源、体验、签名缺口、发布流程、macOS 矩阵、接触面、任务拆分 | T-76 | 文档、规则与台账更新；文档门禁全绿 |
| T-78 | 身份与更新源：产品名、应用标识、协议、产物名、独立版本、COS 路径、环境别名、未签名更新开关 | T-77 | Windows 未签名包显示 LCoder 身份、可安装、能路由 `lcoder://open`、数据路径为 LCoder；真实上传不演练 |
| T-79 | 更新体验：设置区、版本与通道显示、延迟启动检查、手动检查、全部状态、未签名不可用状态 | T-78 | 深浅主题下每个状态的桌面截图；日志证明延迟检查；无静默安装 |
| T-80 | macOS 适配与未签名打包：窗口、菜单、Dock、快捷键、对话框、路径、shell、git、字体、协议、数据目录、arm64 与 x64 的 DMG/ZIP | T-78 | 两个架构在用户的 Mac 上启动；打开仓库；跑一次对话与一条命令；限制有文档 |
| T-81 | COS 与 CDN 流水线：路径、别名、上传、固定下载、blockmap、缓存策略、刷新、回滚、dry-run、测试 | T-78 | 本地校验与 dry-run 通过；测试桶真实上传成功后才能谈生产 |
| T-82 | Windows 与 macOS 签名公证：证书、Authenticode、Developer ID、公证、stapling、从上一签名版本升级 | T-80、T-81 | 干净机器首次启动与签名升级通过全部平台检查 |

## 9. 未验边界

- 未签名 macOS 自动更新未验证，且因 ad-hoc 签名逐构建变化而预计失败或被拒绝。不作承诺。
- macOS x64 产物在真实 Intel 硬件或干净 Rosetta 环境跑过之前未验证。
- 未签名 Windows 自动更新未验证；受管机器上的 SmartScreen 行为未知。
- 真实 COS 上传、CDN 缓存、CDN 刷新、DNS、TLS 与桶权限在发布凭据和生产源就绪前未验证。
- 已签名的 macOS 分发被 T-82 的 Apple Developer ID 与公证工作阻塞。
- 从 DeepSeek Harness 安装迁移数据到 LCoder 不受支持且未验证。
- macOS 麦克风、录屏与辅助功能权限弹窗不在本设计范围，需要真机走查。
