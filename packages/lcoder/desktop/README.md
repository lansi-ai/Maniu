---
description: "LCoder's Electron shell for T-187 S1 and T-190 M3: a frameless window with synchronized maximize state and drag regions, a supervised host profile process, a self-written token-to-cookie/unary-POST/WS-mux/$events link layer, a localized menu and tray, and a narrow renderer IPC surface."
kind: "package-reference"
---

# @lcoder/desktop

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

主进程内的 S1 竖切，只覆盖「起宿主 → 登录门禁 → 列会话 → 发一条 → 流式正文 → 重启读历史」：

- `src/host-entry.ts`：最小宿主进程，用 `runProfile` 跑 `<DSH_HOME>/profiles/s1`，把 ready URL 报回主进程。
- `src/host-supervisor.ts`：拉起/关停宿主子进程，读 `ready`/`fatal` IPC。
- `src/link.ts`：主进程内协议适配层——launch token 换 cookie（`interactions=answer`）、一元 `POST /api/<ns>/<method>`、WS `/api/remote.mux`、`$events` 与 `$events/result`。
- `src/preload.ts` / `src/ipc.ts`：只暴露 call/stream/events/window 的窄 IPC；命名空间与方法白名单在 `link.ts`。
- `src/main.ts` / `src/window.ts`：单实例、frameless 主窗口（最小 520×600）、渲染产物加载、最大化/全屏状态推送。
- `src/menu.ts` / `src/tray.ts` / `src/desktop-locale.ts`：本地化应用菜单（含缩放与全屏快捷键）、托盘打开/退出，语言由渲染端经 IPC 同步并写入 userData。
- `src/update.ts`：更新检查占位；没有更新源时返回可解释的 `unavailable/no-feed`，界面不显示网络错误。

<a id="table-of-contents"></a>
## Table of Contents

- [Summary](#summary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

### Session transport

#### What the model sees

Nothing of its own: the shell only carries `session.prompt` text into the Host and renders `session.follow` frames back; every tool and prompt comes from the Host profile.

#### Token effect

Only the text submitted through `session.prompt` enters the request; the window, IPC, and link layers add no tokens.

#### KV Cache effect

One follow stream per selected session leaves the Host's request prefix reusable across consecutive prompts until the preset or tool set changes.

## Known Limitations and Deferred Work

- 更新检查尚未接入 `electron-updater`；当前构建只返回「没有更新源」空态，安装入口不可用。
- 托盘只提供打开与退出；关闭窗口仍直接退出，没有「最小化到托盘」。
- 没有接入退出确认、运行中任务检查与安装期锁；这些随打包与更新任务补齐。

### Dev Note

构建与启动见 [lcoder/s1.md](../../../lcoder/s1.md)。
