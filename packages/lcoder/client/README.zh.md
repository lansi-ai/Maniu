---
description: "LCoder 自研渲染端的 T-187 S1、T-189 M2 与 T-190 M3 骨架：账号门禁支持验证码/密码登录与个人中心，聊天经 follow 渲染流式正文，工作台经宿主 workspaceFiles 投影 .spec，并带模型、皮肤、字体、语言与更新等系统面。"
kind: "package-reference"
---

# @lcoder/client

[English](README.md) | 中文

<a id="summary"></a>
## 概述

- `src/app.tsx`：登录门禁、会话列表、聊天与工作台导航；欢迎屏与登录页在门禁内切换。
- `src/account/`：验证码/密码登录、注册、退出与令牌刷新、个人中心与用量分页；令牌始终留在宿主凭据里。
- `src/pages/settings.tsx`、`src/settings/model-settings.ts`：模型服务（provider、路由、钥匙三态、默认模型）、皮肤、字体、语言与更新空态；`src/prefs.ts` 持久化本地偏好。
- `src/locale-zh.ts` / `src/locale-en.ts`：新壳与 M3 新增文案的双语词典；`src/theme/skins.css` 提供霓虹/冷银/粉樱三套皮肤与自托管 Inter。
- `src/store.ts`：`session.follow` 三帧（snapshot / event / assistant-stream）的纯折叠；入口 `session.list` + `api-session/*` 事件。
- `src/spec/`：`.spec` 文件投影（任务、规则、契约、方案、需求、交付物、联调组、岗位、项目与本地密钥），全部经宿主 `workspaceFiles` 读取。
- `src/pages/`：需求、任务（六列看板/列表、详情、附件）、项目、项目信息、角色、设置；Markdown 渲染器与全屏阅读器。
- `src/commands/run.ts`：人机命令只走 `commands.execute`，主进程对命令名再做一层白名单。
- `src/theme/liquid-glass.css`：新客户端主题底座，集中 `--lg-*` token、环境背景层与 `.lg-glass` / `.lg-sheen` / `.lg-lift` 基元；其余样式只消费这些变量。
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

- 中英只覆盖新壳与 M3 面；M2 工作台页面的既有文案仍为中文，本轮只要求新增文案走词典。
- 密码重置没有对应的 `lcoderCloud` Remote，界面不提供入口；退出与令牌刷新已接入。
- S1 profile 的 `llm-pi-ai` base 层把 `lcoder-cloud.baseURL` 保存为 `!!js` 表达式对象，`settings.mutate` 会整段拒绝；设置页把宿主的拒绝原样显示。密钥三态可读，`credentials.set`/`unset` 的写入与删除已单独验证。
- 流式正文仍只画 assistant 文本：工具卡只有文字结果，审批/提问卡片仍是 waterfall 转发、没有回执 UI；模型 chip 与上下文用量未接入。
- 任务附件的图片缩略图依赖 `workspaceFiles.readBytes` 的 multipart 解码，已在适配层实现，但超大文件与断流未压测。
- 讨论历史的参会身份聚合依赖 `session/events`；没有讨论会话时只显示定位不到。

### 开发备注

<a id="dev-note"></a>

构建与启动见 [lcoder/s1.md](../../../lcoder/s1.md)。
