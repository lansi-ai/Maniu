---
description: "LCoder 的宿主插件：规格、任务、需求与编辑工具的可见性随任务状态收放；仓库没有可读任务时退回四工具立项面，规格根按会话工作区解析。"
kind: "package-reference"
---

# @maniu/kernel

[English](README.md) | 中文

## 概述

`@maniu/kernel` 向 DeepSeek Harness 宿主注册 LCoder 的规格、任务与需求工具。工具面随当前任务状态收放：`drafting` 给读取、契约与立项工具，`contracted` 增加编辑、命令执行与证据，`closed` 只读。取不到任务状态的仓库不再拿到全量能力，而是拿到立项面 `file_read`、`spec_query`、`task_read`、`task_draft`。规格根跟随会话工作区，因此桌面端宿主读目标仓库的 `.spec`，而不是它的 profile 目录。宿主提供 `tools` 服务后，通过 LCoder patch 层挂载本包。`contract_sign` 刻意不存在。

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
      name: '@maniu/kernel'
      config:
        root: !!js process.env.LCODER_SPEC_ROOT || undefined
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `root` | `process.cwd()/.spec` | 会话没有 cwd 时的备案规格根 |
| `selfCheck` | `true` | 加载时打印工具面自检 |
| `taskId` | 第一个任务 | 没有会话认领时，用哪个任务的状态选择工具面；某条会话被任务的 `session` 字段认领时，该会话改按那条任务取状态，并行的两条会话各读各的。读不到任何任务时按立项面收 |
| `role` | 未设 | 角色天花板，取值 `intake`、`architect`、`pm`、`dev`、`git`、`ops`、`review`、`scheduler`、`flow`、`manager`；工具面取状态掩码与该角色工具表的交集，角色只会减去能力，`scheduler` 与 `flow` 只有 `file_read`、`file_list`、`spec_query`、`task_read`，`role_draft` 只有 `manager` 看得见。配错角色名在装载时即失败 |

本插件通过 patch 层作为插件行挂载，没有 `dsh plugin add` 安装路径。一次工具调用从 `session.header.cwd/.spec` 解析规格根；没有会话 cwd 时用 `root`，没有 `root` 时用 `process.cwd()/.spec`。除工具外它注册若干人机命令：`contract_sign` 由人签署任务的契约，`task_bind` 把任务认给当前会话，`task_assign` 把任务分配给岗位，`task_contract` 推进到已签约，`task_split_ready` 把需求拆出且已分配岗位的起草任务直接推进到待开发，`proposal_approve` 采纳方案，`requirement_approve` 确认需求，`requirement_release` 把已确认需求标为已上线，`requirement_close` 取消未上线需求，`deploy` 执行部署，`task_schedule` 把一次调度判定追加到 `.spec/evidence/<任务>/schedule.jsonl`，入队判定还会在 `.spec/evidence/scheduling/` 下写联调组记录；`flow_status` 只读求值，返回策略、下一步与逐任务计划的一行 JSON；`flow_log` 把一次开工或流程结果追加到 `.spec/evidence/<任务>/flow.jsonl`；`agent_bind` 把智能调度或流程控制的单例会话号写进 `.spec/agents.yaml`。工作台外壳调用后三条，它们都不进模型工具面。它们都由宿主写 `.spec`，都留在命令面而不是工具面——注册成工具就等于模型能给自己签字、能自己挑工具面，也能自己写审计记录。`task_assign <任务编号> <岗位 id>` 先查 `.spec/roles.yaml`、再查内置角色，写回 `Task.role`，不改任务状态。`task_split_ready <任务编号>` 只接受需求拆出、已分配岗位的 drafting 任务，直接写入 contracted，以需求文档作为契约依据；没有方案回指或没有岗位的会被拒绝。`role_draft` 是模型唯一的岗位写入口：它只能追加或更新一项、不能删除，继承不合法当场拒绝，并且只有 `manager` 角色看得见；分配始终只由人做。它还接受可选的 `signals`，是三组字符串数组——`strong` 技术栈强特征词、`medium` 弱语义词、`preferredPaths` 文件落点前缀——每组最多 32 条、每条最多 64 个字符，忽略大小写去重；名册只把它们存给本地建议层，调度硬闸从不读取。AI 自签是 kernel 函数而不是命令或工具：`selfSignContract` 只在 `.spec/automation.yaml` 的 `sign` 为 `auto`、任务没有 `scope.irreversible`、契约有非空 `review*.log` 证据时写 `by: agent`，并记下 `actor` preset 与策略路径、哈希、文件修改时刻。P3 用同一套三闸复核，收口时任何一道不成立的 agent 签名都无效。

`task_draft` 除标题与分级外还接受可选的任务元信息字段：`description`（允许换行，最多 4000 个字符）、`category`（`page`、`api`、`data`、`other`）、`change_type`（`bug`、`feature`、`improvement`、`style`）、`attachments`（最多 8 张图片，路径相对 `.spec` 根目录，扩展名限 `png`、`jpg`、`jpeg`、`webp`、`gif`；绝对路径、`..`、空串与其他扩展名都被拒）、`track`（内置轨或 `.spec/project.yaml` 追加的轨，未知轨连同可用清单一起拒绝）、`proposal` 与 `requirement`（分别回指方案与需求，写前查存在，两者可以并存，读侧优先 `requirement`）。它的回显包含这些字段，`task_read` 读任务详情时也一并返回。

`requirement_draft` 用必填的标题与 Markdown 正文、可选的 `options`（每项 `name` 与 `summary` 必填、`cost` 可省）与 `recommendation`，写 `.spec/requirements/REQ-<编号>.yaml` 与同名正文文件。它取现有 `REQ-` 编号之后的下一个空号，不覆盖已有文件对；先写正文再写元数据，元数据写失败会删掉刚写的正文。状态固定写 `draft`。`/requirement_approve` 把正文非空的起草态需求推到 `confirmed`；`/requirement_release` 只在至少一条任务通过 `Task.requirement` 回指且这些任务全部 `closed` 时推到 `released`，否则报出未关闭的任务编号；`/requirement_close` 关闭起草或已确认的需求，并拒绝已上线的需求——它是终态。工作台投影按同一目录把每份 YAML 与同名正文合成一行。

`deliverable_draft` 用必填的 `summary`、至少一条仓库相对路径的 `docs` 与可空的 `commands`，把一条任务的交付物登记成 `.spec/deliverables/<任务编号>.yaml`。每条 `docs` 必须在仓库根下解析成真实文件；绝对路径、`..` 与不存在的文件都被拒。工具按任务覆盖写，保留首次 `created_at` 并刷新 `updated_at`；它只登记索引，工程文档本身仍用 `file_edit` 写。`task_close` 在 P1、P3、P4 之后跑 D1：A 级、通用轨、或标题描述命中基础框架、脚手架、架构、技术选型的任务，必须有一份摘要非空、至少一条文档的可读索引，否则收口把 `.spec/deliverables/<任务编号>.yaml` 作为下一步报出来。普通任务不受影响。只有 `dev`、`architect` 与 `ops` 看得见这个工具，且从 `contracted` 起才可见。

### 人才库宿主动态 preset

`@maniu/kernel/talents` 挂载人才库的宿主半边。客户端经 `agentTalents/applyTalents` 提交云端人才；每条人才注册成稳定 preset `talent-<云端 id>`，以它的 `basePreset` 声明行为底，`persona` 与 `plugins` 按同名覆盖。插件必须能从本机已安装包解析到；`url`、`source`、`package`、未知字段、`!!js` 标记、重名与非 JSON 值由 `agent-talent/invalid` 或 `agent-talent/unknown-plugin` 拒绝。配置未变的重复提交是空操作；编辑后替换定义，运行中的会话保持它启动时的 revision。仍有本机会话记录该 preset 时 `agentTalents/removeTalent` 拒绝撤回，`agentTalents/sessionRefs` 列出这些会话，内置 preset 永不被替换或删除。

`tools`、`model` 与 `budget` 在 preset 末尾生成 `@maniu/kernel/talents-policy` 行。`tools` 是白名单：Agent 创建时策略把工具面收窄到列出的工具，空列表或缺省不限制，列出的工具不在已挂载 preset 的工具面上时报 `agent-talent/unknown-tool` 并拒绝登记。`model` 写入新启动会话的模型选择；恢复的会话保持它记录的模型。`budget` 留在云端：`lcoder-cloud` 路由上的每次模型请求都带 `x-lcoder-session-id`，会话 preset 是已登记人才时再带 `x-lcoder-talent-id`，网关据此按会话计量并限制该人才。

同一个插件还提供只读的表单清单与项目身份。`agentTalents/catalog` 列出根 Loader 与 preset 组合里出现过、且本机可解析的插件包，以及非人才的 base preset；`agentTalents/presetTools` 读一个 base preset 当前的工具面，让白名单只能写它真正暴露的工具。`agentTalents/projectIdentity` 读项目路径（或作用域会话 `cwd`）下的 `.spec/project.yaml`，本身不写文件。新项目在 `project_draft` 首次登记时就写入 `projectId`；老文件缺字段时由客户端自动调用一次 `agentTalents/ensureProjectId`，重复调用幂等。缺 `.spec/project.yaml` 的项目不会凭空得到 id。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内幕——点击展开</summary>

插件具名导出 `name`、`inject` 与 `apply`，与上游函数插件形态一致。它注入 `tools`，为每个定义注册一个 `when` 条件，每个 model step 求值一次。条件每次都从磁盘读取任务状态，因此签契约或推进任务会立刻改变可见工具。

每个工具工厂接受固定根或解析函数。解析函数只读窄会话事实 `agent.session.header.cwd`；插件把同一个解析函数交给全部工具，因此同一会话在规格与任务操作上看到同一个规格根。文件工具收到仓库根（规格根的上一级），而 `cmd_run`、`env.yaml` 与证据仍留在规格根下。

| 文件 | 职责 |
|---|---|
| `src/plugin.ts` | 工具注册、工具面收放与加载自检 |
| `src/kernel/spec-root.ts` | 会话优先的规格根解析 |
| `src/kernel/spec-store.ts` | 规则与状态机的读写 |
| `src/kernel/task-store.ts` | 任务对象、迁移与落盘 |
| `src/kernel/requirement-store.ts` | 需求对象、编号分配与两文件写入 |
| `src/tools/spec-tools.ts`、`src/tools/task-tools.ts`、`src/tools/edit-tools.ts` | 模型工具 |
| `src/tools/requirement-tools.ts` | 模型可调用的 `requirement_draft` |
| `src/tools/deliverable-tools.ts` | 模型可调用的 `deliverable_draft` |
| `src/kernel/deliverable-store.ts`, `src/schema/deliverable.ts` | 交付索引的读写与必须交付判定 |
| `src/commands/requirement-approve.ts`、`src/commands/requirement-release.ts`、`src/commands/requirement-close.ts` | 三条只进命令面的需求状态命令 |
| `src/schema/requirement-progress.ts` | 需求九态进度的纯函数推导 |
| `src/checkers/index.ts` | P1、P3、P4、D1 收口检查器 |
| `src/kernel/automation.ts` | `.spec/automation.yaml` 的读取、默认值与策略哈希 |
| `src/kernel/flow.ts`、`src/kernel/flow-store.ts` | 纯函数下一步判定与 `.spec` 事实装配 |
| `src/kernel/sign-gate.ts` | AI 自签的三道补偿闸 |
| `src/commands/flow-status.ts`、`src/commands/flow-log.ts` | 流程判定 JSON 与逐任务动作流水 |
| `src/commands/agent-bind.ts` | `.spec/agents.yaml` 里的两条常驻调度会话号 |
| `src/kernel/role-store.ts`、`src/schema/roles.ts` | `.spec/roles.yaml` 的读写与共享的内置角色 id |
| `src/talents/service.ts`、`src/talents/validate.ts`、`src/talents/compose.ts`、`src/talents/policy.ts` | 人才库宿主动态 preset 的注册、wire 校验、组合与按 Agent 生效的策略行 |
| `src/tools/role-tools.ts` | `role_draft`，模型唯一的岗位写入口 |
| `src/commands/task-assign.ts` | 人机命令 `task_assign`，写回 `Task.role` |
| `src/commands/task-split-ready.ts` | 人机命令 `task_split_ready`，把拆分任务推进到 `contracted` |

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
- 人才的 `tools` 白名单与 `model` 默认模型在 Agent 以该人才 preset 创建时生效；通过 `agent-presets` 把运行中的会话改绑到别的 preset 不会重新施加。直接注册在某个 Agent 自身作用域里的工具不会被 restriction 隐藏，因为 restriction 豁免查看作用域的注册。
- 动态人才 preset 只存在进程内：宿主每次重启后要由客户端重新提交；记录过某条人才的会话在重新提交前无法恢复。
- 删除保护只覆盖本机，这是既定口径：别的设备上的会话不会拦住云端删除。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

构建用 `pnpm --filter @maniu/kernel run bundle`；根 `tsconfig.host.json` 通过 `references` 包含本包，所以 `pnpm typecheck` 会覆盖它。包测试用 `pnpm exec vitest run packages/lcoder/kernel`。

</details>
