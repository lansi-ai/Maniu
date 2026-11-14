---
description: "LCoder's Electron shell skeleton for T-187 S1: a frameless window, a supervised minimal host profile process, a self-written token-to-cookie/unary-POST/WS-mux/$events link layer, and a narrow renderer IPC surface."
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
- `src/main.ts` / `src/window.ts`：单实例、frameless 主窗口（最小 520×600）、渲染产物加载。

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

- S1 只服务一条端到端竖切：登录门禁、会话列表、发消息与流式正文；审批/提问回执、附件、工具卡、工作台五页在 M1/M2 实现。

### Dev Note

构建与启动见 [lcoder/s1.md](../../../lcoder/s1.md)。
