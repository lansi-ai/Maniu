# Core set 裁剪调研（T-179）

状态：调研完成。未执行打包、未删除任何包、未改依赖声明与发布脚本。本文只回答四个减重维度中的「安装包与磁盘体积」；构建速度与维护风险只在候选分级里附带说明。

## 结论

- core set 仍是 333 个包 / 9,962 个受控文件 / 68.17 MiB 受控源码，口径与 `lcoder/closure-audit.md` 一致，即 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-desktop-host` 的打包依赖闭包。
- 这 333 个包里 276 个（54.24 MiB）从桌面启用装配可达；56 个（12.83 MiB）只由 `apps/cli` 的依赖声明带入，桌面装配既不挂载也解析不到；剩下 1 个是 `@deepseek-ai/dsh` 自身（1.10 MiB）。可排包候选只在后 56 个里。
- 安装包体积不由这 68.17 MiB 源码决定。本机既有构建产物实测：主运行时载荷解包后 268 MiB（Node 90 + Python 157 + pnpm 22），Office 转换载荷 libreoffice-kit-win32-x64 另有 184 MiB，Electron dist 368 MiB。333 个包是 JS 代码，量级小一个数量级。
- A 级可安全排包 11 个包 / 1.28 MiB 源码（非桌面 CLI 形态与小工具），收益小但不动产品路径；B 级两块：可选能力 bundle 45 个包 / 11.55 MiB 源码，Office 与 Python 载荷约 341 MiB 解包字节；C 级是运行必需面，不动。
- 未做真实打包称重，因此所有「安装包能省多少」都没有实测数字；下一任务第一件事应是建立称重基线。

## 口径

- 包数与字节来自 `lcoder/scripts/audit-package-closure.mjs` 的 `--json` 输出，统计对象是 `git ls-files` 的受控文件，不含 `node_modules`、`lib`、`dist`、`.git`。这是源码面口径，不是安装包口径。
- core set 成员列表不在审计 JSON 里，用脚本导出的 `discoverPackages`、`attachDependencyEdges`、`corePackageSetClosure` 三个函数复算，与审计输出逐项对得上（333 / 9,962 / 68.17 MiB）。
- 功能分组按目录与包名映射：`plugin-manager|plugin-inventory|plugin-package-inventory|plugin-market|plugin-recommendations|creation-recommendations` 归插件市场；`client` 与 `apps/web` 归客户端 UI；`document` 与 `skill-office` 归 office；`llm` 归模型；`terminal|browser-use|computer-use` 归浏览器与终端；`native|python` 归 python 与 native；`telemetry|feedback|identity` 归遥测与反馈；`apps|host|boot|bundle|sdk|acp|vendor|cordis` 归桌面壳与打包；`core|session|session-query|context|compaction|preset|interaction|api|typert|storage|workspace|settings|credentials|attachment|spill|deliverables` 归核心循环与会话；`shell|fs|subprocess|sandbox|skill|web|mcp|lsp|jobs|todo|plan|goal|schedule|workflow|guard|ptc-runtime|extensions|util|subagent` 归工具与运行时；其余 experimental 归上方实验能力，最后剩下归其他。
- 「可达」的算法：从 208 行装配清单里启用的插件包出发，沿 `dependencies`、`peerDependencies`、`optionalDependencies` 与包内 cordis YAML 的插件名递归，另加 `dsh-base`、`dsh-web-app`、`dsh-app-boot`、`official-bundles`、`home-paths`、`launch-environment`、`desktop-host` 七个启动根。故意不展开 `@deepseek-ai/dsh` 自身的依赖边，否则它的依赖列表会让整个闭包自证可达。
- 平台过滤：审计脚本不按 `os`/`cpu` 过滤，win-x64 打包时 `selectDesktopPackageClosure` 会剔除 4 个非 Windows 原生包（`native/system/packages` 下的 darwin-arm64、darwin-x64、linux-arm64、linux-x64）。所以真实 win-x64 core set 是 329 个 workspace 包，文中按 333 的口径讨论，差值单列。
- 磁盘测量来自本工作树既有产物：`apps/desktop/.desktop-build/targets/win-x64/runtime/primary-runtime`（2026-11-11 构建）与根 `node_modules/.pnpm`。这些是解包后字节，与安装包（压缩后）不是一回事。

## 一、333 包的构成

| 分组 | 包数 | 受控文件 | 受控字节 |
| --- | ---: | ---: | ---: |
| 核心循环与会话 | 86 | 1,968 | 12.85 MiB |
| 模型与 provider | 8 | 268 | 2.08 MiB |
| 客户端 UI | 62 | 3,385 | 23.93 MiB |
| 工具与运行时 | 82 | 1,586 | 10.77 MiB |
| 桌面壳与打包 | 30 | 722 | 4.23 MiB |
| python 与 native | 5 | 33 | 0.05 MiB |
| 遥测与反馈 | 4 | 62 | 0.21 MiB |
| 插件市场 | 13 | 358 | 2.87 MiB |
| 浏览器与终端 | 4 | 78 | 0.55 MiB |
| office | 2 | 57 | 0.21 MiB |
| 其他（上游实验能力） | 37 | 1,445 | 10.42 MiB |
| 其他 | 0 | 0 | 0 B |
| 合计 | 333 | 9,962 | 68.17 MiB |

按装配角色再切一刀，结论更直接。

| 角色 | 包数 | 受控文件 | 受控字节 | 判定依据 |
| --- | ---: | ---: | ---: | --- |
| 桌面启用装配可达 | 276 | 7,897 | 54.24 MiB | 从启用插件出发的依赖闭包可达，运行需要 |
| 只由 `apps/cli` 声明 | 56 | 1,864 | 12.83 MiB | 桌面装配不可达；`dsh` 的依赖列表是唯一入边 |
| `@deepseek-ai/dsh` 自身 | 1 | 201 | 1.10 MiB | 桌面宿主用它启动 profile |

- 208 行装配里有 191 个不同包，其中 189 个在 core set；`@maniu/kernel`、`@maniu/workspace` 与两个客户端工具包不在闭包里，属 LCoder 自有面。
- 客户端 UI 最大（23.93 MiB）且几乎都可达，因为 `@deepseek-ai/dsh-web-app` 的 139 条 `dependencies` 把整套客户端插件都声明了。profile 里禁用某个插件不会让它离开安装包。
- 其他（上游实验能力）10.42 MiB 与插件市场 2.87 MiB 合计 13.29 MiB，几乎全部落在不可达的 56 个包里，是本次最主要的可裁面积。

## 二、安装包真正的体积构成（实测解包字节）

| 载荷 | 解包字节 | 来源 | 是否随包 | 依据 |
| --- | ---: | --- | --- | --- |
| Electron dist | 368 MiB | `node_modules/.pnpm/electron@44.7.0/dist` | 是 | 桌面壳本体，地板 |
| libreoffice-kit-win32-x64 | 184 MiB | `node_modules/.pnpm/@deepseek-ai+libreoffice-kit-win32-x64@0.1.5` | 是 | `office-to-pdf` 与 `skill-office` 依赖；asarUnpack 明确包含它 |
| Python 3.12 + 轮子 | 157 MiB | `targets/win-x64/runtime/primary-runtime/dependencies/python` | 是 | 锁定在 `scripts/primary-runtime/lock.json`，含 numpy、pandas、Pillow、lxml、python-docx、python-pptx、openpyxl |
| Node 24.21.0 | 90 MiB | 同目录 `dependencies/node` | 是 | 进 `runtime/bin`，作为宿主与工具子进程 PATH 上的 node |
| pnpm 11.28.5 | 22 MiB | 同目录 `dependencies/pnpm` | 是 | 插件安装与包操作 |
| office-skills 资源 | 48 KiB | `targets/win-x64/runtime/office-skills` | 是 | 宿主启动时若不匹配会失败 |
| dsh 运行时（333 包） | 未测 | `targets/win-x64/dsh/node_modules` | 是 | 源码受控字节 68.17 MiB；安装后字节未称重 |
| 主运行时小计 | 268 MiB | — | 是 | Node + Python + pnpm |
| 前端静态资源 | 含在 dsh 树 | `apps/web` 5.05 MiB 源码 | 是 | 由 `dsh-web-frontend` 提供 |

- 合起来，解包后的应用目录是 800 MiB 量级；333 个包的源码只占其中零头。想减安装包，必须动载荷，光排 JS 包收效有限。
- 安装包（NSIS 或 dmg）的压缩后体积没有实测，压缩比未知，本文不估算。
- `libreoffice-kit-win32-x64` 是第三方 npm 包，不是 workspace 包，审计脚本本来就不统计它；它也不在 333 里，但确实进安装包。

## 三、可裁候选

分级口径：A 表示桌面产品没有任何路径依赖、改动只是删依赖声明；B 表示需要产品拍板或需要改代码、改运行时装配；C 表示运行必需，本阶段不动。

### A 级：可安全排包（11 个包，1.28 MiB 源码，224 个文件）

所有条目的唯一依赖者是 `apps/cli/package.json`（`@deepseek-ai/dsh` 的 `dependencies`）；profile 的 208 行装配里没有任何一行引用它们的插件 id，也没有任何其他 workspace 包依赖它们（acp 集群内部除外）。

| 候选（入口边） | 带入包 | 包数 | 受控字节 | 断掉的产品路径 | 是否在 core 闭包 | 改动代价 |
| --- | --- | ---: | ---: | --- | --- | --- |
| `@deepseek-ai/dsh-acp-app` | acp-app、acp、mcp-client | 3 | 0.52 MiB | `dsh --profile acp` 不可用；桌面无 ACP 入口 | 是 | 改 `apps/cli/package.json` 1 条，登记接触面 |
| `@deepseek-ai/dsh-headless` | headless | 1 | 0.18 MiB | `dsh --profile headless` 与脚本化批处理不可用 | 是 | 同上 |
| `@deepseek-ai/dsh-sdk-app` + `sdk-minimal` | sdk-app、sdk-minimal、sdk-jsonrpc-server、sdk-protocol | 4 | 0.44 MiB（并集） | JSON-RPC SDK 接口不可用；两个 SDK 客户端连不上 | 是 | 改 2 条依赖 + 保留模板常量需同步处理 |
| `@deepseek-ai/dsh-tool-str-replace-editor` | 同名 | 1 | 0.07 MiB | 该编辑工具在桌面装配里本来就没有挂载行 | 是 | 改 1 条依赖 |
| `@deepseek-ai/dsh-tmux-context` | 同名 | 1 | 0.05 MiB | tmux 上下文插件没有任何装配行 | 是 | 改 1 条依赖 |
| `@deepseek-ai/dsh-agent-tool-presentation` | 同名 | 1 | 0.02 MiB | 工具呈现模式插件未挂载 | 是 | 改 1 条依赖 |

- 说明：`mcp-client` 在 acp 集群里被一起带入，但它还有 `apps/cli` 的直接边。如果产品继续保留 MCP 能力，应只删 `mcp-client` 之外的三条，另见 B 级。
- 说明：`sdk-app` 还依赖 `skill-office`、`tool-workspace-dependencies` 等包，这些包同时被其他路径可达，所以并集只有 0.44 MiB，不是逐项相加。
- 逐入口的数字会重叠（例如 `mcp-client` 同时属于 acp 集群与自己那条边），合计以并集为 1.28 MiB 为准。
- 代价的共同部分：`apps/cli/package.json` 目前不在 `lcoder/contact-surface.txt`，删边属于新增接触点，按 `docs/PROJECT-RULES.md` §1 需要人工复核并登记。`pnpm-lock.yaml` 会随 `pnpm install` 变化。上游 `dsh` npm 包的语义会变（少四条依赖），LCoder 不发布这个包，风险落在本地打包与 `verify-default-product-isolation` 门禁。

### B 级：需产品拍板或需改代码

| 候选 | 涉及包数 | 受控字节 | 解包字节 | 为什么需要拍板 | 需要改什么 |
| --- | ---: | ---: | ---: | --- | --- |
| 15 个可选能力 bundle（liveshare、inspector、forge、agent-team、voice-input、cot-translation、auto-review、session-search、ralph、terminal、badge-skill、session-titles、tool-worktree、plugin-market、personalized-recommendations） | 45 | 11.55 MiB | 未测 | 它们是「随包携带、默认关闭、由插件管理器开启」的离线能力目录；T-177 的切片把插件管理器一并关了，但切片还没接进发布流程，当前装配仍会列出这些开关 | 删 `apps/cli/package.json` 15 条边 + 从 `packages/util/official-bundles/src/bundles.ts` 的 `OPTIONAL_BUNDLES` 删同名项；`verify-default-product-isolation` 门禁要求每个条目都是 dsh 的运行时依赖，两边必须同步 |
| Office 载荷：`office-to-pdf` + `skill-office` + `libreoffice-kit-win32-x64` | 2 个 workspace 包 | 0.21 MiB | 184 MiB | LCoder 的 `packages/lcoder/*` 完全不引用 office；T-177 第一波已计划关掉 `office-to-pdf`；宿主启动强制要求 `office-skills` 资源存在（`apps/desktop-host/src/office.ts`） | 改 `apps/desktop-host/package.json` 与 `apps/cli/package.json`、`dsh-web-app` 依赖；改 `apps/desktop-host/src/office.ts` 的启动检查与 `apps/desktop/src/main.ts` 的 `primaryRuntime` 传递；改 runtime 准备与 host 冒烟；不发布 `libreoffice-kit` 平台包 |
| Python 运行时 | — | — | 157 MiB | 它的模型面入口是 `load_workspace_dependencies` 与 office/data 技能；当前桌面装配里 `tool-workspace-dependencies` 没有挂载，`skill-filesystem` 与 `tool-skill` 都是禁用，等于今天没有消费者 | 改 `scripts/primary-runtime/prepare.ts` 与 `lock.json`、`runtime.json` 的 `python`/`pythonPackages` 字段、`packages/skill/tool-workspace-dependencies` 与宿主冒烟 |
| pnpm 运行时 | — | — | 22 MiB | 只服务插件安装与包操作；与插件市场去留同命运 | 与插件市场一起决策；改 `main.ts` 的 `runtimeResources` 与宿主包操作入口 |
| `mcp-client` | 1 | 0.23 MiB | 未测 | MCP 服务器支持；当前 `mcp-resources` 挂载但 `mcp-client` 未挂载，桌面实际连不上 MCP 服务器 | 单独删 1 条依赖，或先把 MCP 接通再保留 |
| 内置终端 `terminal` + `terminal-bash` | 2 | 0.29 MiB | 未测 | T-177 第二波已关掉终端页签与 `terminal-controller`，但包仍在装配依赖里 | 删 `apps/cli/package.json` 2 条边（`sdk-minimal` 也引用它们，需同处理） |
| 遥测与反馈 4 包（otel、command-feedback、message-feedback、anonymous-user-id） | 4 | 0.21 MiB | 未测 | 字节收益低于 0.3 MiB，动机是隐私而不是体积；砍掉后 `/feedback` 与埋点消失 | 改 4 条依赖 + 3 行 profile 禁用；不建议为体积单独做 |
| 插件市场 13 包 | 13 | 2.87 MiB | 未测 | 与 15 个可选 bundle 重叠；T-177 已把插件管理两行关掉 | 与可选 bundle 同批处理 |
| Node 运行时 | — | — | 90 MiB | 宿主与工具子进程的 node；桌面本身用 Electron 的 `runAsNode`。删掉会改模型可见的工具面 | 不建议裁；如需裁要先验证 `runtime/bin` 的所有消费方 |

- Office 与 Python 两块合计 341 MiB 解包字节，是这份清单里最大的两块。它们的共同前提是产品确认「不做 Office 文档处理与数据分析」，不是纯打包配置能解决的。
- LibreOffice 的 184 MiB 现状：`office-to-pdf` 仍是一行启用的装配（第 145 行），所以预览路径理论上还在；但 LCoder 外壳没有文档预览页签（T-177 第二波已把 `ui-sidebar-documentpreview` 排进裁剪），产品侧看不到它。

### C 级：不动（运行必需）

- 客户端 UI 62 个包 / 23.93 MiB：外壳的 slots、locale、connection、ui-session、ui-renderer、ui-workspace 与 `dsh-web-app` 的依赖面。T-177 已证明单独禁用插件只会缩小传输量，不会缩小安装包；要让它们离开安装包得改 `dsh-web-app` 的依赖声明，等于重做 bundle 组成，属下一个层级的设计。
- 核心循环与会话 86 个包 / 12.85 MiB：agent-loop、session、api、typert、storage、settings、credentials 等，全部是会话与设置页的承重面。
- 工具与运行时 82 个包 / 10.77 MiB（除已单列的终端、MCP、str-replace）：fs、shell、sandbox、skill、web、subagent、jobs 等，模型工具面依赖它们。
- 模型与 provider 8 个包 / 2.08 MiB：`llm`、`llm-deepseek*`、`llm-pi-ai`、`token-meter` 等，会话必需。
- 桌面壳与打包 30 个包 / 4.23 MiB：含 `@deepseek-ai/dsh`、`dsh-desktop-host`、cordis 家族、`dsh-base`、`dsh-web-app`、`dsh-app-boot`、directory picker 与 `dsh-web-frontend`。
- python 与 native 5 个包 / 0.05 MiB：win-x64 只会保留 `@deepseek-ai/node-addon-system` 入口包，另外 4 个平台包在选包阶段就按 `os`/`cpu` 剔除，字节可忽略，不值得单独立项。
- LSP：`packages/lsp/*` 三个包本来就不在 core 闭包里（`lcoder/closure-audit.md` 的 59 个非运行时包之一），删源码不影响安装包；要保持的是「别把它加回 `dsh` 的依赖」。
- 浏览器与 computer-use：`packages/browser-use/*`、`packages/computer-use/*` 不在 core 闭包里；`dsh-cua-bundle` 属 `ON_DEMAND_BUNDLES`，从 npm 现装。也就是说内置浏览器与电脑操作今天不进安装包。
- web search：`web`、`web-search-deepseek`、`web-deepseek-api`、`web-fetch-http`、`tool-web` 五个包 0.52 MiB。四行装配启用、`tool-web` 禁用；保留（C），删除会改变模型的搜索能力，收益只有半 MiB。

### 指定项的去留依据（汇总）

| 项 | 分级 | 依据 |
| --- | --- | --- |
| Python 运行时 | B | 157 MiB，装配里无消费者；但官方技能与 `load_workspace_dependencies` 是它的入口，删要改 runtime 准备与宿主启动检查 |
| native 系统插件 | C | 5 个包 0.05 MiB，win-x64 只留入口包，其余按平台剔除 |
| office-to-pdf | B | 0.11 MiB 源码，但拖着 184 MiB LibreOffice；LCoder 无任何引用，T-177 已计划关闭该行 |
| 浏览器与终端 | C（终端为 B） | 浏览器与 computer-use 不在闭包；终端 0.29 MiB 在闭包但装配已无页签消费 |
| 遥测 | B | 4 包 0.21 MiB，体积收益极小，动机是隐私 |
| 插件市场 | B | 13 包 2.87 MiB，与可选 bundle 同批 |
| LSP | C | 已不在 core 闭包，零安装包收益 |
| MCP | B（mcp-client） | 0.23 MiB，只差一条依赖；`mcp-resources` 属 C |
| web search | C | 0.52 MiB，四行启用，属模型能力面 |
| computer-use | C | 不在 core 闭包，ON_DEMAND 现装 |

## 四、试点方案

### P0 称重基线（下一任务第一步，本任务未执行）

还没做过一次真实打包称重，后续所有收益都要用这个尺子量。命令与产出：

```sh
pnpm --filter @deepseek-ai/dsh-desktop package:win:x64:unsigned
```

- 产出目录 `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/`：一个 NSIS 安装包（体积记为安装包口径），一个 `win-unpacked/`（体积记为安装后口径）。
- 同一次构建还会留下 `targets/win-x64/dsh/node_modules/@deepseek-ai/*` 与 `targets/win-x64/runtime/primary-runtime/dependencies/*`，用来做逐包归因。
- 需要记录的账：安装包字节；`win-unpacked` 总字节；`resources/app.asar`、`resources/app.asar.unpacked/dsh`、`resources/runtime/primary-runtime/dependencies/{node,python,pnpm}`、`resources/runtime/office-skills` 各自字节；`targets/win-x64/dsh/node_modules/@deepseek-ai/*` 的逐包字节 TOP 30。
- 耗时未实测，打包包含 primary runtime 下载、pnpm 全量安装、electron-builder 三步，本机缓存已存在，预计十几分钟量级，以实际为准。
- 注意：`package:win:x64:unsigned` 不需要签名凭据；不要用带签名需求的 `package`。

### P1 最小排除实验（单边改动）

- 改哪一处：`apps/cli/package.json` 的 `dependencies` 里删掉 `"@deepseek-ai/dsh-tool-str-replace-editor": "workspace:*"` 一行。选它是因为：0.07 MiB、不在 `OPTIONAL_BUNDLES`、不在 `PROFILE_TEMPLATES`、没有 profile 行，删掉只影响 `dsh` 对这一个工具的声明，不会触发门禁的清单一致性检查。
- 预期减少：源码面 70.7 KiB（15 个受控文件）；安装后与安装包口径预计不超过这个数，真实值必须由 P0 的尺子量。
- 验证步骤：
  1. `pnpm install`（会改 `pnpm-lock.yaml`，走单一重活车道）。
  2. `pnpm run build:artifacts`，确认打包用的是最新 `lib/`。
  3. `pnpm --filter @deepseek-ai/dsh-desktop package:win:x64:unsigned`，构建内的 `verifyDesktopRuntime` 会逐文件校验运行时完整性，过滤后的树必须自洽。
  4. `pnpm --filter @deepseek-ai/dsh-desktop exec tsx scripts/smoke-packaged-runtime.ts --unsigned`（脚本参数以实际 `--help` 为准），确认打包后运行时与 Office 转换冒烟通过。
  5. 启动 `win-unpacked` 里的可执行文件，用独立 `--user-data-dir` 与仓内 home，跑 `lcoder/scripts/smoke.cmd` 的六条 CDP 探针，至少覆盖登录态、外壳根、打开仓库、五页切换、任务详情、设置页、发一条消息。
  6. 对比 P0 的安装包与 `win-unpacked` 字节，得到第一组真实增量。
- 失败判定：`verifyDesktopRuntime` 报完整性不一致、宿主启动失败、`pluginInventory` 少条目、或六条探针任一红，都算实验失败并回滚依赖行。

### 后续任务拆分与优先级

| 优先级 | 任务 | 范围 | 预期收益 | 前置 |
| --- | --- | --- | --- | --- |
| P0 | 打包称重基线 | 只打包、只记账，不改代码 | 建立尺子 | 无 |
| P1 | 可选能力 bundle 排包 | 15 条依赖 + `OPTIONAL_BUNDLES` + 门禁 + 称重 | 11.55 MiB 源码 | P0；产品确认不做离线可选能力市场 |
| P2 | Office 载荷移除 | office-to-pdf、skill-office、libreoffice-kit、office-skills、宿主启动检查 | 约 184 MiB 解包 | P0；产品确认不做 Office 文档处理 |
| P2 | 非桌面 CLI 形态排包 | acp、headless、sdk 三组 7 条依赖 + 模板常量 | 1.28 MiB 源码 | P0；确认桌面产品不承诺这些 CLI profile |
| P3 | Python 载荷移除 | runtime 准备、lock、runtime.json、workspace dependencies 工具 | 约 157 MiB 解包 | P2 或产品确认无数据分析场景 |
| P3 | 插件市场与 pnpm | 13 包 + pnpm 载荷 | 2.87 MiB + 22 MiB | 与 P1 同批决策 |
| P4 | MCP、终端、遥测微调 | 各 1–4 条依赖 | 合计 0.7 MiB + 0.29 MiB | 产品逐项确认 |

- 排序原则是「收益 × 确定性 ÷ 改动成本」：Office 与 Python 收益最大但都需要产品口径和运行时改动，所以放在可选 bundle 之后；可选 bundle 与 CLI 形态改动最小、可以立刻做。
- 可选 bundle 与插件市场是同一件事的两面，必须一起拍板；只删一边会让插件管理器报告的清单与实际安装不一致。

## 复跑

```sh
node lcoder/scripts/audit-package-closure.mjs
node lcoder/scripts/audit-package-closure.mjs --check
node lcoder/scripts/audit-package-closure.mjs --json "$LOCALAPPDATA/Temp/t179-audit.json"
```

- 本次 `--json` 输出确认了 333 包 / 9,962 文件 / 68.17 MiB、运行时 338、构建 56、测试 3、候选 0、workspace 边 6,523、实测链接 5,095。
- core set 成员与分组是临时脚本从审计模块的三个导出函数复算的（脚本未入库，属本任务的一次性分析）；复算口径写在上文「口径」一节，任何人可以照同样的规则重跑。
- 装配可达性用的是 `lcoder/profile-slice.md` 附录 A 的 208 行快照作为挂载集合；上游清单变化后要重导再算。

## 未验项

- 未打包：没有跑 electron-builder，安装包与 `win-unpacked` 的真实字节、压缩比、各载荷占比都没有实测。
- 未删除任何包、未改任何 `package.json` 与 `pnpm-lock.yaml`；所有「预计减少」都是源码面推导。
- 未验证排除后启动：依赖边删掉后宿主能否启动、`pluginInventory` 是否报缺、profile 是否仍能合成，均未做实验。
- dsh 运行时（333 包）安装后字节未测，只测了源码受控字节。
- 未测 macOS：mac-arm64 与 mac-x64 的 core set 剔除项不同，Node、Python、Electron 的字节也不同。
- `pnpm --filter @deepseek-ai/dsh-desktop exec tsx scripts/smoke-packaged-runtime.ts --unsigned` 的参数组合未核，P1 执行前需先看该脚本的 `--help`。
- 未核 `verify-default-product-isolation` 在删边后的具体报错形态，只读了它对 `OPTIONAL_BUNDLES` 的规则描述。
