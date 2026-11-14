---
description: "LCoder 专属外壳：项目切换、五态任务板、项目信息抽屉，以及基于会话工作区 .spec 的真实悬浮对话。"
kind: "package-reference"
---

# @lcoder/workspace

[English](README.md) | 中文

## 概述

`@lcoder/workspace` 是 LCoder 的外壳：左侧菜单在需求页与任务页之间切换，顶栏保留项目、会话与智能调度入口；需求页有表格与九态看板两种视图，任务页只画方案讨论、待开发、开发中、验收中、已完成五列。另有项目信息抽屉、悬浮对话、空看板的立项入口、展示需求与已起草任务的立项结果页、按同一档咒语新开会话的「重新开始」，以及向 kernel 求下一步、只启动选中的可开始任务且不推进状态的「开工」面板。顶栏两个入口打开智能调度与流程控制常驻会话；对话里显示上下文占用与压缩标记，还能用紧凑 chip 切换会话模型，并把图片或文件随提示一起发出。kernel 已运行时通过 LCoder patch 层挂载；`shell: false` 保留旧的右栏工作台页签。外壳对产品数据只读：状态机判断与写入都归 kernel。

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

在 LCoder patch 层挂载本包。`shell` 为 true（默认）时注册并选中 `lcoder-home` 主面板；项目选择器列出 Host 工作区，「打开仓库」注册一个目录并创建会话。

### 何时选择它

当 kernel 已运行、用户应从 LCoder 的项目/任务外壳工作时选择它。不要用它编辑规格数据或做状态迁移：外壳只投影产品数据，写入与状态机判断归 kernel。只需要旧的右栏工作台页签时把 `shell` 设为 false。

### 最小配置

```yaml
- insert:
    - id: ui-lcoder-workspace
      name: '@lcoder/workspace'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `shell` | `true` | 在 `lcoder-home` 主面板渲染 LCoder 外壳；`false` 保留右栏页签 |
| `openTimeoutMs` | `15000` | 「打开仓库」每一步的等待上限；到点报「超时」并给出卡住的步骤，被拒绝则报出对方给的原因 |

本包通过 patch 层作为插件行挂载，没有 `dsh plugin add` 安装路径。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内幕——点击展开</summary>

本包注册外壳主面板；`shell: false` 时注册旧的页签。外壳通过框架 hooks 读工作区与会话列表，通过 `workspaceFiles` 读 `.spec/tasks`、`.spec/spec/rules.yaml`、`.spec/project.yaml`、`.spec/local.yaml`、`.spec/requirements` 与 `.spec/deliverables`，并通过会话控制器发送提示。需求投影把每份 `REQ-xx.yaml` 与同名 Markdown 正文合成一行，带标题、状态、候选、推荐与四个时刻；旧立项流程只有 Markdown 的文件仍然返回一行（没有元数据），读不懂的文件如实报出而不是丢掉。项目选择器的「打开仓库」调用 `workspaces.create` 与 `sessions.create`，然后选中新工作区。每一步最多等 `openTimeoutMs`：到点抛 `WorkspaceOpenTimeoutError` 并带上卡住的步骤名，被拒绝则保留对方返回的原因；两种情况用不同词典键，挂住的调用不会被写成「打开失败」。

需求页把九态一律交给 kernel 的 `requirementProgress` 派生：表格列编号、标题、状态、关联任务数与更新时间，支持关键字与状态筛选并按编号排序；看板按待补全、待确认、已确认、已拆分、开发中、测试中、待上线、已上线分列，已取消默认隐藏、可单独打开。点一行打开需求详情抽屉：完整需求正文（也可进阅读器全屏读）、立项问答、回指这条需求的任务（编号、标题、状态、轨）、这些任务的交付物汇总与讨论历史入口，按状态给确认需求、拆分任务、发布上线与关闭需求四条人机命令；命令失败原文就地显示。任务页隐藏旧流程的需求本体任务（起草态且带方案回指、无轨无岗位），任务卡与详情显示所属需求编号并可跳到需求页；旧任务的 `proposal` 作为回退仍可读。

从任务卡打开对话时，外壳复用该任务已经认领的那条会话（`.spec/tasks/<ID>.yaml` 的 `session` 字段）。没有还在的会话时，外壳在同一个仓库里再开一条，并在创建这一步指名角色——preset 在首回合之后就锁死——再通过人机命令 `/task_bind` 把任务认给这条会话，落盘由 kernel 做。角色来自 `agentPresets.list`，且只给 id 以 `lcoder` 开头的 preset——上游角色不挂本包的工具，根本读不到 `.spec`；名册读失败或是空的，就按宿主默认角色开。顶栏的会话条列出本工作区的会话，按认领它的任务标名，点一下就切过去。任务卡与任务详情都显示任务上的岗位（缺字段显示「未分配」）；显示名来自 `.spec/roles.yaml`，名册与内置角色都不认识的 id 显示为「未知岗位」。详情面板通过人机命令 `/task_assign` 分配；名册为空时提示先去起草岗位。详情显示任务描述并保留换行、领域与变更类型两枚标签，以及经 `workspaceFiles.readBytes` 读出的只读图片缩略图；文件缺失或读不到只显示文件名占位，不让整页失败。元信息只留难度与岗位，规则、证据要求与工具面收进「更多」，各带一句白话解释。交付物区展示登记的摘要、进全屏 Markdown 阅读器的文档路径与验收命令；A 级、通用轨或命中基础与架构关键词的任务缺索引时就地给出 `.spec/deliverables/<编号>.yaml`，普通任务没有索引则不画这一块。

需求详情的拆分以 REQ 为输入，不再借用立项会话。点「拆分任务」会新建一条 `lcoder-pm` 项目经理会话，把完整的 `.spec/requirements/<REQ 编号>.md` 交过去，并在最多三分钟内等 `.spec/tasks` 里出现回指同一需求、拆分前不存在的 drafting 任务；关掉抽屉不会中止这一轮，拆分状态按需求编号留档，重开只显示同一份结果，不会从头再来。拆分指令先要求用 `file_list` 加 README 与构建清单调研仓库现状，再给每条新任务标且只标一条 `track`：内置 `h5`、`admin`、`api`、`desktop`、`host`、`general`，或 `.spec/project.yaml` 里项目追加的轨，同时把 `requirement` 写成 REQ 编号、不写 `proposal`。拆分不再新建 `lcoder-manager` 会话、不再写 `Task.role`，也不再调用 `/task_assign`；具体岗位留给实施阶段的人。任何新任务没标轨都会按失败报出编号；同一需求下已经有回指任务时进度进入「已拆分」，拆放入口不再出现，绝不重复拆。详情回报新增条数与按轨分布。方案讨论从轨推导参与者，而不是 `Task.role`：需求分析师、项目经理、研发经理固定入会，每条技术轨通过 `dev` 面加入（`general` 由架构师兼顾），架构师汇总会议并逐任务用 `contract_draft` 起草契约，`change`、`not_change`、`acceptance`、`fail_if` 四项都必须非空。会议规模仍决定大任务是否并成一个会，同一角色跨组只建一次会话。需求详情还提供讨论历史抽屉，按角色分组展示助手发言：优先读本窗口记下的讨论会话，重启后按 `agentPreset` 与消息里出现的需求编号恢复候选；定位不到会话或读不到记录都如实说明。任务详情展示参与角色、逐任务契约状态，以及确认方案与重新讨论两个动作；确认后逐条执行 `/contract_sign` 与 `/task_contract`，失败的行留在详情里，这些任务也因状态未动而留在方案讨论列。已有完整契约的一批重开时不再建会话。

悬浮对话订阅会话事件窗口并渲染用户/助手文本；输入框向同一会话继续发送提示。头部 chip 从 `modelSelection` 投影读当前模型，没记过时显示目录默认值并标为默认；点开按服务商分组，选中时调 `session.selectModel`，同一次调用也保存全局默认。输入区把图片读成 base64 的 `image` part，其余文件先经 `fileUploads.upload` 拿回执，图片按会话广播的 `imageLimits` 校验，发送时把文本、图片、文件拼成一次提示。发送被拒时保留草稿与附件；模型不支持图片时如实说明，不丢附件。磁盘上没有任务时，看板给出两个入口。「全新项目」先打开需求分析师向导：三节简介（分析师简历、七问工作流程、可选的模型高级配置）默认折叠，确认后才发送；确认后 7 问咒语发出，提问卡、收起的「思考中」过程行与带「确认需求 / 更多轮次」的方案结果都留在同一块面板里；本轮结束但还没读到方案时，思考行停转、写明状态并就地给出「重新开始」。「已有资料」仍在悬浮对话里发先读仓库与已声明文档的立项分析咒语。两档咒语都只发一次：判据读会话自身的记录——已起过回合、已有消息，或首条提示正等首个回合——所以关掉向导、刷新页面或重开窗口只按这些事实重算阶段，不会重发。确认需求对最新 REQ 派 `/requirement_approve`，成功后关闭面板并重读投影；失败则面板保持打开并显示宿主原话。任务页页头打开一张独立的立项结果页：默认展示编号最大的需求（其余需求就地切换），画出正文、候选、推荐与状态，列出全部已起草任务并标注回指当前需求的那些，以及项目登记、仓库、分支与三份文档路径；还没有需求时给出同样的两个立项入口，读不懂的投影文件按 problems 原话列出。立项会话的浮层头多一个「重新开始」：确认框列出项目登记、规格条目、任务与方案，确认后按宿主默认角色新建会话并重发同一档立项咒语；已落盘内容一概不删，旧会话仍可从顶栏点开回看。

「开工」与流程面板画的是 kernel `/flow_status` 的结果：策略来源与开关、整体下一步与挡住原因、逐任务计划。判定没有挡住原因、且动作是外壳能交给会话的那几种（`contract`、`implement`、`verify`、`close`、`commit`）才算可开始；签署与外部动作单独列出等人处理。批量开工按计划顺序逐条执行，单条失败不影响后面的；每条结果通过 `/flow_log` 落盘。已经在会话里跑着或排着队的任务只切过去，所以重复点不会把提示词再发一遍。动作流水合并 `.spec/evidence/<任务>/flow.jsonl` 与 `schedule.jsonl`，按时刻倒序。

智能调度与流程控制入口按 `.spec/agents.yaml` 的 `schedulerSession` / `flowSession` 找单例会话；会话不在或 `agentPreset` 对不上时，先找同 preset 的工作区会话，最后才新建并通过 `/agent_bind` 写回会话号。每次打开都把标题校正成角色名。两个 preset 都显式挂了 `compaction-basic`，所以切模型后阈值仍随适配器的 `contextWindow` 走。本包自身不注册模型工具、提示词段落或 schema。

| 文件 | 职责 |
|---|---|
| `src/client/index.ts` | 外壳注册、文件/提示回调，以及 `shell: false` 页签 |
| `src/client/shell/Shell.tsx` | 左侧菜单、需求页与任务页、项目信息抽屉、任务详情与悬浮对话 |
| `src/client/shell/RequirementsPage.tsx` | 需求表格与九态看板：筛选、已取消开关与新建入口 |
| `src/client/shell/RequirementDetail.tsx` | 需求详情抽屉：正文、立项问答、关联任务、讨论历史与四条人机动作 |
| `src/client/shell/MarkdownReader.tsx` | 全屏 Markdown 阅读器：缩放、拖动平移、键盘操作与加载失败空态 |
| `src/client/shell/requirement-page.ts` | 需求派生：九态、关联任务、更新时间、筛选与分列 |
| `src/client/shell/ChatExtras.tsx` | 模型 chip 与服务商面板、附件条与附件按钮 |
| `src/client/shell/TaskAttachments.tsx` | 任务图片附件的只读缩略图与放大弹窗 |
| `src/client/shell/chat-composer.ts` | 纯函数：模型面板状态、当前模型解析、附件校验与提示词拼装 |
| `src/client/shell/shell-data.ts` | 外壳类型、逐任务启动咒语、立项咒语与会话消息提取 |
| `src/client/shell/requirement-split.ts` | 以 REQ 为输入的项目经理拆分：调研与按轨指令、轮询与按轨汇总 |
| `src/client/shell/plan-discussion.ts` | 方案讨论：固定三方加按轨技术岗位、指令拼装、契约起草与确认门禁 |
| `src/client/shell/discussion-history.ts` | 讨论历史：需求编号过滤、角色标记解析、preset 兜底与按角色分组 |
| `src/client/shell/session-turn.ts` | 共用的一轮等待：最后一条助手答复、结束判据与超时 |
| `src/client/shell/intake.ts` | 立项会话档位识别、重开动作与最新需求取数 |
| `src/client/shell/intake-wizard.ts` | 按会话事实算向导阶段、摊平过程条目与模型选项 |
| `src/client/shell/IntakeWizard.tsx` | 需求分析师向导：简介、提问层、思考行与结果卡 |
| `src/client/shell/IntakeResultPage.tsx` | 立项结果页与重开确认框 |
| `src/client/onboarding.ts` | 立项动作的发/只开/拦下判定，判据取会话事实 |
| `src/client/flow-status.ts` | `/flow_status` JSON 的形状校验 |
| `src/client/flow-history.ts` | `flow.jsonl` / `schedule.jsonl` 的合并动作流水 |
| `src/client/singleton.ts` | 两个调度角色的常驻会话解析 |
| `src/client/shell/Shell.module.css` | 外壳布局与浮层样式 |
| `src/client/projection.ts` | `.spec` 任务/规则/需求/交付索引、`project.yaml` 与 `local.yaml` 读取 |
| `src/client/definition.ts` | 回退模式的页签 kind、id、优先级与引导入口 |
| `src/client/WorkspaceBody.tsx` | 回退页签的三栏正文 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- `packages/lcoder/kernel` —— 宿主插件；它的文件工具使用仓库根。
- `lcoder/RUN.md` —— 启动、桌面 profile 与 smoke 步骤。
- `packages/client/ui-workspace` —— 项目选择器背后的上游工作区模型。
- `packages/lcoder/kernel/fixtures/demo` —— 带 `.spec` 的演示仓库。

-----

<a id="model-experience"></a>
## 模型体验

### Shell UI

#### 模型看到什么

外壳不注册工具、提示词段落或 schema。用户从悬浮对话发送的提示（含立项咒语）按普通会话输入到达模型；任务与项目数据通过 `workspaceFiles` 读取，不注入请求。

#### Token 影响

本包不产生额外影响；用户提示与回复是普通会话内容。

#### KV Cache 影响

没有；本包不改变请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 「打开仓库」超时只解放外壳：底层 `workspaces.create` 仍在挂，因为上游 Workspace 命令队列没有取消语义。
- 会话条按认领该会话的任务标名，不标角色；单例入口从会话投影读 `agentPreset`，但列表仍显示认领任务的标题。
- 悬浮对话只从会话事件窗口渲染最终用户/助手文本，不是完整 DSH 会话 UI（工具卡片、逐 token 流式）。压缩标记与上下文占用会画出来，压缩摘要本身仍是普通上下文行。
- `flow_status` 只在投影重读与一批开工结束后求值；面板不订阅 `.spec` 文件变化。
- 任务板读取所选工作区的第一个会话；每个任务单独建会话尚未实现。
- 外壳在所选工作区或会话变化时重载；通过 `workspaceFiles.changes` 的增量刷新尚未实现。
- 项目信息抽屉从 `.spec/local.yaml` 解析 `passwordRef`；环境变量解析尚未实现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

构建用 `pnpm --filter @lcoder/workspace run bundle`；根 `tsconfig.client.json` 通过 `references` 包含本包，所以 `pnpm typecheck` 会覆盖它。包测试用 `pnpm exec vitest run packages/lcoder/workspace`。改页签路径时保持 `shell: false` 回退可用。

</details>
