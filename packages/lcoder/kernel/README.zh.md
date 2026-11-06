---
description: "LCoder 的宿主插件：十个规格、任务与编辑工具的可见性随任务状态收放；仓库没有可读任务时退回四工具立项面，规格根按会话工作区解析。"
kind: "package-reference"
---

# @lcoder/kernel

[English](README.md) | 中文

## 概述

`@lcoder/kernel` 向 DeepSeek Harness 宿主注册 LCoder 的规格与任务工具。工具面随当前任务状态收放：`drafting` 给读取、契约与立项工具，`contracted` 增加编辑、命令执行与证据，`closed` 只读。取不到任务状态的仓库不再拿到全量能力，而是拿到立项面 `file_read`、`spec_query`、`task_read`、`task_draft`。规格根跟随会话工作区，因此桌面端宿主读目标仓库的 `.spec`，而不是它的 profile 目录。宿主提供 `tools` 服务后，通过 LCoder patch 层挂载本包。`contract_sign` 刻意不存在。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 LCoder patch 层挂载插件，并让会话绑定 agent 要工作的仓库，其下应有 `.spec`。

### 何时选择它

当 DeepSeek Harness 组合已经提供 `tools` 服务，且 agent 应在 LCoder 五态任务流下工作时选择它。不要把它当通用文件编辑工具包：工具面按任务状态 fail-closed，契约未签时 `file_edit` 与 `cmd_run` 不可见。还没有 `.spec` 的仓库按“未立项”处理：模型能读、能立任务，收口仍需有人签署的契约。

### 最小配置

```yaml
- insert:
    - id: lcoder-kernel
      name: '@lcoder/kernel'
      config:
        root: !!js process.env.LCODER_SPEC_ROOT || undefined
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `root` | `process.cwd()/.spec` | 会话没有 cwd 时的备案规格根 |
| `selfCheck` | `true` | 加载时打印工具面自检 |
| `taskId` | 第一个任务 | 没有会话认领时，用哪个任务的状态选择工具面；某条会话被任务的 `session` 字段认领时，该会话改按那条任务取状态，并行的两条会话各读各的。读不到任何任务时按立项面收 |
| `role` | 未设 | 角色天花板，取值 `intake`、`architect`、`pm`、`dev`、`git`、`ops`、`review`、`scheduler`、`flow`；工具面取状态掩码与该角色工具表的交集，角色只会减去能力，`scheduler` 与 `flow` 只有 `file_read`、`file_list`、`spec_query`、`task_read`。配错角色名在装载时即失败 |

本插件通过 patch 层作为插件行挂载，没有 `dsh plugin add` 安装路径。一次工具调用从 `session.header.cwd/.spec` 解析规格根；没有会话 cwd 时用 `root`，没有 `root` 时用 `process.cwd()/.spec`。除工具外它注册若干人机命令：`contract_sign` 由人签署任务的契约，`task_bind` 把任务认给当前会话，`task_contract` 推进到已签约，`proposal_approve` 采纳方案，`deploy` 执行部署，`task_schedule` 把一次调度判定追加到 `.spec/evidence/<任务>/schedule.jsonl`，入队判定还会在 `.spec/evidence/scheduling/` 下写联调组记录；`flow_status` 只读求值，返回策略、下一步与逐任务计划的一行 JSON；`flow_log` 把一次开工或流程结果追加到 `.spec/evidence/<任务>/flow.jsonl`；`agent_bind` 把智能调度或流程控制的单例会话号写进 `.spec/agents.yaml`。工作台外壳调用后三条，它们都不进模型工具面。它们都由宿主写 `.spec`，都留在命令面而不是工具面——注册成工具就等于模型能给自己签字、能自己挑工具面，也能自己写审计记录。AI 自签是 kernel 函数而不是命令或工具：`selfSignContract` 只在 `.spec/automation.yaml` 的 `sign` 为 `auto`、任务没有 `scope.irreversible`、契约有非空 `review*.log` 证据时写 `by: agent`，并记下 `actor` preset 与策略路径、哈希、文件修改时刻。P3 用同一套三闸复核，收口时任何一道不成立的 agent 签名都无效。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内幕——点击展开</summary>

插件具名导出 `name`、`inject` 与 `apply`，与上游函数插件形态一致。它注入 `tools`，为每个定义注册一个 `when` 条件，每个 model step 求值一次。条件每次都从磁盘读取任务状态，因此签契约或推进任务会立刻改变可见工具。

每个工具工厂接受固定根或解析函数。解析函数只读窄会话事实 `agent.session.header.cwd`；插件把同一个解析函数交给十个工具，因此同一会话在规格与任务操作上看到同一个规格根。文件工具收到仓库根（规格根的上一级），而 `cmd_run`、`env.yaml` 与证据仍留在规格根下。

| 文件 | 职责 |
|---|---|
| `src/plugin.ts` | 工具注册、工具面收放与加载自检 |
| `src/kernel/spec-root.ts` | 会话优先的规格根解析 |
| `src/kernel/spec-store.ts` | 规则与状态机的读写 |
| `src/kernel/task-store.ts` | 任务对象、迁移与落盘 |
| `src/tools/spec-tools.ts`、`src/tools/task-tools.ts`、`src/tools/edit-tools.ts` | 十个模型工具 |
| `src/checkers/index.ts` | P1、P3、P4 收口检查器 |
| `src/kernel/automation.ts` | `.spec/automation.yaml` 的读取、默认值与策略哈希 |
| `src/kernel/flow.ts`、`src/kernel/flow-store.ts` | 纯函数下一步判定与 `.spec` 事实装配 |
| `src/kernel/sign-gate.ts` | AI 自签的三道补偿闸 |
| `src/commands/flow-status.ts`、`src/commands/flow-log.ts` | 流程判定 JSON 与逐任务动作流水 |
| `src/commands/agent-bind.ts` | `.spec/agents.yaml` 里的两条常驻调度会话号 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- `packages/lcoder/workspace` —— 同一批 `.spec` 文件的浏览器侧投影。
- `lcoder/cordis.patch.yml` —— 挂载两个 LCoder 包的 patch 层。
- `lcoder/RUN.md` —— 启动与验证。
- `lcoder/UPSTREAM-BASELINE.md` —— 上游关系与接触面。

-----

<a id="model-experience"></a>
## 模型体验

### 已注册工具

#### 模型看到什么

工具的名称、描述与 `parameters` JSON Schema，先按当前任务状态经 `when` 过滤，再按配置的角色天花板收窄；读不到任务状态时给立项面。人机命令永不出现在其中。

#### Token 影响

每个可见工具的描述与参数 schema 都在每一步占用请求 token；`when` 隐藏一个工具时，该步的声明也随之消失。

#### KV Cache 影响

可见工具集只在任务状态迁移时变化。同状态重复应用是空操作，迁移会让请求前缀从第一个变化的工具 schema token 起失效。角色天花板在本插件装载时就定下，一次会话里不会移动。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- `contract_sign` 按设计不存在；签署在模型回合之外。AI 自签只以三闸下的 `selfSignContract` 形式存在，目前还没有执行器调用它；流程面板只标出「可自签」，不替人执行。
- `flow_status` 每次调用重读整份 `.spec`，不订阅文件变化；外壳在投影重读或一批开工结束后再问一次。
- `.spec/automation.yaml` 在 kernel 每次判定时读取，没有写入口，由人直接编辑。策略不能承载 push、部署这类外部不可逆动作。
- `task_transition` 没有工具入口；推进任务需要编辑其 YAML。
- `when` 只管本包注册的工具。bundle 全局注册的工具（`read`、`write`、`edit`、`glob`、`grep`、`bash`、`pwsh`）对该 profile 的每个 Agent 都可见，所以未立项仓库并不会因此失去改代码能力；要收住它们需要 Agent 作用域的 `restrict`。
- P1 使用文本索引，注释或字符串里的同名标识符会造成误报。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

构建用 `pnpm --filter @lcoder/kernel run bundle`；根 `tsconfig.host.json` 通过 `references` 包含本包，所以 `pnpm typecheck` 会覆盖它。包测试用 `pnpm exec vitest run packages/lcoder/kernel`。

</details>
