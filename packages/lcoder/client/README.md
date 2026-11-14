---
description: "LCoder's React renderer skeleton for T-187 S1: a login gate driven by lcoderCloud.state, the session list fed by session.list and api-session events, and a follow-based chat that renders streaming assistant text through narrow preload IPC."
kind: "package-reference"
---

# @lcoder/client

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

- `src/app.tsx`：登录门禁、会话列表、发消息、流式正文。
- `src/store.ts`：`session.follow` 三帧（snapshot / event / assistant-stream）的纯折叠；入口 `session.list` + `api-session/*` 事件。
- `src/contract.ts`：`window.lcoder` 窄 IPC 契约，与主进程同名同形。
- 渲染端无 Node、无 `fetch`、无宿主 cookie；所有宿主访问经 preload 暴露的 IPC。

<a id="table-of-contents"></a>
## Table of Contents

- [Summary](#summary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

### Chat rendering

#### What the model sees

Nothing of its own: the renderer never runs in the Host process, and the text it shows comes from `session.follow` frames and `assistant/message` records.

#### Token effect

Composer text is the only model input this package originates, through the Host `session.prompt` Remote.

#### KV Cache effect

The renderer keeps no request-assembly state, so it cannot invalidate the Host's cached request prefix.

## Known Limitations and Deferred Work

- 流式正文只画 assistant 文本；工具卡、审批/提问卡片、附件与 Markdown 阅读器在 M1/M2 实现。

### Dev Note

构建与启动见 [lcoder/s1.md](../../../lcoder/s1.md)。
