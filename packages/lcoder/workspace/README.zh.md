---
description: "LCoder 专属外壳：项目切换、五态任务板、项目信息抽屉，以及基于会话工作区 .spec 的真实悬浮对话。"
kind: "package-reference"
---

# @lcoder/workspace

[English](README.md) | 中文

## 概述

`@lcoder/workspace` 是 LCoder 的外壳。它展示当前项目、从会话工作区 `.spec` 读出的五态任务板、从 `.spec/project.yaml` 读出的项目信息抽屉，以及把 dev-flow 启动咒语发送到真实会话的悬浮对话。项目选择器可以打开另一个仓库，创建或复用它的工作区并建一个会话。看板为空时给出立项咒语，文档路径取自 `.spec/project.yaml` 声明的交付文档。kernel 已运行时通过 LCoder patch 层挂载；`shell: false` 保留旧的右栏工作台页签。外壳对产品数据只读：状态机判断与写入都归 kernel。

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
从任务卡打开对话时，外壳复用该任务已经认领的那条会话（`.spec/tasks/<ID>.yaml` 的 `session` 字段）。没有还在的会话时，外壳在同一个仓库里再开一条，并在创建这一步指名角色——preset 在首回合之后就锁死——再通过人机命令 `/task_bind` 把任务认给这条会话，落盘由 kernel 做。角色来自 `agentPresets.list`；名册读失败或是空的，就按宿主默认角色开。顶栏的会话条列出本工作区的会话，按认领它的任务标名，点一下就切过去。

悬浮对话订阅会话事件窗口并渲染用户/助手文本；输入框向同一会话继续发送提示。磁盘上没有任务时，看板的立项动作填入并发送分析咒语，而不是逐任务的启动咒语。本包自身不注册模型工具、提示词段落或 schema。

| 文件 | 职责 |
|---|---|
| `src/client/index.ts` | 外壳注册、文件/提示回调，以及 `shell: false` 页签 |
| `src/client/shell/Shell.tsx` | 项目切换、任务板、项目信息抽屉、任务详情与悬浮对话 |
| `src/client/shell/shell-data.ts` | 外壳类型、逐任务启动咒语、立项咒语与会话消息提取 |
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
- 会话条按认领该会话的任务标名，不标角色：框架的会话行不带 `agentPreset`，外壳也不从记录里猜。
- 悬浮对话只从会话事件窗口渲染最终用户/助手文本，不是完整 DSH 会话 UI（工具卡片、逐 token 流式）。
- 任务板读取所选工作区的第一个会话；每个任务单独建会话尚未实现。
- 外壳在所选工作区或会话变化时重载；通过 `workspaceFiles.changes` 的增量刷新尚未实现。
- 项目信息抽屉从 `.spec/local.yaml` 解析 `passwordRef`；环境变量解析尚未实现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

构建用 `pnpm --filter @lcoder/workspace run bundle`；根 `tsconfig.client.json` 通过 `references` 包含本包，所以 `pnpm typecheck` 会覆盖它。包测试用 `pnpm exec vitest run packages/lcoder/workspace`。改页签路径时保持 `shell: false` 回退可用。

</details>
