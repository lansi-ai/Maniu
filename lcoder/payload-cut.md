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

本树（pool-slot-2）独立实例：渲染 9823、主进程 9831、宿主 9832、mock cloud 9833，`DSH_HOME` 与 `userData` 都在仓内 `.desktop-build/development`。

| 项 | 结果 |
| --- | --- |
| 桌面实例启动 | 通过；`dsh web:` 就绪，日志无插件激活失败 |
| T-177 七条 DOM 断言 | **7/7**：登录态、外壳根、打开仓库、外壳五页（requirements/tasks/projects/project-info/settings）、任务详情、设置页、会话发一条消息 |
| 插件清单 | `pluginInventory/list` 211 条：184 active、27 disabled（`fiberPhase: null`）、**0 failed** |
| 会话消息 | 用户消息进入 transcript |
| 运行时冒烟 | `smokePrimaryRuntime` 走 node+pnpm；Python 三段执行按设计跳过 |

- 为了不碰共享 `targets`，本次把本树的 `apps/desktop/.desktop-build/targets` 从 junction 换成本地目录（先拷贝既有 runtime，再由新的准备逻辑重写）。共享目录里的 slot-1 与主检出未受影响。
- 门禁：`pnpm run typecheck` 0；`apps/desktop` + `apps/desktop-host` + `scripts/primary-runtime` 目标 spec 266 通过；`packages/lcoder` 1119 通过；`build:artifacts` 与 `build:check` 0。

## 未验项

- 未跑 electron-builder：NSIS 安装包与 `win-unpacked` 的真实字节、压缩比没有实测；181.7 MiB 是引擎包在本机磁盘上的字节，打包器复制方式与之等价但未逐文件核对。
- 未跑打包后的宿主冒烟（`smokeDesktopRuntime`）：它需要 `targets/electron` 与完整 dsh 树，本机没有这两样。
- 未验 macOS：darwin 的签名清单里不再有 LibreOffice JIT 授权，mac 打包与签名流程未在本机执行。
- 未验 `dsh --profile sdk` 与 `--profile headless`：它们从 `sdk-app` / 各自 bundle 取 `skill-office` 与 `tool-workspace-dependencies`，依赖仍在库里，但没有跑这两个 profile。
- Python SDK 的 exe 路径仍走完整载荷（`--python-only` / 默认全量），本次未改也未验其产物。
