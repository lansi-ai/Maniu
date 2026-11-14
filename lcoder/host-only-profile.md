# 宿主-only profile 启动实验（T-186）

状态：实验完成。结论是**可行**；browser 面全部关掉后宿主能起，鉴权、一元 RPC、流式 mux、`$events` 都通。实验不改产品源码、不改 `apps/desktop` 默认装配、不改 `.spec` 与开发台账。

## 0. 结论

- **可行**。196 行合成清单里关掉 84 行（63 个浏览器面行 + 21 个只服务上游 UI 的宿主行）后，宿主在 3099 端口正常启动，日志零激活失败，并完成「建会话 → 列会话 → `session/follow` 首帧 → `$events` 实时事件」。
- **实测最小组合是 89 个启用行**（H2）。再删 14 行（H3）宿主仍能起、API 仍应答，但 `session/create` 返回 `agent-preset/invalid`：默认 `standard` preset 的 12 个工具行在等 8 个宿主服务。所以 89 行是**当前默认 preset 下**的下限，不是宿主本身的下限。
- 必须保留的 `dsh-client-*` 包只有两个，且都是它们的**宿主半**：`connection`（`/api` 路由、鉴权、mux 升级）与 `file-upload`（`fileUploads` 服务，`session-controller` 的 static inject 里点名）。`modules`、`client-hmr`、`ui-*`、`locale`、`shortcuts`、`ui-renderer` 等全部可关。
- 另外 `api-remotes`（不叫 `dsh-client-*`，但属客户端装配）也必须保留：它的宿主入口把 `$events` 事件源注册到 `typertGateway`。
- 对 T-184 的影响：M4 的「宿主-only profile 变体」没有启动阻断；S1 可以直接用本实验的 89 行组合起步。真正的新增约束来自 LCoder 自己的 preset——十个角色挂的工具会重新拉高宿主下限，需在 preset 落地后重测。
- 对 S1 的一个具体提示：`$events` 要求 `/connect` 时声明 `interactions=answer`；声明 `none` 会收到 `gateway/interactions-forbidden`。新壳的适配层必须按 `answer` 换 cookie。

## 1. 实验条件

| 项 | 值 |
| --- | --- |
| 工作树 | `E:\Projects\LCoder\.worktrees\pool-slot-1`，分支 `lcoder/t186-host-only` |
| 仓内 home | `<本树>\.dsh-home-t186`（一次性，实验后删除） |
| profile | 从 `.dsh-home/profiles/web` 拷的出厂模板：`bundles = dsh-base + dsh-web-app`，`cordis.patch.yml` 为空 |
| 端口 | 3099（3099 全程只有本实验的进程） |
| Node | v24.16.0 |
| 模型 | 未配置；本实验不跑模型回合，只建会话与订阅 |
| 组合口径 | `pnpm dsh web --dump-config` 的合成清单 196 行；`disabled: true` 按字面统计，`!!js` 条件禁用不计入 |

### 1.1 可复现命令

配置随本文件提交：`lcoder/host-only-profile.patch.yml`（关 63 行浏览器面）与 `lcoder/host-only-minimal.patch.yml`（再关 21 行宿主面）。

```sh
export pnpm_config_verify_deps_before_run=false
export DSH_HOME='E:\Projects\LCoder\.worktrees\pool-slot-1\.dsh-home-t186'

# 1) 落一份出厂 web profile（本次实验是从既有 .dsh-home/profiles/web 拷的三份文件）
mkdir -p "$DSH_HOME/profiles/web"
cp .dsh-home/profiles/web/cordis.yml .dsh-home/profiles/web/package.json \
   .dsh-home/profiles/web/cordis.patch.yml "$DSH_HOME/profiles/web/"

# 2) H1：只关浏览器面
pnpm dsh web --patch lcoder/host-only-profile.patch.yml \
  --no-open --host 127.0.0.1 --port 3099 > lcoder/logs/t186-h1.log 2>&1

# 3) H2：再关 21 行只服务上游 UI 的宿主行
pnpm dsh web --patch lcoder/host-only-profile.patch.yml \
  --patch lcoder/host-only-minimal.patch.yml \
  --no-open --host 127.0.0.1 --port 3099 > lcoder/logs/t186-h2.log 2>&1
```

就绪判据：日志出现 `dsh web: http://127.0.0.1:3099/?token=…`，且没有 `did not activate` / `failed to activate`。

### 1.2 探针

| 脚本 | 作用 |
| --- | --- |
| `lcoder/scripts/t186-ws-probe.mjs <port> <launchToken> <sessionId> [interactions]` | 自换 cookie，开 `$events` 与 `session/follow` 两个逻辑流，打印首帧摘要 |
| `lcoder/scripts/t186-events-probe.mjs <port> <launchToken> <cwd>` | 订阅 `$events` 后新建一条会话，等真实的 `api-session/added` |

## 2. 组合数字

| 组合 | 启用（字面） | 关闭（字面） | 相对基线关闭 | 结果 |
| --- | ---: | ---: | ---: | --- |
| 基线 `dsh web` | 173 | 23 | — | 全量，含 73 个浏览器插件 |
| H1 只关浏览器面 | 110 | 86 | +63 | 起得来；API/WS/events 全通 |
| H2 再加 21 行宿主裁剪 | 89 | 107 | +84 | 起得来；建会话成功 |
| H3 再加 14 行（负对照） | 75 | 121 | +98 | 宿主起得来，但建会话被 preset 拒绝 |

说明：`bash-sandbox` 等行由 `!!js` 在 win32 上动态禁用，不计入「字面关闭」。运行时激活数没有仪器（`plugin-inventory` 在 H2 已关）；H1/H2/H3 的启动日志都是 0 条激活失败，这是本次能给出的精度上限。

## 3. 逐步证据

### 3.1 启动与激活

H1 日志只有两行：命令行回显与 ready 行；**无** `N entries did not activate`。H2、H3 相同。

### 3.2 鉴权链

```sh
TOKEN=$(grep -o "token=[A-Za-z0-9_-]*" lcoder/logs/t186-h2.log | head -1 | cut -d= -f2)
curl -s -D lcoder/logs/t186-connect.headers -o /dev/null -c lcoder/logs/t186-cookies.txt \
  "http://127.0.0.1:3099/connect?token=$TOKEN&interactions=answer"
```

结果：`HTTP/1.1 302 Found`，`location: ./api/remote.mux`，1 条 `Set-Cookie`（cookie 值不落文档）。注意：一个 API socket 拥有它换来的 Peer，socket 关闭后同一 cookie 失效；每次订阅都要重新换。

### 3.3 一元 RPC

请求体必须恰好一个 plain-object 的 `args`，字段名是生成签名里的参数名（`session/list` 是 `_request`，`session/create` 是 `request`）：

```json
{"type":"client-request","rpcId":"t186-2","method":"session/list","payload":{"args":{"_request":{}}}}
```

结果：

```json
{"type":"server-response","rpcId":"t186-2","result":{"ok":true,"value":{"items":[]}}}
```

`session/create`（`cwd` 指向临时目录）返回 `ok:true` 与新 `sessionId`，`agentPreset` 为 `standard`。

### 3.4 流式 mux 与 `session/follow`

Node 24 全局 `WebSocket` 直接可用（v24.16.0），构造时的 `{ headers: { cookie } }` 被接受，真实握手成功。开两个逻辑流后首帧：

| 流 | 首帧 |
| --- | --- |
| `$events`（`{args:{}}`） | `{type:'ready', clientId, host}` |
| `session/follow`（`{args:{request:{address:{kind:'session',sessionId}, activate:false, maxMessages:20}}}`） | `{type:'snapshot', header, projections, cursor, records, hasMore}` |

同一探针在 H1 与 H2 都返回 `both-first-items`。`interactions` 参数用于负向验证：

| `/connect` 的 interactions | `$events` 结果 |
| --- | --- |
| `answer` | 首帧 `ready`，之后可收事件 |
| `none` | 错误帧 `gateway/interactions-forbidden`（`forwarded Remote events require interactions=answer`） |

### 3.5 事件投递

订阅 `$events` 后新建一条会话，收到真实事件：

```json
{"type":"item","streamId":"ev","value":{"type":"event","event":"api-session/added","args":[ … ]}}
```

这是 S1 会话列表增量刷新的唯一来源，不能只靠轮询。

## 4. 最小必需插件集

### 4.1 按 inject 链可指认的硬必需

| 组 | 行（id） | 依据 |
| --- | --- | --- |
| 传输与就绪 | `web-startup`、`webserver`、`web-runtime`、`connection` | `/api` 与 mux 升级、launch token、URL/ready 行；`web-runtime` 也是当前唯一的 token 公告点 |
| 协议与网关 | `typert`、`typert-loader`、`typert-gateway`、`remote-access` | Remote 描述、分发、非 owner Peer 访问控制 |
| 事件源 | `api-remotes` | 宿主入口把 allowlist 事件注册到 `typertGateway`；缺它 `$events` 没有源 |
| 会话/工作区 API | `session-controller`、`workspace-controller`、`workspace-files` | 三个命名空间的宿主实现 |
| `session-controller` 的注入 | `agent-default-model`、`agent`、`attachment-local`、`file-upload`、`llm`、`session`、`session-projection`、`session-query-sqlite`、`workspace` | `static inject` 逐项点名；缺一项控制器不激活 |
| 回合运行时 | `tools`、`tool-executor-native`、`system-prompt`、`agent-loop`、`session-persistence-jsonl` | 发消息后真正跑回合 |
| 存储 | `storage`、`storage-json`、`storage-domain` | 工作区与设置落盘 |
| 进程与文件 | `subprocess`、`sandbox`、`sandbox-policy`、`fs-sandbox`、`fs-observation-policy`、`shell-env`、`working-directory`、`tool-working-directory` | 工具执行前置 |
| 交互 | `commands`、`approval`、`permission`、`user-questions` | 人类命令、审批、提问 |
| 模型 | `llm-deepseek`、`llm-pi-ai`、`llm-deepseek-account`、`deepseek-llm-api-extensions`、`llm-retry` | 目录、凭据、路由 |
| preset | `agent-preset-registry` + 至少一个 `preset-*` | `session/create` 必须有可用 preset |

### 4.2 受默认 preset 约束的行（H3 证明）

H3 在 H2 基础上再关 14 行后，宿主仍正常起、`session/list` 仍应答，但 `session/create` 返回：

| 缺失服务 | 等待它的 preset 行 |
| --- | --- |
| `jobs` | `tool-jobs` |
| `skills` | `skill-filesystem`、`tool-skill` |
| `goals` | `command-goal`、`tool-goal` |
| `web` | `tool-web` |
| `pluginManager` | `tool-plugin-manager` |
| `subagents` | `tool-subagent-control`、`tool-subagent`、`tool-subagent-fork` |
| `subagents` + `ptcRuntime` | `workflow-ptc` |
| `workflowEngine` | `tool-workflow` |

所以：**宿主能少，preset 不能少**。要再降 89 行，只能换一个不引用这些服务的 preset（本次未做，见 §7）。

### 4.3 已关闭的行

- 63 行浏览器面：全部 `ui-*`、`modules`、`client-hmr`、`locale`、`shortcuts`、`resources`、`ui-theme`、`cordis-client-runner`、`product-analytics`、`message-quotes`、`session-log-export`、`ui-settings-*`、`entry-customization`。
- 21 行只服务上游 UI 的宿主面：`otel`、`session-telemetry-otel`、`desktop-product-telemetry`、`plugin-inventory`、`plugin-package-inventory-deepseek`、`job-controller`、`terminal-controller`、`office-to-pdf`、`open-in-app`、`message-feedback`、`command-feedback`、`session-stats`、`session-turn-outline`、`deliverable-file-references`、`workspace-changes`、`harness-dev-context`、`cordis-host-runner`、`cordis-inspect-providers`、`mcp-resources`、`hmr`、`subagent-model-selection-settings`。

## 5. 必须保留的客户端包与原因

| 包 | 行 id | 为什么不能关 |
| --- | --- | --- |
| `@deepseek-ai/dsh-client-connection` | `connection` | 宿主半拥有 `/api` 路由、launch token 换 cookie、mux 升级与信任栅栏；关掉就没有 API |
| `@deepseek-ai/dsh-client-file-upload` | `file-upload` | 宿主半提供 `fileUploads`；`session-controller` 的 `static inject` 列了它，缺它控制器不激活 |
| `@deepseek-ai/dsh-api-remotes` | `api-remotes` | 不是 `dsh-client-*` 命名，但属客户端装配；宿主入口注册 `$events` 事件源，缺它事件流为空 |
| `@deepseek-ai/dsh-client-modules` | `modules` | **可关**。它只组合浏览器 roster、发 `/plugins/…`；H2 关掉后 API 不受影响。代价是上游前端页面完全不可用——这正是新客户端要的结果 |

## 6. 对 T-184 的 M4 与 S1 的影响

- **M4 的宿主-only profile 变体没有阻断**。R5 可以照本实验落地：关 84 行 + 保留 §4.1 的硬必需行；`git diff` 不会碰上游源码。
- **S1 的启动路径可以照抄 H2**：先 89 行起宿主，跑「建会话 → 列表 → follow → 发消息」。注意 S1 需要真实模型才会产生流式回复，实验只验到 follow 首帧。
- **下限会被 LCoder preset 抬高**。十个 LCoder 角色挂的是 kernel 工具（`cmd_run`、`task_*`、`spec_*` 等），它们需要 shell/sandbox/fs 一类服务；`standard` preset 的 8 个服务依赖只是第一条证据。preset 落地后要重跑一次本实验的 H2 口径。
- **token 公告点要提前设计**。新壳从 `desktop-host` 的 `ready.url` 拿 token，而 URL 行由 `web-runtime` 打印。若新 profile 去掉 `web-runtime`，必须自带等价的 ready/token 通道，否则壳拿不到 cookie。
- **`$events` 必须 `interactions=answer`**。这条要写进适配层的 `/connect` 实现与冒烟断言，不能只验一元 RPC。
- **前端静态资源**：`web-runtime` 仍会挂 `frontend-static` 指向上游 `dsh-web-frontend/dist`。本实验没有改它；新壳换自己的 dist 是独立一步（未验，见 §7）。

## 7. 阻断点与替代路径

| 阻断点 | 现象 | 替代路径 |
| --- | --- | --- |
| 默认 preset 依赖 8 个宿主服务 | H3 的 `agent-preset/invalid`，列出 12 个等待中的工具行 | 换小 preset（只挂 persona + 必要工具）后可再降宿主行；需单独实验 |
| `web-runtime` 是唯一 token 公告点 | 去掉后看不到 ready URL，`desktop-host` 的 `ready` 消息也随之缺失 | 保留 `web-runtime`（推荐，成本为零），或在新壳里自建 ready 通道 |
| `plugin-inventory` 关掉后没有运行时激活数 | 只能以「0 条激活失败」判断 | 保留 `plugin-inventory` 只作诊断（+1 行） |
| 上游前端页面不可用 | `/` 仍是上游 dist，但插件 roster 为空，页面会停在 Loading plugins | 新客户端不加载该页面；这不是缺陷 |

## 8. 未验项

- 未跑真实模型回合：没有凭据，只验到 `session/follow` 首帧与 `session/create`。
- 未验 `workspace.follow`（用 `session.follow` 代替）；未验 `workspace/create` 与目录选择。
- 未验审批/提问的 waterfall 回执往返。
- 未测 LCoder 十个 preset 的宿主依赖闭包（当前只有 `standard` 的证据）。
- 未验证自定义小 preset 方案能否真的把 89 行继续压低。
- 未验证 `frontend-static` 换成本地新客户端 dist。
- 未做 macOS/Linux；本实验只在 win32 上跑。
- 运行时激活条目数未采集（仪器行被裁）；进度量的精度是「日志里 0 条激活失败」。
- 未用 `--from-default-profile web` 落 profile（本次是拷模板），该路径未实测。
- 未做并发/多客户端：一个 API socket 独占其 Peer，第二 socket 的行为未验。
