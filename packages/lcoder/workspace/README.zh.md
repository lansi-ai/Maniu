---
description: "LCoder 专属外壳：项目切换、五态任务板、项目信息抽屉，以及基于会话工作区 .spec 的真实悬浮对话。"
kind: "package-reference"
---

# @lcoder/workspace

[English](README.md) | 中文

## 概述

`@lcoder/workspace` 是 LCoder 的外壳：当前项目、从会话工作区 `.spec` 读出的五态任务板与项目信息抽屉、悬浮对话、空看板的立项入口、展示方案与已起草任务的立项结果页、按同一档咒语新开会话的「重新开始」，以及向 kernel 求下一步、只启动选中的可开始任务且不推进状态的「开工」面板。顶栏两个入口打开智能调度与流程控制常驻会话；对话里显示上下文占用与压缩标记，还能用紧凑 chip 切换会话模型，并把图片或文件随提示一起发出。kernel 已运行时通过 LCoder patch 层挂载；`shell: false` 保留旧的右栏工作台页签。外壳对产品数据只读：状态机判断与写入都归 kernel。

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

本包注册外壳主面板；`shell: false` 时注册旧的页签。外壳通过框架 hooks 读工作区与会话列表，通过 `workspaceFiles` 读 `.spec/tasks`、`.spec/spec/rules.yaml`、`.spec/project.yaml` 与 `.spec/local.yaml`，并通过会话控制器发送提示。项目选择器的「打开仓库」调用 `workspaces.create` 与 `sessions.create`，然后选中新工作区。每一步最多等 `openTimeoutMs`：到点抛 `WorkspaceOpenTimeoutError` 并带上卡住的步骤名，被拒绝则保留对方返回的原因；两种情况用不同词典键，挂住的调用不会被写成「打开失败」。

从任务卡打开对话时，外壳复用该任务已经认领的那条会话（`.spec/tasks/<ID>.yaml` 的 `session` 字段）。没有还在的会话时，外壳在同一个仓库里再开一条，并在创建这一步指名角色——preset 在首回合之后就锁死——再通过人机命令 `/task_bind` 把任务认给这条会话，落盘由 kernel 做。角色来自 `agentPresets.list`，且只给 id 以 `lcoder` 开头的 preset——上游角色不挂本包的十个工具，根本读不到 `.spec`；名册读失败或是空的，就按宿主默认角色开。顶栏的会话条列出本工作区的会话，按认领它的任务标名，点一下就切过去。

悬浮对话订阅会话事件窗口并渲染用户/助手文本；输入框向同一会话继续发送提示。头部 chip 从 `modelSelection` 投影读当前模型，没记过时显示目录默认值并标为默认；点开按服务商分组，选中时调 `session.selectModel`，同一次调用也保存全局默认。输入区把图片读成 base64 的 `image` part，其余文件先经 `fileUploads.upload` 拿回执，图片按会话广播的 `imageLimits` 校验，发送时把文本、图片、文件拼成一次提示。发送被拒时保留草稿与附件；模型不支持图片时如实说明，不丢附件。磁盘上没有任务时，看板给出两个共用同一条会话的入口：「全新项目」发 7 问引导咒语，「已有资料」发先读仓库与已声明文档的立项分析咒语。先点哪个都只发一次，之后再点任一个都只重开悬浮对话。判据读会话自身的记录——已起过回合、已有消息，或首条提示正等首个回合——所以刷新页面或重开窗口也不会重发。看板页头打开一张独立的立项结果页：默认展示编号最大的方案（其余方案就地切换），列出全部已起草任务并标注回指当前方案的那些，以及项目登记、仓库、分支与三份文档路径；还没有方案时给出同样的两个立项入口，读不懂的投影文件按 problems 原话列出。立项会话的浮层头多一个「重新开始」：确认框列出项目登记、规格条目、任务与方案，确认后按宿主默认角色新建会话并重发同一档立项咒语；已落盘内容一概不删，旧会话仍可从顶栏点开回看。

「开工」与流程面板画的是 kernel `/flow_status` 的结果：策略来源与开关、整体下一步与挡住原因、逐任务计划。判定没有挡住原因、且动作是外壳能交给会话的那几种（`contract`、`implement`、`verify`、`close`、`commit`）才算可开始；签署与外部动作单独列出等人处理。批量开工按计划顺序逐条执行，单条失败不影响后面的；每条结果通过 `/flow_log` 落盘。已经在会话里跑着或排着队的任务只切过去，所以重复点不会把提示词再发一遍。动作流水合并 `.spec/evidence/<任务>/flow.jsonl` 与 `schedule.jsonl`，按时刻倒序。

智能调度与流程控制入口按 `.spec/agents.yaml` 的 `schedulerSession` / `flowSession` 找单例会话；会话不在或 `agentPreset` 对不上时，先找同 preset 的工作区会话，最后才新建并通过 `/agent_bind` 写回会话号。每次打开都把标题校正成角色名。两个 preset 都显式挂了 `compaction-basic`，所以切模型后阈值仍随适配器的 `contextWindow` 走。本包自身不注册模型工具、提示词段落或 schema。

| 文件 | 职责 |
|---|---|
| `src/client/index.ts` | 外壳注册、文件/提示回调，以及 `shell: false` 页签 |
| `src/client/shell/Shell.tsx` | 项目切换、任务板、项目信息抽屉、任务详情与悬浮对话 |
| `src/client/shell/ChatExtras.tsx` | 模型 chip 与服务商面板、附件条与附件按钮 |
| `src/client/shell/chat-composer.ts` | 纯函数：模型面板状态、当前模型解析、附件校验与提示词拼装 |
| `src/client/shell/shell-data.ts` | 外壳类型、逐任务启动咒语、立项咒语与会话消息提取 |
| `src/client/shell/intake.ts` | 立项会话档位识别、重开动作与结果页计数 |
| `src/client/shell/IntakeResultPage.tsx` | 立项结果页与重开确认框 |
| `src/client/onboarding.ts` | 立项动作的发/只开/拦下判定，判据取会话事实 |
| `src/client/flow-status.ts` | `/flow_status` JSON 的形状校验 |
| `src/client/flow-history.ts` | `flow.jsonl` / `schedule.jsonl` 的合并动作流水 |
| `src/client/singleton.ts` | 两个调度角色的常驻会话解析 |
| `src/client/shell/Shell.module.css` | 外壳布局与浮层样式 |
| `src/client/projection.ts` | `.spec` 任务/规则、`project.yaml` 与 `local.yaml` 读取 |
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
