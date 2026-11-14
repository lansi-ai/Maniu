---
description: "LCoder's React renderer skeleton for T-187 S1 and T-189 M2: a login gate driven by lcoderCloud.state, the session list fed by session.list and api-session events, a follow-based chat, and a workbench projected from .spec through the Host workspaceFiles Remote."
kind: "package-reference"
---

# @lcoder/client

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

- `src/app.tsx`：登录门禁、会话列表、聊天与工作台导航。
- `src/store.ts`：`session.follow` 三帧（snapshot / event / assistant-stream）的纯折叠；入口 `session.list` + `api-session/*` 事件。
- `src/spec/`：`.spec` 文件投影（任务、规则、契约、方案、需求、交付物、联调组、岗位、项目与本地密钥），全部经宿主 `workspaceFiles` 读取。
- `src/pages/`：需求、任务（六列看板/列表、详情、附件）、项目、项目信息、角色、设置；Markdown 渲染器与全屏阅读器。
- `src/commands/run.ts`：人机命令只走 `commands.execute`，主进程对命令名再做一层白名单。
- `src/theme/liquid-glass.css`：新客户端主题底座，集中 `--lg-*` token、环境背景层与 `.lg-glass` / `.lg-sheen` / `.lg-lift` 基元；其余样式只消费这些变量。
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

- 流式正文仍只画 assistant 文本：工具卡只有文字结果，审批/提问卡片仍是 waterfall 转发、没有回执 UI；模型 chip 与上下文用量未接入。
- 任务附件的图片缩略图依赖 `workspaceFiles.readBytes` 的 multipart 解码，已在适配层实现，但超大文件与断流未压测。
- 讨论历史的参会身份聚合依赖 `session/events`；没有赠送会话时只显示定位不到。

### Dev Note

构建与启动见 [lcoder/s1.md](../../../lcoder/s1.md)。
