---
description: "LCoder's self-built React renderer for T-187 S1, T-189 M2, T-190 M3, and T-191 M1: an account gate with SMS/password sign-in and a personal center, a follow-based chat with process groups, approval/question cards, attachments, model chip, and context usage, a .spec workbench, and a system surface with model, skin, font, language, and update settings."
kind: "package-reference"
---

# @lcoder/client

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

- `src/app.tsx`：登录门禁、会话列表、聊天与工作台导航；欢迎屏与登录页在门禁内切换。
- `src/account/`：验证码/密码登录、注册、退出与令牌刷新、个人中心与用量分页；令牌始终留在宿主凭据里。
- `src/pages/settings.tsx`、`src/settings/model-settings.ts`：模型服务（provider、路由、钥匙三态、默认模型）、皮肤、字体、语言与更新空态；`src/prefs.ts` 持久化本地偏好。
- `src/locale-zh.ts` / `src/locale-en.ts`：新壳与 M3 新增文案的双语词典；`src/theme/skins.css` 提供霓虹/冷银/粉樱三套皮肤与自托管 Inter。
- `src/store.ts`：`session.follow` 三帧（snapshot / event / assistant-stream）的纯折叠；按 seq 检测缺口并要求重开快照，折叠会话标题、投影水位、按回合收敛的过程组与工具结果摘要；入口 `session.list` + `api-session/*` 事件。
- `src/chat/`：审批/提问回执编码（`approvalOutcome` / `questionOutcome` 原样发回宿主结果）、模型与上下文用量判定、图片上限与提示词拼装、附件读取与 `session/attachment` 预览、`session/control` 投影流。
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

- 中英只覆盖新壳与 M3 面；M2 工作台页面的既有文案仍为中文，本轮只要求新增文案走词典。
- 密码重置没有对应的 `lcoderCloud` Remote，界面不提供入口；退出与令牌刷新已接入。
- S1 profile 的 `llm-pi-ai` base 层把 `lcoder-cloud.baseURL` 保存为 `!!js` 表达式对象，`settings.mutate` 会整段拒绝；设置页把宿主的拒绝原样显示。密钥三态可读，`credentials.set`/`unset` 的写入与删除已单独验证。
- 本机 mock 只回文本、不能发起工具调用，因此审批卡与提问卡的真实往返只在单测里验证回执编码；S1 profile 的唯一模型只有文本模态，图片无法落成 durable 引用，聊天内图片预览（`session/attachment`）也只由单测覆盖调用形状。接上可跑工具的模型与支持图片的 provider 后应各补一条探针。
- `session/control` 是宿主级流；冷会话在流打开后才激活时，模型与用量先取 follow 开场帧里的投影，再被同键、更高水位的控制帧覆盖。
- 任务附件的图片缩略图依赖 `workspaceFiles.readBytes` 的 multipart 解码，已在适配层实现，但超大文件与断流未压测。
- 讨论历史的参会身份聚合依赖 `session/events`；没有赠送会话时只显示定位不到。

### Dev Note

构建与启动见 [lcoder/s1.md](../../../lcoder/s1.md)。
