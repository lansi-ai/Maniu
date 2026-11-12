# LCoder 项目规则（PROJECT-RULES）

[English](PROJECT-RULES.md) | 中文

> 本文件是项目规则的单一入口。通用纪律（红线、任务分级、提交纪律）由 dev-flow 的 `task-flow` 技能单源定义，本文只写项目专属约束与落地路径。

## 0. 项目快照（开工必知）

- **产品**：LCoder —— 面向 Windows 与 macOS 桌面端的规格驱动开发工作台，把 `.spec` 规格库、任务状态机与 agent 工具面收放做成 DeepSeek Harness 的插件层。
- **技术栈**：TypeScript（ESM）· Node ≥24.9 · pnpm workspaces · Cordis · React 18
- **基线版本**：DeepSeek Harness `0.2.2-alpha.2`（2026-10-30）
- **当前主线**：MVP-0 —— 工作台在本地跑通，收口 T-02
- **命名**：包名 `@lcoder/kernel`、`@lcoder/workspace`；主线分支 `lcoder/main`
- **架构**：[UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md)（上游关系与接触面）、[architecture.zh.md](architecture.zh.md)（上游架构）

## 1. 硬约束红线（项目专属 · 永不违反）

- 🚫 不改任何上游文件；确需修改必须先进 [contact-surface.txt](../lcoder/contact-surface.txt)，并在 [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md) §3 写明「改什么 / 为什么」。
- 🚫 `.spec` 下的任务与规格 YAML 是 **LCoder 产品数据**的唯一事实源；UI 只读不写，状态机判断不进 UI。它不是本仓库的开发任务台账。kernel 是唯一写入口：模型可以经 `task_draft` 新建 `drafting` 任务、经 `spec_draft` 新建 `draft` 规格条目、经 `project_draft` 写 `.spec/project.yaml`、经 `proposal_draft` 写 `draft` 方案，但不能推进状态、不能签契约、不能批准方案、不能改**已存在**的规格条目。
- 🚫 目标平台是 Windows 与 macOS 桌面端；路径处理按平台来——Windows 用盘符、反斜杠与大小写不敏感比较，macOS 用 POSIX 分隔符，默认大小写不敏感卷在比较前先经原生 realpath 归一。
- 🚫 `contract_sign`、`task_bind`、`task_contract`、`task_assign`、`task_split_ready` 与 `proposal_approve` 永不注册为模型工具：分别签契约、写「哪条会话认领哪条任务」、把已签的起草任务推进到已签约、把任务分配给岗位、把已分配岗位的拆分任务以需求文档为契约依据直接推进到已签约、采纳一个方案。只有人能触发它们。**签署可以在三道补偿闸同时成立时交给 AI，这是用户 2026-11-06 的决定**：`.spec/automation.yaml` 里 `sign` 为 `auto`、任务的 `scope.irreversible` 为空、且这条契约有非空的评审复核证据（`review*.log`）。三闸缺一不可；AI 自签写 `by: agent`、具体 `actor` preset，以及授权策略的路径、哈希与判定时刻。任务只要触及不可逆项就永远由人签——P3 拒绝任何三闸不成立的 agent 签名，并在签名哈希不再覆盖当前正文时判其作废。
- 🚫 `.spec/automation.yaml` 永不承载外部不可逆动作。push、部署、改注册表与外部环境变更永远由人做；schema 遇到这些键直接判非法，而不是读进来忽略。
- 🚫 Git 只走到本地提交。`git_commit` 只暂存它被给到的路径，不带 `--amend`、不带 `--no-verify`；**没有 push 工具，`cmd_run` 的登记面上也不该登记 `git push`**——推远端、`git reset --hard`、任何强推都仍是人的动作。
- 🚫 部署只由人触发。`/deploy` 只跑 `.spec/env.yaml` 里 `exec: human` 的那一条命令，并把输出落成任务证据；`deploy` 永不注册为模型工具，登记为 `ai-auto` 或 `ai-confirm` 的命令仍走 `cmd_run` 与审批那条路。
- 🚫 `Task.scope.allowed_paths` 是 `file_edit` 的硬闸：任务声明了范围，越出范围的写入一律被拒；空数组与读不到任务时不设限。运维与实施都受这条约束，不靠提示词。
- 🚫 能新增就不修改；改上游只改装配层（patch 层、聚合 tsconfig），不碰组件内部实现。
- 🚫 新增接触点必须人工评审；`upstream-diff.sh` 只报冲突，不判断改动深度。
- ✅ 规格条目必须有出处与代码落点；没有出处的条目不得置为 `confirmed`。

## 2. 目录放置

| 你要创建的内容 | 放这里 |
|---|---|
| 规格条目 | `.spec/spec/rules.yaml` |
| 状态机定义 | `.spec/spec/states/*.yaml` |
| 产品任务数据（LCoder 运行时） | `.spec/tasks/T-xx.yaml` |
| 产品任务契约 | `.spec/contracts/<ID>.contract.yaml` |
| 产品自动化策略（按动作开关、停止条件、任务范围） | `.spec/automation.yaml` |
| 常驻调度会话（每仓一条智能调度与一条流程控制） | `.spec/agents.yaml`（`schedulerSession`、`flowSession`） |
| 岗位名册（轻量岗位，继承内置角色天花板） | `.spec/roles.yaml` |
| 产品方案（候选、推荐、决定态） | `.spec/proposals/P-<nn>.yaml`；任务用 `proposal:` 回指 |
| 产品任务证据 | `.spec/evidence/<ID>/<name>.log` |
| 验收命令与环境 | `.spec/env.yaml`；敏感值写 `.spec/local.yaml`，不提交 |
| 宿主插件（agent 工具） | `packages/lcoder/kernel/src/` |
| 浏览器侧插件（工作台 UI） | `packages/lcoder/workspace/src/client/` |
| 二开装配、基线与脚本 | `lcoder/` |
| 角色 preset（可提交的装配源） | `lcoder/desktop-profile.patch.yml`；运行副本在被忽略的桌面 home 里 |
| 仓库治理文档 | `docs/PROJECT-RULES.md`、`docs/active-context.md`、`docs/prd-and-design.md` |
| 开发台账（dev-flow） | `docs/tasks.yaml`（人维护，开发进度唯一源） |
| 离线任务看板 | `docs/tasks-html/index.html`（由 `docs/tasks.yaml` 生成，勿手改） |
| 包测试 | `packages/lcoder/<包>/tests/` |
| 排障坑档 | `lcoder/PITFALLS.md` |

- 包必须放在 `packages/<组>/<包>` 两级；`pnpm-workspace.yaml` 只识别 `packages/*/*`。
- 跨包引用只用包名与导出，不直接 import 上游内部路径。

## 3. 工作流（任务分级）

### 任务分级

| 分级 | 适用范围 | 必须执行的流程 |
|---|---|---|
| A | 契约/架构/规则变更（`!`）、里程碑、发版、上游升级 | 契约确认 → 全链门禁 → 台账登记 → 看板更新 → 汇报勾选 |
| B | 常规功能开发（1–3 文件） | 契约确认（或已明确则降级内部自检）→ 编码 → 门禁 → 看板一行收口 |
| C | 小修 ≤3 文件、无契约/架构变更 | 直接修 → 门禁 → 提交；**不强制更新看板**（除非碰里程碑，日末/发版统一收口）；坑档可当日批次末统一写 |

分级与开发台账 `docs/tasks.yaml` 的 `grade` 字段一致；开发进度的唯一源是 `docs/tasks.yaml`，`.spec/tasks/*.yaml` 是产品数据。

### 开工流程（A/B 类）

1. 读 [active-context.zh.md](active-context.zh.md)，确认与「当前焦点/下一步」一致。
2. 读 `docs/tasks.yaml` 与 `docs/PROJECT-RULES.md`，确认本任务的分级、范围与所需证据。`.spec` 只在开发 LCoder 规格库功能时读取；示例任务 `DEMO-01` 不是开发任务。
3. 契约确认：一句话总结 Input/Output、异常边界、MVP 边界；用户已明确授权 → 降级内部自检。
4. 编码：契约先行 → 实现 → 测试；单任务 1–3 文件；禁留 TODO。

### 完成门禁（必过）

- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm lint` 全绿
- [ ] `pnpm exec vitest run packages/lcoder` 全绿；改上游共享面时跑全仓 `pnpm test`
- [ ] 文档或包 README 变更时 `pnpm run test:docs` 全绿
- [ ] 开发证据：门禁命令输出记录在 `docs/tasks.yaml` 的任务 note 或提交说明；`.spec/evidence` 只服务产品任务
- [ ] 若本次变更同时触及产品任务（`.spec`），按 kernel 的 P1/P3/P4 另行验证；开发任务本身不写 `.spec` 契约
- [ ] **双源同步**：契约 / 统计口径 / 目录约定 / 异常策略 / 扫描范围变更时，同时更新 [prd-and-design.zh.md](prd-and-design.zh.md) 与 `docs/PROJECT-RULES.md`——只改一处即视为漂移
- [ ] 开发台账更新：先改 `docs/tasks.yaml`，再跑 `python scripts/build-tasks-html.py`；`docs/active-context.md` 只更新当前焦点。产品数据（`.spec`）的变更另走产品流程，不写进开发台账
- [ ] bug 修复必写坑档 [PITFALLS.md](../lcoder/PITFALLS.md)（四段式，编号顺延）
- [ ] 给最终汇报：变更清单 + commit 指令

### 特殊场景

- 上游新版本：按 [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md) §4 演练——`pnpm install`、`pnpm build`、`pnpm exec vitest run packages/lcoder`、`./lcoder/scripts/upstream-diff.sh`，全绿才合回 `lcoder/main`。
- 规则演进：技术栈、目录或流程变化 → 同步更新本文件对应节。
- 看板膨胀：`docs/active-context.md` 超 100 行 → 先归档完成史，再考虑拆轨。

## 4. 提交规范

- 格式：`<type>(<scope>): <summary>` ≤50 字符；契约破坏性变更 type 后加 `!`。
- type：feat / fix / docs / refactor / style / chore / test / build。
- scope：`kernel` / `workspace` / `lcoder` / `spec` / `docs`。
- 原子提交：完成看板一个节点（1–3 文件）即 commit；禁混提。
- 多窗口并行：一条功能线 = 分支 + worktree 独立目录；并行 ≤3 线；共享契约文件只在基线改。

## 5. 字典索引

| 文档 | 用途 |
|---|---|
| [active-context.zh.md](active-context.zh.md) | 当前看板（开工第一读） |
| [prd-and-design.zh.md](prd-and-design.zh.md) | 产品与方案口径 |
| [desktop-release.zh.md](desktop-release.zh.md) | 桌面发布身份、更新源、签名缺口与 macOS 适配 |
| `docs/tasks.yaml` | 开发台账（dev-flow，唯一源） |
| `docs/tasks-html/index.html` | 离线任务看板（由开发台账生成，勿手改） |
| `.spec/spec/rules.yaml` | 产品规格条目（LCoder 运行时） |
| `.spec/tasks/` | 产品任务数据（LCoder 运行时，非开发台账） |
| `.spec/contracts/` | 任务契约 |
| `.spec/proposals/` | 等人拍板的产品方案 |
| `.spec/evidence/` | 收口证据 |
| `.spec/env.yaml` | 验收命令与环境 |
| `.spec/roles.yaml` | 岗位名册（显示名、继承的内置角色、可选提示词前缀） |
| [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md) | 上游基线、接触面、升级演练 |
| [contact-surface.txt](../lcoder/contact-surface.txt) | 改过的上游文件清单 |
| [RUN.md](../lcoder/RUN.md) | 启动与验证手册 |
| [PITFALLS.md](../lcoder/PITFALLS.md) | 排障坑档（grep 坑号） |
| [architecture.zh.md](architecture.zh.md) | 上游架构（改 `packages/` 前必读） |
| [AGENTS.md](AGENTS.md) | 上游文档标准 |

## 6. 环境注意

- **隔离是产品约束，不是偏好。** LCoder 的开发与验证既不得依赖本机是否安装了桌面版或 `dsh`，也不得改变本机已装的那些应用。每次运行都把 `DSH_HOME` 指向仓库内目录（仓根 `.dsh-home/`，已进 `.gitignore`；worktree 用各自仓内 home），桌面 `userData` 留在 `apps/desktop/.desktop-build/development/electron-user-data`——`apps/desktop/scripts/dev.ts` 本来就默认到这里。禁止：写 `~/.dsh`、写 `AppData`、动注册表、安装或卸载应用、杀不是本次会话拉起的进程。
- **本机桌面 profile 必须配 `documentsDirectory`。** 宿主向操作系统问「文档目录在哪」在这台机器上会挂住，于是首启动的 `workspace/initializeDefault` 永不 settle，并把注册表队列占死，后面「打开仓库」一起没应答，且全程没有报错。同一份代码、同一个仓内 home、只改这一行的实测：不配时两个调用都无应答、`storages/workspace.json` 停在 227 字节且 `workspaceIds` 为空；配上后 22 个请求全部应答、文件变 758 字节并登记出默认工作区。这是对本机查询挂死的规避；队头卡住后该命名空间不会自愈属设计特征（`commands.ts` 里没有 deadline），而 10 秒超时是否兜得住这次等待未经证实，配置写法见 `lcoder/RUN.md`。
- Node 要求 `>=24.9.0`；本机用 `pnpm env use --global 24`，不要改系统 Node。
- 首次安装 `pnpm install`；首次启动前跑 `pnpm run build:artifacts`。
- 启动：`DSH_HOME='<仓内绝对路径>\.dsh-home' pnpm dsh web --patch lcoder/cordis.patch.yml --no-open --port 3080`（Git Bash 里路径要写成 Windows 形式，否则 profile 静默起不来）。
- `@lcoder/*` 用 `link:` 接进仓内 profile（`<DSH_HOME>/profiles/web/package.json`），不接进 `~/.dsh`；重建 home 目录后重做。
- Windows 上 kill `dev:web` 不会带走子进程；换实例前按进程树清理，再确认端口空闲。
- 不要给 `dev:web` 接管道；输出重定向到文件再读，否则日志会被缓冲到进程结束。
- 一条桌面线一个 worktree：主窗用默认 Electron inspector 端口（9229/9222/9230），feature worktree 用 `DSH_DESKTOP_MAIN_INSPECT_PORT`、`DSH_DESKTOP_RENDERER_DEBUG_PORT`、`DSH_DESKTOP_HOST_INSPECT_PORT` 设一组预留端口，端口号记在该任务的台账备注里。`apps/desktop/scripts/dev.ts` 把 `DSH_HOME` 与 Electron `userData` 指进 `apps/desktop/.desktop-build/development/`，worktree 不写主窗的 `~/.dsh`；这些默认值别改——把 `DSH_HOME` 设成 `~/.dsh` 就等于让一次验证去写本机安装态。`@lcoder/*` 的 link 要指向 worktree 自己的包目录。
- **重活单通道。** 所有跨工作树的 `pnpm install` 与构建产物生成都走 `lcoder/scripts/worktree.cmd -Action provision` 或 `-Action build`；脚本持一把机器级命名互斥，同一时间只允许一条重活。禁止手工并发跑这些命令；测试可以并行，但要限制 worker。
- **并行预算：同时最多两条 UI 工作树。** 需要安装或构建的波次只留一条在重活车道，其余等；文档与契约线用 `-Action sparse`，完全不装依赖。
- **共享运行时、隔离会话数据。** `-Action junction` 只共享 `.desktop-build/downloads` 与 `targets`；`electron-user-data` 与仓内 home 仍按工作树独立。
- **收口即清。** 合入后用 `worktree.cmd -Action clean -Remove` 清理；不要把带 `node_modules` 或构建产物的树留在 `.worktrees`。
- 插件路径是批量 combo URL，不是 `plugins/<name>/client.js`；单独请求会 404。
- 文档门禁：`pnpm run test:docs`；包 README 必须有 `kind` / `description` frontmatter 与 `Summary` / `Table of Contents` / `Dev Note` 骨架。
- 看板：先改 `docs/tasks.yaml`，再跑 `python scripts/build-tasks-html.py`；产物是 `docs/tasks-html/index.html`。`.spec` 不参与看板生成。
- macOS 开发使用同一套仓库内 home 与仓库内 Electron 用户数据。未签名 macOS 构建是内部测试产物；其 Gatekeeper 与自动更新限制见 [desktop-release.zh.md](desktop-release.zh.md)。
- 上游文档要求每段一个物理行（`verify-md-wrap`）；新增 `docs/` 文档按此写。
