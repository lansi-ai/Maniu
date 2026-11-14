---
description: "LCoder 自研渲染端的 T-187 S1 骨架：登录门禁读 lcoderCloud.state，会话列表由 session.list 与 api-session 事件驱动，聊天经 follow 渲染流式 assistant 文本，全部走 preload 的窄 IPC。"
kind: "package-reference"
---

# @lcoder/client

[English](README.md) | 中文

<a id="summary"></a>
## 概述

- `src/app.tsx`：登录门禁、会话列表、发消息、流式正文。
- `src/store.ts`：`session.follow` 三帧（snapshot / event / assistant-stream）的纯折叠；入口 `session.list` + `api-session/*` 事件。
- `src/contract.ts`：`window.lcoder` 窄 IPC 契约，与主进程同名同形。
- 渲染端无 Node、无 `fetch`、无宿主 cookie；所有宿主访问经 preload 暴露的 IPC。

<a id="table-of-contents"></a>
## 目录

- [概述](#summary)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

### 聊天渲染

#### 模型看到什么

本包自己不加任何内容：渲染端不在宿主进程里运行，界面上的文本来自 `session.follow` 的帧与 `assistant/message` 记录。

#### Token 影响

输入框里的文本是本包唯一发起的模型输入，经宿主的 `session.prompt` Remote 提交。

#### KV Cache 影响

渲染端不保留请求组装状态，因此不会让宿主的请求前缀缓存失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 流式正文只画 assistant 文本；工具卡、审批/提问卡片、附件与 Markdown 阅读器在 M1/M2 实现。

### 开发备注

<a id="dev-note"></a>

构建与启动见 [lcoder/s1.md](../../../lcoder/s1.md)。
