# Office 与 Python 载荷裁剪（T-183）

状态：已落地并验证。依据是 T-179 的 [core set 裁剪调研](core-set-slice.md) 与用户 2026-11-14 的拍板——LCoder 不做 Office 转换与数据分析，两块载荷都不再随桌面端分发。本文记录基线、改动、实测字节、验证结果与未验项。

## 结论

- 主运行时载荷从 **266,660,010 B（254.3 MiB）降到 115,228,736 B（109.9 MiB）**，减少 **151,431,274 B（144.4 MiB）**，去掉的是 Python 3.12 解释器与 site-packages、以及 `office-skills` 资源。
- LibreOffice 引擎载荷（**190,527,948 B，181.7 MiB**）在打包物化阶段整族排除，不进 app。两项合计从解包应用里拿掉约 **342.0 MB**。
- Node（93,740,743 B）与 pnpm（21,487,737 B）原样保留；Electron dist（385,514,847 B）是地板，未动。
- 本树桌面实例启动正常，T-177 的七条 DOM 断言 **7/7 通过**，插件清单 211 条、0 条 `failed`。

## 称重基线

基线来自 2026-11-11 构建的 `apps/desktop/.desktop-build/targets/win-x64/runtime`（与主检出共享）与工作树 `node_modules`。都是**解包字节**，不是压缩后的安装包。

| 载荷 | 字节 | 说明 |
| --- | ---: | --- |
| 主运行时总计 | 266,660,010 | `runtime/` |
| `primary-runtime/` | 266,635,267 | |
| `dependencies/node` | 93,740,743 | Node 24.21.0，保留 |
| `dependencies/pnpm` | 21,487,737 | pnpm 11.28.5，保留 |
| `dependencies/python` | 151,406,186 | Python 3.12.14 + numpy/pandas/Pillow/lxml 等轮子 |
| `office-skills` | 24,743 | 宿主启动检查要求存在 |
| `@deepseek-ai/libreoffice-kit-win32-x64@0.1.5` | 190,527,948 | `asarUnpack` 整包解出 |
| `@deepseek-ai/libreoffice-kit@0.1.5` | 349,405 | 加载器 JS，不随引擎移除 |
| Electron dist 44.7.0 | 385,514,847 | 地板 |

- 本机没有 `unsigned-artifacts/` 或 `win-unpacked/`，`targets` 下只有一个 `runtime/` 目录。**本次没有跑 electron-builder 打包**（要重新下载 Electron、对 dsh 树做一次全量 pnpm install，并且会把产物写进与主检出共享的 `targets`）。因此安装包（NSIS）压缩后体积、`win-unpacked` 总字节均未实测。
- 替代口径：分别称「`extraResources` 会整目录拷贝的 `runtime/`」与「`runtime-file-policy` 会决定是否拷贝的引擎包」。这两个数字与真实解包字节一一对应，误差只在打包器的复制方式。

## 改动

### 载荷组成

- `scripts/primary-runtime/prepare.ts` 新增 `nodeOnly`：跳过 Python 归档、wheel 解包与 `office-skills` 复制；`pythonPackages` 写空映射，payload digest 格式升到 9（载荷字节变了，缓存必须失效）；CLI 增加 `--node-only`。
- 共享 manifest 规范（`packages/skill/tool-workspace-dependencies`，属不改的上游包）仍要求 `python` 字段，所以 node-only 载荷照 lock 写入版本号、声明空发行版映射；冒烟改成双侧校验：有解释器就必须有发行版记录，反之亦然。这样「半截载荷」仍然会响。
- 桌面侧：`prepare-primary-runtime.ts` 传 `nodeOnly: true`；`prepare-development-runtime.ts` 的复用判据只认 `runtime.json`、Node 与 pnpm 三个条目；`prepare-dsh.ts` 与 `runtime-file-policy.ts` 直接排除整族 `libreoffice-kit-*`；`electron-builder-config.mjs` 不再为引擎加 `asarUnpack`、也不再调用 `officePackageDirectories`。
- 发布冒烟 `smoke-runtime.ts` 去掉 Python fixture 与 Office 往返，保留 CLI 离线装插件、宿主启动、前端与插件路由。

### 宿主启动检查

- `apps/desktop-host/src/office.ts` 与 `office-engine.ts` 删除：前者在启动时挂 `load_workspace_dependencies`、要求 `office-skills` 存在并解析引擎 CLI；后者是 ASAR 内的引擎解析钩子。
- `installOfficeEngineResolution` 与 `ctx.plugin(desktopOffice)` 一并移除；宿主 argv 从 6 个降到 5 个（runtimeDir、projectDir、pnpm、nodeBin）。
- `runtimeArchivePath`（通用的 ASAR 定位）迁到 `apps/desktop-host/src/runtime-archive.ts`，`cli.ts` 与 `smoke-prepared-runtime.ts` 继续使用。
- `apps/desktop/src/main.ts`、`host-process.ts` 不再传 `primaryRuntime`；`dev.ts` 不再注入 `DSH_DESKTOP_PRIMARY_RUNTIME_DIR`。

### 依赖边

- `apps/desktop-host/package.json`：删 `@deepseek-ai/libreoffice-kit`、`@deepseek-ai/dsh-skill-office`、`@deepseek-ai/dsh-tool-workspace-dependencies`。
- `apps/cli/package.json`：删 `@deepseek-ai/dsh-skill-office`、`@deepseek-ai/dsh-tool-workspace-dependencies`（`sdk-app` 自己声明这两条，SDK profile 不受影响）。
- `pnpm-lock.yaml` 用 `pnpm install --lockfile-only` 同步（15 行删除，只改 importer，不重装 node_modules）。
- 没有动 `packages/bundle/web-app` → `ui-sidebar-documentpreview` / `office-to-pdf` 那条链：`office-to-pdf` 的插件行在 profile 里仍是禁用状态，引擎缺失时这条路径不可用；要连 JS 包一起排掉属于 T-179 的下一层级，不在本任务。

## 实测（裁剪后）

| 载荷 | 字节 | 变化 |
| --- | ---: | --- |
| 主运行时总计 | 115,228,736 | −151,431,274 |
| `dependencies/node` | 93,740,743 | 0 |
| `dependencies/pnpm` | 21,487,737 | 0 |
| `runtime.json` | 256 | 新增记录（空发行版映射） |
| `dependencies/python` | — | 移除 |
| `office-skills` | — | 移除 |
| LibreOffice 引擎族 | — | 打包物化时排除（−190,527,948） |

- 合计从解包应用里移除 341,959,222 B（约 326.1 MiB）。
- `runtime.json` 内容：`{"python":"3.12.14","node":"24.21.0","pnpm":"11.28.5","pythonPackages":{}}`。

## 验证

本树（pool-slot-2）独立实例：渲染 9823、主进程 9831、宿主 9832、mock cloud 9833，`DSH_HOME` 与 `userData` 都在仓内 `.desktop-build/development`。以下是裁剪当时的初次验收；合入主线后的复核见下一节。

| 项 | 结果 |
| --- | --- |
| 桌面实例启动 | 通过；`dsh web:` 就绪，日志无插件激活失败 |
| T-177 七条 DOM 断言 | **7/7**：登录态、外壳根、打开仓库、外壳五页（requirements/tasks/projects/project-info/settings）、任务详情、设置页、会话发一条消息 |
| 插件清单 | `pluginInventory/list` 211 条：184 active、27 disabled（`fiberPhase: null`）、**0 failed** |
| 会话消息 | 用户消息进入 transcript |
| 运行时冒烟 | `smokePrimaryRuntime` 走 node+pnpm；Python 三段执行按设计跳过 |

- 为了不碰共享 `targets`，本次把本树的 `apps/desktop/.desktop-build/targets` 从 junction 换成本地目录（先拷贝既有 runtime，再由新的准备逻辑重写）。共享目录里的 slot-1 与主检出未受影响。
- 门禁：`pnpm run typecheck` 0；`apps/desktop` + `apps/desktop-host` + `scripts/primary-runtime` 目标 spec 266 通过；`packages/lcoder` 1119 通过；`build:artifacts` 与 `build:check` 0。

### 合入主线后的复核（2026-11-14 晚）

- 以 merge-forward 并入主检尖端（merge 提交在 `git log` 可见）。主检自 merge-base 起没有改 `apps/desktop`、`apps/desktop-host`、`apps/cli`、`scripts/primary-runtime`，合入内容是新客户端包与文档；裁剪面没有语义冲突。
- `pnpm install --frozen-lockfile` 通过（1756 条供应策略条目），锁无需重生成。`build:artifacts` 8/8（45 秒）、`build:check` 2/2、`typecheck` 5/5、`packages/lcoder` 93 个 spec / 1121 条通过。
- 定向测试 `apps/desktop` + `apps/desktop-host` + `scripts/primary-runtime`：2074 通过、25 红。同一批 25 红在主检出同一点逐条复现（welcome/fatal-recovery 快照仍写 DeepSeek Harness 而品牌已改 LCoder、`DOWNLOAD_PROD_ORIGIN` 缺 `.env.windows`、`vswhere.exe`/`tar`/`npm --recursive` 本机工具链），属既有红，不是裁剪引入。
- 实例复核（本树 pool-slot-1，端口 9842/9849/9850、mock 云 9841；原定的 9822/9829 已被 pool-slot-2 实例占用）：T-177 七条 DOM 断言 **7/7**；`pluginInventory/list` 211 条（184 active、27 disabled、**0 failed**）；`runtime.json` 仍是 node-only 空发行版映射。
- 载荷字节与裁剪时一致：`runtime/` 115,228,736 B，其中 node 93,740,743、pnpm 21,487,737；无 `dependencies/python`、无 `office-skills`。`smokePrimaryRuntime` 退出 0，只输出载荷内 pnpm 11.28.5。
- 新客户端不受影响：`@lcoder/desktop`、`@lcoder/client` 产物齐全，用独立 `DSH_HOME`（仓内 `.dsh-home`）与端口 9862/9869/9870 起窗，页面标题 LCoder、`data-theme=liquid-glass`、五页与「宿主就绪」均渲染；验后已停。
- `smoke.cmd` 的 `window.up` 探针查 `div[data-theme]`，该属性自 2026-11-10 皮肤切换起已从外壳根移除，因此这条一键冒烟在合入主检后对旧外壳必红；本轮改用 `lcoder/logs/t178-seven-dom.mjs` 的七条断言（临时副本把渲染端口改成 9842），没有改脚本本身。

## 加回路径

这一节只写怎么恢复，不代表要恢复。裁剪本身没有删除 lock 里的任何下载锁，也没有删除 skill-office / workspace-dependencies 的源码与包，所以回退是「改回几处开关」，不是重新设计。

### 1. 依赖边与 package.json 字段

| 文件 | 恢复内容 |
| --- | --- |
| `apps/desktop-host/package.json` | `dependencies` 加回三条：`"@deepseek-ai/libreoffice-kit": "^0.1.5"`、`"@deepseek-ai/dsh-skill-office": "workspace:*"`、`"@deepseek-ai/dsh-tool-workspace-dependencies": "workspace:*"` |
| `apps/cli/package.json` | `dependencies` 加回两条：`"@deepseek-ai/dsh-skill-office": "workspace:*"`、`"@deepseek-ai/dsh-tool-workspace-dependencies": "workspace:*"` |
| `pnpm-lock.yaml` | 两条 package.json 改完后跑一次 `pnpm install --lockfile-only`（或常规 install）让 importer 重新记录；不要手改 lock |

- 其余字段（`scripts`、`files`、`devDependencies`）本次没有删过，不需要恢复。
- 没有动 `packages/bundle/web-app` → `ui-sidebar-documentpreview` / `office-to-pdf` 这条链；`office-to-pdf` 的插件行一直在 profile 里，恢复依赖边与宿主检查后它即可重新加载（当前该行仍是禁用状态，需按 profile 策略单独打开）。

### 2. runtime 准备与 lock 字段

- `scripts/primary-runtime/lock.json` **一个字都没删**：`pythonVersion`、`pythonRelease`、每个 target 的 `pythonTarget`/`pythonSha256`、`wheels`、`pythonPackages` 全部在；13 个归档（4 个 win 轮子 + 9 个共享轮子 + Node 压缩包）在下载缓存里也都在。恢复载荷不需要重新生成 lock。
- `scripts/primary-runtime/prepare.ts`：`nodeOnly` 分支保留即可作为回退开关。恢复 = 桌面载体不再传 `nodeOnly`；全量分支仍会解包 Python、铺 wheel、执行 `prunePrimaryRuntimePythonTests`、复制 `office-skills`，并写 13 项 `pythonPackages`。
- `apps/desktop/scripts/prepare-primary-runtime.ts`：删掉 `nodeOnly: true` 与那行 `lcoder:` 注释。
- `apps/desktop/scripts/prepare-development-runtime.ts`：`PayloadIdentity` 加回 `python`、`pythonPackages`；`payloadEntries` 加回 `<payload>/dependencies/python/python.exe`（Windows）或 `bin/python3`、`Lib|lib/python3.12/site-packages`、以及 `../office-skills`；`cacheInputs` 加回 `officeAssets()`（连同 `treeDigest` 导入）；`CACHE_FORMAT` 再 +1。
- `apps/desktop/scripts/prepare-dsh.ts`、`runtime-file-policy.ts`：去掉对 `@deepseek-ai/libreoffice-kit-*` 的整族排除，恢复 `selectOfficeEngine` 选引擎与「缺引擎即失败」的校验。
- `apps/desktop/scripts/electron-builder-config.mjs`：恢复引擎的 `asarUnpack` 模式与 `beforePack` 里的 `officePackageDirectories(...)`（否则引擎即使装回来也不会解出 ASAR）。
- `apps/desktop/scripts/smoke-runtime.ts`、`smoke-prepared-runtime.ts`、`macos-runtime.ts`：恢复 Python fixture 生成、Office 往返三条（DOCX/XLSX/PPTX → PDF）与 skill CLI 冒烟；mac 签名加回 LibreOffice 二进制的 JIT 授权规则。
- 载荷落点：恢复后应出现 `targets/win-x64/runtime/primary-runtime/dependencies/python`、`targets/win-x64/runtime/office-skills`，`runtime.json` 的 `pythonPackages` 为 13 项。

### 3. 宿主启动检查与 host 冒烟

| 文件 | 恢复内容 |
| --- | --- |
| `apps/desktop-host/src/office.ts`、`office-engine.ts` | 从 T-183 裁剪提交的父提交取回：`git show "$(git log --format=%H --grep '裁剪 Office 与 Python' -1)^:apps/desktop-host/src/office.ts" > apps/desktop-host/src/office.ts`（另一个同理） |
| `apps/desktop-host/src/index.ts` | 恢复两个 import、`installOfficeEngineResolution(runtimeDir)`、把主运行时目录放回 `process.argv[4]` 并让 `packageManager` 回到 `argv[5]`/`argv[6]`、恢复 `await ctx.plugin(desktopOffice, { runtimeDir, source, root })` |
| `apps/desktop/src/host-process.ts` | 恢复 `primaryRuntime` 形参，argv 恢复为 runtimeDir、projectDir、primaryRuntime、pnpm、nodeBin |
| `apps/desktop/src/main.ts` | 恢复 `developmentPrimaryRuntime()`、`primaryRuntime`（打包态取 `resources/runtime/primary-runtime`），并传给 `DesktopHostProcess` |
| `apps/desktop/scripts/dev.ts`、`test-workspace-updates.ts` | 恢复 `DSH_DESKTOP_PRIMARY_RUNTIME_DIR: developmentRuntimeDirectory()` 注入 |
| `apps/desktop-host/src/cli.ts` | 恢复 `runDesktopCli(runtimeDir, supportDir)` 形参与 `installOfficeEngineResolution(runtimeDir)` |
| `apps/desktop-host/tests/office.spec.ts`、`office-engine.spec.ts` 与相关断言 | 从同一个父提交取回，同步 host-process / main-startup 的 argv 期望 |

- 宿主启动检查的实质是：`office.ts` 要求同级的 `office-skills` 存在，并把 `load_workspace_dependencies` 与 Office 技能一起挂回模型面；`office-engine.ts` 负责让 ASAR 内的引擎路径在原生子进程里可用。两者缺一，打包态 Office 能力仍然不可用。

### 4. 回退演练（已验证）

只验证「锁与资产仍然完整、全量载荷还能重新铺出来」，不改任何代码：

```sh
node --import tsx scripts/primary-runtime/prepare.ts --target win-x64 \
  --output "$LOCALAPPDATA/Temp/t183-restore" \
  --cache apps/desktop/.desktop-build/downloads
```

- 2026-11-14 实测：退出码 0；输出目录 **266,816,477 B**，其中 `dependencies/python` 151,562,653 B、`dependencies/node` 93,740,743 B、`dependencies/pnpm` 21,487,737 B、`office-skills` 24,743 B；`runtime.json` 记录 `python: 3.12.14`、13 项发行版；日志末尾出现 Python 校验、`pip check`、Office 读写往返与 pnpm 版本输出。
- `--cache` 指向本机既有的归档缓存；换一台机器时省掉该参数即可，构建器会在默认缓存目录下载并校验 SHA-256。
- 与 2026-11-11 的存量基线（266,660,010 B）相差 156 KB（0.06%），来自重新解包的文件集与文件系统统计差异，量级一致。
- 合入主检后复跑同一命令（2026-11-14 晚）：退出码 0；总量 266,817,611 B，`dependencies/python` 151,563,787 B、`office-skills` 24,743 B、node/pnpm 不变；`runtime.json` 记录 `python: 3.12.14` 与 13 项发行版；日志出现 `No broken requirements found.`、`Office runtime versions and document round trips passed.` 与 pnpm 11.28.5。加回路径在合并后的树上仍可用。
- 全代码回退则是 `git revert --no-edit "$(git log --format=%H --grep '裁剪 Office 与 Python' -1)"` 后跑 `pnpm install --lockfile-only && pnpm run build:artifacts`：依赖边、宿主插件、打包过滤与冒烟项一起回来，下次启动会按全量载荷重新准备。

### 以后只想按需提供时参照的机制

- 上游的现成机制是 **ON_DEMAND_BUNDLES**：清单在 `packages/util/official-bundles/src/bundles.ts`，生成物是 `packages/util/official-bundles/src/catalog.generated.ts` 的 `OFFICIAL_ON_DEMAND_CATALOG`（每项带 `packageName`、`meta`、`platforms`）。消费入口是 `packages/boot/plugin-manager/src/index.ts`：`readBundles()` 把目录并进插件清单，`installBundle` 用随包的 pnpm 从 npm 现装进当前 profile。`@deepseek-ai/dsh-cua-bundle` 就是现成例子（标了 `platforms: ['darwin']`，清单里默认不列）。
- LCoder 要按需提供 Office，入口应是自己的一条 catalog 条目 + 一个 LCoder 拥有的 bundle：把 `libreoffice-kit` 声明成该 bundle 的依赖，安装时由 pnpm 把平台包（npm optional dependency）拉下来。两点边界要先说清：其一，目录是生成的，加条目要改生成器而不是手改生成物；其二，**Python 不是 npm 包**，pnpm 装不了，仍需要 `scripts/primary-runtime` 那套带锁的下载器，或者让按需 bundle 只覆盖不需要 Python 的转换能力。
- 按需安装会把字节写进 profile（用户目录），不影响安装包体积，但也意味着离线环境、磁盘配额与「卸载后残留」都要另行设计；本次不做。

## 未验项

- 未跑 electron-builder：NSIS 安装包与 `win-unpacked` 的真实字节、压缩比没有实测；181.7 MiB 是引擎包在本机磁盘上的字节（本树 `node_modules` 里该包仍是 190,527,948 B），打包器复制方式与之等价但未逐文件核对。
- 未跑打包后的宿主冒烟（`smokeDesktopRuntime`）：它需要 `targets/electron` 与完整 dsh 树，本机没有这两样。
- 打包前置也被本机配置挡住：`pnpm --filter @deepseek-ai/dsh-desktop run check:package` 直接报 `cannot read apps/desktop/.env.windows`；该文件要放下载域、发布标识与 Windows 签名工具链，本机没有，也不该由实现线临时造。`targets/win-x64` 下只有 `runtime/`，没有 `electron/`、`dsh/` 与 `package-set/`。
- 未验 macOS：darwin 的签名清单里不再有 LibreOffice JIT 授权，mac 打包与签名流程未在本机执行。
- 未验 `dsh --profile sdk` 与 `--profile headless`：它们从 `sdk-app` / 各自 bundle 取 `skill-office` 与 `tool-workspace-dependencies`，依赖仍在库里，但没有跑这两个 profile。
- Python SDK 的 exe 路径仍走完整载荷（`--python-only` / 默认全量），本次未改也未验其产物。
- `smoke.cmd` 对当前外壳已失效（`div[data-theme]` 在 2026-11-10 皮肤切换后不存在）；本轮没有改它，旧外壳验收走 `t178-seven-dom.mjs`。
