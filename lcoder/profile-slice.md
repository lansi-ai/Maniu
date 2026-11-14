# Profile 裁剪减重（T-177）

状态：阶段一（静态装配清单与三波切片）与阶段二（逐波实测）都已完成；T-178 起三波默认接入发布 profile（`rebuild.cmd profile` 自动 apply + 合成校验硬闸）。静态推导的数字保留作对照，结论以「阶段二实测」一节为准。

## 结论

- 桌面 profile 合成后共 208 个顶层条目，win32 桌面上 181 启用 / 27 禁用。运行时的等价口径是 211 条 / 184 启用 / 184 激活 / 0 失败，多出的 3 条是 profile 根 `include` 与 2 个无 id 的动态条目。
- LCoder 直接触达 21 行（含自己的 2 行），其余 160 行启用条目不是 LCoder 功能路径的一部分。
- 三波切片共关 51 行：第一波 26、第二波 9、第三波 16（另有一行只改 preset 默认值）。实测：浏览器 roster 73→42，组合 URL 未压缩 10,866,318→7,758,357 字节（−2.96 MiB，−28.6%），gzip 传输 2,368,669→1,620,622 字节（−730.5 KiB，−31.6%）；基线三次启动中位数 5 秒，三波各 5/4/5 秒（第三波取修正版 w3b 样本；含 input-trigger 的首版停在 Loading plugins，其 4 秒作废），1 秒分辨率下看不出差异。
- 每波重启后都跑了同一组 7 条 DOM 断言（登录态、外壳根、打开仓库、外壳五页切换、任务详情、设置页、会话发一条消息）。第一、二波全绿；第三波首版触发断点（浏览器停在 Loading plugins），回滚后把输入触发链移出该波，修正版全绿。
- 有一条反直觉的承重项：`config-editor` 是 `settings` 服务的硬注入依赖（`packages/settings/settings/src/index.ts:224`），按"插件配置编辑器"直觉关掉会断 LCoder 设置页的保存。同类的还有 `workspace-files`、`ui-workspace`、`ui-settings`、`ui-sidebar-right`、`ui-context-menu`，都在切片的"明确不关"清单里。
- 安装包体积这一维 profile 改不了：发布物走 core package set，333 个包 / 68.17 MiB（`lcoder/closure-audit.md`），与本切片无关，要动得另立 core set 裁剪任务。

## 口径

合成以三份 patch 为准：`packages/bundle/base/cordis.patch.yml`、`packages/bundle/web-app/cordis.patch.yml`、`lcoder/desktop-profile.patch.yml`（运行副本另有一段本机本地段，不影响行集合）。

桌面 profile 名 `desktop` 被 CLI 独占（`apps/cli/src/args.ts:84`），`dsh --profile desktop --dump-config` 直接拒绝。取清单的做法是把运行副本的三份文件（`cordis.yml`、`cordis.patch.yml`、`package.json`）复制成一个临时 profile，再跑 `--dump-config`；该方法不启动宿主、不求值 `!!js`，只走 patch 合成算法。

`disabled` 的四种 `!!js` 表达式按 win32 桌面上下文评估：`!ctx.get('profileContext')` 与 `profileContext?.name !== 'desktop'` 为假（profile 启动与桌面名都在），`process.platform === 'win32'` 为真，`process.platform !== 'win32'` 为假。`disabled: true` 是字面禁用。

"客户端产物"是 `packages/*/*/lib/client.js` 的未压缩字节，只是下载量的上界；实际传输走 `plugins/??…` 组合 URL 并经 gzip，阶段二用带 token 的请求实测。

"LCoder 触达"取 `packages/lcoder/{kernel,workspace}` 的源码 import、`packages/lcoder/workspace/package.json` 的 `dsh.client.inject`，以及它们通过公开服务间接依赖的宿主行；记号 S=会话、T=任务、R=需求、P=项目、I=项目信息、G=设置、D=交付物。上游自己的聊天界面（`ui-conversation`、`ui-chat`、`ui-tool` 等）不在七条路径内——LCoder 外壳整壳自绘，这些插件仍会下载和激活，但画不到屏幕上。

与监督窗口口径的差异：监督窗口测得"96 个上游插件、3 处禁用"。阶段二运行时实测是 211 条 / 184 启用 / 184 激活 / 27 禁用，浏览器 roster 73；三个数都不等于 96。base 层 patch 自身是 97 行，96 大概按这一层数出来，本报告不再沿用，统一用"合成清单条目""运行时激活条目""浏览器 roster"三个口径并分别标注。

## 装配总览

| 口径 | 数 | 说明 |
| --- | ---: | --- |
| 合成后顶层条目 | 208 | 按 id 覆盖后剩余的行 |
| win32 桌面启用 | 181 | 宿主 109 + 客户端 72 |
| win32 桌面禁用 | 27 | 26 行字面禁用 + `bash-sandbox` 的平台表达式（非 win32 才挂） |
| preset 定义行 | 14 | 上游 4 个（standard / ptc / cordis / minimal）+ LCoder 10 个 |
| preset 子插件 | 114 | 只在对应角色会话创建时装载 |
| LCoder 直接触达 | 21 | 含 `@lcoder/*` 两行 |
| 客户端产物合计 | 7.25 MiB | 全部 client 包，未压缩，含未启用项 |

## 第一波：先关掉没有业务消费者的整块

26 行，静态减少客户端产物约 1,405 KiB（逐行舍入后相加 1,406 KiB），宿主少 11 行。"同波必须一起关"的组已经写在切片文件的注释里。

| id | 包 | 面 | 依赖关系与风险 | 预计断点 | client.js |
| --- | --- | --- | --- | --- | ---: |
| `otel` | dsh-otel | 宿主 | 只被下面三行消费 | 无遥测上报 | — |
| `session-telemetry-otel` | dsh-session-telemetry-otel | 宿主 | `FEEDBACK_ONLY`，无消费者 | 反馈上报不可用 | — |
| `desktop-product-telemetry` | dsh-host-product-telemetry-otel | 宿主 | 依赖 otel，只被 product-analytics 消费 | 产品埋点不可用 | — |
| `product-analytics` | dsh-client-product-analytics | 客户端 | 依赖 desktop-product-telemetry | 埋点无效 | 2 KiB |
| `plugin-manager` | dsh-plugin-manager | 宿主 | 提供 `pluginManager`，只被 plugin-inventory 取用；桌面"禁用第三方插件"的恢复路径由 `apps/desktop/src/project-manager.ts` 直接改 patch，不经过它 | 插件启停不可用 | — |
| `plugin-inventory` | dsh-host-plugin-inventory | 宿主 | 提供 `pluginInventory`，客户端 Plugins 页经 remote 读取 | Plugins 页无数据 | — |
| `plugin-package-inventory-deepseek` | dsh-plugin-package-inventory-deepseek | 宿主 | 无服务消费者 | 插件市场清单消失 | — |
| `ui-plugin-manager` | dsh-client-ui-plugin-manager | 客户端 | 被 5 个官方设置页与 entry-customization 硬注入，必须同关 | Plugins 页消失 | 428 KiB |
| `ui-settings-plugins` + 5 个官方设置页 | dsh-client-ui-settings-* | 客户端 | 与 ui-plugin-manager 同组 | 设置里 Plugins 分区消失 | 186 KiB |
| `entry-customization` | dsh-client-ui-entry-customization | 客户端 | 硬注入 ui-plugin-manager | 启动器不再可固定/编辑 | 10 KiB |
| `office-to-pdf` | dsh-office-to-pdf | 宿主 | 提供 `officeToPdf` remote 命名空间，只被文档预览的 office 渲染器取用；无硬注入 | Office 文件预览不出现 | — |
| `ui-workflow-run` | dsh-client-ui-workflow-run | 客户端 | 宿主两行已被 web-app 禁用 | workflow 运行卡片消失 | 35 KiB |
| `schedule` | dsh-schedule | 宿主 | 提供 `schedule`；合成清单里没有任何工具行消费它（tool-schedule 未被任何 preset 挂载） | 定时提醒不投递，已存记录留在本地存储（未核具体文件） | — |
| `ui-schedule` | dsh-client-ui-schedule | 客户端 | 会话提醒面板 | 提醒 UI 消失 | 622 KiB |
| `goal` | dsh-goal | 宿主 | 提供 `goals`，只有未挂载的 sdk server 以可选方式读取 | 会话目标不可用 | — |
| `goal-round-driver` | dsh-goal-round-driver | 宿主 | 依赖 goals | 同上 | — |
| `ui-goal` | dsh-client-ui-goal | 客户端 | GoalBar 座位 | 目标条消失 | 30 KiB |
| `ui-plan` | dsh-client-ui-plan | 客户端 | 宿主 plan-mode 已被 web-app 禁用 | plan 座位消失 | 37 KiB |
| `jobs` | dsh-jobs-local | 宿主 | 提供 `jobs`；唯一消费者 tool-bash / tool-pwsh 只在 preset-standard 的子插件里（LCoder 的 preset 不挂） | 后台任务注册表消失 | — |
| `job-controller` | dsh-api-job-controller | 双面 | 硬注入 jobs | 任务名单 remote 消失 | 12 KiB |
| `ui-jobs` | dsh-client-ui-jobs | 客户端 | 硬注入 job-controller | 任务名单 UI 消失 | 44 KiB |

## 第二波：侧栏四类页签与交付物

9 行，静态减少客户端产物 702 KiB。"交付物"一列指上游的"本轮改动文件"卡片，与 LCoder 的 `.spec` 交付物无关——两者同名不同物，后者由外壳自绘。

| id | 包 | 面 | 依赖关系与风险 | 预计断点 | client.js |
| --- | --- | --- | --- | --- | ---: |
| `ui-sidebar-browser` | dsh-client-ui-sidebar-browser | 客户端 | 只注册页签；桌面是唯一启用它的档位 | 内置浏览器页签消失 | 71 KiB |
| `ui-sidebar-terminal` | dsh-client-ui-sidebar-terminal | 客户端 | 硬注入 terminal-controller | 终端页签消失 | 30 KiB |
| `terminal-controller` | dsh-api-terminal-controller | 双面 | 提供 `webTerminals`/`terminalController`，只被终端页签消费 | 终端 remote 消失 | — |
| `ui-sidebar-files` | dsh-client-ui-sidebar-files | 客户端 | 只注册页签，读 workspace-files | 文件树页签消失 | 91 KiB |
| `ui-sidebar-documentpreview` | dsh-client-ui-sidebar-documentpreview | 客户端 | 被 ui-open-in-app 硬注入，必须同关；交付物文档预览走外壳自己的弹层（`files.readPage`），不用它 | 文档预览页签消失 | 320 KiB |
| `ui-open-in-app` + `open-in-app` | dsh-client-ui-open-in-app / dsh-host-open-in-app | 客户端 + 宿主 | 同组 | "用其他应用打开"按钮消失 | 59 KiB |
| `ui-deliverables` | dsh-client-ui-deliverables | 客户端 | 提供 `chatFileMentions`，ui-chat 以 `ctx.get` 可选读取 | 本轮改动文件卡片消失 | 130 KiB |
| `deliverable-file-references` | dsh-deliverable-file-references | 宿主 | 无服务消费者 | 交付物文件引用不再进提示词 | — |
| `workspace-changes` | dsh-workspace-changes | 宿主 | 提供 `workspaceChanges`，无服务消费者 | 不再采集工作树快照 | — |

## 第三波：客户端 UI 未用项与上游 preset 名册

16 行禁用 + 1 行只改配置，静态减少客户端产物 927 KiB。这一波改的是产品口径，不只是体积：关掉后标准 / PTC / cordis / minimal 四套上游角色从名册消失，所以同一波把 `agent-preset-registry` 的 `default` 从 `standard` 改成 `lcoder`，否则新建会话的兜底角色会指向已禁用的 preset。

首版还包含 `ui-input-trigger` / `ui-commands` 两行，实测直接断链（见"阶段二实测"的回滚记录），已从本波移除；它们属于"可裁但需整链"，候选写在切片文件末尾的注释里。

| id | 包 | 面 | 依赖关系与风险 | 预计断点 | client.js |
| --- | --- | --- | --- | --- | ---: |
| `agent-preset-registry`（仅改配置） | dsh-agent-preset-registry | 宿主 | `default` 与 `selectedDefault` 同时写 `lcoder` | 无（新建会话兜底角色变成 lcoder） | — |
| `preset-standard` / `preset-ptc` / `preset-cordis` / `preset-minimal` | dsh-agent-preset | 宿主 | 只被 registry 以 `injects: [agentPresets]` 读取；必须同改 registry 的 default | 上游四个角色不可选 | — |
| `ui-trajectory` | dsh-client-ui-trajectory | 客户端 | 提供 `sessionToolResults`，只被 ui-attachment 注入 | 轨迹视图消失 | 456 KiB |
| `ui-attachment` | dsh-client-ui-attachment | 客户端 | 依赖 ui-trajectory；外壳用自己的附件条（ChatExtras） | 上游附件条消失 | 98 KiB |
| `ui-cordis` | dsh-client-ui-cordis | 客户端 | 无消费者 | Cordis 检查器页签消失 | 90 KiB |
| `ui-model-selection` | dsh-client-ui-model-selection | 客户端 | 提供 `modelDirectories`，无消费者；外壳用自己的 ModelSettings | 上游模型选择座位消失 | 89 KiB |
| `ui-message-feedback` | dsh-client-ui-message-feedback | 客户端 | 点赞/点踩与反馈弹窗 | 消息反馈消失 | 43 KiB |
| `message-feedback` / `command-feedback` | dsh-message-feedback / dsh-command-feedback | 宿主 | 支撑上面那行与 `/feedback` | 反馈数据面消失 | — |
| `session-log-download` / `ui-settings-session-log` | dsh-session-log-export / dsh-client-ui-settings-session-log | 客户端 | `/export` 与下载弹窗、设置页入口；注入 ui-commands（保留） | 会话导出不可用 | 35 KiB |
| `ui-file-actions` | dsh-client-ui-file-actions | 客户端 | 提供 `fileActions`，无消费者 | 文件动作菜单消失 | 67 KiB |
| `ui-skill` / `ui-reference` | dsh-client-ui-skill / dsh-client-ui-reference | 客户端 | 输入触发链的叶子，都注入 ui-input-trigger（保留，见"明确不关"） | 上游技能/引用补全消失 | 49 KiB |

## 明确不关的行

这些行看着像"插件管理/侧栏/UI"，实际是 LCoder 的承重点，已写进切片文件末尾的注释防止后来者顺手加进去。

| id | 为什么不能关 |
| --- | --- |
| `config-editor` | `settings` 服务 `static inject = ['configEditor', 'profileContext']`；关掉它 `settings` 不激活，LCoder 设置页保存直接断 |
| `settings` / `settings-controller` / `ui-settings` | 外壳的 ModelSettings 走 `remote.settings.describe/mutate`，并从 ui-settings 读 `settingsSchema` |
| `workspace-files` / `workspace-controller` / `workspace` / `ui-workspace` | 任务、需求、项目、项目信息的文件投影全走这四个；外壳还硬注入 ui-workspace |
| `ui-sidebar-right` | 外壳的 `sidebarRightTabs` 与 `sidebar.right.pane.tab` 都注册在它上面 |
| `ui-context-menu` | 11 个客户端插件硬注入它，关掉会连锁失活 |
| `ui-session` / `ui-layout` / `ui-renderer` / `ui-slots` / `locale` / `connection` / `api-remotes` | 外壳的 `dsh.client.inject` 直接列了它们 |
| `ui-input-trigger` / `ui-commands` | 输入触发链的根。`ui-chat`、`ui-subagent`、`ui-commands`、`ui-reference`、`ui-skill` 都硬注入 `ui-input-trigger`；`ui-commands` 又被 `message-feedback`、`model-selection`、`permission-presets`、`session-log-export` 注入。单独关任何一个，浏览器就停在 Loading plugins（实测见阶段二）。要裁得连 ui-chat / ui-conversation / ui-tool 整链一起裁并重验回退面 |

## 切片文件与落地方式

`lcoder/desktop-profile.slice.yml` 是唯一源，按 `# ── T-177 slice · wave N` 分段，只写 `disabled` 或必要的完整 `config`；patch 语义是同 id 后写覆盖整行 config，所以不重抄上游字段。

`lcoder/scripts/profile-slice.mjs` 负责落地与校验：

```sh
node lcoder/scripts/profile-slice.mjs apply --all         # 全部波次（rebuild 自动调用；可 --wave 单发）
node lcoder/scripts/profile-slice.mjs check --all         # 硬闸：逐 id 核对合成清单
node lcoder/scripts/profile-slice.mjs status
node lcoder/scripts/profile-slice.mjs restore
node lcoder/scripts/profile-slice.mjs estimate --wave 1   # 静态客户端产物上界
```

默认接入：`lcoder\scripts\rebuild.cmd profile` 拷完运行副本后立刻 `apply --all`，profile 保障末尾再跑 `check --all`；`warm`/`claim` 在跳过构建时也执行同一段 profile 保障，所以这条路径同样带切片。运行副本被重拷后切片会重新套上，不再是“重拷即消失”。脚本把选中波次追加到运行副本 `apps/desktop/.desktop-build/development/home/profiles/desktop/cordis.patch.yml` 末尾，夹在一对 `# ── T-177 slice` 标记之间；apply 先摘旧块再写，重复执行字节一致，重写运行副本后重放也不堆块；写入前解析一次，解析失败不落盘；首次 apply 备份为 `cordis.patch.yml.t177-backup`（restore 不删它）。

硬闸：`check` 把运行副本的三份文件（`cordis.yml`、`cordis.patch.yml`、`package.json`）拷成同 home 下的临时 profile `desktop-slice-check`，跑一次 `--dump-config` 后立即删除；逐个核对切片 id 在合成清单里存在且为 `disabled: true`，`agent-preset-registry` 另核 `config.default` / `selectedDefault` 都是 `lcoder`。任一 id 未命中就打印全部未命中 id 并以非零退出，`rebuild.cmd` 把失败原样传出。这正是升上游后的漂移探测器：上游 id 改名或移除时，include 的 patch 探测只 warn 并跳过（`vendor/include/src/index.ts:51`），切片会静默失效，而这条闸会红。

实验能力保留：`restore` 先按语义比对备份（桌面端启动时会把 YAML 重新序列化，折行与默认模型落盘都会变），语义一致才写回备份原字节，否则按去掉块的内容还原；`estimate` 仍对单波做静态客户端产物估算。

`check` 顺带打印的合成口径：208 条 / 启用 130 / 禁用 78（win32 桌面），`agent-preset-registry.config.default = lcoder`，启用 preset 恰为 LCoder 的十个。阶段一已做过的静态校验结论（第一波 181→155、第二波 →146、第三波 →130；全部 51 行命中禁用）仍成立。

## 阶段二实测

条件：主检出桌面实例在跑（9222/9229/9230，PID 39096 与宿主 44820），全程未启停；本工作树实例用 `start-desktop.cmd -Fast`、端口 9823/9831/9832、仓内 home；本机 mock 云在 9833，四个状态都注入同一 `LCODER_CLOUD_BASE_URL`，登录态与模型路由一致。测量期间不并跑构建、vitest 与其他重活，基线三次与各波在同一条件下取。

启动就绪取日志 `dsh web:` 行的 `[Ns]` 时间戳：

| 状态 | 样本 | 中位数 |
| --- | --- | ---: |
| 全量（无 mock，首次冷启动） | 35 / 5 / 5 秒 | 5 秒 |
| 全量（带 mock） | 5 / 5 / 5 秒 | 5 秒 |
| + 第一波 | 5 秒 | — |
| + 第二波 | 4 秒 | — |
| + 第三波 | 5 秒 | — |
| 还原后复核 | 5 秒 | — |

第三波的样本取自修正版 `t177-w3b-run.console.log`；首版 `t177-w3-run.console.log` 的 4 秒是外壳停在 `Loading plugins…` 时的就绪时间，不作数。

1 秒分辨率下，profile 裁剪没有可测的启动收益；唯一的 35 秒来自首次冷 I/O，与裁剪无关。

运行时激活数（`pluginInventory/list`，启动完成后立即读）：

| 状态 | 运行时条目 | 启用 | 激活 | 失败 | 浏览器 roster |
| --- | ---: | ---: | ---: | ---: | ---: |
| 全量 | 211 | 184 | 184 | 0 | 73 |
| 还原后复核 | 211 | 184 | 184 | 0 | 73 |
| + 第一波 | 仪器同波被关，不可测 | — | — | — | 58 |
| + 第二波 | 同上 | — | — | — | 52 |
| + 第三波 | 同上 | — | — | — | 42 |

静态 208 / 181 / 27 与运行时 211 / 184 / 27 差的 3 条是 profile 根 `include` 与 2 条无 id 的动态条目。第一波把 `plugin-inventory` 一起关了，所以逐波宿主数只有静态投影（130 启用 / 78 禁用）；浏览器 roster 是实测，三波分别 −15 / −6 / −10，与静态行数一致（第一波的 15 含 `job-controller` 这条双面行）。

客户端字节用带 token 的组合 URL 实测（3 个 batch：bootstrap + 2 个 application；服务端 `content-encoding: gzip`、chunked 无 content-length，wire 取 gzip 后长度）：

| 状态 | 未压缩 | gzip/wire | 相对全量 |
| --- | ---: | ---: | --- |
| 全量 | 10,866,318 | 2,368,669 | — |
| + 第一波 | 9,426,746 | 2,027,605 | −1,439,572（−13.2% / −14.4%） |
| + 第二波 | 8,708,189 | 1,838,632 | −2,158,129（−19.9% / −22.4%） |
| + 第三波 | 7,758,357 | 1,620,622 | −3,107,961（−28.6% / −31.6%） |

逐波实测增量与静态上界吻合：第一波 1,439,572 字节 vs 静态 1,405 KiB，第二波 718,557 vs 702 KiB，第三波 949,832 vs 927 KiB。

每波重启后跑同一组 7 条 CDP DOM 断言（登录态、外壳根、打开仓库、外壳五页切换、任务详情、设置页、会话发一条消息）：

| 状态 | 结果 |
| --- | --- |
| 全量（两次：基线 run4 与还原后复核） | 7/7 |
| + 第一波 | 7/7 |
| + 第二波 | 7/7 |
| + 第三波首版（含 ui-input-trigger / ui-commands） | 1/7：外壳根 30 秒未出现，页面停在 `HARNESS Loading plugins…`；已回滚并记录 |
| + 第三波修正版 | 7/7 |

断点与回滚：首版第三波把 `ui-input-trigger`、`ui-commands` 也关了。从 `window.__DSH_BOOT__` 的 `inject` 算出的缺失依赖是 `ui-chat → ui-input-trigger`、`ui-subagent → ui-input-trigger`、`ui-commands → ui-input-trigger`、`ui-reference/ui-skill → ui-input-trigger`、`ui-permission-presets → ui-commands`；这些消费者仍在册，所以浏览器启动链卡住。回滚做法是 `apply --wave 1 --wave 2` 覆盖旧块后重启，未改任何产品代码。修正后把这两行移出该波，归入"可裁但需整链验证"。

各类结论：

- 可采纳：第一波 26 行、第二波 9 行、第三波 16 行 + 1 行只改 preset 默认值；逐波实测均通过 7 条断言，启动无激活失败。
- 会断链路：`ui-input-trigger` / `ui-commands` 不能单独关，必须连同 `ui-chat`、`ui-conversation`、`ui-tool` 等整链一起裁并重验回退面。
- 需改代码才能裁：本任务未发现必须改产品代码才能关的行。若要把上游聊天整链裁掉，先要由产品决定是否放弃 `shell: false` 回退模式。

## 四维前后对照（实测）

| 维度 | 全量 | 三波后 | 结论 |
| --- | --- | --- | --- |
| 安装包体积 | 333 包 / 68.17 MiB core set | 不变 | profile 改不了这一维；要动得另立 core set 裁剪任务 |
| 磁盘（源码与 node_modules） | 12,805 受控文件 / 87.03 MiB + 链接 | 不变 | 禁用不动包 |
| 构建速度 | `build:artifacts` 全量 | 不变 | 分层重建 2 秒只是 `@lcoder/workspace` 重打，profile 不参与 |
| 客户端下载 | 10.87 MB 未压缩 / 2.37 MB gzip | 7.76 MB / 1.62 MB | −28.6% / −31.6% |
| 启动就绪 | 5 秒（中位数） | 4–5 秒 | 1 秒分辨率内无可测收益 |
| 激活条目 | 184 宿主 + 73 roster | 静态 130 宿主 + 42 roster | 宿主逐波未实测（仪器同波被关） |
| 维护与升级风险 | 51 条 id 绑定上游行 | 上游改名时 patch 未命中只 warn 并跳过（`vendor/include/src/index.ts:51`） | 升上游后复跑 `estimate`，出现"合成清单里没有这一行"即为静默失效 |
| 功能心智负担（可见） | 外壳 5 个导航、0 个上游侧栏页签 | 同 | 裁掉的 31 个客户端插件在外壳里本来就不显示；可见项不变 |

## 下一阶段建议

1. 三波已接进发布 profile 的生成流程（T-178）：`rebuild.cmd profile` 重拷后自动 apply，并用 `check` 把“未命中 id”做成非零退出的硬闸。
2. 还要减安装包就走 core set 裁剪，另立任务；profile 层已到边界。
3. 还想减客户端字节，唯一大块是上游聊天面整链（`ui-conversation` 940 KB + `ui-chat` 688 KB + `ui-tool` 204 KB 及座位，约 1.6 MB 未压缩），需要产品拍板是否放弃 `shell: false` 回退。

## 未验项

- 宿主逐波激活数未实测：`plugin-inventory` 在第一波被关，逐波只有静态投影；基线与还原后各有一次运行时实测（211/184/184）。
- 启动时间只到秒级（日志时间戳为整秒）；毫秒级需要在启动日志里加时间戳，未做。
- 冷启动 35 秒只有一次样本，未重复。
- 第三波关掉上游 preset 后，只以会话头 `agentPreset=lcoder` 间接证明角色名册生效；未跑一次真实子 agent 回合（无真实模型钥匙，走的是 mock 云）。
- 会话发消息走 mock 云；真实云端与官网 DeepSeek 路由未验。
- 上游聊天整链（可裁候选）未做实验，`shell: false` 回退面未验。
- 安装包体积未做打包称重。

## 附录 A：逐行装配清单（208 行快照）

生成口径见"口径"一节；表是 2026-11-14 本检出的一次快照，升上游后重导。面列的双面包只标"客户端"（同一行同时挂宿主与浏览器两半）；消费方是服务边与 `dsh.client.inject` 的反向集合，最多列 4 个。

| # | id | 包 | 层 | 面 | 状态 | LCoder 路径 | 提供 | 消费方（行 id） |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `tool-plugin-manager` | `@deepseek-ai/dsh-plugin-manager/tools` | — | 宿主 | 禁用 | — | — | — |
| 2 | `plugin-manager` | `@deepseek-ai/dsh-plugin-manager` | packages/boot | 宿主 | 启用 | — | pluginManager | — |
| 3 | `timer` | `@deepseek-ai/cordis-plugin-timer` | vendor/timer | 宿主 | 启用 | — | timer | cordis-client-runner |
| 4 | `hmr` | `@deepseek-ai/dsh-hmr` | packages/boot | 宿主 | 启用 | — | hmr | — |
| 5 | `llm` | `@deepseek-ai/dsh-llm` | packages/llm | 宿主 | 启用 | S | llm | session-controller, compaction-basic, llm-deepseek-account, llm-deepseek +2 |
| 6 | `deepseek-llm-api-extensions` | `@deepseek-ai/dsh-deepseek-llm-api-extensions` | packages/llm | 宿主 | 启用 | — | deepseekLlmApiExtensions | plugin-package-inventory-deepseek, session-log-deepseek |
| 7 | `session` | `@deepseek-ai/dsh-session` | packages/core | 宿主 | 启用 | STR | sessions | session-controller, ui-agent-preset, ui-approval, ui-chat +34 |
| 8 | `session-log-deepseek` | `@deepseek-ai/dsh-session-log-deepseek` | packages/session | 宿主 | 启用 | — | sessionLogDeepSeek | — |
| 9 | `typert` | `@deepseek-ai/dsh-typert-registry` | packages/typert | 客户端 | 启用 | S | typert | typert-gateway, session-controller, workspace-controller, typert-loader |
| 10 | `typert-loader` | `@deepseek-ai/dsh-typert-loader` | packages/typert | 宿主 | 启用 | S | — | — |
| 11 | `typert-gateway` | `@deepseek-ai/dsh-api-gateway` | packages/api | 客户端 | 启用 | S | remote, typertGateway | job-controller, remote-access, api-remotes, session-controller +36 |
| 12 | `remote-access` | `@deepseek-ai/dsh-api-remote-access` | packages/api | 客户端 | 启用 | S | remoteAccess | typert-gateway, session-controller, workspace-controller, ui-plugin-manager +5 |
| 13 | `session-title` | `@deepseek-ai/dsh-session-title` | packages/session | 宿主 | 启用 | — | sessionTitle | session-title-llm |
| 14 | `session-title-llm` | `@deepseek-ai/dsh-session-title-first-prompt-llm` | packages/session | 宿主 | 启用 | — | — | — |
| 15 | `user-questions` | `@deepseek-ai/dsh-user-questions` | packages/interaction | 宿主 | 启用 | S | userQuestions | — |
| 16 | `agent` | `@deepseek-ai/dsh-agent` | packages/core | 宿主 | 启用 | S | agents | account-controller, session-controller, file-upload, agent-instructions +12 |
| 17 | `plugin-package-inventory-deepseek` | `@deepseek-ai/dsh-plugin-package-inventory-deepseek` | packages/llm | 宿主 | 启用 | — | — | — |
| 18 | `agent-default-model` | `@deepseek-ai/dsh-agent-default-model` | packages/core | 宿主 | 启用 | G | — | — |
| 19 | `jobs` | `@deepseek-ai/dsh-jobs-local` | packages/jobs | 宿主 | 启用 | — | jobs | job-controller, ui-jobs, tool-jobs, tool-bash +2 |
| 20 | `llm-retry` | `@deepseek-ai/dsh-llm-retry` | packages/llm | 宿主 | 启用 | S | — | — |
| 21 | `config-editor` | `@deepseek-ai/dsh-config-editor` | packages/boot | 宿主 | 启用 | G | — | — |
| 22 | `settings` | `@deepseek-ai/dsh-settings` | packages/settings | 宿主 | 启用 | G | — | — |
| 23 | `authorization` | `@deepseek-ai/dsh-authorization` | packages/credentials | 宿主 | 启用 | SG | authorization | deepseek-account, llm-pi-ai |
| 24 | `deepseek-account` | `@deepseek-ai/dsh-deepseek-account-platform` | packages/credentials | 宿主 | 启用 | — | — | — |
| 25 | `credentials` | `@deepseek-ai/dsh-credentials-local` | packages/credentials | 宿主 | 启用 | SG | — | — |
| 26 | `llm-pi-ai` | `@deepseek-ai/dsh-llm-pi-ai` | packages/llm | 宿主 | 启用 | SG | — | — |
| 27 | `session-persistence-jsonl` | `@deepseek-ai/dsh-session-persistence-jsonl` | packages/session | 宿主 | 启用 | S | — | — |
| 28 | `attachment-local` | `@deepseek-ai/dsh-attachment-local` | packages/attachment | 宿主 | 启用 | S | — | — |
| 29 | `session-query-sqlite` | `@deepseek-ai/dsh-session-query-sqlite` | packages/session-query | 宿主 | 启用 | — | — | — |
| 30 | `working-directory` | `@deepseek-ai/dsh-working-directory` | packages/session | 宿主 | 启用 | — | workingDirectory | session-controller, agent-instructions, file-reference-local, tool-fs +7 |
| 31 | `tool-working-directory` | `@deepseek-ai/dsh-tool-working-directory` | packages/session | 宿主 | 启用 | — | — | — |
| 32 | `session-projection` | `@deepseek-ai/dsh-session-projection` | packages/session | 宿主 | 启用 | S | sessionProjections | session-controller, harness-dev-context, agent, agent-loop +17 |
| 33 | `storage` | `@deepseek-ai/dsh-storage` | packages/storage | 宿主 | 启用 | — | storage | storage-domain, storage-json, workspace |
| 34 | `storage-json` | `@deepseek-ai/dsh-storage-json` | packages/storage | 宿主 | 启用 | — | — | — |
| 35 | `storage-domain` | `@deepseek-ai/dsh-storage-domain` | packages/storage | 宿主 | 启用 | — | — | — |
| 36 | `session-projection-cache` | `@deepseek-ai/dsh-session-projection-cache` | packages/session | 宿主 | 启用 | — | sessionProjectionCache | — |
| 37 | `otel` | `@deepseek-ai/dsh-otel` | packages/telemetry | 宿主 | 启用 | — | otel | desktop-product-telemetry, session-telemetry-otel |
| 38 | `session-telemetry-otel` | `@deepseek-ai/dsh-session-telemetry-otel` | packages/session | 宿主 | 启用 | — | — | — |
| 39 | `subprocess` | `@deepseek-ai/dsh-subprocess-local` | packages/subprocess | 宿主 | 启用 | — | — | — |
| 40 | `sandbox` | `@deepseek-ai/dsh-sandbox-local` | packages/sandbox | 宿主 | 启用 | — | — | — |
| 41 | `sandbox-policy` | `@deepseek-ai/dsh-sandbox-policy` | packages/sandbox | 宿主 | 启用 | — | sandboxPolicy | plugin-manager, ui-deliverables, fs-sandbox, tool-fs +5 |
| 42 | `bash-sandbox` | `@deepseek-ai/dsh-bash-sandbox` | packages/shell | 宿主 | 禁用 | — | — | — |
| 43 | `pwsh-sandbox` | `@deepseek-ai/dsh-pwsh-sandbox` | packages/shell | 宿主 | 启用 | — | — | — |
| 44 | `approval` | `@deepseek-ai/dsh-user-approval` | packages/interaction | 宿主 | 启用 | S | approval | tool-fs, permission, pwsh-sandbox, tool-bash +1 |
| 45 | `permission` | `@deepseek-ai/dsh-permission-presets` | packages/interaction | 宿主 | 启用 | — | permissionPresets | — |
| 46 | `shell-env` | `@deepseek-ai/dsh-shell-env` | packages/shell | 宿主 | 启用 | — | shellEnv | tool-bash, tool-pwsh |
| 47 | `tool-bash` | `@deepseek-ai/dsh-tool-bash` | packages/shell | 宿主 | 禁用 | — | — | — |
| 48 | `tool-pwsh` | `@deepseek-ai/dsh-tool-pwsh` | packages/shell | 宿主 | 禁用 | — | — | — |
| 49 | `tool-jobs` | `@deepseek-ai/dsh-tool-jobs` | packages/jobs | 宿主 | 禁用 | — | — | — |
| 50 | `fs-observation-policy` | `@deepseek-ai/dsh-fs-observation-policy` | packages/fs | 宿主 | 启用 | — | — | — |
| 51 | `tool-fs` | `@deepseek-ai/dsh-tool-fs` | packages/fs | 宿主 | 禁用 | — | — | — |
| 52 | `tool-fs-search` | `@deepseek-ai/dsh-tool-fs-search` | packages/fs | 宿主 | 禁用 | — | — | — |
| 53 | `agent-instructions` | `@deepseek-ai/dsh-agent-instructions` | packages/context | 宿主 | 禁用 | — | — | — |
| 54 | `skill` | `@deepseek-ai/dsh-skill` | packages/skill | 宿主 | 启用 | — | skills | skill-filesystem, tool-skill |
| 55 | `skill-filesystem` | `@deepseek-ai/dsh-skill-filesystem` | packages/skill | 宿主 | 禁用 | — | — | — |
| 56 | `tool-skill` | `@deepseek-ai/dsh-tool-skill` | packages/skill | 宿主 | 禁用 | — | — | — |
| 57 | `commands` | `@deepseek-ai/dsh-commands` | packages/interaction | 宿主 | 启用 | S | commands | file-upload, command-compact, command-feedback, command-goal +1 |
| 58 | `command-feedback` | `@deepseek-ai/dsh-command-feedback` | packages/feedback | 宿主 | 启用 | — | sessionFeedback | — |
| 59 | `goal` | `@deepseek-ai/dsh-goal` | packages/goal | 宿主 | 启用 | — | goals | command-goal, goal-round-driver, tool-goal |
| 60 | `goal-round-driver` | `@deepseek-ai/dsh-goal-round-driver` | packages/goal | 宿主 | 启用 | — | — | — |
| 61 | `command-goal` | `@deepseek-ai/dsh-command-goal` | packages/goal | 宿主 | 禁用 | — | — | — |
| 62 | `plan-mode` | `@deepseek-ai/dsh-plan-mode` | packages/plan | 宿主 | 禁用 | — | planMode | — |
| 63 | `token-meter` | `@deepseek-ai/dsh-token-meter` | packages/llm | 宿主 | 启用 | — | tokenMeter | compaction-basic, tool-result-pruner |
| 64 | `compaction-basic` | `@deepseek-ai/dsh-compaction-basic` | packages/compaction | 宿主 | 禁用 | — | — | — |
| 65 | `command-compact` | `@deepseek-ai/dsh-command-compact` | packages/compaction | 宿主 | 禁用 | — | — | — |
| 66 | `subagent` | `@deepseek-ai/dsh-subagent` | packages/subagent | 宿主 | 启用 | — | subagents | subagent-fork-in-process, subagent-spawn-in-process, tool-subagent, tool-subagent-fork +2 |
| 67 | `subagent-spawn-in-process` | `@deepseek-ai/dsh-subagent-spawn-in-process` | packages/subagent | 宿主 | 启用 | — | — | — |
| 68 | `subagent-fork-in-process` | `@deepseek-ai/dsh-subagent-fork-in-process` | packages/subagent | 宿主 | 启用 | — | — | — |
| 69 | `tool-subagent-control` | `@deepseek-ai/dsh-tool-subagent-control` | packages/subagent | 宿主 | 禁用 | — | — | — |
| 70 | `tool-subagent` | `@deepseek-ai/dsh-tool-subagent` | packages/subagent | 宿主 | 禁用 | — | subagentModelSelection | — |
| 71 | `tool-subagent-fork` | `@deepseek-ai/dsh-tool-subagent` | packages/subagent | 宿主 | 禁用 | — | subagentModelSelection | — |
| 72 | `ptc-runtime` | `@deepseek-ai/dsh-ptc-runtime-node` | packages/ptc-runtime | 宿主 | 启用 | — | — | — |
| 73 | `workflow-ptc` | `@deepseek-ai/dsh-workflow-ptc` | packages/workflow | 宿主 | 禁用 | — | — | — |
| 74 | `tool-workflow` | `@deepseek-ai/dsh-tool-workflow` | packages/workflow | 宿主 | 禁用 | — | — | — |
| 75 | `timeout-policy` | `@deepseek-ai/dsh-tool-call-timeout-policy` | packages/guard | 宿主 | 启用 | — | — | — |
| 76 | `spill-local` | `@deepseek-ai/dsh-spill-local` | packages/spill | 宿主 | 启用 | — | — | — |
| 77 | `spill-policy` | `@deepseek-ai/dsh-spill-policy` | packages/spill | 宿主 | 启用 | — | — | — |
| 78 | `session-checkpoint-policy` | `@deepseek-ai/dsh-session-checkpoint-policy` | packages/session | 宿主 | 启用 | — | — | — |
| 79 | `tool-result-pruner` | `@deepseek-ai/dsh-compaction-tool-result-pruner` | packages/compaction | 宿主 | 禁用 | — | toolResultPruner | — |
| 80 | `image-offload` | `@deepseek-ai/dsh-compaction-image-offload` | packages/compaction | 宿主 | 启用 | — | — | — |
| 81 | `tool-todo` | `@deepseek-ai/dsh-tool-todo` | packages/todo | 宿主 | 禁用 | — | — | — |
| 82 | `tool-goal` | `@deepseek-ai/dsh-tool-goal` | packages/goal | 宿主 | 禁用 | — | — | — |
| 83 | `repeat-tool-reminder` | `@deepseek-ai/dsh-repeat-tool-reminder` | packages/guard | 宿主 | 启用 | — | — | — |
| 84 | `web` | `@deepseek-ai/dsh-web` | packages/web | 宿主 | 启用 | — | web | cordis-host-runner, tool-web, web-deepseek-api, web-fetch-http +1 |
| 85 | `web-search-deepseek` | `@deepseek-ai/dsh-web-search-deepseek` | packages/web | 宿主 | 启用 | — | — | — |
| 86 | `web-deepseek-api` | `@deepseek-ai/dsh-web-deepseek-api` | packages/web | 宿主 | 启用 | — | — | — |
| 87 | `web-fetch-http` | `@deepseek-ai/dsh-web-fetch-http` | packages/web | 宿主 | 启用 | — | — | — |
| 88 | `tool-web` | `@deepseek-ai/dsh-tool-web` | packages/web | 宿主 | 禁用 | — | — | — |
| 89 | `mcp-resources` | `@deepseek-ai/dsh-mcp-resources` | packages/mcp | 宿主 | 启用 | — | mcpResources | — |
| 90 | `tools` | `@deepseek-ai/dsh-tools` | packages/core | 宿主 | 启用 | STRD | tools | plugin-manager, file-reference-local, tool-executor-native, tool-executor-ptc +19 |
| 91 | `tool-executor-native` | `@deepseek-ai/dsh-tool-executor-native` | packages/core | 宿主 | 启用 | — | — | — |
| 92 | `tool-executor-ptc` | `@deepseek-ai/dsh-tool-executor-ptc` | packages/core | 宿主 | 禁用 | — | — | — |
| 93 | `system-prompt` | `@deepseek-ai/dsh-system-prompt` | packages/core | 宿主 | 启用 | — | systemPrompt | harness-dev-context, agent-loop, tool-executor-ptc, tools +13 |
| 94 | `agent-loop` | `@deepseek-ai/dsh-agent-loop` | packages/core | 宿主 | 启用 | S | agentLoop | — |
| 95 | `fs-sandbox` | `@deepseek-ai/dsh-fs-sandbox` | packages/fs | 宿主 | 启用 | — | — | — |
| 96 | `llm-deepseek` | `@deepseek-ai/dsh-llm-deepseek-api-key` | packages/llm | 宿主 | 启用 | S | — | — |
| 97 | `llm-deepseek-account` | `@deepseek-ai/dsh-llm-deepseek-account` | packages/llm | 宿主 | 启用 | — | — | — |
| 98 | `desktop-product-telemetry` | `@deepseek-ai/dsh-host-product-telemetry-otel` | packages/host | 宿主 | 启用 | — | productTelemetry | product-analytics |
| 99 | `product-analytics` | `@deepseek-ai/dsh-client-product-analytics` | packages/client | 客户端 | 启用 | — | productAnalytics | — |
| 100 | `subagent-model-selection-settings` | `@deepseek-ai/dsh-tool-subagent/model-selection-settings` | — | 宿主 | 启用 | — | — | — |
| 101 | `message-feedback` | `@deepseek-ai/dsh-message-feedback` | packages/feedback | 宿主 | 启用 | — | messageFeedback | — |
| 102 | `session-log-download` | `@deepseek-ai/dsh-session-log-export` | packages/session-query | 客户端 | 启用 | — | sessionLogDownload | — |
| 103 | `open-in-app` | `@deepseek-ai/dsh-host-open-in-app` | packages/host | 宿主 | 启用 | — | — | — |
| 104 | `ui-file-actions` | `@deepseek-ai/dsh-client-ui-file-actions` | packages/client | 客户端 | 启用 | — | fileActions | — |
| 105 | `ui-context-menu` | `@deepseek-ai/dsh-client-ui-context-menu` | packages/client | 客户端 | 启用 | — | contextMenus | ui-attachment, ui-chat, ui-conversation, ui-deliverables +8 |
| 106 | `ui-open-in-app` | `@deepseek-ai/dsh-client-ui-open-in-app` | packages/client | 客户端 | 启用 | — | — | — |
| 107 | `workspace` | `@deepseek-ai/dsh-workspace` | packages/workspace | 宿主 | 启用 | TRP | workspaceRegistry | session-controller, workspace-controller |
| 108 | `session-reference` | `@deepseek-ai/dsh-session-reference` | packages/context | 宿主 | 启用 | — | sessionReferenceResolver | — |
| 109 | `file-reference-local` | `@deepseek-ai/dsh-file-reference-local` | packages/context | 宿主 | 启用 | — | — | — |
| 110 | `session-stats` | `@deepseek-ai/dsh-session-stats` | packages/session | 宿主 | 启用 | — | — | — |
| 111 | `session-turn-outline` | `@deepseek-ai/dsh-session-turn-outline` | packages/session | 宿主 | 启用 | — | — | — |
| 112 | `directory-picker` | `@deepseek-ai/dsh-host-directory-picker-auto` | packages/host | 宿主 | 启用 | P | — | — |
| 113 | `plugin-inventory` | `@deepseek-ai/dsh-host-plugin-inventory` | packages/host | 宿主 | 启用 | — | pluginInventory | — |
| 114 | `session-controller` | `@deepseek-ai/dsh-api-session-controller` | packages/api | 客户端 | 启用 | S | sessionFileReferences, sessionController, sessionSkillCatalog | ui-agent-preset, ui-approval, ui-chat, ui-conversation +21 |
| 115 | `job-controller` | `@deepseek-ai/dsh-api-job-controller` | packages/api | 客户端 | 启用 | — | jobs, jobController | ui-jobs, jobs, tool-jobs, tool-bash +2 |
| 116 | `terminal-controller` | `@deepseek-ai/dsh-api-terminal-controller` | packages/api | 客户端 | 启用 | — | webTerminals, terminalController | ui-sidebar-terminal |
| 117 | `workspace-files` | `@deepseek-ai/dsh-api-workspace-files` | packages/api | 客户端 | 启用 | TRID | workspaceFiles | ui-deliverables, ui-file-actions, ui-open-in-app, ui-sidebar-documentpreview +2 |
| 118 | `schedule` | `@deepseek-ai/dsh-schedule` | packages/schedule | 宿主 | 启用 | — | schedule | — |
| 119 | `ui-settings-account` | `@deepseek-ai/dsh-client-ui-settings-account` | packages/client | 客户端 | 禁用 | — | — | — |
| 120 | `account-controller` | `@deepseek-ai/dsh-api-account-controller` | packages/api | 宿主 | 启用 | — | accountController | — |
| 121 | `settings-controller` | `@deepseek-ai/dsh-api-settings-controller` | packages/api | 宿主 | 启用 | G | credentialsController, settingsController | — |
| 122 | `workspace-controller` | `@deepseek-ai/dsh-api-workspace-controller` | packages/api | 客户端 | 启用 | TRPI | workspaces, directoryPickerController, workspaceController | ui-chat, ui-schedule, ui-sidebar, ui-sidebar-browser +3 |
| 123 | `cordis-host-runner` | `@deepseek-ai/dsh-cordis-host-runner` | packages/extensions | 宿主 | 启用 | — | dynamicCordisRunner, cordisInspect | ui-cordis |
| 124 | `cordis-inspect-providers` | `@deepseek-ai/dsh-tool-cordis/host` | — | 宿主 | 启用 | — | — | — |
| 125 | `web-startup` | `@deepseek-ai/dsh-web-app/startup` | — | 宿主 | 启用 | S | — | — |
| 126 | `webserver` | `@deepseek-ai/dsh-host-webserver` | packages/host | 宿主 | 启用 | S | webServer | web-runtime, client-hmr, directory-picker, open-in-app |
| 127 | `web-runtime` | `@deepseek-ai/dsh-web-app` | packages/bundle | 宿主 | 启用 | S | webApp | harness-dev-context |
| 128 | `harness-dev-context` | `@deepseek-ai/dsh-harness-dev-context` | packages/context | 宿主 | 启用 | — | — | — |
| 129 | `client-hmr` | `@deepseek-ai/dsh-client-hmr` | packages/client | 客户端 | 启用 | — | — | — |
| 130 | `modules` | `@deepseek-ai/dsh-client-modules` | packages/client | 客户端 | 启用 | S | clientModules | client-hmr, ui-settings-general, ui-settings-plugin-inventory, cordis-client-runner |
| 131 | `connection` | `@deepseek-ai/dsh-client-connection` | packages/client | 客户端 | 启用 | S | connection | typert-gateway, job-controller, session-controller, workspace-controller +15 |
| 132 | `file-upload` | `@deepseek-ai/dsh-client-file-upload` | packages/client | 客户端 | 启用 | — | fileUpload, fileUploads | session-controller, ui-conversation |
| 133 | `api-remotes` | `@deepseek-ai/dsh-api-remotes` | packages/api | 客户端 | 启用 | S | — | file-upload, locale, ui-agent-preset, ui-approval +29 |
| 134 | `cordis-client-runner` | `@deepseek-ai/dsh-cordis-client-runner` | packages/extensions | 客户端 | 启用 | — | dynamicCordisRunner, cordisInspect | ui-cordis |
| 135 | `ui-theme` | `@deepseek-ai/dsh-client-ui-theme` | packages/client | 客户端 | 启用 | S | theme | ui-layout, ui-settings-account, ui-sidebar-terminal, cordis-client-runner |
| 136 | `locale` | `@deepseek-ai/dsh-client-locale` | packages/client | 客户端 | 启用 | S | locale | shortcuts, ui-agent-preset, ui-approval, ui-attachment +50 |
| 137 | `shortcuts` | `@deepseek-ai/dsh-client-shortcuts` | packages/client | 客户端 | 启用 | — | shortcuts | ui-context-menu, ui-layout, ui-open-in-app, ui-settings-general +8 |
| 138 | `ui-shortcuts` | `@deepseek-ai/dsh-client-ui-shortcuts` | packages/client | 客户端 | 启用 | — | — | — |
| 139 | `ui-layout` | `@deepseek-ai/dsh-client-ui-layout` | packages/client | 客户端 | 启用 | S | — | ui-chat, ui-context-menu, ui-conversation, ui-file-drag +12 |
| 140 | `ui-renderer` | `@deepseek-ai/dsh-client-ui-renderer` | packages/client | 客户端 | 启用 | S | slots | remote-access, locale, resources, ui-agent-preset +53 |
| 141 | `ui-session` | `@deepseek-ai/dsh-client-ui-session` | packages/client | 客户端 | 启用 | S | uiSession | ui-agent-preset, ui-approval, ui-chat, ui-conversation +15 |
| 142 | `resources` | `@deepseek-ai/dsh-client-resources` | packages/client | 客户端 | 启用 | — | — | workspace-files, ui-plan, ui-sidebar-documentpreview, ui-sidebar-right +1 |
| 143 | `ui-sidebar` | `@deepseek-ai/dsh-client-ui-sidebar` | packages/client | 客户端 | 禁用 | — | — | ui-brand-official, ui-plugin-manager, ui-schedule, ui-settings-general +2 |
| 144 | `ui-sidebar-right` | `@deepseek-ai/dsh-client-ui-sidebar-right` | packages/client | 客户端 | 启用 | S | — | ui-chat, ui-deliverables, ui-open-in-app, ui-plan +9 |
| 145 | `office-to-pdf` | `@deepseek-ai/dsh-office-to-pdf` | packages/document | 宿主 | 启用 | — | officeToPdf | — |
| 146 | `ui-sidebar-documentpreview` | `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` | packages/client | 客户端 | 启用 | — | — | ui-open-in-app |
| 147 | `ui-sidebar-browser` | `@deepseek-ai/dsh-client-ui-sidebar-browser` | packages/client | 客户端 | 启用 | — | — | — |
| 148 | `ui-sidebar-terminal` | `@deepseek-ai/dsh-client-ui-sidebar-terminal` | packages/client | 客户端 | 启用 | — | — | — |
| 149 | `ui-sidebar-files` | `@deepseek-ai/dsh-client-ui-sidebar-files` | packages/client | 客户端 | 启用 | — | — | — |
| 150 | `ui-settings` | `@deepseek-ai/dsh-client-ui-settings` | packages/client | 客户端 | 启用 | G | configForms, settingsSchema | locale, ui-agent-preset, ui-chat, ui-conversation +18 |
| 151 | `ui-settings-general` | `@deepseek-ai/dsh-client-ui-settings-general` | packages/client | 客户端 | 启用 | — | — | — |
| 152 | `ui-settings-models` | `@deepseek-ai/dsh-client-ui-settings-models` | packages/client | 客户端 | 启用 | — | — | — |
| 153 | `ui-plugin-manager` | `@deepseek-ai/dsh-client-ui-plugin-manager` | packages/client | 客户端 | 启用 | — | pluginRegistryProbe, pluginChanges | entry-customization, ui-settings-agent-loop, ui-settings-shell, ui-settings-subagent +1 |
| 154 | `ui-settings-plugin-inventory` | `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` | packages/client | 客户端 | 启用 | — | — | — |
| 155 | `ui-conversation` | `@deepseek-ai/dsh-client-ui-conversation` | packages/client | 客户端 | 启用 | — | uiConversation, conversation | ui-agent-preset, ui-approval, ui-attachment, ui-chat +22 |
| 156 | `ui-approval` | `@deepseek-ai/dsh-client-ui-approval` | packages/client | 客户端 | 启用 | — | — | — |
| 157 | `message-quotes` | `@deepseek-ai/dsh-message-quotes` | packages/session | 客户端 | 启用 | — | — | — |
| 158 | `ui-chat` | `@deepseek-ai/dsh-client-ui-chat` | packages/client | 客户端 | 启用 | — | — | ui-attachment, ui-deliverables, ui-goal, ui-plan +5 |
| 159 | `ui-brand-official` | `@deepseek-ai/dsh-client-ui-brand-official` | packages/client | 客户端 | 禁用 | — | — | — |
| 160 | `ui-attachment` | `@deepseek-ai/dsh-client-ui-attachment` | packages/client | 客户端 | 启用 | — | — | — |
| 161 | `ui-file-drag` | `@deepseek-ai/dsh-client-ui-file-drag` | packages/client | 客户端 | 启用 | — | fileDrag | ui-attachment, ui-chat, ui-sidebar-documentpreview |
| 162 | `ui-tool` | `@deepseek-ai/dsh-client-ui-tool` | packages/client | 客户端 | 启用 | — | — | ui-attachment, ui-deliverables, ui-schedule, ui-skill +1 |
| 163 | `ui-cordis` | `@deepseek-ai/dsh-client-ui-cordis` | packages/extensions | 客户端 | 启用 | — | — | — |
| 164 | `deliverable-file-references` | `@deepseek-ai/dsh-deliverable-file-references` | packages/deliverables | 宿主 | 启用 | — | — | — |
| 165 | `ui-deliverables` | `@deepseek-ai/dsh-client-ui-deliverables` | packages/client | 客户端 | 启用 | — | chatFileMentions | — |
| 166 | `workspace-changes` | `@deepseek-ai/dsh-workspace-changes` | packages/deliverables | 宿主 | 启用 | — | workspaceChanges | ui-deliverables |
| 167 | `ui-workspace` | `@deepseek-ai/dsh-client-ui-workspace` | packages/client | 客户端 | 启用 | P | uiWorkspace | ui-agent-preset, ui-chat, ui-conversation, entry-customization +6 |
| 168 | `ui-workflow-run` | `@deepseek-ai/dsh-client-ui-workflow-run` | packages/client | 客户端 | 启用 | — | — | — |
| 169 | `ui-input-trigger` | `@deepseek-ai/dsh-client-ui-input-trigger` | packages/client | 客户端 | 启用 | — | inputTriggers | ui-chat, ui-commands, ui-reference, ui-skill +1 |
| 170 | `ui-commands` | `@deepseek-ai/dsh-client-ui-commands` | packages/client | 客户端 | 启用 | — | commandUi | ui-message-feedback, ui-model-selection, ui-permission, session-log-download |
| 171 | `ui-skill` | `@deepseek-ai/dsh-client-ui-skill` | packages/client | 客户端 | 启用 | — | — | — |
| 172 | `ui-subagent` | `@deepseek-ai/dsh-client-ui-subagent` | packages/client | 客户端 | 启用 | — | — | — |
| 173 | `ui-reference` | `@deepseek-ai/dsh-client-ui-reference` | packages/client | 客户端 | 启用 | — | — | — |
| 174 | `ui-secret-mask` | `@deepseek-ai/dsh-client-ui-secret-mask` | packages/client | 客户端 | 启用 | — | — | — |
| 175 | `ui-jobs` | `@deepseek-ai/dsh-client-ui-jobs` | packages/client | 客户端 | 启用 | — | — | — |
| 176 | `ui-schedule` | `@deepseek-ai/dsh-client-ui-schedule` | packages/client | 客户端 | 启用 | — | — | — |
| 177 | `ui-goal` | `@deepseek-ai/dsh-client-ui-goal` | packages/client | 客户端 | 启用 | — | — | — |
| 178 | `ui-message-feedback` | `@deepseek-ai/dsh-client-ui-message-feedback` | packages/client | 客户端 | 启用 | — | feedbackUi | — |
| 179 | `ui-model-selection` | `@deepseek-ai/dsh-client-ui-model-selection` | packages/client | 客户端 | 启用 | — | modelDirectories | — |
| 180 | `ui-permission` | `@deepseek-ai/dsh-client-ui-permission-presets` | packages/client | 客户端 | 启用 | — | — | — |
| 181 | `ui-agent-preset` | `@deepseek-ai/dsh-client-ui-agent-preset` | packages/client | 客户端 | 启用 | — | — | ui-settings-plugin-inventory |
| 182 | `entry-customization` | `@deepseek-ai/dsh-client-ui-entry-customization` | packages/client | 客户端 | 启用 | — | — | — |
| 183 | `ui-settings-session-log` | `@deepseek-ai/dsh-client-ui-settings-session-log` | packages/client | 客户端 | 启用 | — | — | — |
| 184 | `ui-settings-plugins` | `@deepseek-ai/dsh-client-ui-settings-plugins` | packages/client | 客户端 | 启用 | — | — | — |
| 185 | `ui-settings-shell` | `@deepseek-ai/dsh-client-ui-settings-shell` | packages/client | 客户端 | 启用 | — | — | — |
| 186 | `ui-settings-agent-loop` | `@deepseek-ai/dsh-client-ui-settings-agent-loop` | packages/client | 客户端 | 启用 | — | — | — |
| 187 | `ui-settings-subagent` | `@deepseek-ai/dsh-client-ui-settings-subagent` | packages/client | 客户端 | 启用 | — | — | — |
| 188 | `ui-settings-web-search` | `@deepseek-ai/dsh-client-ui-settings-web-search` | packages/client | 客户端 | 启用 | — | — | — |
| 189 | `ui-plan` | `@deepseek-ai/dsh-client-ui-plan` | packages/client | 客户端 | 启用 | — | — | — |
| 190 | `ui-user-questions` | `@deepseek-ai/dsh-client-ui-user-questions` | packages/client | 客户端 | 启用 | — | — | ui-plan |
| 191 | `ui-trajectory` | `@deepseek-ai/dsh-client-ui-trajectory` | packages/client | 客户端 | 启用 | — | sessionToolResults | ui-attachment |
| 192 | `agent-preset-registry` | `@deepseek-ai/dsh-agent-preset-registry` | packages/preset | 宿主 | 启用 | S | agentPresets | preset-standard, preset-ptc, preset-minimal, preset-cordis +10 |
| 193 | `preset-standard` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 194 | `preset-ptc` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 195 | `preset-minimal` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 196 | `preset-cordis` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 197 | `preset-lcoder` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 198 | `preset-lcoder-intake` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 199 | `preset-lcoder-architect` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 200 | `preset-lcoder-review` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 201 | `preset-lcoder-pm` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 202 | `preset-lcoder-git` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 203 | `preset-lcoder-ops` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 204 | `preset-lcoder-scheduler` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 205 | `preset-lcoder-flow` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 206 | `preset-lcoder-manager` | `@deepseek-ai/dsh-agent-preset` | packages/preset | 宿主 | 启用 | — | — | — |
| 207 | `lcoder-cloud` | `@lcoder/kernel/cloud` | — | 宿主 | 启用 | G | — | — |
| 208 | `ui-lcoder-workspace` | `@lcoder/workspace` | packages/lcoder | 客户端 | 启用 | STRPIGD | — | — |
