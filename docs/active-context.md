# 激活上下文与任务看板 (active-context.md)

## 01. 当前迭代目标 (Current Sprint Goal)

- **版本阶段**：MVP-0 —— 工作台在本地跑通。
- **核心业务价值**：agent 在工作台里按 `.spec` 规格与任务状态机工作，改动有契约、有证据、可复核。
- **关键交付物**：kernel 挂载并注册九个工具；右栏工作台三栏；文件投影读出任务与规则。

## 02. 任务看板 (Task Board)

- **开发台账（dev-flow）**：`docs/tasks.yaml`，人维护，是开发进度的唯一源。
- **产品数据（LCoder）**：`.spec/` 是产品示例数据（订单佣金：`DR-01`/`DR-02`、`DEMO-01`），供 kernel 与 UI 读取；它与开发台账 ID 不重叠，改产品数据不改变开发进度。
- **离线看板**：`docs/tasks-html/index.html`（双击打开，含概览、状态看板、层级树、矩阵与筛选）。
- **重跑命令**：`python scripts/build-tasks-html.py`。

- **当前焦点**：T-02 收口（开发看板 `doing`）。
- **已完成**：T-01 文件投影。
- **下一步**：见 §04。

## 03. 关键决策与架构遗留 (Key Decisions & Context)

- **已做出的关键技术决策**：
  - 数据面走文件投影，不自建 Remote、不引 typert 生成器。
  - 工具面按状态 fail-closed；`contract_sign` 不进模型工具。
  - 挂载只走 `lcoder/cordis.patch.yml`，不改上游清单。
  - `.spec/tasks` 是产品数据；`docs/tasks.yaml` 是开发台账；两者不互相派生，看板只从开发台账生成。
- **风险与技术债记录**：
  - 契约签署通道未实现，P3 只能人工写 YAML。
  - `task_transition` 没有工具入口。
  - 产品示例 `DEMO-01` 处于 `drafting`，尚无契约；示例 `env.yaml` 已就位。
  - `packages/lcoder/workspace/README.md` 未过上游包 README 标准，`test:docs` 当前红。

## 04. 下一步即时行动 (Next Immediate Actions)

- **当前正在处理**：T-02 收口。
- **即将执行**：修两份包 README → `pnpm typecheck` / `pnpm lint` / `pnpm exec vitest run packages/lcoder` → 起服务做 smoke → 更新 `docs/tasks.yaml` 状态。
- **开发证据**：门禁命令输出记录在 `docs/tasks.yaml` 的任务 note 或提交说明；`.spec/evidence` 只服务产品任务。
- **看板重跑**：开发状态变化后先改 `docs/tasks.yaml`，再执行 `python scripts/build-tasks-html.py`。
- **前置修复**：按上游包 README 规范重写 `packages/lcoder/workspace/README.md`，补 `packages/lcoder/kernel/README.md`。
- **AI 交互指令提示**：后续会话可直接提示「按 active-context.md 的下一步继续执行」。

## 05. 规则自我演进维护

本文件为动态看板。每次开发任务收口或业务需求变更时，先改 `docs/tasks.yaml`（开发台账），再跑 `python scripts/build-tasks-html.py`，最后按 [PROJECT-RULES.md](PROJECT-RULES.md) §3 的更新协议更新本文件的当前焦点；只维护当前窗口，完成史留在 git。产品数据（`.spec`）的变更另走产品流程，不通过本看板。C 类小任务不强制更新，日末或发版统一收口。
