# 客户端自研架构方案（T-184）

状态：方案稿，等用户 Sign-off。本任务只出方案，不含产品代码、不改源码、不改 `.spec`、不改台账与看板。

方向由用户 2026-11-14 拍板：客户端框架也自研——自己的 Electron 壳、自己的 React 客户端、自己的流式层；宿主运行时（agent、会话、工具、模型、工作区实体）继续用上游。

## 0. 结论摘要

- 目标形态是三段：**新 Electron 壳**（窗口/托盘/单实例/更新）＋**进程内薄适配层**（持令牌、讲宿主协议）＋**自写 React 客户端**（页面、会话状态、流式渲染）。宿主进程原样保留。
- 耦合规模实测：`packages/lcoder/workspace/src` 里 **28 个文件、16,306 行**直接 import `@deepseek-ai/*`，与台账「二十八文件、一万六千三百行」一致；该目录总源码 25,508 行，即约 64% 需要重写或改造。
- 需要移植的宿主契约：**2 种传输**（一元 `POST /api/<namespace>/<method>`、流式 WS `/api/remote.mux`）、**1 条宿主事件流**（`$events`）、**2 条二进制路由**（`/api/file` 与上传）、**10 个命名空间、约 40 个方法（含 2 个流式）、12 个事件通道**（上游同名面共 57 个方法，其余 17 个明确不实现）。
- 最危险的三个：`session.follow` 的帧语义、`$events` 的 waterfall 回执（审批/提问）、客户端会话状态机（retain/binding/projection/gap repair）。
- 已定：宿主继续做子进程，薄适配层放 Electron 主进程，渲染端只见窄 IPC；渲染端不接触宿主 cookie。
- 里程碑 M0–M4 合计 **50–62 人日**（单人，含自测）；两人并行约 7–8 周。
- 第一个可实施切片 **S1**（M0 内）：新壳能起宿主、完成登录门禁、列会话、发一条消息并看到流式回复，约 **6–8 人日**。
- 已拍板（2026-11-14）：**宿主保持独立子进程**；**承载层完全自写**（一元 POST + WS mux，不复用 `dsh-client-connection`）；**回退窗口 1 个小版本**，切换后只保留安装包回退（手动重装），代码里不留旧壳隐藏开关；**本轮不减安装包**，体积交给 T-183 载荷裁剪与 core set 调研。

## 1. 现状与口径

### 1.1 当前五层

| 层 | 实体 | 职责 | 本方案处置 |
| --- | --- | --- | --- |
| 桌面壳 | `apps/desktop`（Electron 主进程、preload、托盘、更新、打包） | 窗口、单实例、更新、宿主拉起、`dsh-app://` 静态与转发 | **重写**为 `packages/lcoder/desktop` |
| 宿主进程 | `apps/desktop-host` → `runProfile('desktop')` | 跑 Cordis profile，起 web server，报 `ready.url` | **保留**（原样调用） |
| 宿主 API | `packages/api/*`、`packages/typert/*`、`packages/client/connection` | 一元/流式 Remote、`$events`、鉴权、信任栅栏 | **保留**（只读消费） |
| 上游客户端运行时 | `dsh-client-connection`、`dsh-api-remotes/client`、`dsh-client-ui-session`、`ui-workspace`、`ui-layout`、`ui-slots`、`locale`、`ui-primitives` | `ctx.remote.*`、会话/工作区状态、槽位、词典、组件 | **移除**（由自写客户端取代） |
| LCoder 工作台 | `packages/lcoder/workspace`（1 个 main 槽位插件） | 整壳 UI + `.spec` 文件投影 | **迁入**新客户端 |

关键事实：今天 LCoder 的「外壳」其实是**上游客户端里的一个 main 槽位**。它用 `ctx.sessions`/`ctx.workspaces` 拿状态、用 `ctx.remote.*` 拿数据、用 `ctx.locale` 拿文案、用 `ui-primitives` 画 Markdown。新客户端没有任何一层可以继续依赖这些，只有宿主 API 可以。

### 1.2 上游 import 清单（28 文件）

| 上游入口 | 次数 | 性质 | 处置 |
| --- | ---: | --- | --- |
| `dsh-session/types` | 14 | 纯类型（`SessionId` 等） | 保留类型；或用本地 branded 类型 |
| `dsh-client-ui-slots` | 12 | 槽位运行时与 props 类型 | 移除；页面改成普通 React props |
| `dsh-client-ui-session/client` | 5 | 会话绑定、`pendingInteraction` | 移除；自建会话 store |
| `dsh-client-ui-primitives` | 5 | `MarkdownText`、`DisclosureRow`、图标 | 移除；自写 Markdown 渲染与折叠行 |
| `dsh-typert-protocol` | 4 | `RemoteResult`、协议类型 | 保留（非 UI） |
| `dsh-api-session-controller/{types,client}` | 6 | 会话类型、`SessionEventLikeEntry` | 类型保留；`/client` 运行时移除 |
| `dsh-api-remotes/client` | 3 | `ctx.remote` 挂载与声明合并 | 移除；由自写 link 层取代 |
| `dsh-client-ui-sidebar-right/client` | 2 | 页签定义类型 | 移除 |
| `dsh-client-ui-layout/client` | 2 | `MainPanelId`、`selectPanel` | 移除 |
| `dsh-client-locale/client` | 2 | `TranslateNS` | 移除；改用本地 i18n |
| `dsh-typert-protocol/remote-info` | 1 | 生成码 | 保留 |
| `dsh-compaction/types` | 1 | `compaction/*` 事件声明合并 | 移除（不再显示压缩提示） |
| `dsh-client-ui-workspace/client` | 1 | 工作区类型 | 移除 |
| `dsh-client-ui-settings/client` | 1 | 设置 schema 类型 | 移除；设置页改读 `settings.describe` |
| `dsh-client-ui-renderer/client` | 1 | `settingsSchema` 服务 | 移除 |
| `dsh-api-workspace-files/types` | 1 | 文件投影类型 | 保留类型 |
| `dsh-api-workspace-controller/{types,client}` | 2 | `WorkspaceView`、工作区服务 | 类型保留；服务移除 |
| `dsh-agent-preset-registry/types` | 1 | `agentPreset` 投影类型 | 保留类型 |
| `cordis` | 1 | 插件 `Context` 类型 | 仅类型；新客户端无 cordis |

### 1.3 口径

- 「端点」= typert Remote 的 `<namespace>/<method>` 或 HTTP 路由；「事件通道」= `$events` allowlist 成员。
- 「必需」指 M4 parity 硬闸放行条件；「非必需」指用户已明确剪掉的聊天附属面。
- 只在 win32 桌面 profile 口径下统计；Web 实例只作判别器，不参与 parity。
- 本文所有数字来自本工作树 HEAD 的源码读数，未经运行验证；未验项见 §9.2。

## 2. 宿主 API 契约清单

### 2.1 传输与认证

| 面 | 机制 | 细节 | 适配层处置 |
| --- | --- | --- | --- |
| 一元调用 | `POST /api/<namespace>/<method>` | body `{type:'client-request', rpcId, method, payload:{args}}`；结果为 `{ok:true,value}` 或 `{ok:false,error:{code,message,details}}`；二进制结果走 `multipart/form-data` 的 metadata + 字节段 | 在适配层发，渲染端只拿结构化结果 |
| 流式调用 | `WebSocket /api/remote.mux` | 逻辑流帧 `open` / `item{streamId,value}` / `end{streamId}` / `cancel{streamId}`；一元与流式共用 RPC 编号空间 | 适配层持一条 mux，向上投影成按 streamId 的 IPC 事件 |
| 宿主事件 | WS 内建 `$events` 逻辑流 | 开场 `{type:'ready',clientId,host:{home}}`；之后逐条推送 allowlist 事件；waterfall 事件要求客户端回执 | 同上，单列一条事件订阅 |
| 事件回执 | `POST /api/$events/result` | `{rpcId, outcome:{kind:'result',value}}` 或 `{kind:'next'}` | 适配层负责 `approval/request`、`user-questions/request` 的原样回执 |
| 二进制读取 | `GET/HEAD /api/file` | 图片等资源字节，`session-controller/media-references` 用 | 适配层透传；`.spec` 附件仍走 `workspaceFiles.readBytes` |
| 上传 | 上传路由（`fileUploads` 流） | 客户端提交 base64 或字节，拿 `{receiptId,file}` | 走 `fileUploads.upload` Remote，不直连路由 |
| 认证 | 启动令牌 → Cookie | `GET /connect?token=…&interactions=answer` → 302 + `HttpOnly` 签名 cookie（与 authority 绑定）；页面路径是 `GET /?token=…` | 适配层用 Node 客户端完成兑换并自持 cookie；**不下发渲染端** |
| 信任栅栏 | Host/Origin 校验 | 只放行 loopback、监听地址字面量或 `trustedHosts`；浏览器标记须同源 | 适配层以 loopback + 无 Origin 的 Node 请求通过，避免自定义 origin 被 403 |
| 进程内旁路（备选） | `ctx.connection.createPeer()` + `createSharedFetchHandler('/api')` | 完全跳过 token/cookie；需与宿主同进程 | 只有「宿主进主进程」方案才可用，见 §3.4 |

### 2.2 方法清单

共 10 个命名空间、57 个方法（其中约 40 个需要适配层包；其余明确不实现）。「漂移风险」按上游 README 与生成物判断：**高**＝判别式/帧语义/二进制；**中**＝常用但字段仍可能增删；**低**＝稳定的小面。

| 命名空间 | 方法 | 传输 | 请求字段 | 响应字段 | 客户端用途 | 风险 | 适配层包 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `session` | `list` | POST | `{}` | `{items:SessionSummary[]}`（`sessionId`、`updatedAt`、`running`、`blank`、`agentAvailable`、`cwd?`、`parentSessionId?`、`origin?`、`formatStatus?`、`projections?`） | 会话列表、卡片状态 | 中 | 是 |
| `session` | `create` | POST | `{workspaceId?,cwd?,sessionId?,agentPreset?}` | `{sessionId,agentPreset?}` | 打开仓库、新会话、按角色开会话 | 中 | 是 |
| `session` | `rename` | POST | `{sessionId,title}` | `{title,seq}` | 会话标题写成角色名 | 低 | 是 |
| `session` | `prompt` | POST | `{requestId,sessionId,mode:'queue'\|'steer',content:PromptContentPart[],clientTimeZone?}` | `{accepted:true}` | 发消息 | **高**（`content` 判别式） | 是 |
| `session` | `cancel` | POST | `{sessionId}` | 空值/回执 | 停止回合 | 低 | 是 |
| `session` | `events` / `page` | POST | `{address,throughSeq?,cursor?,maxMessages?,turnWindow?}` | `{records:SessionHistoryRecord[],cursor,hasMore}` | 历史窗口、断线补洞 | **高**（record 判别式） | 是 |
| `session` | `follow` | WS | `{address,activate?,assistantStream?,maxMessages?,turnWindow?}` | `snapshot{header,cursor,records,hasMore,projections,assistantStream?}` / `event{event:SessionWireEvent}` / `assistant-stream{frame}` | 聊天主链 | **极高** | 是 |
| `session` | `projections` | POST | `{sessionId?}` | 投影基线与更新 | 状态位、上下文用量、角色 | 中 | 是 |
| `session` | `modelCatalog` | POST | — | `{default,routableProviders,groups,failures}` | 发送前门禁、模型 chip | 中 | 是 |
| `session` | `selectModel` | POST | `{sessionId,provider,model,reasoningEffort?}` | `{selected}` | 会话模型切换 | 中 | 是 |
| `session` | `attachment` | POST | `{sessionId,attachment}` | `{attachment,data(base64)}` | 上游聊天图片 | 低 | 否（不改用） |
| `session` | `updateQueue` | POST | `{sessionId,itemId,action}` | 回执 | 上游队列编辑 | 低 | 否 |
| `session` | `search` / `fork` / `subagent*` | POST/WS | — | — | 搜索、分叉、子代理 | 中 | 否 |
| `workspace` | `create` | POST | `{path}` | `WorkspaceValue`（`workspaceId`、`path`、`title`、`sessionIds`、时间） | 「打开仓库」 | 低 | 是 |
| `workspace` | `follow` | WS | — | `baseline` / `upsert` / `remove` / `order` / `archived` / `pinned` / `replace` | 项目列表 | 中 | 是 |
| `workspace` | `initializeDefault` | POST | — | `WorkspaceValue \| undefined` | 首启动默认工作区 | 低 | 是 |
| `workspace` | `rename`/`delete`/`insertBefore`/`insertSessionBefore`/`archiveSession`/`unarchiveSession`/`pinSession`/`unpinSession` | POST | 各自 id/name | 回执 | 上游侧栏行为 | 低 | 否 |
| `workspaceFiles` | `list` | POST | `(scopeId, path)` | `{path,entries,truncated}` | `.spec` 目录枚举 | 低 | 是 |
| `workspaceFiles` | `read` | POST | `(scopeId, path, {offset?,limit?})` | `{absolutePath,version,bytes?,offset,text,lines,eof}` | YAML/Markdown 投影 | 低 | 是 |
| `workspaceFiles` | `readBytes` | POST | `(scopeId, path, {range?,baseFile?})` | `{…,data:Uint8Array,eof}` | 任务附件图片 | 低 | 是 |
| `workspaceFiles` | `stat` | POST | `(scopeId, path)` | 元数据 | 存在性判断 | 低 | 否 |
| `workspaceFiles` | `changes` | WS | `(scopeId, path)` | 变更帧 | 增量刷新 | 中 | M2 再定 |
| `settings` | `describe` | POST | `{redactSecrets:true}` | `{writable,hasDocument,namespaces[]}`（含 `schema`、`revision`） | 设置页、协议枚举 | 中 | 是 |
| `settings` | `mutate` | POST | `(ns, SettingsPathOpView[], expectedRevision?)` | `SettingsNamespaceView` | 模型、路由、主题落盘 | 中 | 是 |
| `settings` | `update` / `replace` / `openSettingsDocument` | POST | — | — | 上游设置页 | 低 | 否 |
| `credentials` | `describe` | POST | `(refs:string[])` | `Record<ref,CredentialInfo>`（有无、来源，不含值） | 钥匙三态 | 中 | 是 |
| `credentials` | `set` / `unset` | POST | `(ref,value)` / `(ref)` | 回执 | 写/删钥匙 | **高**（安全） | 是 |
| `llm` | `listProviders` | POST | — | `LlmProviderInfo[]` | 云端路由是否可用 | 中 | 是 |
| `llm` | `listConfigurableProviders` | POST | — | `LlmConfigurableProvider[]` | 设置页表单 | 中 | 是 |
| `llm` | `discoverModels` | POST | `(ns,{provider?,baseURL?,protocol?,apiKey?},signal?)` | `LlmDiscoveredModel[]` | 拉模型目录 | 中 | 是 |
| `fileUploads` | `upload` | POST | `(agentId,{data:base64,name?})` | `{receiptId,file}` | 附件上传 | 中 | 是 |
| `commands` | `execute` | POST | `(agentId,line,attachments,signal?)` | `{result:{kind,text}}` / `undefined` | 人类命令（签署、认领、流程） | 中 | 是 |
| `agentPresets` | `list` | POST | — | `{presets:[{id,name?,…}]}` | 角色名册、专家页 | 中 | 是 |
| `agentPresets` | `read` | POST | `(id)` | `{content}` | 专家提示词 | 中 | 是 |
| `lcoderCloud` | `state` | POST | — | `CloudResult<CloudState>`（用户、额度、guest、`lastError`） | 登录门禁、顶栏 | 低 | 是 |
| `lcoderCloud` | `sendSms` / `register` / `loginSms` / `loginPassword` | POST | 手机号、验证码、密码 | `CloudResult<CloudSmsValue \| CloudAuthValue>` | 登录页 | 低 | 是 |
| `lcoderCloud` | `refresh` / `me` / `logout` | POST | — | `CloudResult<…>` | 会话续期、个人中心 | 低 | 是 |
| `lcoderCloud` | `usage` | POST | `CloudUsageQuery` | `CloudResult<CloudUsagePage>` | 用量分页 | 低 | 是 |
| `lcoderCloud` | `claimGuest` | POST | `CloudGuestClaimInput` | `CloudResult<CloudGuestView>` | 桌面端已去匿名路径 | 低 | 否 |

说明：

- `session.follow` 的 `assistantStream` 帧为 `start|chunk|end`，带 `revision` 与**稠密递增的 `index`**；开场的 `snapshot.assistantStream` 给出当前 attempt 与已累积 chunk。丢帧只能靠 revision 判定并重开，不能自己拼。
- `session.page`/`events` 是补洞通道：`follow` 的 `snapshot.hasMore=true` 或重连后都要靠它，不能只信流。
- 二进制参数/结果（`readBytes.data`、上传）必须走结构化解码，不能 JSON 化后当字符串。
- `commands.execute` 是「人类命令」面：签署、认领、需求确认、流程判定、角色绑定都从这一条进，新客户端**不得**绕开它直接写 `.spec`。

### 2.3 事件通道

`$events` allowlist 里新客户端需要的 12 条：

| 事件 | 模式 | 载荷要点 | 用途 | 回执 |
| --- | --- | --- | --- | --- |
| `approval/request` | waterfall | `{agent, toolName, callId?, reason?, displayReason?, signal?}` | 工具审批卡 | **必须**回 `allowed-once` / `rejected` / `cancelled` / `unavailable` |
| `user-questions/request` | waterfall | `{questions[], agent?, signal?, wait?:{callId,timed?}}` | 提问卡（含计划评审） | **必须**回 `{answers:[{id,selected[],custom?}]}` |
| `api-session/added` | emit | `SessionSummary` | 会话列表新增 | 否 |
| `api-session/removed` | emit | `sessionId` | 会话删除 | 否 |
| `api-session/status` | emit | `(sessionId, running)` | 运行态 | 否 |
| `api-session/activity` | emit | `(sessionId, updatedAt)` | 最近活动排序 | 否 |
| `api-session/error` | emit | `(sessionId, message)` | 无回合位置的失败 | 否 |
| `llm/models-updated` | emit | — | 模型目录变化 | 否 |
| `llm/adapters-updated` | emit | — | provider 变化 | 否 |
| `credentials/reference-updated` | emit | — | 钥匙写入/删除 | 否 |
| `credentials/record-updated` | emit | — | 账户记录变化 | 否 |
| `settings/document-updated` | emit | — | 设置文档外部变化 | 否 |

不需要的通道（可忽略但适配层不应静默丢弃非法帧）：`agent-preset/selected`、`commands/change`、`goal/*`、`schedule/changed`、`plugin-manager/*`、`plugin-market/*`、`cordis/*`、`permission-presets/catalog-changed`、`deepseek-account/*`。

### 2.4 最危险的三个契约

1. **`session.follow`（极高）**。开场的 `snapshot` 与后续 `event`、`assistant-stream` 三种帧交错；`assistant-stream` 有 `revision` + 稠密 `index`，必须按序消费并支持重开；`turnWindow`/`maxMessages` 决定历史窗口；断线补洞依赖 `session.events`。写错的表现是「文字重复、丢字、工具卡错位」，且只在长回合/弱网出现。
2. **`$events` waterfall 回执（极高）**。审批与提问是 waterfall，监听者必须 `return` 一个 outcome 才是认领；回 `next()` 等于放弃。审批还有 `signal` 取消与 `answerable` 状态；提问有 `wait.callId` 的定时领取（`userQuestions.attachWait`）。回执错会挂住工具调用或让审批永不结算。
3. **客户端会话状态机（高）**。上游 `dsh-client-ui-session` + `api-session-controller/client` 合计约 4,700 行，负责 retain/refcount、binding 代际、projection store、事件折叠、gap repair、pending interaction 优先级。新客户端如果照搬会得到同样的复杂度；如果简化，必须明确放弃「多窗口同会话」「子代理」「轨迹」这些面，并证明单窗口单会话路径不会退化成「重启后读不到历史」。

## 3. 目标架构

### 3.1 三段边界

```
packages/lcoder/desktop   (Electron 主进程, 新壳)
  ├ host-supervisor   spawn desktop-host → 读 ready.url → 生命周期/日志/崩溃重启
  ├ link              token→cookie, 一元 POST, WS mux, $events, 事件回执
  ├ bridge            窄 IPC：call / stream / event / host-state
  ├ shell             BrowserWindow、frameless 标题栏、托盘、菜单、单实例、更新
  └ preload           只暴露 window.lcoder（无 Node、无 fetch）

packages/lcoder/client    (Renderer, React 18 + Vite)
  ├ app               导航、五页、悬浮对话、设置、登录门禁
  ├ store             session-store（follow→events→messages）、workspace-store
  ├ projection        .spec 文件投影（从现有 projection.ts 平移）
  ├ i18n              zh/en 词典（从 locales.ts 平移）
  └ ui                Markdown、折叠行、卡片、表单（自写，替代 ui-primitives）
```

宿主侧保持原样：`apps/desktop-host`（`runProfile('desktop')`）＋ `packages/api/*` ＋ `packages/typert/*` ＋ `packages/client/connection` ＋ `packages/host/webserver`。

### 3.2 继续用的上游包（宿主侧）

| 包 | 用途 | 约束 |
| --- | --- | --- |
| `apps/desktop-host` | profile 启动器、`ready` 消息、退出检查 | 原样调用，不改 |
| `dsh-client-connection` | 宿主 web server 的鉴权与 RPC 承载 | 只作为**宿主**依赖；新客户端不 import |
| `dsh-api-*`（session/workspace/files/settings/account/gateway/remotes/remote-access） | Remote 服务 | 宿主装配，只经线上协议消费 |
| `dsh-typert-protocol` / `typert-registry` / `typert-loader` | 协议描述与生成物 | 新客户端可读**生成物**，不读运行时服务 |
| `dsh-host-webserver` / `frontend-static` | HTTP 监听、静态兜底 | 可选：用 `frontend-static` 直接服务自写客户端产物 |
| `dsh-session` / `agent` / `llm` / `tools` / `workspace` / `settings` / `credentials` | 运行时 | 不动 |
| `@lcoder/kernel` | 工具、人类命令、云端 Remote、`.spec` 状态机 | 不动 |

### 3.3 彻底移除（客户端侧）

- **运行时**：`dsh-client-ui-session`、`dsh-client-ui-workspace`、`dsh-client-ui-layout`、`dsh-client-ui-renderer`、`dsh-client-ui-slots`、`dsh-client-locale`、`dsh-client-ui-primitives`、`dsh-client-ui-theme`、`dsh-client-store`、`dsh-api-remotes/client`、`dsh-api-gateway/client`、`dsh-client-file-upload`（若不需要上游上传组件）、`dsh-client-connection`（客户端侧引用）。
- **页面插件**：`ui-conversation`、`ui-chat`、`ui-tool`、`ui-approval`、`ui-user-questions`、`ui-attachment`、`ui-sidebar*`、`ui-settings*`、`ui-plan`、`ui-goal`、`ui-jobs`、`ui-schedule`、`ui-message-feedback`、`ui-model-selection`、`ui-cordis`、`ui-trajectory`、`ui-input-trigger`、`ui-commands`、`ui-skill`、`ui-reference`、`ui-permission`、`ui-agent-preset`、`ui-subagent`、`entry-customization`、`ui-deliverables`、`ui-workspace`、`ui-theme`、`product-analytics`、`client-hmr`、`modules`、`resources`、`shortcuts`、`ui-shortcuts`、`ui-secret-mask`、`ui-file-actions`、`ui-file-drag`、`ui-open-in-app`、`ui-sidebar-browser`、`ui-sidebar-terminal`、`ui-sidebar-files`、`ui-sidebar-documentpreview`、`ui-workflow-run`。
- **Web 外壳**：`dsh-web-app` 的页面路径、`dsh-web-frontend` 产物、`dsh-client-modules` 的插件清单与组合 URL。
- **桌面壳**：`apps/desktop` 全部（主进程、preload、托盘、更新、欢迎页、打包脚本、测试夹具）。

移除后宿主 profile 需要一份**只含宿主面**的变体（`lcoder-host.slice.yml`）：保留 webserver、connection、gateway、api-*、session/agent/tools/llm/workspace/settings/credentials 与十个 preset；禁掉全部 `ui-*`、`modules`、`client-hmr`、`web-app` 的页面装配。**这份变体尚未验证可启动**（见 §10）。

### 3.4 三个必须先定的架构选择

| 选择 | 选项 A | 选项 B | 建议 |
| --- | --- | --- | --- |
| 宿主进程位置 | 保持子进程（现状） | 宿主进 Electron 主进程，用 `createPeer` 直连 | **A**。B 会让 SQLite/原生模块/工具同步活压住 UI 线程，且违背「只由 dsh profile 启动」的现有边界；A 的代价只是要讲 HTTP/WS |
| 承载层来源 | 自写 WS mux + 一元 POST（约 700–900 行，语义抄 `stream-protocol.ts`） | 复用非 UI 的 `dsh-client-connection`（React 无关） | **A**（满足「替换 `@deepseek-ai/dsh-client-*`」的字面口径）；若团队接受保留一个非 UI 上游包，B 可省 3–4 人日 |
| 类型来源 | 读各包 `lib/typert.remote-client.d.ts` + `dump` 生成物，手写窄接口 | 直接 import 各包 `./remote` 生成物（zod 码） | **B 的类型 + A 的传输**：类型用生成物，传输自写；生成物只读、不运行 |

补充：如果最终选择「宿主进主进程」，适配层可完全去掉 HTTP 与 cookie，改用 `ctx.connection.createPeer({principal,interactions:'answer'})` 加共享 fetch handler；这条路径最短，但只应作为 B 方案备选。

### 3.5 渲染端 IPC 面（建议）

| 通道 | 方向 | 载荷 | 用途 |
| --- | --- | --- | --- |
| `lcoder:host-state` | main→renderer | `{kind:'starting'\|'ready'\|'fatal', detail?}` | 启动进度、失败原因 |
| `lcoder:call` | invoke | `{ns, method, args}` → `RemoteResult` | 全部一元调用 |
| `lcoder:stream` | invoke + 事件 | `{ns, method, args}` → `streamId`；`lcoder:stream-item/end/cancel` | `follow`、`workspace.follow` |
| `lcoder:events` | main→renderer | `{name, payload}` | 宿主事件（含审批/提问） |
| `lcoder:event-result` | invoke | `{rpcId, outcome}` | waterfall 回执 |
| `lcoder:window` | invoke | 最小化/最大化/关闭/拖拽/状态 | 自绘标题栏 |
| `lcoder:dialog` | invoke | 选目录、保存文件、读剪贴板图片 | 打开仓库、附件 |
| `lcoder:update` | both | 状态、检查、安装 | 更新 UI |
| `lcoder:theme` | both | 深浅、强调色、系统字体 | 主题与原生外观 |

## 4. 里程碑 M0–M4

估时为人日（单人、含自测与文档），不含用户验收等待。

| 里程碑 | 主题 | 主要任务 | 依赖 | 估时 | 验收 |
| --- | --- | --- | --- | ---: | --- |
| **M0** | 壳与连接 | 新包骨架（`packages/lcoder/desktop`、`packages/lcoder/client`）；Window/单实例/托盘最小面；host-supervisor；link（token→cookie、一元、WS mux、`$events`、回执）；IPC 契约；Vite+React 骨架；登录门禁读 `lcoderCloud.state`；会话列表；发送与流式正文 | 无 | **10–12** | S1 通过（§4.1） |
| **M1** | 会话与聊天 | 会话 store 完整化（follow 三帧、补洞、projection、错误位）；工具卡与过程组；审批卡；提问卡；附件（上传 + `readBytes` 预览）；停止/改名；模型 chip；上下文用量；无模型门禁 | M0 | **9–11** | 一轮真实回合内：流式正文、工具卡、审批往返、提问往返、附件收发全部成立 |
| **M2** | 工作台数据面 | `.spec` 投影平移（任务/规则/需求/方案/契约/交付物/调度证据/角色/常驻会话/项目/本地密钥/自动化）；五页；看板与列表；任务详情；Markdown 阅读器；需求详情与讨论历史；立项向导与结果页；专家/角色看板；调度建议；流程状态与动作日志；任务附件 | M1 | **13–16** | `DEMO-01` 看板与详情、五页切换、Markdown 阅读、需求审批命令全部成立 |
| **M3** | 账号与系统面 | 登录/注册/验证码/密码；个人中心与用量；设置页（模型、路由、主题、字体、语言）；四套皮肤；中英切换；窗口按钮与拖拽；托盘/菜单/快捷键；更新 UI；欢迎屏 | M0（可并行 M2） | **10–12** | 登录→开会话→改设置→重启仍生效；深浅与中英各一套截图级检查 |
| **M4** | parity 硬闸与切换 | parity 清单逐项验收脚本；宿主-only profile 变体；一次性切换；旧产物保留与回滚演练；打包与更新签名；移除 `apps/desktop` 与上游 client 依赖；接触面撤销 | M1+M2+M3 | **8–11** | 12 条冒烟全绿；回滚演练成功（1 个小版本的安装包可重装）；`git diff` 显示不再修改上游文件；安装包体积不在本轮验收（交 T-183 与 core set 调研） |
| 合计 | | | | **50–62** | |

两人并行（壳+连接 / 页面平移）可压到 **7–8 周**；M2 是唯一难以并行的大块，第二人先做 M3 的登录与设置，再接手 M2 的需求/专家页。

### 4.1 第一个可实施切片（S1）

范围只做一条端到端竖切，不碰工作台页面：

1. `packages/lcoder/desktop` 能构建、能启动，窗口出现（frameless、最小 520×600）。
2. 起宿主：复用 `apps/desktop-host` 启动语义，拿到 `ready.url`，握手成功。
3. 登录门禁：调 `lcoderCloud.state`；未登录显示登录页占位（只校验状态，不实现表单）。
4. 列会话：`session.list` + `api-session/*` 事件，左侧列出标题与运行态。
5. 发消息：`session.create`（可选 `workspaceId`）→ `session.follow` → `session.prompt`。
6. 流式回复：`assistant-stream` 的 `start/chunk/end` 与 `assistant/message` 落定都能画出来。
7. 冒烟：一条 CDP 探针，断言「窗口起来 → 会话列表非空 → 发一条 → 出现 assistant 文本」。

估时 **6–8 人日**；验收判据是「关掉重启后，同一会话能重新读到历史（走 `follow` 的 snapshot）」，这一条能提前暴露 store 设计问题。

## 5. parity 清单

「必需」＝M4 硬闸放行条件；「必需（流程）」＝产品主流程缺它就走不通；「非必需」＝用户已明确剪掉或当前只作辅助。

### 5.1 工作台页面

| 页/面 | 能力 | 现状证据 | 数据源 | 新实现 | 必需性 |
| --- | --- | --- | --- | --- | --- |
| 需求页 | 需求列表、状态筛选、搜索 | `RequirementsPage.tsx`、`requirement-page.ts` | `.spec/requirements/*.yaml` + `.md` | 平移解析，重画列表 | 必需（流程） |
| 需求页 | 需求详情抽屉：候选方案、推荐、正文 Markdown、时间线 | `RequirementDetail.tsx`、`requirement.ts` | 同上 | 平移 + 自写 Markdown | 必需（流程） |
| 需求页 | 确认 / 上线 / 关闭（人类命令） | `index.ts` 的 `/requirement_approve`、`_release`、`_close` | `commands.execute` | 同命令面 | 必需（流程） |
| 需求页 | 需求拆分与提案审批 | `requirement-split.ts`、`plan-discussion.ts` | `.spec/proposals/*`、`/proposal_approve` | 平移规则 | 必需（流程） |
| 需求页 | 讨论历史（按需求聚合会话轮次） | `discussion-history.ts` | 会话 `page/events` + 需求文件 | 平移 | 非必需（可后置到 M3） |
| 需求页 | 立项向导：三档讨论、模型选择、确认需求、结果页、重开 | `IntakeWizard.tsx`、`intake*.ts` | 会话回合 + 提案文件 | 平移 | 必需（流程） |
| 任务页 | 看板 / 列表切换 | `Shell.tsx` `taskView` | `.spec/tasks/*.yaml` | 平移 | 必需 |
| 任务页 | 筛选：等级、状态、会话、角色 | `task-filter.ts` | 投影 | 平移 | 必需 |
| 任务页 | 任务卡：状态、等级、会话 chip、队列标记、调度建议 | `task-card-visual.ts`、`task-session.ts`、`scheduling.ts` | 投影 + `api-session/*` + `.spec/evidence/scheduling` | 平移 | 必需 |
| 任务页 | 任务详情：契约正文、验收、风险、允许路径、证据、交付物、附件 | `Shell.tsx` 详情段、`task-detail-view.ts`、`DeliverableView.tsx` | `.spec/contracts`、`deliverables`、`evidence` | 平移 | 必需 |
| 任务页 | 签署、认领、分配、签约推进、流程判定与记录 | `index.ts` 人类命令 | `commands.execute` | 同命令面 | 必需（流程） |
| 任务页 | 动作日志 | `flow-history.ts` | `.spec/evidence/*/*.log` | 平移 | 必需（流程） |
| 任务页 | 调度建议、并行组、角色提示 | `scheduling.ts`、`role-hint.ts`、`singleton.ts` | 投影 + 角色名册 | 平移纯函数 | 非必需（可后置到 M3） |
| 任务页 | 专家 / 角色看板与关系图 | `AgentDashboardPage.tsx`、`dashboard-graph.ts`、`dashboard.ts` | `agentPresets.list` + 会话 | 平移 | 非必需（可后置） |
| 项目页 | 切换项目列表、当前标记 | `WorkspacePages.tsx` 的 `SwitchProjectPage` | `workspace.follow` | 平移 | 必需 |
| 项目页 | 打开仓库：路径输入、桌面目录选择、超时与失败提示 | `project-directory.ts`、`open-failure.ts` | `workspace.create` + `session.create` + 目录对话框 | 平移（对话框经 IPC） | 必需 |
| 项目信息页 | 项目元数据、分支、运行时、架构文档入口 | `WorkspacePages.tsx` 的 `ProjectInfoPage` | `.spec/project.yaml` | 平移 | 必需 |
| 项目信息页 | 环境清单与数据库密码「引用 → 本机值」揭示 | `projection.ts` 的 `local.yaml` 段 | `.spec/local.yaml` | 平移（只在内存） | 必需 |
| 设置页 | 模型与路由：provider、模型、base URL、钥匙三态、发现模型、会话模型切换 | `ModelSettings.tsx`、`model-settings.ts` | `settings.*`、`credentials.*`、`llm.*`、`session.selectModel` | 平移 | 必需 |
| 设置页 | 皮肤（neon/silver/frost/rose）、字体（系统/现代）、中英 | `skin.ts`、`WorkspacePages.tsx` | 本地存储 + 词典 | 自写主题层 | 必需 |
| 设置页 | 更新入口、关于 | `apps/desktop` 更新 UI | `lcoder:update` IPC | 新壳实现 | 必需 |

### 5.2 对话与交互

| 面 | 能力 | 现状证据 | 数据源 | 新实现 | 必需性 |
| --- | --- | --- | --- | --- | --- |
| 悬浮对话 | 普通/最大化两档、可拖动、可关闭 | `Shell.tsx`、`chat-composer.ts` | 本地状态 + 窗口尺寸 | 平移 | 必需 |
| 悬浮对话 | 流式正文（chunk 增量） | `messagesFromEntries`、`assistant-stream` | `session.follow` | 自写 store | 必需（流程） |
| 悬浮对话 | 用户气泡、隐藏的系统咒语、注入上下文折叠 | `ChatPanel.tsx`、`shell-data.ts` | 会话事件 | 平移 | 必需 |
| 悬浮对话 | 过程组头：思考 + 工具调用，可展开，失败态 | `ChatPanel.tsx`、`task-card-visual` | `assistant/message` 的 tool-call/reasoning + `tool/result` | 自写折叠行 | 必需（流程） |
| 悬浮对话 | 工具卡展示名与状态（`cmd_run`、`task_*`、`spec_*`、读写） | `ChatPanel.tsx` | 同上 | 平移映射 | 必需（流程） |
| 悬浮对话 | 审批卡（允许一次 / 拒绝） | `ChatPanel.tsx`、`pending.ts` | `approval/request` | 自写 + 回执 | 必需（流程） |
| 悬浮对话 | 提问卡（单选/多选/自定义/计划评审） | `ChatPanel.tsx`、`pending.ts` | `user-questions/request` | 自写 + 回执 | 必需（流程） |
| 悬浮对话 | 附件：拖放/选择、图片限制、上传、回显、失败重试 | `ChatExtras.tsx`、`TaskAttachments.tsx`、`chat-composer.ts` | `fileUploads.upload`、`workspaceFiles.readBytes` | 平移 | 必需（流程） |
| 悬浮对话 | 模型 chip、默认模型、无钥匙提示 | `ChatExtras.tsx`、`model-status.ts` | `session.modelCatalog`、`llm.listProviders` | 平移 | 必需 |
| 悬浮对话 | 上下文用量 | `readContextPressure` | `contextPressure` 投影 | 平移 | 非必需 |
| 悬浮对话 | 停止回合、改名 | `session.cancel`、`session.rename` | Remote | 平移 | 必需 |
| 悬浮对话 | 压缩提示 | `ChatPanel.tsx` 的 `compaction` 分支 | `compaction/*` 事件 | **删除** | 非必需（用户剪掉） |
| 悬浮对话 | 子代理行、反馈按钮、轨迹视图 | 上游 `ui-subagent`、`ui-message-feedback`、`ui-trajectory` | — | **删除** | 非必需（用户剪掉） |

### 5.3 账号、门禁与系统面

| 面 | 能力 | 现状证据 | 数据源 | 新实现 | 必需性 |
| --- | --- | --- | --- | --- | --- |
| 登录门禁 | 未登录只渲染全屏登录页；入口按 `gateEntry` 判定 | `gate.ts`、`use-cloud.ts` | `lcoderCloud.state` | 平移判定 | 必需 |
| 登录页 | 验证码登录、密码登录、注册；倒计时、错误码映射、额度提示 | `CloudAccount.tsx`、`errors.ts`、`estimate.ts`、`login-grid.ts` | `lcoderCloud.*` | 平移 | 必需 |
| 云账号 | 顶栏账号按钮、个人中心、用量分页、余额、退出 | `PersonalCenter.tsx`、`use-cloud.ts` | `lcoderCloud.me/usage/logout` | 平移 | 必需 |
| 云门禁 | 云端不可用/加载中的独立态 | `gate.ts` | `CloudResult` | 平移 | 必需 |
| 欢迎屏 | 品牌、钥匙引导、跳过、开始 | `apps/desktop` welcome 窗、`WelcomePage.tsx` | 本地 | **随新壳重写** | 必需 |
| 窗口 | frameless、自绘按钮、拖拽、最大化/全屏状态、最小尺寸 | `window-chrome.ts`、`window-drag.ts`、`apps/desktop/src/main.ts` | 新壳 IPC | 新壳实现 | 必需 |
| 窄窗 | 容器查询塌单栏；520 最小宽；对话窗尺寸配置 | `Shell.module.css`、`Config.chatWindow` | CSS + 配置 | 平移 | 必需 |
| 主题 | 深/浅、强调色、系统字体同步 | `shell-theme.js`、preload 的 `data-ds-theme-source` | 新壳 + 本地存储 | 新壳实现 | 必需 |
| 中英 | 全量词典、桌面菜单同步 | `locales.ts`（1,675 行）、`apps/desktop/src/locale.ts` | 本地词典 + 新壳菜单 | 平移 | 必需 |
| 托盘 | 打开应用 / 退出，图标随品牌 | `apps/desktop/src/tray.ts` | 新壳 | 新壳实现 | 必需 |
| 单实例 | 第二次启动聚焦已有窗口 | `single-instance.ts` | 新壳 | 新壳实现 | 必需 |
| 菜单/快捷键 | 应用菜单、窗口快捷键、输入快捷键 | `apps/desktop/src/main.ts`、`shortcuts` | 新壳 | 新壳实现 | 必需 |
| 更新 | 检查、下载、安装、强制更新、安装期锁 | `update-coordinator.ts`、`update-presentation.ts` | `electron-updater` + feed | 新壳实现 | 必需 |
| 退出确认 | 有运行任务时确认；会话等待提醒 | `quit-confirmation`、`quit-inspection` | 宿主 `update-tasks`/`quit-inspection` | 新壳实现 | 必需 |
| 关于/诊断 | 关于面板、版本、更新通道 | `apps/desktop/src/main.ts` | 新壳 | 新壳实现 | 非必需 |

### 5.4 当前不显示但被装配的上游面（不进 parity）

插件市场、内置终端、内置浏览器、文档预览、会话搜索/导出、分叉、目标、定时提醒、任务队列、工作流运行卡、消息反馈、Cordis 检查器、产品埋点。这些在 T-177 三波里已被禁用或从未在 LCoder 外壳出现；新客户端不实现，也不为它们保留槽位。

## 6. 移除顺序

原则：**先并行、后切换、再撤接触面**；上游源码不删，只退出使用。删上游文件等同于永久扩大接触面，每次升上游都要解释。

| 步 | 动作 | 前置 | 产物 | 回退点 |
| ---: | --- | --- | --- | --- |
| R0 | 新建 `packages/lcoder/desktop`、`packages/lcoder/client`（link 作为 `desktop` 内模块）；旧壳仍是默认 | 无 | 两套壳并存，`start-all` 不变 | 删新包即可 |
| R1 | 新壳跑通 S1 与 M1；旧壳保持可启动 | R0 | 开发期双壳 | 旧壳 |
| R2 | parity 硬闸全绿，切默认入口：`start-all`/`rebuild`/打包脚本指向新壳 | M1–M3 | 新壳成为默认 | 旧壳构建目录仍保留 |
| R3 | 两个 RC 观察期；旧产物（安装包 + `win-unpacked`）与 feed 条目保留 | R2 | 回退包 | 重装旧版 |
| R4 | 退出 `packages/lcoder/workspace` 的客户端半：`src/client` 删除，`projection.ts`/`locales.ts`/纯函数迁入 `@lcoder/client`；包只保留 kernel 依赖 | R3 | 一个 UI 包 | git revert |
| R5 | profile 去客户端：新增 `lcoder-host.slice.yml`，禁用全部 `ui-*`、`modules`、`client-hmr`、`web-app` 的页面装配；保留 webserver/connection/gateway/api-*/session/agent/tools/llm/workspace/settings/credentials/preset | R4 | 宿主-only profile | 恢复旧 profile |
| R6 | 接触面撤销（见下表）：改回上游原状或改由新包承担 | R4 | `contact-surface.txt` 大幅缩短 | 逐文件恢复 |
| R7 | 文档收口：RUN、PROJECT-RULES 目录表、prd-and-design §3/§12、desktop-release、UPSTREAM-BASELINE §3 | R6 | 新入口文档 | — |

### 6.1 接触面撤销清单

| 接触面 | 撤销方式 | 注意 |
| --- | --- | --- |
| `packages/client/ui-layout/src/client/AppFrame.tsx` | 还原上游原样 | 新壳不再用上游 AppFrame |
| `packages/client/modules/src/assets.ts` + 测试 | 还原上游原样 | 新壳自己发字体资源；若改由 `frontend-static` 提供，则这条要保留 |
| `apps/desktop/src/{main,ipc,preload-app,locale,single-instance,update-presentation}.ts` 与全部 `apps/desktop/*` 登记项 | 还原上游原样，停止修改 | 新壳代码在 `packages/lcoder/desktop`，不再落上游目录 |
| `apps/desktop/tests/*` 与 `tests/expected/*` | 还原上游 | 新壳自带测试 |
| `apps/desktop/resources/*`、`scripts/render-tray-icon.ts` | 还原上游 | 新壳自带图标与 ICO 管线 |
| `apps/desktop/scripts/dev.ts` 的 `deferSmoke` | 还原上游 | 新壳 dev 脚本自持 `SKIP_RUNTIME_SMOKE` 语义 |
| `scripts/gen-third-party-notices.ts` | **保留** | Inter 仍随包分发；若字体改成系统字体再撤 |
| `tsconfig.client.json` / `tsconfig.host.json` | **保留**，references 改指新包 | 聚合编译仍需要 |
| `pnpm-lock.yaml`、`AGENTS.md` | **保留** | 依赖与入口规则 |
| `lcoder/desktop-profile.patch.yml` 的角色 preset | **保留** | 十个角色仍要挂到新 profile |

### 6.2 上游 client 依赖的退出顺序

1. 先停**引用**：新包不 import 任何 `@deepseek-ai/dsh-client-*`（`pnpm run hygiene` + 自定义 grep 门禁）。
2. 再停**装配**：profile 不再挂 `ui-lcoder-workspace`，`dsh.client.inject` 整段删除。
3. 再停**服务**：宿主‑only profile 禁用全部客户端行（R5）。
4. 最后谈**安装包**：禁用行不减小安装包（T-177 结论）；要减体积必须走 core set 裁剪（T-179/T-183），把 `dsh-web-app`、`dsh-web-frontend`、`ui-*` 从依赖闭包移除。这一步独立立项，不与切换同批。

## 7. 风险与回退

### 7.1 一次性切换的 hard gate

全部满足才允许 R2：

- [ ] parity §5 中所有「必需」项逐条通过，证据是自动化脚本输出，不是人工截图。
- [ ] 12 条冒烟全绿：窗口起来、宿主就绪、登录态、打开仓库、会话列表、发消息流式回复、工具卡、审批往返、提问往返、附件上传与回显、五页切换、设置保存后重启生效。
- [ ] 干净仓（无 `.spec`）与已用仓（`DEMO-01` + 已绑会话）各跑一遍。
- [ ] 用本机 mock 云（`lcoder/scripts/mock-cloud.mjs`）覆盖登录、额度耗尽、token 过期三条错误路径。
- [ ] 断网/宿主崩溃/宿主重启三种异常下界面有明确状态，不白屏、不假装成功。
- [ ] 旧产物回退演练成功（见 §7.2）。
- [ ] `git diff upstream/master...HEAD -- apps/desktop packages/client` 为空（R6 之后）。

### 7.2 上一版产物的保留与回滚

- 保留三样：上一版**签名安装包**、`win-unpacked` 目录、feed 上对应的版本对象（至少 1 个小版本）。
- 回滚方式：重装旧安装包。注意 `electron-updater` 配了 `allowDowngrade=false`，**应用内不会降级**；回滚必须走手动安装，且要在干净用户目录验证一次。
- `userData` 兼容：新旧壳共用 `ai.lansi.lcoder` 与同一 `userData`；切换前确认没有只在旧壳写入的 UI 状态（皮肤、字体现存 localStorage，`localStorage` 按 origin 隔离——新壳若改 origin，需要一次性迁移或接受重置）。
- 会话数据在宿主 home，不在壳里；壳回滚不影响会话。

### 7.3 pre-stable API 漂移

- 上游声明「Public APIs are pre-stable; update every consumer」。新客户端是**新的消费者**，必须自建漂移探测：
  1. 构建期类型门禁：新 link 层的窄接口对着各包 `lib/typert.remote-client.d.ts` 编译，字段消失即红。
  2. 协议冒烟：对真宿主逐个调用 §2.2 中标「是」的方法（只读方法全调，写方法用临时会话），任一 `ok:false` 即红。
  3. 升上游演练把生成物差异纳入 `lcoder/scripts/upstream-diff.sh` 的观察面（`lib/typert.*` 变化）。
- 禁止在适配层做「字段缺失就猜」的兼容；缺字段按失败上报，避免静默错误。

### 7.4 登录与云

- 令牌只存在宿主凭据里（`CloudTokenManager` → `ctx.credentials`），新客户端只调 `lcoderCloud.*`；切换壳不要求重新登录。
- 宿主 web 鉴权每次启动用 launch token 换 cookie；适配层自持，渲染端拿不到。cookie 的 authority 与 cookie 名绑定，端口变化不影响（同一 loopback authority 含端口，需按实际 URL 取）。
- 云端不可用与未登录必须分开显示（现状 `gate.ts` 已如此），否则会用「登录」掩盖网络故障。

### 7.5 打包与更新签名

- 身份不变：`ai.lansi.lcoder`、`LCoder.exe`、`LCoder.app`、`lcoder` scheme、`%LOCALAPPDATA%\Programs\LCoder`、更新缓存 `lcoder-updater`。
- 打包链要在新壳里重建：electron-builder 配置、asar 解包清单（`.node/.dll/.exe`、ripgrep、libreoffice）、extraResources（`runtime`）、NSIS 选项（per-user、可选目录关闭）、8 语言安装器。
- 签名仍按 T-82 现状（Windows token signer / macOS Developer ID + notarize）；**未签名产物不得进生产 feed**。
- 强制更新策略（manifest 的 `dshMandatoryUpdatePolicy`）与安装期 `update-tasks` 锁要在新壳复刻，否则会出现「安装时还在写会话」。
- 新增风险：新壳若改成 Vite 产物，asar 内文件路径与 `frontend-static` 的 dist 根要重新对齐；`app.asar.unpacked` 规则要覆盖新路径。

### 7.6 安全边界

- 渲染端无 Node、无 `contextIsolation:false`、无通用 `fs`/`exec` 桥；IPC 只暴露 §3.5 的窄面。
- `.spec` 写入只走 `commands.execute`；附件只走 `workspaceFiles.readBytes`；不在渲染端拼路径读盘。
- 适配层的 `ds` 调用参数来自渲染端时必须白名单化命名空间与方法，不能透传任意路径到 fetch。

## 8. 明确非目标

- **不自研 agent runtime**：agent loop、会话持久化、工具执行、模型路由、工作区实体、`.spec` 状态机全部继续用上游与 `@lcoder/kernel`。
- **不做独立 BFF 服务**：不新起第二个 HTTP/WS 服务，不引入 GraphQL/RPC 中间层；适配层是主进程内模块。
- **不改宿主 API**：除已有的 `lcoderCloud` Remote，不新增 Remote、不改上游服务签名。
- **不做压缩提示、子代理、反馈、轨迹 UI**：用户已明确剪掉；对应事件可以忽略。
- **不做上游附属面**：插件市场、终端、浏览器、文档预览、会话搜索/导出/分叉、目标、定时提醒、任务队列、工作流卡。
- **不做多窗口/多工作区并行 UI**：保留现有单主窗；多窗口同会话不在这次范围。
- **不删上游源码**：`apps/desktop` 与 `packages/client/*` 留在上游树里，只退出使用；安装包减重另立任务。

## 9. 拍板结论与未验项

### 9.1 已拍板（2026-11-14）

1. **宿主进程位置**：保持独立子进程，不进 Electron 主进程。理由：UI 线程不被 SQLite、原生模块与工具同步活压住，也沿用「只由 dsh profile 启动」的既有边界；代价是适配层要讲 HTTP/WS。
2. **承载层**：完全自写，一元 `POST /api/<namespace>/<method>` 加 WS mux，不复用 `@deepseek-ai/dsh-client-connection`。理由：满足「替换全部 `@deepseek-ai/dsh-client-*`」的口径；多出的约 3–4 人日已含在 M0 估时内。
3. **回退窗口**：1 个小版本；切换后只保留安装包回退（手动重装），代码里不留旧壳隐藏开关。理由：一次性切换下，运行时开关会让两套壳长期并行维护。
4. **安装包体积**：本轮不减；客户端切换只做能力与架构切换，体积目标交给 T-183 载荷裁剪与 core set 调研，分开验收。理由：profile 禁用不减包（T-177 实测），减包要动依赖闭包，与本轮风险不同源。

### 9.2 未验项（本方案未做实验）

- 未写任何产品代码；所有估时是草案，未经实际切片校准。
- 未验证「宿主-only profile」能否启动：`dsh-web-app`/`modules`/`client-hmr` 与若干 `ui-*` 之间有硬注入，T-177 已证明单独关会停在 `Loading plugins`。R5 需要一次真实的 profile 实验。
- 未验证 `frontend-static` 能否独立挂载并服务自写客户端 dist（不经过 `web-app`）。
- 未验证 Electron 主进程的全局 `WebSocket` 可用性与浏览器一致性（Electron 44 的 Node 版本需实测）；不可用则引入 `ws`。
- 未验证自写会话 store 在弱网/宿主重启下的补洞与重开行为。
- 未验证自写 Markdown（代码复制、脚注、紧凑变体）与 `MarkdownText` 的观感差距。
- 未验证新客户端的 `localStorage` origin 变化对皮肤/字体/语言持久化的影响。
- 未做打包称重；新壳的 asar 组成与安装包体积变化未知。
- 未验证 macOS：本方案按 win32 写，mac 的窗口/签名/更新矩阵另需一轮。

### 9.3 建议的下一步

先只做 S1（§4.1），用一周时间把「壳起宿主 → 登录门禁 → 列会话 → 发一条 → 流式回复」跑通，再回来校准 M1/M2 估时；同时并行做一次宿主-only profile 的启动实验，这是整个方案唯一可能推翻 M4 路径的前提。
