# LCoder

[English](README.md) | 中文

LCoder 是面向 Windows 与 macOS 的规格驱动开发工作台：它把五态任务流与仓库内的 `.spec` 规格库交给 agent，让每一次改动都由任务、已签署的契约与留存的证据驱动。

## 与上游的关系

LCoder 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的桌面端二开，跟踪的上游基线为 `0.2.2-alpha.2`（2026-10-30）。基线提交、分支规则与升级演练记录在 [UPSTREAM-BASELINE.md](lcoder/UPSTREAM-BASELINE.md)。

改动集中在装配层（patch 层、桌面 profile、打包配置）与插件层（`packages/lcoder/*`）；原则上不修改上游组件内部，确需改动的少量上游文件在落地前登记到 [contact-surface.txt](lcoder/contact-surface.txt) 与 UPSTREAM-BASELINE.md 第 3 节。上游处于开发者预览阶段、API 未稳定，同步新版本可能波及插件层，操作按基线记录里的演练执行，门禁全绿才合回。

<a id="run"></a> <a id="run-from-source"></a>

## 运行与构建

环境要求 Node `>=24.9.0`（见 `package.json` 的 `engines`）与 pnpm。首次先安装依赖并构建产物：

```sh
pnpm install
pnpm run build:artifacts
```

用仓库内的启动器启动桌面端；它会停掉本检出的旧实例、构建、启动应用，并在就绪后打印带 token 的地址：

```bat
lcoder\scripts\start-desktop.cmd
```

改过源码后，用 `lcoder\scripts\rebuild.cmd` 只重建改动的那一层（`workspace`、`kernel`、`desktop`、`profile` 或 `all`）。完整步骤见手册 [RUN.md](lcoder/RUN.md)，包括仓内 `DSH_HOME`、把 `@lcoder/*` 以 `link:` 接进 profile、本机 `documentsDirectory` 规避、模型钥匙与就绪判据，并记录了 Web UI 判别入口 `pnpm dsh web --patch lcoder/cordis.patch.yml`。运行前请阅读[安全说明](SAFETY.zh.md)。

根目录的构建与门禁命令以 `package.json` 为准：`pnpm run build` 构建全部产物并跑聚合检查，`pnpm run build:check` 只跑聚合检查；`pnpm run typecheck`、`pnpm run lint`、`pnpm exec vitest run packages/lcoder`、`pnpm run test:docs` 为收口门禁。

## 仓库结构

| 路径 | 用途 |
|---|---|
| `packages/lcoder/kernel/` | 宿主插件：注册规格与任务工具，按任务状态选择工具面，从会话工作区解析 `.spec`，并通过永不进入模型工具面的人工命令写契约与证据。 |
| `packages/lcoder/workspace/` | 浏览器侧外壳插件：项目切换、五态任务看板、项目信息抽屉、浮层对话与立项和重开入口；它只读产品数据，写入交给 kernel。 |
| `lcoder/` | 二开装配：patch 层、桌面 profile、启动与分层重建脚本、上游基线与接触面登记、坑档。 |
| `docs/` | 项目治理与产品文档（如 `PROJECT-RULES.md`、`active-context.md`、`prd-and-design.md`、`desktop-release.md`），以及继承自上游的架构与开发文档。 |
| `.spec/` | 产品示例数据：规格条目、示例任务与证据；它是产品数据，不是开发台账。 |
| `packages/` 与 `apps/` | 上游 DeepSeek Harness 的组件包与桌面应用外壳。 |

## 身份与更新源

LCoder 的打包配置产出 `LCoder` 应用（Windows 为 `LCoder.exe`，macOS 为 `LCoder.app`），应用标识 `ai.lansi.lcoder`，使用 `lcoder` URL 协议并按用户安装。安装包会注册 `lcoder` 方案，但应用侧协议路由未实现：任何 `lcoder://` 地址只会拉起或聚焦已有窗口，不解析路径；macOS 的 `open-url` 处理仍只匹配上游的 `dsh://open`。身份、数据与日志目录、版本与通道、上游接触面的权威说明在 [desktop-release.md](docs/desktop-release.zh.md)。打包产物与安装后的身份尚未验证。

更新源按私有 COS 桶加公开 CDN 源设计：按目标分发 `latest` 与 `nightly` feed 及固定下载；客户端只读 CDN 源、不直连桶，公开源、桶名与凭据都属于发布配置，不进入本仓。真实上传、CDN 刷新、更新设置界面与自动检查尚未实现或未验，因此自动更新目前不可用。

首期所有构建都是未签名的内测产物。Windows 会触发未知发布者的 SmartScreen 警告；macOS 使用 ad-hoc 签名，首次启动会被 Gatekeeper 与隔离属性拦下，需用户显式放行，从 DMG 启动还可能发生 App Translocation。macOS 打包、签名与公证，以及未签名构建的自动更新，都待完成且未验。不要把任何构建说成可公开发布或已公证。

## 开发纪律

- [PROJECT-RULES.md](docs/PROJECT-RULES.zh.md)：红线、任务分级、目录归属与收口门禁。
- [active-context.md](docs/active-context.zh.md)：当前看板与下一步。
- [docs/tasks.yaml](docs/tasks.yaml)：开发台账，开发进度的唯一来源；离线看板由它生成。
- [PITFALLS.md](lcoder/PITFALLS.md)：本检出的编号坑档（中文）。
- [UPSTREAM-BASELINE.md](lcoder/UPSTREAM-BASELINE.md)：跟踪的上游版本、接触面与升级演练。
- [AGENTS.md](AGENTS.md)：面向 agent 的仓库说明。

## 平台范围

桌面目标平台是 Windows x64 与 macOS arm64 和 x64。Windows 设计为按用户安装，不需要提权。macOS 首期构建未签名，只作内测产物；适配与打包矩阵见 `docs/desktop-release.md` 第 6 节，macOS 开发启动器与打包仍待完成。

开发与验证一律使用仓内的 `DSH_HOME` 与 Electron userData 目录，不写本机已安装应用的数据、`AppData` 与注册表。

## 许可证

LCoder 以 [MIT](LICENSE) 许可分发。第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；上游的版权与许可声明保留。
