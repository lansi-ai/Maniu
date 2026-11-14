---
description: "LCoder 自研 Electron 壳的 T-187 S1 与 T-190 M3 骨架：带最大化状态同步与拖拽区的 frameless 窗口、受监督的宿主 profile 子进程、自写的 token→cookie/一元 POST/WS mux/$events 适配层、本地化菜单与托盘，以及渲染端的窄 IPC 面。"
kind: "package-reference"
---

# @lcoder/desktop

[English](README.md) | 中文

<a id="summary"></a>
## 概述

主进程内的 S1 竖切，只覆盖「起宿主 → 登录门禁 → 列会话 → 发一条 → 流式正文 → 重启读历史」：

- `src/host-entry.ts`：最小宿主进程，用 `runProfile` 跑 `<DSH_HOME>/profiles/s1`，把 ready URL 报回主进程。
- `src/host-supervisor.ts`：拉起/关停宿主子进程，读 `ready`/`fatal` IPC。
- `src/link.ts`：主进程内协议适配层——launch token 换 cookie（`interactions=answer`）、一元 `POST /api/<ns>/<method>`、WS `/api/remote.mux`、`$events` 与 `$events/result`。
- `src/preload.ts` / `src/ipc.ts`：只暴露 call/stream/events/window 的窄 IPC；命名空间与方法白名单在 `link.ts`。
- `src/main.ts` / `src/window.ts`：单实例、frameless 主窗口（最小 520×600）、渲染产物加载、最大化/全屏状态推送。
- `src/menu.ts` / `src/tray.ts` / `src/desktop-locale.ts`：本地化应用菜单（含缩放与全屏快捷键）、托盘打开/退出，语言由渲染端经 IPC 同步并写入 userData。
- `src/update.ts`：更新检查占位；没有更新源时返回可解释的 `unavailable/no-feed`，界面不显示网络错误。
- 关窗即退出（与旧壳一致），托盘只在运行期提供「回到窗口 / 退出」；关停有 12 秒硬上限，超时先杀宿主再强制退出，绝不静默驻留。

<a id="table-of-contents"></a>
## 目录

- [概述](#summary)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

### 会话传输

#### 模型看到什么

本包自己不加任何内容：外壳只把 `session.prompt` 的文本送进宿主，并把 `session.follow` 的帧画回界面；工具与提示词全部来自宿主 profile。

#### Token 影响

只有经 `session.prompt` 提交的文本进入请求；窗口、IPC 与链路层不增加 token。

#### KV Cache 影响

每个选中会话只保留一条 follow 流，因此连续提示在 preset 或工具集变化前复用宿主的请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 更新检查尚未接入 `electron-updater`；当前构建只返回「没有更新源」空态，安装入口不可用。
- 托盘只提供打开与退出；关闭窗口仍直接退出，没有「最小化到托盘」。
- 没有接入退出确认、运行中任务检查与安装期锁；这些随打包与更新任务补齐。

### 开发备注

<a id="dev-note"></a>

构建与启动见 [lcoder/s1.md](../../../lcoder/s1.md)。
