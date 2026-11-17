# 客户端 M4 切换方案（T-194）

状态：方案稿。本文件只做设计与验收口径，不含产品代码；不改源码、装配、`.spec`、`docs/tasks.yaml` 与看板。

上游方案见 [client-rewrite-plan.md](client-rewrite-plan.md) 的 M4 与 §5–§7；本文件把 M4 拆成可执行的四件事：**parity 矩阵 → 宿主-only profile → 一次性切换 → 回退与移除**，并补齐打包签名与未验项。

## 0. 结论摘要

- 新客户端（`packages/lcoder/desktop` + `packages/lcoder/client`）已跑通 S1、M1、M2、M3 四条竖切。合并后主检证据：S1 探针五连 PASS，M2 探针 PASS，M3 探针 39/39，M1 探针在 T-191 工作树编写但本树未复跑。
- parity 共 57 项：**已验 26 / 未验 25 / 阻塞 6**。阻塞全部集中在两处：**系统面未实现**（自动更新、更新期锁、退出确认、深链）与**两处产品面缺失**（项目密码揭示、模型路由配置）。未验里最危险的是审批与提问的真实回环、工具卡、附件探针未在本树复跑。
- 切换前必须补两个变体：**发布用宿主-only profile**（只能从 `desktop-profile.patch.yml` 的十个角色 preset 派生，不能沿用 S1 的单 preset）与**打包配置迁入新壳**（electron-builder、NSIS、asar、签名、feed、electron-updater 全部未在新壳存在）。
- 数据面结论：宿主 home 保持 `~/.dsh` 不动即可带走会话与云端令牌；**壳的 UI 偏好（皮肤、字体、语言、欢迎屏标记）不会自动迁移**，按「一次性重置」处理。
- 回退只能手动重装旧安装包（`allowDowngrade=false`），保留上一版签名安装包、`win-unpacked` 与 feed 对象各 1 个小版本；会话数据格式不变，回退后仍可读；但新壳创建的 `maniu-workbench` 会话需要在旧 profile 里补同名 preset 才能继续对话。
- 移除顺序保持「先并行、后切换、再撤接触面」；上游源码不删。宿主侧必须继续使用的客户端包只有三个：`connection`、`file-upload`、`api-remotes`。

## 1. parity 矩阵

口径：
- **已验**＝合并后主检上有自动化探针 PASS 记录（t187/t189/t190 或 T-193 偏好单测）；探针名与断言见 §1.5。
- **未验**＝新客户端已实现或部分实现，但没有当前工作树的探针证据，或只被单测/合成帧覆盖。
- **阻塞**＝新客户端未实现、或实现与本清单/旧壳语义不一致，切换硬闸不放行。
- 「验收方式」给出切换前必须补的探针或人工步骤；人工项只用于无法自动化的观感与系统集成。

### 1.1 工作台页面

| # | 面 | 能力 | 新客户端证据 | 验收方式 | 状态 |
| ---: | --- | --- | --- | --- | --- |
| 1 | 需求 | 列表、状态筛选、搜索 | `pages/requirements.tsx`；t189 断言需求行 | 复用 t189 | 已验 |
| 2 | 需求 | 详情：正文、候选方案、推荐、时间线 | `pages/requirement-detail.tsx`；t189 断言 REQ-01 正文与表格 | 复用 t189 | 已验 |
| 3 | 需求 | 「确认需求」人类命令 | `commands/run.ts` + `requirement_approve`；t189 断言 | 复用 t189 | 已验 |
| 4 | 需求 | 上线 / 关闭命令 | 同一命令白名单，未进探针 | 扩 t189 断言 `requirement_release` / `_close` 回执 | 未验 |
| 5 | 需求 | 拆分与提案审批 | `pages/requirement-detail.tsx` 只发送拆分指令；提案列表未消费 | 探针断言拆分后 `.spec/proposals` 落盘与审批回执 | 未验 |
| 6 | 需求 | 讨论历史（按需求聚合轮次） | `discussion/history.ts`，按需聚合 | 需要一条真实多轮会话作正样本 | 未验 |
| 7 | 立项 | 三档向导、模型选择、确认需求、结果页、重开 | `pages/intake-wizard.tsx` 只有两档，且选项为 7 问指令后发到新的工作台会话 | 补「三档」与 `maniu-intake` 专用会话；探针断言 7 问落盘 | 未验 |
| 8 | 任务 | 六列看板 | `spec/board.ts` 六列；t189 断言六列与 DEMO-01 卡 | 复用 t189 | 已验 |
| 9 | 任务 | 看板 / 列表切换、筛选 | `pages/tasks.tsx` 有切换与文本/等级/会话/角色筛选；列筛选无控件 | 补列筛选控件后扩 t189 | 未验 |
| 10 | 任务 | 任务卡：状态、等级、会话 chip、队列、调度建议 | `task-detail.tsx` 调度段 + t189 调度记录断言 | 复用 t189；队列标记未单独断言 | 已验 |
| 11 | 任务 | 详情：契约四段、验收、允许路径、证据、交付物、附件 | `pages/task-detail.tsx`；t189 断言契约/验收/路径与附件缩略图 | 复用 t189 | 已验 |
| 12 | 任务 | 签署、认领、分配、推进、流程判定与记录 | `commands/run.ts`；t189 逐项断言 | 复用 t189 | 已验 |
| 13 | 任务 | 动作日志 | `flow/history.ts`；t189 断言决策与日志 | 复用 t189 | 已验 |
| 14 | 项目 | 切换项目、当前标记 | `pages/projects.tsx` + `workspace/use-workspaces.ts`；t189 断言打开仓库后切换 | 复用 t189 | 已验 |
| 15 | 项目 | 打开仓库：路径输入、目录选择 | 同页 + `directoryPicker/pick`；t189 断言打开临时仓 | 复用 t189 | 已验 |
| 16 | 项目 | 打开失败与超时提示 | `open-failure` 语义未迁移 | 探针用不存在路径与无权限路径各断言一次 | 未验 |
| 17 | 项目信息 | 元数据、分支、架构文档入口 | `pages/project-info.tsx`；t189 断言项目信息 | 复用 t189 | 已验 |
| 18 | 项目信息 | 环境清单与数据库密码「引用 → 本机值」揭示 | **未实现**：只打印 `passwordRef`；`projection.secrets` 已加载但无消费方 | 实现揭示（只在内存、不落日志）后加探针 | 阻塞 |
| 19 | 阅读器 | Markdown 全屏阅读、缩放、Esc | `pages/reader.tsx`；t189 断言文档与 REQ 阅读 | 复用 t189 | 已验 |
| 20 | 设置 | 默认模型、provider、密钥三态 | `pages/model-panel.tsx`；t190 断言默认模型写盘与密钥往返 | 复用 t190 | 已验 |
| 21 | 设置 | 路由配置、发现模型、baseURL / 模型 id 编辑 | **未实现**：只有可路由列表；S1 profile 的表达式 baseURL 保存会被整段拒绝 | 实现后再验；至少恢复「发现模型」 | 阻塞 |
| 22 | 设置 | 四套皮肤（流体玻璃 / neon / silver / rose） | `theme/skins.css`；t190 断言四套可区分 | 复用 t190 | 已验 |
| 23 | 设置 | 字体（系统 / 现代） | `prefs.ts`；t190 断言 `Inter` 实际渲染 | 复用 t190 | 已验 |
| 24 | 设置 | 中英切换（界面） | `locale*.ts`；t190 断言 EN 文案 | 复用 t190 | 已验 |
| 25 | 系统 | 语言切换同步主进程菜单 / 托盘 | 客户端未调用 `window.lcoder.setLocale`，重启后才同步 | 补 IPC 调用；探针断言切换后菜单文案立即变化 | 未验 |
| 26 | 角色 | 专家 / 角色看板与关系图 | `pages/roles.tsx` 只有 preset 与项目角色列表 | 补关系图或明确降级为列表并让用户拍板 | 未验 |
| 27 | 调度 | 调度建议、并行组、角色提示 | 单任务启发式有；`projection.groups` 未消费 | 补并行组视图或明确降级 | 未验 |

### 1.2 对话与交互

| # | 面 | 能力 | 新客户端证据 | 验收方式 | 状态 |
| ---: | --- | --- | --- | --- | --- |
| 28 | 悬浮对话 | 流式正文（chunk 增量） | `shell/chat-transcript.tsx`；t187 断言持久化 assistant 文本 | 复用 t187 | 已验 |
| 29 | 悬浮对话 | 重启后从 follow snapshot 读历史 | `app.tsx` + `store.ts`；t187 重启段 | 复用 t187 | 已验 |
| 30 | 悬浮对话 | 工具卡与过程组（思考 + 工具调用、失败态） | `chat-transcript.tsx` 过程组已实现 | 扩探针：mock 返回 tool_calls 后断言卡名与状态 | 未验 |
| 31 | 悬浮对话 | 审批卡（允许一次 / 拒绝）与 waterfall 回执 | `shell/pending-cards.tsx` + `app.tsx` 回执；只有单测与合成帧 | 扩 mock 产生审批工具调用，断言「卡出现 → 回执 → 工具继续」 | 未验 |
| 32 | 悬浮对话 | 提问卡（单选/多选/自定义）与回执 | `pending-cards.tsx` + `chat/pending.ts`；只有单测 | 同上，用 `ask_user` 工具真实阻塞一次 | 未验 |
| 33 | 悬浮对话 | 附件：选择/拖放、上传、回显、失败重试 | `chat/attachments.ts` + `shell/composer.tsx`；t191 探针已写但本树未跑 | 复跑 `t191-m1-probe.mjs` | 未验 |
| 34 | 悬浮对话 | 模型 chip、默认模型、无钥匙门禁 | `shell/composer.tsx`；t190 断言默认模型可见与写盘 | 复用 t190 | 已验 |
| 35 | 悬浮对话 | 会话内模型切换 | `session/selectModel` 已接 | 扩 t191：切模型后断言下一回合请求的模型 | 未验 |
| 36 | 悬浮对话 | 上下文用量 | `composer.ts` 读 `contextPressure` | 复跑 t191（断言 `known=true`） | 未验 |
| 37 | 悬浮对话 | 停止回合 | `session.cancel` 已接 | 扩 t191：停止后断言流结束且无追加文本 | 未验 |
| 38 | 悬浮对话 | 改名 | `shell/chat-view.tsx` → `session.rename` | 复跑 t191（断言重启后标题） | 未验 |
| 39 | 悬浮对话 | 压缩提示 / 子代理 / 反馈 / 轨迹 | **已按产品决定删除**，无对应渲染 | 人工确认不出现即可 | 已验 |

### 1.3 账号与云端

| # | 面 | 能力 | 新客户端证据 | 验收方式 | 状态 |
| ---: | --- | --- | --- | --- | --- |
| 40 | 登录门禁 | booting / signed-out / cloud-error / ready 四态 | `shell/gate-view.tsx`；t187、t190 断言门禁放行 | 复用 t187/t190 | 已验 |
| 41 | 登录页 | 验证码、注册、密码登录、倒计时、错误映射 | `account/login-screen.tsx`；t190 全链断言 | 复用 t190 | 已验 |
| 42 | 个人中心 | 账号、余额、估算、用量分页、退出 | `account/personal-center.tsx`；t190 断言用量行与退出 | 复用 t190 | 已验 |
| 43 | 云门禁 | 云端不可用 / 加载中的独立态，不冒充未登录 | 四态已实现，mock 关闭路径未进探针 | 探针停 mock 或返回 5xx 断言 cloud-error | 未验 |
| 44 | 云端 | 令牌自动续期、401 后重试 | link 有一次 401 重新换 cookie；refresh 未验 | mock 控制 `expireAccess` 后断言自动续期 | 未验 |

### 1.4 窗口与系统面

| # | 面 | 能力 | 新客户端证据 | 验收方式 | 状态 |
| ---: | --- | --- | --- | --- | --- |
| 45 | 窗口 | frameless、自绘按钮、最大化/全屏状态 | `shell/titlebar.tsx` + `desktop/src/window.ts`；t190 断言最大化切换 | 复用 t190 | 已验 |
| 46 | 窗口 | 拖拽移动、边缘缩放 | 只有 CSS `-webkit-app-region`，未按过 | 人工拖拽 + 拖边缩放各一次 | 未验 |
| 47 | 窄窗 | 520 最小宽、窄窗塌单栏 | 最小宽已配；塌单栏只有 CSS 断点 | 人工缩到 520/900 两档检查 | 未验 |
| 48 | 托盘 | 打开 / 退出、品牌图标 | `desktop/src/tray.ts` 已实现 | 人工点托盘与退出；探针可断言托盘创建 | 未验 |
| 49 | 单实例 | 第二次启动聚焦已有窗口 | `main.ts` `requestSingleInstanceLock` | 探针起第二个实例断言不新增窗口 | 未验 |
| 50 | 菜单/快捷键 | 应用菜单、F11、缩放、输入快捷键 | 菜单已本地化；快捷键只接了阅读器与 Enter | 人工按 F11 / 缩放 / 菜单项 | 未验 |
| 51 | 退出 | 有运行任务时确认；关闭到托盘 | **未实现**：关窗即退出，无任务检查，也无 `update-tasks` / `quit-inspection` 移植 | 实现退出确认后再切；否则作为产品决定记录 | 阻塞 |
| 52 | 更新 | 检查、下载、安装、强制更新 | **占位**：`checkUpdate` 恒为 `unavailable/no-feed` | 迁入 electron-updater 与 feed 后加探针 | 阻塞 |
| 53 | 更新 | 安装期锁（新 HTTP 503、安装前停宿主） | 旧壳在 `desktop-host` 装 `update-tasks` / `quit-inspection`；新 `host-entry` 未移植 | 与 52 同批移植并验 | 阻塞 |
| 54 | 欢迎屏 | 品牌、钥匙引导、跳过、开始，只出现一次 | `welcome/welcome-screen.tsx` + `prefs`；t190 断言欢迎屏 | 复用 t190 | 已验 |
| 55 | 偏好 | 皮肤/字体/语言重启保持 | 主进程 `userData/lcoder-preferences.json` 为权威；T-193 单测 + t190 39/39 | 复用 t190 | 已验 |
| 56 | 系统 | 深链 `lcoder://` 打开 | **未实现**：无协议注册与参数转交 | 补协议注册后人工与探针各一次 | 阻塞 |
| 57 | 系统 | 等待用户时任务栏闪烁（window attention） | 未实现 | 实现后人工观察 | 未验 |

### 1.5 计数与证据边界

- 合计 57 行：**已验 26 / 未验 25 / 阻塞 6**（已验含 #39 的「已删除」项与 #10 的卡面）。
- 已验来自三个探针与一次修复单测：`lcoder/scripts/t187-s1-probe.mjs`（S1）、`t189-m2-probe.mjs`（M2）、`t190-m3-probe.mjs`（M3）、T-193 偏好单测。合并后主检记录：S1 五连 PASS、M2 PASS、M3 39/39。
- `packages/lcoder/desktop/scripts/t191-m1-probe.mjs` 的断言覆盖附件、模型 chip、停止按钮、用量、改名；本工作树没有它的 PASS 记录，T-191 台账把「审批/提问真实回环、模型切换、停止截断、durable 图片预览」列为未验。切换前必须在本树复跑并补这些项。
- 审批与提问是宿主 waterfall：探针必须同时断言「事件送达」与「回执被宿主接受」，只验卡面不算通过。

## 2. 宿主-only profile 变体

### 2.1 发布形态

发布 profile 是**追加层**，不是新装配源：

```
bundles:  @deepseek-ai/dsh-base + @deepseek-ai/dsh-web-app   # 与旧桌面一致，靠 patch 关行
patch:    lcoder/desktop-profile.patch.yml                   # 十个角色 preset、云端 provider、默认模型
        + lcoder/host-only-profile.patch.yml                 # 关 63 行浏览器面
        + lcoder/host-only-minimal.patch.yml                 # 再关 21 行只服务上游 UI 的宿主行
        + (新增) lcoder/host-workbench.patch.yml             # maniu-workbench preset、registry 默认值
```

- profile 目录名改为 **`lcoder`**（`<DSH_HOME>/profiles/lcoder`），旧 `desktop` 目录原样保留给回退。profile 名不进入会话格式，改名不影响历史。
- 新壳启动时把模板落到该目录；模板随安装包分发（`extraResources/profile/`），不再从仓库相对路径读取。
- 允许继续使用 `dsh-web-app` bundle：它带来宿主行；浏览器行由 patch 关闭。这样不必维护一份新的 bundle 清单，风险低于自建 bundle。

### 2.2 与当前 desktop profile 的差异

| 项 | 旧 desktop（运行副本） | 发布变体 | 影响 |
| --- | --- | --- | --- |
| 浏览器装配 | 全部 `ui-*`、`modules`、`client-hmr`、`locale`、`shortcuts`、`resources` 等 63 行启用 | 全关（复用 T-186 H1 清单） | 上游页面不可用；这正是新客户端要的结果 |
| 只服务上游 UI 的宿主行 | 默认启用 | 关 21 行（`otel`、`job-controller`、`terminal-controller`、`office-to-pdf`、`open-in-app`、`message-feedback`、`session-stats`、`session-turn-outline`、`deliverable-file-references`、`workspace-changes` 等） | 新客户端没有这些页面；关掉不减安装包，只减少启动面 |
| 角色 preset | 十个（`lcoder`、`-intake`、`-architect`、`-review`、`-pm`、`-git`、`-ops`、`-scheduler`、`-flow`、`-manager`）＋ `lcoder-cloud` | 原样保留；`agent-preset-registry.selectedDefault` 仍为 `lcoder` | 历史会话的 `agentPreset` 必须继续可解析 |
| 工作台会话 preset | 无 | 新增 `maniu-workbench`（新客户端建项目会话时使用） | 回退时旧 profile 需补同名 preset，见 §4.3 |
| 默认模型 / 云端 provider | `agent-default-model` + `llm-pi-ai` 的 `lcoder-cloud` | 原样 | 切换壳不要求重新登录 |
| 传输与协议 | `web-startup`、`webserver`、`web-runtime`、`connection`、`typert*`、`api-remotes`、`remote-access` | 原样保留 | `$events` 需要 `api-remotes`；`/connect` 必须 `interactions=answer` |
| `file-upload` | 启用 | 保留 | `session-controller` 的 static inject 点名它 |
| 宿主控制面 | `apps/desktop-host` 额外安装 `update-tasks`、`quit-inspection`、平台会话发布、文件拖拽 | `host-entry.ts` 未安装 | 自动更新安装锁与退出确认缺失；随 §6 一起移植或明确降级 |
| 文档目录 | 写死本检出路径 | 写安装目录下 `documents/`（真实存在） | 规避向 OS 查询文档目录挂住（PITFALLS W-08） |

### 2.3 启动方式

- 开发：`pnpm --filter @maniu/desktop run launch`，`DSH_HOME` 默认 `<本树>/.dsh-home`，走 `s1` 快速 profile。
- 发布：新壳启动 → `HostSupervisor` 用 `process.execPath`（`ELECTRON_RUN_AS_NODE=1`）起 `host-entry.js`，参数为 profile 目录；宿主把 `ready.url` 经 IPC 回主进程，再由 link 换 cookie。
- 打包态必须补两项与旧壳的差异：
  1. `host-entry` 当前不传 `packageManager`（node/pnpm 路径）。工具执行需要 T-183 的 node-only 运行时载荷，必须按旧 `desktop-host` 的方式传入 `command` / `args` / `PATH`。
  2. 打包路径不能再用 `REPO_ROOT` 推导；`host-entry`、profile 模板、渲染 dist、托盘图标都要按 `app.getAppPath()` / `process.resourcesPath` 解析。

### 2.4 验收

1. 用发布变体起宿主：日志零激活失败，`session/list`、`session/create`（`lcoder` preset）、`session/follow`、`$events` 四项通。
2. 用 `maniu-workbench` 与 `maniu-intake` 各建一条会话，确认 preset 不被拒。
3. 重跑 T-186 的 H2 口径（89 行）在**十个 preset** 下的依赖闭包；T-186 只验过 `standard`，preset 会抬高宿主下限。
4. 再跑 t187/t189/t190/t191 四条探针，全部在发布 profile 上 PASS；探针不得依赖 `s1` 特有点（如单 preset）。

### 2.5 未决

- `host-only-minimal.patch.yml` 关掉的 `session-stats` / `session-turn-outline` / `workspace-changes` 是否被新客户端或 `.spec` 投影隐式依赖，未逐项验；先保持关闭，出现缺服务再单独加回并记录。
- `web-runtime` 当前是唯一 token 公告点，但新壳从 `ctx.connection.authenticatedUrl` 取 URL，不解析 stdout；是否可关未验，建议保留到切换稳定后再评估。

## 3. 一次性切换步骤

### 3.1 放行硬闸

全部满足才允许把默认入口指向新壳：

- [ ] parity 矩阵 6 项阻塞全部清零；25 项未验中，凡属「必需（流程）」的项必须转已验（剩余可得项须用户书面接受）。
- [ ] 12 条切换冒烟全绿：窗口、宿主就绪、登录态、打开仓库、会话列表、发消息流式、工具卡、审批往返、提问往返、附件上传回显、五页切换、设置保存后重启生效。
- [ ] 干净仓（无 `.spec`）与已用仓（`DEMO-01` + 已绑会话）各跑一遍；四个探针在发布 profile 上全 PASS。
- [ ] 打包态冒烟：安装包起窗、登录、发一条回合、重启读历史。
- [ ] 回退演练完成（见 §4.4）。
- [ ] `git diff upstream/master...HEAD -- apps/desktop packages/client` 在 R6 后为空。

### 3.2 步骤表

| 步 | 动作 | 类型 | 前置 | 验证 |
| ---: | --- | --- | --- | --- |
| C0 | 旧壳最后一版打 tag 并保留安装包、`win-unpacked`、feed 对象 | 发布配置 | 无 | `ls-remote` / feed 对象存在 |
| C1 | 新壳补系统面：更新、更新期锁、退出确认、深链、菜单即时本地化、密码揭示、模型配置面 | 代码 | 无 | 对应探针/人工项转已验 |
| C2 | 发布 profile 变体落地：新壳 profile 模板、十个 preset、`maniu-workbench`、`maniu-intake` 会话 | 代码 + 装配 | 无（可与 C1 并行） | §2.4 四项 |
| C3 | 新壳打包链：builder 配置、NSIS、图标、签名、feed、updater | 代码 + 发布配置 | C1 | 本机产出未签名安装包并起窗 |
| C4 | 12 条冒烟脚本落地并全绿（含审批/提问/工具卡） | 代码 | C1、C2 | 脚本退出码 0 |
| C5 | 入口切换：`start-all` / `start-desktop` / `rebuild` / `smoke` 指向新壳；默认 profile 改为发布变体 | 代码（仓库脚本） | C4 | 一条命令起窗，探针全 PASS |
| C6 | 发布签名安装包与 feed，进入两个 RC 观察期 | 发布配置 | C3、C5 | 安装、更新、回退各一次 |
| C7 | 观察期后收口：撤接触面、移除旧壳入口、文档收口 | 代码 + 文档 | C6 | §5 的每步验证 |

代码改动与发布配置的分界：
- **代码改动**：`packages/lcoder/desktop`、`packages/lcoder/client`、`lcoder/scripts/*`、仓库入口脚本、profile 模板、`tsconfig.*` references、lock。
- **发布配置**：`.env.windows` / `.env.macos`、签名凭据与令牌、`publishing/{test,production}.json`、COS / EdgeOne、GitHub workflow 触发与审批、feed 上的版本对象。
- **不改**：上游 `apps/desktop` 与 `packages/client/*` 源码直到 R6；`.spec` 与 `docs/tasks.yaml` 不在切换动作内。

### 3.3 入口与默认 profile

| 入口 | 现状 | 切换后 |
| --- | --- | --- |
| `lcoder/scripts/start-all.ps1` | 拉旧壳 `pnpm run start:desktop` | 拉新壳 `pnpm --filter @maniu/desktop run launch` |
| `lcoder/scripts/start-desktop.ps1` / `.cmd` | 旧壳 dev 脚本 | 新壳 launch；保留 `-Fast` 跳过构建语义 |
| `lcoder/scripts/rebuild.cmd` | 构建旧 Desktop bundle | 构建 `@maniu/desktop` + `@maniu/client` |
| `lcoder/scripts/smoke.cmd` | 旧壳 6 项 DOM 探针 | 12 条切换冒烟（可包一层并按项报告） |
| `apps/desktop/package.json` 的 `package:win:*` 等 | 旧壳打包 | 新壳 `packages/lcoder/desktop` 同名脚本；旧脚本保留到观察期结束 |
| 默认 profile | `profiles/desktop`（旧壳） | `profiles/lcoder`（发布变体）；`desktop` 目录保留 |

### 3.4 数据迁移

- **宿主 home 不变**：发布态固定 `DSH_HOME=~/.dsh`，与旧壳一致；会话（`sessions/`）、凭据（`.credentials.yaml`）、宿主设置随 home 一起保留。开发态继续用仓内 `.dsh-home`，不要把开发 home 指向 `~/.dsh`。
- **profile 新增而非覆盖**：新壳只写 `profiles/lcoder`，不动 `profiles/desktop`；旧壳回退时仍读自己的 profile。
- **UI 偏好重置**：旧壳偏好分散在 `dsh-app://app` 的 localStorage（`lcoder.skin`）与 `userData/desktop/locale-cache`；新壳用 `file://` origin 与 `userData/lcoder-preferences.json`，两套 origin 不互通。接受一次性重置：皮肤回落 `liquid-glass`、字体 `system`、语言按旧 locale-cache 手工带一次也可不做。
- **欢迎屏**：新壳首次启动显示一次；旧壳的 `DSH_DESKTOP_WELCOME` 开关不再使用。
- **会话 preset 兼容**：新壳创建的 `maniu-workbench` 会话，在旧壳回退时要能解析；因此 C2 同时给旧 `desktop-profile.patch.yml` 补一条同名 preset（只加装配，不改行为），或把新客户端项目会话改用 `lcoder` preset。推荐前者。

### 3.5 用户可见变化（需发布说明）

1. 皮肤默认从 `neon` 变为流体玻璃；`frost` 退役并回落新默认。
2. 欢迎屏首次出现一次；旧环境变量开关失效。
3. 会话列表、任务、需求等页面布局重写；压缩提示、子代理、反馈、轨迹、插件市场、终端、浏览器、文档预览不再出现。
4. 窗口骨架重写：最小尺寸 520×600，窗口尺寸不再按工作区计算；关闭行为见 §8 待拍板项。
5. 设置页模型面收窄（当前只有默认模型与密钥）；发现模型与 baseURL 编辑在 C1 补齐。
6. 项目信息页密码本机值揭示在 C1 补齐，否则该项为功能回退。
7. 登录态与云端令牌不变；已登录用户切换后不需要重新登录。

## 4. 回退

### 4.1 保留物（至少 1 个小版本）

| 保留项 | 位置 | 用途 |
| --- | --- | --- |
| 上一版**签名**安装包 | 发布物料归档与本机 `dist/` | 手动重装 |
| `win-unpacked` | 本机构建目录 | 不做安装即可验证旧壳能起 |
| feed 上对应版本对象与 blockmap | 对象存储 | 已升级用户仍能拿到旧版 |
| 旧 profile `profiles/desktop` | `~/.dsh/profiles/desktop` | 旧壳启动所需，切换不得覆盖 |
| 旧壳最后 commit 与 tag | 仓库 | 重出包来源 |

### 4.2 手动重装步骤

1. 退出新壳；确认没有宿主子进程与 `LCoder.exe` 残留。
2. 用旧签名的 `lcoder-latest-windows-x64.exe` 覆盖安装（per-user，安装目录不变）。
3. 首启检查：会话列表可见、云端已登录、历史会话可打开；旧 profile 正常装配。
4. 在干净用户目录（新建 Windows 用户或临时 `userData`）再装一次，确认不是靠旧机器残留才能起。
5. 归档现场：`~/.dsh` 会话目录、安装器版本号、回退时间。

注意：`electron-updater` 配 `allowDowngrade=false`，应用内不会降级，**只能手动重装**；也不要在 feed 上把旧版本标成更高版本号来骗过 updater。

### 4.3 回退后的数据兼容

| 数据 | 兼容性 | 说明 |
| --- | --- | --- |
| 会话 JSONL（v4） | 兼容 | 新客户端不新增会话格式，只消费 `session/follow`；旧壳可读 |
| 云端令牌 | 兼容 | 存 `~/.dsh/.credentials.yaml`，两壳共用 home |
| 宿主设置（模型、路由） | 兼容 | 在 home 的 profile 文档里；两壳 profile 独立，旧壳读自己的 `desktop` |
| `maniu-workbench` 会话 | **需前置** | 新壳建的项目会话带该 preset；回退前旧 profile 必须已补同名 preset（§3.4） |
| UI 偏好 | 不兼容 | 新壳 `lcoder-preferences.json` + `file://` localStorage；旧壳不读，旧壳偏好仍在旧 origin，无需迁移 |
| 欢迎屏标记 | 不兼容 | 旧壳环境变量开关与新壳标记互不影响 |
| 自动更新通道 | 需一致 | 回退包必须与旧 feed 通道、`productName`、`appId`、`publisherName` 完全一致，否则更新器拒装 |

新壳在切换后不得写入任何只有新壳能解释的持久数据；当前实现只写偏好 JSON，满足该约束。若 C1 增加窗口布局、最近项目等持久项，必须同时评估回退忽略策略。

### 4.4 回退演练（切换前必做一次）

1. 在干净用户目录安装旧版 → 登录 → 建一条会话 → 发一条消息 → 关窗。
2. 覆盖安装新版 RC → 验证会话仍在、可继续、可新建。
3. 手动重装旧版 → 验证同一批会话可读、可继续；`maniu-workbench` 会话可打开。
4. 复核安装目录、协议注册、托盘图标、更新缓存目录没有残留第二个应用。
5. 记录演练时间、包版本、会话数与截图到发布记录。演练不通过则不允许 C6。

### 4.5 不可回退点

- 一旦在发布 feed 上删掉旧版本对象，已升级用户无法再取回旧包；观察期内禁止删。
- 一旦 R6 撤掉接触面并删除旧壳入口，仓库不再能一键重建旧包；旧包只存在于归档，回退只能用归档件。
- 若未来给会话格式或宿主设置引入新字段，回退窗口立即失效；本轮明确不做这类变更。

## 5. 依赖移除顺序

原则：**先并行、后切换、再撤接触面**；上游源码不删，只退出使用；接触面每撤一条都要能指认替代者。

### 5.1 总步骤

| 步 | 动作 | 前置 | 验证 |
| ---: | --- | --- | --- |
| R0 | 新建 `packages/lcoder/desktop`、`packages/lcoder/client`；旧壳仍是默认 | 无 | 两套壳并存，`start-all` 不变 |
| R1 | 新壳跑通 S1/M1/M2/M3；旧壳保持可启动 | R0 | 四条探针 PASS；旧壳 smoke 仍绿 |
| R2 | parity 硬闸全绿，切默认入口（§3.3） | R1 + §3.1 | 12 条冒烟全绿 |
| R3 | 两个 RC 观察期；旧包与 feed 对象保留 | R2 | 安装、更新、回退各一次 |
| R4 | 退出 `packages/lcoder/workspace` 的客户端半：`src/client` 删除；`projection.ts`、`locales.ts`、纯函数迁入 `@maniu/client`；包只保留 kernel 依赖与宿主侧内容 | R3 | `@maniu/workspace` 不再被 profile 挂载；`pnpm typecheck`、client 构建、四条探针全绿 |
| R5 | profile 去客户端：发布变体为默认；禁用行写入模板 | R4 | 宿主启动零激活失败；`$events`、`session/follow`、命令面全通 |
| R6 | 接触面撤销（§5.3） | R4、R5 | `git diff upstream/master...HEAD -- apps/desktop packages/client` 为空；`upstream-diff.sh` 只剩保留项 |
| R7 | 文档收口：`RUN.md`、`PROJECT-RULES` 目录表、`prd-and-design`、`UPSTREAM-BASELINE` §3、`desktop-release` | R6 | `pnpm run test:docs`、`doc-sync` 全绿 |

每步的回退点：R4 用 `git revert`；R5 恢复旧 profile；R6 逐文件恢复；R7 纯文档。

### 5.2 上游 client 依赖的退出顺序

1. **停引用**：新包不 import 任何 `@deepseek-ai/dsh-client-*`。当前事实：`packages/lcoder/desktop` 与 `client/src` 对 `@deepseek-ai/*` 的 import 只有 4 条（`app-boot`、`profile-boot`、`host-webserver`、`client-connection` 的类型面），无一属于 UI 运行时。加一条 grep 门禁防止回流。
2. **停装配**：profile 不再挂 `ui-lcoder-workspace`，`dsh.client.inject` 整段删除；`lcoder/cordis.patch.yml` 只保留宿主侧内容或整体退出。
3. **停服务**：发布 profile 关闭全部客户端行（R5）。
4. **谈安装包**：禁用行不减包（T-177 结论）。要减体积必须动 core package set / 客户端 bundle / 随包载荷，另立任务；本轮只保证不新增。

### 5.3 接触面撤销清单

| 接触面 | 撤销方式 | 注意 |
| --- | --- | --- |
| `apps/desktop/src/{main,ipc,preload-app,locale,single-instance,update-presentation}.ts` | 还原上游原样，停止修改 | 新壳代码在 `packages/lcoder/desktop` |
| `apps/desktop` 的托盘/窗口/图标资源、`scripts/render-tray-icon.ts`、`scripts/dev.ts` | 还原上游 | 新壳自带图标与 ICO 管线；`deferSmoke` 语义改由新壳 dev 脚本自持 |
| `apps/desktop/tests/*` 与 `tests/expected/*` | 还原上游 | 新壳自带测试 |
| `apps/desktop/scripts/development-*.ts`（T-105 新增） | 随旧壳一起退出使用；文件可留到上游同步时再定 | 新壳需要同等的构建/运行时复用，另做 |
| `packages/client/ui-layout/src/client/AppFrame.tsx` | 还原上游 | 新壳不再用上游 AppFrame |
| `packages/client/modules/src/assets.ts` 与其测试 | 还原上游 | 新壳从 `file://` 发字体；不再需要 `.woff2` MIME 路由 |
| `scripts/gen-third-party-notices.ts` | **保留** | Inter 仍随新客户端分发 |
| `tsconfig.client.json` / `tsconfig.host.json` | **保留**，references 改指新包 | 聚合编译仍需要 |
| `pnpm-lock.yaml`、`AGENTS.md`、`lcoder/desktop-profile.patch.yml` | **保留** | 依赖、入口规则、十个角色 preset |

### 5.4 必须继续使用的宿主侧包

| 包 | 原因 |
| --- | --- |
| `@deepseek-ai/dsh-client-connection` | 宿主半拥有 `/api`、鉴权、mux 升级与信任栅栏 |
| `@deepseek-ai/dsh-client-file-upload` | `fileUploads` 服务，`session-controller` static inject 点名 |
| `@deepseek-ai/dsh-api-remotes` | 把 `$events` 事件源注册进 `typertGateway` |
| `@deepseek-ai/dsh-host-webserver`、`dsh-app-boot`、`dsh-profile-boot` | 宿主启动与 HTTP 监听 |

`dsh-client-modules`、`client-hmr`、全部 `ui-*`、`client-locale`、`client-ui-primitives`、`client-ui-session`、`client-store` 可以退出装配；是否从依赖闭包删除另由 core set 任务决定。

### 5.5 门禁

- `pnpm run hygiene` + 自定义 grep：新包不得出现 `@deepseek-ai/dsh-client-ui-*` / `client-store` / `client-locale`。
- `pnpm run typecheck`、`build:check`、`packages/lcoder` vitest、`check:i18n`、`test:docs` 每步全绿。
- 四条探针在发布 profile 上全 PASS；旧壳 smoke 只在 R2 前作为对照，R6 后可删。
- `./lcoder/scripts/upstream-diff.sh` 的输出必须能逐条对应本表。

## 6. 打包与更新签名

### 6.1 必须迁入新壳的发布件

新壳目前只有 `build` / `bundle` / `launch`，没有任何打包配置。切换前要在 `packages/lcoder/desktop/scripts/` 重建：

| 类别 | 迁入内容 | 来源（只读参考） |
| --- | --- | --- |
| 身份 | appId `ai.lansi.lcoder`、`LCoder`、`LCoder.exe`、`lcoder` scheme、产物前缀、下载前缀、更新缓存 `lcoder-updater`、tag 前缀 `lcoder-v` | `apps/desktop/scripts/desktop-product-identity.mjs` |
| 版本 | 独立发布版本 `LCODER_RELEASE_VERSION`，不继承上游 `0.2.2-alpha.2` | `desktop-build-version.mjs` |
| 构建配置 | asar、files、extraResources、NSIS、macOS、protocols、publish | `electron-builder-config.mjs` 与 `desktop-package-environment.mjs` |
| 安装器 | `installer.nsh`、目录切换、8 语言 `installer/locales/*.json`、侧边图 | `apps/desktop/installer*`、`resources/` |
| 签名 | Windows token signer、macOS Developer ID + notarize、`publisherName` | `windows-signing/`、`package-macos.ts` |
| 上传/刷新 | 上传计划、COS put、EdgeOne purge、release tag | `desktop-upload-plan.ts`、`desktop-publish-cos.ts`、`desktop-edgeone.ts`、`desktop-release-tag.ts` |
| 运行时载荷 | T-183 node-only `runtime/primary-runtime`（node + pnpm，无 Python/Office） | `prepare-primary-runtime.ts`、`scripts/primary-runtime/prepare.ts` |

复制后不要从 `apps/desktop` 反向 import：R6 会把旧壳还原上游，届时新壳必须自持。可把身份/版本/上传逻辑抽到 `lcoder/` 下的共享脚本，再由两壳各自调用，但优先一次迁完。

### 6.2 新壳的 files / asar / extraResources

| 项 | 取值 |
| --- | --- |
| `files` | `lib/types/main.js`、`lib/preload.cjs`、`host-entry.js`、`package.json`、client dist（`packages/lcoder/client/lib/dist/**`）、宿主依赖 `dsh/node_modules` |
| `asar` | `true`；`asarUnpack` 至少覆盖 `**/*.{node,dylib,dll,so,exe}`、`**/*.so.*`、ripgrep 二进制、原生 addon |
| `extraResources` | `runtime/primary-runtime`（node+pnpm）、profile 模板、`icon.png`、`tray.ico` |
| fuses | `runAsNode: true`（宿主用 `process.execPath` + `ELECTRON_RUN_AS_NODE` 启动）；其余 fuse 保持旧壳值 |
| NSIS | per-user、`oneClick:false`、`allowToChangeInstallationDirectory:false`、`differentialPackage:true`、8 语言 |
| macOS | dmg+zip、`hardenedRuntime`、entitlements、`app-update.yml` 写入与校验、8 语言 `CFBundleLocalizations` |
| publish | 单一 `generic` provider：`${DOWNLOAD_*_ORIGIN}/lcoder-desk[/<releaseId>]/feeds/<target>/` |

新壳运行期路径必须改为 `app.getAppPath()` / `process.resourcesPath`：当前 `profile.ts` 的 `REPO_ROOT`、`window.ts` 的 client dist、`main.ts` 的 tray 路径、`host-supervisor` 的 host-entry 入口在安装态全部失效。

### 6.3 更新器

- 引入 `electron-updater`，`autoDownload=false`、`autoInstallOnAppQuit=false`、`allowDowngrade=false`，仅在 packaged 且能找到 `app-update.yml` 时启用。
- `extraMetadata` 保留 `dshDesktopUpdateChannel` 与 `dshMandatoryUpdatePolicy`；强制更新策略若本轮不做，必须在发布说明中明确关闭，不能只在 UI 隐藏。
- 移植 `update-tasks` 与 `quit-inspection` 到新 `host-entry`：安装期新 HTTP 返回 503、安装前停宿主；否则会出现「安装时还在写会话」。
- 更新 UI 要覆盖：检查中、已最新、下载进度、安装待重启、失败原因；当前 `checkUpdate` 的 `unavailable/no-feed` 只是占位。

### 6.4 签名与 feed

- Windows：SafeNet EV USB token；环境变量 `DSH_DESKTOP_WINDOWS_{CER_FILE,SIGNTOOL,KEY_CONTAINER,TOKEN_PIN}`；`publisherName` 必须与证书一致，否则更新器拒绝新包。
- macOS：Developer ID + 公证（API key 或 Apple ID 二选一）；dmg 单独公证。
- 未签名产物不得进生产 feed；`DSH_DESKTOP_UNSIGNED=1` 只能用于本机验证，且发布配置必须置空。
- 产物名：`lcoder-${version}-win-${arch}.exe` / `lcoder-${version}-mac-${arch}.dmg`；固定下载名 `lcoder-latest-windows-x64.exe`、`lcoder-latest-macos-{arm64,x64}.dmg`。

### 6.5 必须由人执行的环节

| # | 环节 | 为什么必须人工 | 交付物 |
| ---: | --- | --- | --- |
| 1 | 插 USB 签名令牌、输入 PIN | 硬件令牌不能自动化 | 签名成功的安装包 |
| 2 | 填写 `.env.windows` / `.env.macos` 与 `presets/{test,production}.env`、`secrets/*-signing.env` | 凭据不入库 | 本机打包环境 |
| 3 | 填 `publishing/{test,production}.json` 与 COS 凭据 | 同上 | 上传计划可执行 |
| 4 | 在生产机跑 `package:win:x64` 并人工核对签名时间戳与 `publisherName` | 签名与产物身份要在真实环境验证 | 归档包 + 校验记录 |
| 5 | 上传到 COS、触发 EdgeOne purge、核对固定下载名 | 外部服务，影响线上 | feed 对象与刷新记录 |
| 6 | GitHub workflow dispatch 与发布审批 | 平台行为 | 发布记录 |
| 7 | macOS 真机打包与公证 | 需要 mac 与 Apple 凭据 | dmg + 公证票据 |
| 8 | 回退演练与发布说明确认 | 产品/运维决策 | 演练记录 |

自动化能覆盖的是：构建、未签名起窗冒烟、上传前校验、tag 生成；不能覆盖的是签名硬件、外部发布与真机矩阵。

## 7. 风险与未验项

### 7.1 高危风险

| 风险 | 现状证据 | 影响 | 处置 |
| --- | --- | --- | --- |
| **M1 真实模型回环未验** | mock 云端只返回固定文本，不产生 `tool_calls`；审批/提问只有单测与合成帧；T-191 台账把「审批、提问、模型切换、停止截断」列为未验 | 切换后真实用户第一次看到审批卡可能不回执、挂住工具或永不结算 | C4 前扩 mock：新增一个可控 `tool_calls` 模式触发需审批的工具与 `ask_user`；或使用真钥匙跑一条受控会话。探针必须验「事件送达 + 回执被接受 + 工具继续」 |
| **打包称重与打包态冒烟未做** | 新壳无 builder 配置；旧壳的称重只到 T-183 运行时载荷；新壳从未产出安装包 | 可能出现 asar 路径错、`runAsNode` fuse 缺失、native 模块未解包、profile 模板找不到 | C3 先产出未签名安装包，跑「安装 → 起窗 → 登录 → 发一条 → 重启读历史」；再做字节记录。体积不在本轮目标 |
| **macOS 未验** | 本方案与新壳全部按 win32 写；托盘只有 `.ico`，无 dock/activate 语义，也无 mac 图标与 entitlements | mac 用户无法启动或签名失败 | 单列一轮 mac 验证；在 C6 前明确「本轮只发 Windows」，或补齐后再发 |
| **Windows 退出事件根因未定位** | T-192：Electron 原生退出在慢关停后卡死，探针收不到 exit；现用「清理后自 SIGKILL」绕过 | 打包态可能出现关窗后进程残留、更新安装时旧实例不退 | 保留 SIGKILL 兜底与诊断日志；C3 在打包态专门验一次关窗与退出码；不要移除 12 秒硬上限 |
| 宿主崩溃不重启 | `HostSupervisor` 只在 ready 前处理失败，ready 后无 `exit` 监听 | 宿主崩溃后界面永久转圈或显示过期状态 | 切换前加崩溃检测与「重新启动宿主」入口；至少要有明确错误态 |
| 发布 profile 只验过 `standard` preset | T-186 实验用上游 web profile；LCoder 十个 preset 依赖更多服务 | 发布 profile 起不来或建会话被 `agent-preset/invalid` 拒 | C2 用 H2 口径 + 十个 preset 重跑；H3 的负对照保留 |
| 真实云端与令牌续期 | 全部探针走 mock；`refresh` / 401 / 额度耗尽未验 | 上线后登录态过期即掉线 | 用测试账号跑一次真实云端与 token 过期；不加「缺字段就猜」的兼容 |
| 立项语义漂移 | 旧壳建 `maniu-intake` 专用会话；新壳把 7 问指令发到工作台会话，仅两档 | 立项访谈拿不到 `requirement_draft` 工具面 | 恢复三档与 intake 专用会话，或在产品上明确降级；C2 前拍板 |

### 7.2 未验清单（按归属）

| 项 | 归属 | 建议验收时点 |
| --- | --- | --- |
| 审批 / 提问 waterfall 真实回环 | C1/C4 | C4 硬闸 |
| 工具卡与过程组 | C4 | C4 硬闸 |
| 附件探针本树复跑、durable 图片预览 | C4 | C4 硬闸 |
| 会话内模型切换、停止截断、上下文用量、改名 | C4 | C4 硬闸 |
| 项目打开失败与超时提示 | C4 | C4 |
| 云端不可用独立态、令牌续期 | C4 | C4 |
| 窗口拖拽、窄窗、托盘点击、F11/缩放、单实例 | C6 | RC 观察期 |
| 深链 `lcoder://`、窗口 attention | C1 | C6 前 |
| 打包态起窗、更新安装、签名校验 | C6 | C6 硬闸 |
| macOS 打包、签名、公证、窗口 | 单列 | 可延后，但发布范围要声明 |
| 多客户端并发（一个 socket 独占 Peer） | 观察期 | 非阻塞，记录行为 |
| `host-only-minimal` 关掉的行是否被新客户端隐式依赖 | C2 | C2 |

### 7.3 安全边界

- 渲染端继续无 Node、无 `fetch`、无宿主 cookie；IPC 只暴露既定 18 条通道；适配层白名单不得随切换放宽。
- `.spec` 写入只走 `commands.execute`；附件只走 `workspaceFiles.readBytes` / `fileUploads.upload`。
- 密码揭示（C1）只从内存读 `.spec/local.yaml`，不写日志、不进模型、不落渲染端持久存储。
- 更新器校验签名与 `publisherName`；未签名包不得加载 feed。

## 8. 需要用户拍板

| # | 问题 | 选项 | 建议与代价 |
| ---: | --- | --- | --- |
| 1 | 关窗行为 | A 保持旧壳「关窗到托盘 + 有任务时确认」；B 关窗即退出 | 建议 A：这是旧用户的主交互，且更新安装需要「停宿主」语义；代价是要移植 `quit-inspection` / `update-tasks` 与托盘交互，约 2–3 人日 |
| 2 | 审批/提问的验收方式 | A 扩 mock 产生 `tool_calls`；B 只用真钥匙跑受控会话 | 建议 A + 一次真钥匙冒烟：mock 可回归、可进 CI；真钥匙只做一次人工确认 |
| 3 | 项目信息密码揭示 | A 切换前补齐；B 接受功能回退 | 建议 A：旧壳已有，属「必需（流程）」；只在内存揭示，成本小 |
| 4 | 模型配置面 | A 切换前补「发现模型 + baseURL/模型 id 编辑」；B 只保留默认模型与密钥 | 建议 A：没有它就无法接入非默认云端路由；B 会让设置页明显缩水 |
| 5 | 角色看板与并行组 | A 补关系图与 `scheduling.groups` 视图；B 降级为列表 | 建议 B 先降级并在发布说明写明；关系图不是流程必需，但需用户确认 |
| 6 | 立项向导 | A 恢复三档 + `maniu-intake` 专用会话；B 保持两档、在现有会话里访谈 | 建议 A：`requirement_draft` 工具面只在该 preset 里，B 会改变立项行为 |
| 7 | 首版发布范围 | A 只发 Windows；B 等 macOS 一起发 | 建议 A：macOS 完全未验，等待会把 Windows 修复一起拖住 |
| 8 | 自动更新 | A 随切换启用（含强制更新策略与安装锁）；B 首版只支持手动安装，下一版再开 | 建议 A，但若 C1 排不进就把更新 UI 明确标「暂不可用」并保留 feed 回退路径；不能出现「显示可更新但装了报错」 |
| 9 | 宿主 home | A 共用 `~/.dsh`；B 新目录并迁移 | 建议 A：会话与云端令牌原地保留，回退也简单；代价是两壳共享凭据文件，需要约定不并发运行 |

## 9. 验收命令与交接

### 9.1 现有探针

```sh
# 云端 mock 默认 5091；探针会自行拉起
node lcoder/scripts/t187-s1-probe.mjs        # S1：窗口、门禁、会话、流式、重启历史
node lcoder/scripts/t189-m2-probe.mjs        # M2：导航、看板、详情、阅读器、命令面
node lcoder/scripts/t190-m3-probe.mjs        # M3：登录、设置、皮肤/字体/语言、窗口、偏好保持
node packages/lcoder/desktop/scripts/t191-m1-probe.mjs   # M1：工具/附件/停止/用量/改名（本树待复跑）
```

端口约定：主进程 9829、渲染 9822、宿主 9830；`t191` 用 9831/9823/9832。探针失败退出码 1，日志在 `lcoder/logs/`。

### 9.2 切换冒烟（C4 新建）

建议新增 `lcoder/scripts/t194-cutover-smoke.mjs`，一项一条断言，输出 `n/12`：

1. 窗口起来（frameless、标题栏存在）。
2. 宿主 `ready`、`$events` 首帧。
3. 登录门禁 `ready` 或 `signed-out` 正确。
4. 打开仓库成功并出现项目。
5. 会话列表非空。
6. 发消息出现流式正文并落定。
7. 工具卡出现（mock `tool_calls`）。
8. 审批卡往返（回执被接受、工具继续）。
9. 提问卡往返（选择提交、回合继续）。
10. 附件上传并回显。
11. 五页切换（需求、任务、项目、项目信息、设置）。
12. 设置保存后重启仍生效（模型 + 皮肤 + 语言）。

同一脚本在「干净仓」与「DEMO-01 已用仓」各跑一次；结果写入发布记录。

### 9.3 代码门禁

```sh
export pnpm_config_verify_deps_before_run=false
pnpm run build:artifacts
pnpm run build:check
pnpm run typecheck
pnpm exec vitest run packages/lcoder
pnpm run check:i18n
pnpm run test:docs
```

### 9.4 交接

- 本任务只产出本文件与 parity 口径，不改产品代码、不切默认、不删源码。
- 后续任务建议按 C1（系统面）→ C2（发布 profile）→ C3（打包链）→ C4（冒烟）→ C5（入口切换）→ C6（发布与观察）→ C7（移除与文档）拆分；C1 与 C2 可并行，C3 依赖 C1 的更新与退出实现。
- 需要人工执行的环节集中在 §6.5；其中签名令牌、生产上传、macOS 与回退演练必须在真实环境完成，不能由本机自动化替代。
