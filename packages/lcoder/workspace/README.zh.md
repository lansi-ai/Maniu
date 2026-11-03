---
description: "LCoder 工作台页签：通过上游 workspaceFiles 远程只读投影 .spec 任务与规则的三栏界面，不产生任何模型侧贡献。"
kind: "package-reference"
---

# @lcoder/workspace

[English](README.md) | 中文

## 概述

`@lcoder/workspace` 在右栏增加 LCoder 工作台页签。页签通过上游 `workspaceFiles` 远程读取 `.spec` 下的任务与规则 YAML，画出三栏：任务、规格与代码落点、对话。它是只读投影：状态机判断留在 kernel，浏览器从不写入产品数据。已经运行 kernel 时，通过 LCoder patch 层挂载它；它没有配置面，也不自建 Remote。没有绑定工作区时，三栏保持骨架态。

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

在 LCoder patch 层挂载本包，然后在绑定了含 `.spec` 仓库的会话里打开工作台页签。

### 何时选择它

当同一组合里已经运行 kernel，且用户需要在不询问模型的情况下读取任务与规则时选择它。不要用它编辑规格数据或做状态迁移：本包只是投影，写入与状态机判断都归 kernel。

### 最小配置

```yaml
- insert:
    - id: ui-lcoder-workspace
      name: '@lcoder/workspace'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| （无） | — | 本包没有配置面 |

本包通过 patch 层作为插件行挂载，没有 `dsh plugin add` 安装路径。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内幕——点击展开</summary>

本包注册三项浏览器侧贡献：页签类型、词典命名空间与正文。正文通过槽位 `inject` 工厂拿到投影函数，因此本包依赖槽位运行时、词典服务、页签注册表与远程面；缺少任何一项就不激活。

数据路径在 `src/client/projection.ts`：它调用 `workspaceFiles` 命名空间上的 `files.list` 与 `files.readPage`，解析 YAML，返回展示行与逐文件问题。宿主按会话工作区（`session.header.cwd`）解析相对路径，kernel 也从同一个会话头解析规格根，因此工具与 UI 读同一个 `.spec`。

| 文件 | 职责 |
|---|---|
| `src/client/definition.ts` | 页签 kind、id、优先级与引导页入口 |
| `src/client/index.ts` | 服务注入、词典注册与正文槽位注册 |
| `src/client/projection.ts` | 通过 `workspaceFiles` 读 `.spec` YAML 并构造展示行 |
| `src/client/WorkspaceBody.tsx` | 渲染三栏与空态、错误态 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- `packages/lcoder/kernel` —— 写本包所读 YAML 的宿主插件。
- `packages/client/ui-sidebar-files` —— 最完整的上游页签实现，含 store 与组件。
- `packages/client/ui-agent-preset` —— 与工作台最接近的设置页形态。
- `lcoder/RUN.md` —— 启动、挂载与验证步骤。

-----

<a id="model-experience"></a>
## 模型体验

### 工作台 UI

#### 模型看到什么

没有。工作台通过 `workspaceFiles` 读 `.spec` YAML 并在浏览器里渲染；它不注册工具、提示词段落或模型 schema。

#### Token 影响

没有；本包从不构造模型请求。

#### KV Cache 影响

没有；不改变任何请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- kernel 的 `file_read` / `file_edit` 仍以规格根为边界；真实仓库验收时需确认是否应改用仓库根。
- 工作台在页签打开时读一次；通过 `workspaceFiles.changes` 做增量刷新尚未实现。
- 三栏共享选中项推迟到 T-03。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

构建用 `pnpm --filter @lcoder/workspace run bundle`；根 `tsconfig.client.json` 通过 `references` 包含本包，所以 `pnpm typecheck` 会覆盖它。包测试用 `pnpm exec vitest run packages/lcoder/workspace`。

</details>
