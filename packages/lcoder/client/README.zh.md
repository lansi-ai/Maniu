---
description: "LCoder 自研渲染端的 T-187 S1、T-189 M2、T-190 M3 与 T-191 M1 骨架：账号门禁支持验证码/密码登录与个人中心，聊天经 follow 渲染流式正文、过程组、审批/提问卡、附件、模型 chip 与上下文用量，工作台经宿主 workspaceFiles 投影 .spec，并带模型、皮肤、字体、语言与更新等系统面。"
kind: "package-reference"
---

# @maniu/client

[English](README.md) | 中文

<a id="summary"></a>
## 概述

- `src/app.tsx`：登录门禁、会话列表、聊天与工作台导航；欢迎屏与登录页在门禁内切换；审批/提问卡在对话页排进消息列、其他页走右下浮层；立项会话的首条指令整行不渲染、标题固定为「需求分析」；需求页的立项入口只对空项目开放，进入会话前还会再拒一次；运行中关窗的确认层由主进程 `lcoder:close-request` 触发。
- `src/account/`：验证码/密码登录、注册、退出与令牌刷新、个人中心与用量分页；令牌始终留在宿主凭据里。
- `src/pages/settings.tsx`、`src/settings/model-settings.ts`：模型服务首版只读（provider、密钥三态与默认模型可见）、皮肤、字体、语言与手动更新说明；`src/prefs.ts` 持久化本地偏好。
- `src/locale-zh.ts` / `src/locale-en.ts`：新壳与 M3 新增文案的双语词典；`src/theme/skins.css` 提供霓虹/冷银/粉樱三套皮肤与自托管 Inter。
- `src/prefs.ts`：皮肤、字体与语言以主进程 userData 的偏好文件为权威值，localStorage 只作渲染端缓存；启动时先经 `lcoder:preferences-read` 取回落盘值再挂载，点击即经 `lcoder:preferences-write` 同步落盘。
- `src/store.ts`：`session.follow` 三帧（snapshot / event / assistant-stream）的纯折叠；按 seq 检测缺口并要求重开快照，折叠会话标题、投影水位、按回合收敛的过程组与工具结果摘要；入口 `session.list` + `api-session/*` 事件。
- `src/chat/`：审批/提问回执编码（`approvalOutcome` / `questionOutcome` 原样发回宿主结果）、模型与上下文用量判定、图片上限与提示词拼装、附件读取与 `session/attachment` 预览、`session/control` 投影流。
- `src/spec/`：`.spec` 文件投影（任务、规则、契约、方案、需求、交付物、联调组、岗位、流程配置、项目与本地密钥），全部经宿主 `workspaceFiles` 读取；方案投影含需求变更载荷。
- `src/pages/`：需求、任务（六列看板/列表、详情、附件）、项目、项目信息（数据库密码按 `passwordRef` 从内存里的 `.spec/local.yaml` 揭示；流程配置节经`/flow_save`写`.spec/flow.yaml`）、人才库（内置角色并入全局库、只读查看详情、下发宿主preset、老项目自动补projectId）、设置；详情抽屉统一带放大/还原（放大铺满工作区并独立滚动）；Markdown 渲染器与全屏阅读器。需求详情状态先行：标题/徽标/指引/随状态操作栏置顶，阶段chips、正文与报告折叠摘要。
- `src/commands/run.ts`：人机命令只走 `commands.execute`，主进程对命令名再做一层白名单；`src/flow/config.ts`提供流程配置模型与`/flow_save`序列化，需求页四类操作按配置逐岗推进，一节点一浮卡，评审按最新轮署名根判定完成，auto落盘续岗、人工等「下一岗位」；立项浮卡回合结束未落盘时等人工「确认需求」，经`session/prompt`发指令后继续轮询等落盘。新建需求入口不受禁立项影响，描述随首条消息后台发起分析师会话；新建与改稿走分析-文档-确认-提案四步，提案落盘后浮卡等「去对比」打开对比视图，确认与拒绝走人机命令；基于此版本新建复用新建提案通道。
- `src/theme/liquid-glass.css`：新客户端主题底座，集中 `--lg-*` token、环境背景层与 `.lg-glass` / `.lg-sheen` / `.lg-lift` 基元；其余样式只消费这些变量。
- `src/theme/paper-water.tsx` / `refraction-glass.tsx`：登录页浅雾彩水流（按皮肤取色、无 WebGL 静态回退、减动效停帧）与卡面 SVG 折射（唯一 id、按尺寸与 DPR 重建）；控件仍是轻量 `backdrop-filter` 玻璃。
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
- S1 profile 的 `llm-pi-ai` base 层把 `lcoder-cloud.baseURL` 保存为 `!!js` 表达式对象，`settings.mutate` 会整段拒绝；设置页首版只读，密钥三态仍可读，`credentials.set`/`unset` 的写入与删除已单独验证。
- 本机 mock 只回文本、不能发起工具调用，因此审批卡与提问卡的真实往返只在单测里验证回执编码；S1 profile 的唯一模型只有文本模态，图片无法落成 durable 引用，聊天内图片预览（`session/attachment`）也只由单测覆盖调用形状。接上可跑工具的模型与支持图片的 provider 后应各补一条探针。
- `session/control` 是宿主级流；冷会话在流打开后才激活时，模型与用量先取 follow 开场帧里的投影，再被同键、更高水位的控制帧覆盖。
- 任务附件的图片缩略图依赖 `workspaceFiles.readBytes` 的 multipart 解码，已在适配层实现，但超大文件与断流未压测。
- 讨论历史的参会身份聚合依赖 `session/events`；没有讨论会话时只显示定位不到。
- 登录卡面的折射走 `backdrop-filter: url(#svg-filter)`，只有 Chromium/Electron 把它作用到背景；其它内核退回普通模糊。浅雾彩水面本身平滑，折射在卡边缘只表现为几级像素位移，原型里用来显形的演示纹理不进产品。

### 开发备注

<a id="dev-note"></a>

构建与启动见 [lcoder/s1.md](../../../lcoder/s1.md)。

需求页的新建需求抽屉把描述随首条消息发给后台 `maniu-intake` 会话；新建与改稿都走分析-文档-确认-提案四步，落 `requirement_propose` 提案。起草态 `requirement_change` 提案未确认期间，操作浮卡显示等待文案与「去对比」入口；对比视图经 `workspaceFiles` 读基线快照，用 `src/spec/diff.ts` 列变更的章节与条目，revise 给两栏全文对照、new 给新条目全文。确认走 `/proposal_approve`、拒绝走 `/proposal_reject`，完成后刷新投影。

需求详情（T-250）头部三区置顶：需求标题（缺省回退编号）＋状态徽标（draft 蓝/confirmed 绿/终态灰）＋REQ 编号小字；状态驱动指引句；操作栏随状态——draft 给评审/修改需求/确认需求/关闭，confirmed 给拆分任务（无关联任务时）/基于此版本新建/查看任务（有关联时）/上线/关闭，released 给查看任务/基于此版本新建/关闭，closed 无写操作；confirmed 与终态不渲染确认按钮，次级常驻刷新与阅读器打开正文。上线/关闭的前置条件由 kernel 人机命令自身校验（上线要求关联任务全部关闭，关闭拒绝 released），失败给可读回执。确认禁用原因沿用 kernel 口径：至少一轮评审，有 flow.yaml 时 review 节点按根匹配一轮一岗消费署名评审（`src/flow/config.ts` 的 `missingReviewRoles`）。阶段进度为头部下方横排 chips（创建/评审 Rn/版本 vN/过审/拆分），评审与版本 chip 带打开报告/快照入口。正文默认折叠预览首 6 行或 200 字（取先到），展开全文后才渲染全文，文档自带 H1 留在正文区。评审报告默认折叠摘要卡：最新轮次/时间/结论摘录（首 120 字）/打开报告/展开 inline 全文，历史轮次列表默认收起。基于此版本新建复用新建提案通道，提示词带 target 与 base_version（取最新版本号），后台发起不跳转。
