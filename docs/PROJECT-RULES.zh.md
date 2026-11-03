# LCoder 项目规则（PROJECT-RULES）

[English](PROJECT-RULES.md) | 中文

> 本文件是项目规则的单一入口。通用纪律（红线、任务分级、提交纪律）由 dev-flow 的 `task-flow` 技能单源定义，本文只写项目专属约束与落地路径。

## 0. 项目快照（开工必知）

- **产品**：LCoder —— 面向 Windows 桌面端的规格驱动开发工作台，把 `.spec` 规格库、任务状态机与 agent 工具面收放做成 DeepSeek Harness 的插件层。
- **技术栈**：TypeScript（ESM）· Node ≥24.9 · pnpm workspaces · Cordis · React 18
- **基线版本**：DeepSeek Harness `0.2.2-alpha.2`（2026-10-30）
- **当前主线**：MVP-0 —— 工作台在本地跑通，收口 T-02
- **命名**：包名 `@lcoder/kernel`、`@lcoder/workspace`；主线分支 `lcoder/main`
- **架构**：[UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md)（上游关系与接触面）、[architecture.zh.md](architecture.zh.md)（上游架构）

## 1. 硬约束红线（项目专属 · 永不违反）

- 🚫 不改任何上游文件；确需修改必须先进 [contact-surface.txt](../lcoder/contact-surface.txt)，并在 [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md) §3 写明「改什么 / 为什么」。
- 🚫 `.spec` 下的任务与规格 YAML 是 **LCoder 产品数据**的唯一事实源；UI 只读不写，状态机判断不进 UI。它不是本仓库的开发任务台账。
- 🚫 目标平台是 Windows 桌面端；路径处理按 Windows 优先（盘符、反斜杠、大小写不敏感）。
- 🚫 `contract_sign` 永不注册为模型工具；契约只能由人签署，`by: agent` 视为无效。
- 🚫 能新增就不修改；改上游只改装配层（patch 层、聚合 tsconfig），不碰组件内部实现。
- 🚫 新增接触点必须人工评审；`upstream-diff.sh` 只报冲突，不判断改动深度。
- ✅ 规格条目必须有出处与代码落点；没有出处的条目不得置为 `confirmed`。

## 2. 目录放置

| 你要创建的内容 | 放这里 |
|---|---|
| 规格条目 | `.spec/spec/rules.yaml` |
| 状态机定义 | `.spec/spec/states/*.yaml` |
| 产品任务数据（LCoder 运行时） | `.spec/tasks/T-xx.yaml` |
| 产品任务契约 | `.spec/contracts/<ID>.contract.yaml` |
| 产品任务证据 | `.spec/evidence/<ID>/<name>.log` |
| 验收命令与环境 | `.spec/env.yaml`；敏感值写 `.spec/local.yaml`，不提交 |
| 宿主插件（agent 工具） | `packages/lcoder/kernel/src/` |
| 浏览器侧插件（工作台 UI） | `packages/lcoder/workspace/src/client/` |
| 二开装配、基线与脚本 | `lcoder/` |
| 仓库治理文档 | `docs/PROJECT-RULES.md`、`docs/active-context.md`、`docs/prd-and-design.md` |
| 开发台账（dev-flow） | `docs/tasks.yaml`（人维护，开发进度唯一源） |
| 离线任务看板 | `docs/tasks-html/index.html`（由 `docs/tasks.yaml` 生成，勿手改） |
| 包测试 | `packages/lcoder/<包>/tests/` |
| 排障坑档 | `lcoder/PITFALLS.md` |

- 包必须放在 `packages/<组>/<包>` 两级；`pnpm-workspace.yaml` 只识别 `packages/*/*`。
- 跨包引用只用包名与导出，不直接 import 上游内部路径。

## 3. 工作流（任务分级）

### 任务分级

| 分级 | 适用范围 | 必须执行的流程 |
|---|---|---|
| A | 契约/架构/规则变更（`!`）、里程碑、发版、上游升级 | 契约确认 → 全链门禁 → 台账登记 → 看板更新 → 汇报勾选 |
| B | 常规功能开发（1–3 文件） | 契约确认（或已明确则降级内部自检）→ 编码 → 门禁 → 看板一行收口 |
| C | 小修 ≤3 文件、无契约/架构变更 | 直接修 → 门禁 → 提交；**不强制更新看板**（除非碰里程碑，日末/发版统一收口）；坑档可当日批次末统一写 |

分级与开发台账 `docs/tasks.yaml` 的 `grade` 字段一致；开发进度的唯一源是 `docs/tasks.yaml`，`.spec/tasks/*.yaml` 是产品数据。

### 开工流程（A/B 类）

1. 读 [active-context.zh.md](active-context.zh.md)，确认与「当前焦点/下一步」一致。
2. 读 `docs/tasks.yaml` 与 `docs/PROJECT-RULES.md`，确认本任务的分级、范围与所需证据。`.spec` 只在开发 LCoder 规格库功能时读取；示例任务 `DEMO-01` 不是开发任务。
3. 契约确认：一句话总结 Input/Output、异常边界、MVP 边界；用户已明确授权 → 降级内部自检。
4. 编码：契约先行 → 实现 → 测试；单任务 1–3 文件；禁留 TODO。

### 完成门禁（必过）

- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm lint` 全绿
- [ ] `pnpm exec vitest run packages/lcoder` 全绿；改上游共享面时跑全仓 `pnpm test`
- [ ] 文档或包 README 变更时 `pnpm run test:docs` 全绿
- [ ] 开发证据：门禁命令输出记录在 `docs/tasks.yaml` 的任务 note 或提交说明；`.spec/evidence` 只服务产品任务
- [ ] 若本次变更同时触及产品任务（`.spec`），按 kernel 的 P1/P3/P4 另行验证；开发任务本身不写 `.spec` 契约
- [ ] **双源同步**：契约 / 统计口径 / 目录约定 / 异常策略 / 扫描范围变更时，同时更新 [prd-and-design.zh.md](prd-and-design.zh.md) 与 `docs/PROJECT-RULES.md`——只改一处即视为漂移
- [ ] 开发台账更新：先改 `docs/tasks.yaml`，再跑 `python scripts/build-tasks-html.py`；`docs/active-context.md` 只更新当前焦点。产品数据（`.spec`）的变更另走产品流程，不写进开发台账
- [ ] bug 修复必写坑档 [PITFALLS.md](../lcoder/PITFALLS.md)（四段式，编号顺延）
- [ ] 给最终汇报：变更清单 + commit 指令

### 特殊场景

- 上游新版本：按 [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md) §4 演练——`pnpm install`、`pnpm build`、`pnpm exec vitest run packages/lcoder`、`./lcoder/scripts/upstream-diff.sh`，全绿才合回 `lcoder/main`。
- 规则演进：技术栈、目录或流程变化 → 同步更新本文件对应节。
- 看板膨胀：`docs/active-context.md` 超 100 行 → 先归档完成史，再考虑拆轨。

## 4. 提交规范

- 格式：`<type>(<scope>): <summary>` ≤50 字符；契约破坏性变更 type 后加 `!`。
- type：feat / fix / docs / refactor / style / chore / test / build。
- scope：`kernel` / `workspace` / `lcoder` / `spec` / `docs`。
- 原子提交：完成看板一个节点（1–3 文件）即 commit；禁混提。
- 多窗口并行：一条功能线 = 分支 + worktree 独立目录；并行 ≤3 线；共享契约文件只在基线改。

## 5. 字典索引

| 文档 | 用途 |
|---|---|
| [active-context.zh.md](active-context.zh.md) | 当前看板（开工第一读） |
| [prd-and-design.zh.md](prd-and-design.zh.md) | 产品与方案口径 |
| `docs/tasks.yaml` | 开发台账（dev-flow，唯一源） |
| `docs/tasks-html/index.html` | 离线任务看板（由开发台账生成，勿手改） |
| `.spec/spec/rules.yaml` | 产品规格条目（LCoder 运行时） |
| `.spec/tasks/` | 产品任务数据（LCoder 运行时，非开发台账） |
| `.spec/contracts/` | 任务契约 |
| `.spec/evidence/` | 收口证据 |
| `.spec/env.yaml` | 验收命令与环境 |
| [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md) | 上游基线、接触面、升级演练 |
| [contact-surface.txt](../lcoder/contact-surface.txt) | 改过的上游文件清单 |
| [RUN.md](../lcoder/RUN.md) | 启动与验证手册 |
| [PITFALLS.md](../lcoder/PITFALLS.md) | 排障坑档（grep 坑号） |
| [architecture.zh.md](architecture.zh.md) | 上游架构（改 `packages/` 前必读） |
| [AGENTS.md](AGENTS.md) | 上游文档标准 |

## 6. 环境注意

- Node 要求 `>=24.9.0`；本机用 `pnpm env use --global 24`，不要改系统 Node。
- 首次安装 `pnpm install`；首次启动前跑 `pnpm run build:artifacts`。
- 启动：`pnpm dsh web --patch lcoder/cordis.patch.yml --no-open --port 3080`。
- `@lcoder/*` 要在 `~/.dsh/profiles/web` 用 `link:` 接入；换机或重建 `~/.dsh` 后重做。
- Windows 上 kill `dev:web` 不会带走子进程；换实例前按进程树清理，再确认端口空闲。
- 不要给 `dev:web` 接管道；输出重定向到文件再读，否则日志会被缓冲到进程结束。
- 插件路径是批量 combo URL，不是 `plugins/<name>/client.js`；单独请求会 404。
- 文档门禁：`pnpm run test:docs`；包 README 必须有 `kind` / `description` frontmatter 与 `Summary` / `Table of Contents` / `Dev Note` 骨架。
- 看板：先改 `docs/tasks.yaml`，再跑 `python scripts/build-tasks-html.py`；产物是 `docs/tasks-html/index.html`。`.spec` 不参与看板生成。
- 上游文档要求每段一个物理行（`verify-md-wrap`）；新增 `docs/` 文档按此写。
