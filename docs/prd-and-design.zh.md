# LCoder 产品与设计文档（PRD）

[English](prd-and-design.md) | 中文

## 0. 文档定位

本文汇总 LCoder 的业务共识与方案设计，是 [PROJECT-RULES.zh.md](PROJECT-RULES.zh.md) 的口径来源。产品运行时的任务与规格数据不写在这里；LCoder 产品数据的唯一事实源是工作区下的 `.spec/`。

本仓库同时存在两类任务资产，不能混用：`.spec/tasks` 是 **LCoder 产品数据**，供 kernel 与 UI 读取；`docs/tasks.yaml` 是 **开发 LCoder 这个项目的开发台账**（dev-flow），由人维护。两者不互相派生；仓库根的 `.spec` 已替换为订单佣金示例（`DR-01`/`DR-02`、`DEMO-01`），与开发台账 ID 不重叠。

## 1. 背景与问题

Agent 编码的常见失败不是不会写代码，而是不知道「凭什么算做完」：需求散落在对话里，验收靠模型自述，改动边界没有记录。LCoder 把「规格 → 契约 → 实施 → 验证 → 收口」做成可执行的状态机，并把规格库存成仓库里的 YAML，让 agent 与人读同一份事实、按同一套判据收口。底座选用 DeepSeek Harness：它提供插件化的宿主、工具注册、会话与 UI 扩展点，适合做二开而不是重写运行时。

## 2. 产品定位

一句话定位：LCoder 是面向 Windows 与 macOS 桌面端的规格驱动开发工作台，把 `.spec` 规格库、任务状态机与 agent 工具面收放做成 DeepSeek Harness 的插件层。目标用户是使用 agent 做真实仓库开发的个人与小团队，需要可审计、可复现的改动依据。价值主张是模型只能在该看到的工具面里工作，每次收口都留下契约、证据与规格落点。

## 3. 与上游的关系

LCoder 是 DeepSeek Harness 的二开，不 fork 业务实现，也不直接 import 上游内部路径。当前基线是 `0.2.2-alpha.2`（2026-10-30）。分支模型：`master` 是只读上游镜像；`lcoder/main` 是主线；同步上游走 `sync/upstream-<版本>` 临时分支，全绿后合回主线。挂载原则见 [UPSTREAM-BASELINE.md](../lcoder/UPSTREAM-BASELINE.md)：能新增就不修改；改上游只改装配层；每个接触点登记并人工评审。

## 4. 核心概念

| 概念 | 落点 | 说明 |
|---|---|---|
| 规格条目 `RuleEntry` | `.spec/spec/rules.yaml` | 稳定编号、出处、状态、代码落点与验收引用 |
| 状态机 `StateMachine` | `.spec/spec/states/*.yaml` | 状态集合、合法迁移与守卫 |
| 任务 `Task` | `.spec/tasks/T-xx.yaml` | 五态、分级、允许路径、不可逆项、所需证据 |
| 契约 `Contract` | `.spec/contracts/T-xx.contract.yaml` | change / not_change / acceptance / fail_if，加人签 |
| 证据 `Evidence` | `.spec/evidence/T-xx/*.log` | 非空才算证据 |
| 环境 `Env` | `.spec/env.yaml` | 仓库、验收命令、凭据来源 |
| 常驻会话 `AgentsRegistry` | `.spec/agents.yaml` | 智能调度与流程控制的单例会话号；失效时按工作区里 preset 匹配的会话重找 |

形状的唯一来源是 [packages/lcoder/kernel/src/schema/spec.ts](../packages/lcoder/kernel/src/schema/spec.ts)：schema 只保证形状对，语义合规由检查器承担。

## 5. 核心流程（五态）

以下五态是 LCoder 产品内的任务流程；开发 LCoder 本身的开发任务用 A/B/C 分级，见 [PROJECT-RULES.zh.md](PROJECT-RULES.zh.md) §3，两套流程不要混用。

| 状态 | 进入条件 | 模型可见能力 | 出口 |
|---|---|---|---|
| `drafting` | 任务建立，契约未签 | 读代码、查规格、绑定落点、起草契约与后续任务 | 签署有效（人签，或三闸成立的 AI 自签）后进入 `contracted` |
| `contracted` | 契约签署有效 | 增加编辑、跑命令、附证据 | 进入 `implementing` |
| `implementing` | 按契约实施 | 同上 | 只能进 `verifying`，或退回归 `contracted` 重签 |
| `verifying` | 证据齐备 | 增加 `task_close` | 通过 P1/P3/P4 后 `closed`；不过退回 `implementing` |
| `closed` | 终态 | 只读 | 无 |

状态机只管图的合法性；「能否进 `contracted`」还取决于契约是否签署，由 P3 判定，不塞进状态机。收口由 `task_close` 串起三道检查器：P1 条目有落点、P3 要求签名仍覆盖当前正文且签署方式合法（人签，或三补偿闸成立的 AI 自签）、P4 条目有证据；任一不过则状态不变。AI 自签是用户 2026-11-06 的决定：要求自动化策略里 `sign` 为 `auto`、`scope.irreversible` 为空、且该契约有非空的评审复核证据；任务只要触及不可逆项就永远由人签。

磁盘上没有任务的仓库不是第六个状态：在第一个 `task_draft` 落盘之前，kernel 按 §6 的立项面收。

## 6. 工具面

kernel 向宿主注册十二个工具：`file_read`、`project_draft`、`spec_query`、`spec_draft`、`spec_bind`、`contract_draft`、`task_read`、`task_draft`、`file_edit`、`cmd_run`、`evidence_attach`、`task_close`。工具面按任务状态收放，采用 allow 列表（fail-closed）；未配置的工具默认不可见，漏配的后果是「用不了」而不是「越权能用」。读不到任务状态的仓库（没有 `.spec`，或 `tasks/` 为空）拿的是立项面 `file_read`、`project_draft`、`spec_query`、`spec_draft`、`task_read`、`task_draft`：能调研、能落项目信息与规格条目、能立任务，拿不到本包的编辑与命令能力。工具面还有第二维：角色就是一个 Agent preset，在创建会话时选定、首个回合之后锁定，可见工具是 `SURFACE[状态]` 与角色天花板求交，所以角色只能减能力、不能越状态。`dev` 一行刻意不设天花板，但它必须等于注册全集，这条等式由测试钉住，防止新增工具静默地对实施角色隐身。`contract_sign` 与 `task_bind` 不在任何角色表里。`contract_sign` 永不注册为模型工具：模型能调用签署工具，就等于模型能给自己签字。它注册在人机命令面上——`/contract_sign <任务编号>` 不经过模型回合，宿主复算契约正文哈希后写 `sig`，调用与回执都记进会话日志。注册时用 `when` 在每次 model step 求值，而不是 `restrict`；`restrict` 只对全局注册生效，作用域注册盖不住。`when` 也因此只覆盖本包的注册：bundle 全局注册的工具（`read`、`write`、`edit`、`glob`、`grep`、`bash`、`pwsh`）对该 profile 的每个 Agent 仍可见，要收住它们需要 Agent 作用域的 `restrict`（见 §11）。

## 7. 数据面

工作台直接读 `.spec` 下的 YAML，通过上游 `workspaceFiles` 远程命名空间做文件投影，不自建 Remote，也不引 typert 生成器。投影面按会话注入；没有绑定工作区时三栏保持骨架态。状态机判断不进 UI，仍归 kernel。路径必须与 kernel 落盘一致：`task-store.taskPath` 与 `spec-store.saveRules` 都以 `.spec` 为根；分叉不会有类型错误，只会画出错的数据。

kernel 的规格根跟随会话工作区：一次工具调用取 `session.header.cwd/.spec`。没有会话 cwd（headless 启动、启动自检）时退回配置的 `root`，再退回 `process.cwd()/.spec`。桌面端宿主以 profile 目录而不是目标仓库作为进程 cwd，因此只有会话工作区能让工具与 UI 投影读同一个 `.spec`。

任务还可以记录「这条事由哪条会话在办」：`.spec/tasks/<ID>.yaml` 的 `session` 字段。它由人在为该任务打开对话时经 `/task_bind` 写入，模型不写；会话号取自宿主自己的调用上下文，所以前端无法去认领不属于它的会话。这个值是本机 home 里的运行时标识，换机器或会话被删之后内核退回「配置的任务号，再退回看板第一条」，任务的状态本身不会因为认领失效而被改动。释放认领是把这个键整个删掉，不留空值——空值会让整张看板读不懂。

`.spec/automation.yaml` 承载每个项目一份的自动化策略：按动作的开关（`draft`、`contract`、`sign`、`implement`、`verify`、`close`、`commit`）、停止条件（token 预算、时长、连续失败次数、并发上限）与可选的任务范围。缺文件即全手动，与没有自动化时的行为一致。外部不可逆动作——push、部署、改注册表与环境变更——不能出现在这份文件里；schema 遇到这些键直接判非法，而不是读进来忽略。kernel 每次求值都重读，改完下一次判定即生效。

两条常驻调度会话登记在 `.spec/agents.yaml`。会话不在、被删或 `agentPreset` 对不上时按未绑定处理：工作台先找运行 `lcoder-scheduler` 或 `lcoder-flow` 的同工作区会话，找不到才新建，并通过 `/agent_bind` 把会话号写回。流程面板读 `/flow_status`，每次开工结果通过 `/flow_log` 追加；两条命令都不推进任务状态，签署与外部动作始终与批量开工分开。

流程引擎决定「下一步做什么」而不是分配工作：它是任务事实、策略与已用量的纯函数，返回 `draft`、`contract`、`sign`、`implement`、`verify`、`close`、`commit`、`external` 或 `stop` 之一，并带理由与挡住原因（等人签、等依赖、等预算、等外部动作）。它不读写盘；`flow-store` 从 `.spec` 装配事实，驱动已有的人机命令与内部 API 的执行器属于流程控制入口。自签就是其中一种动作：`selfSignContract` 只在三闸同时成立时写 `by: agent`，并把 `actor` preset 与授权策略的路径、哈希、判定时刻一起记进契约。

## 8. MVP 范围（MVP-0）

本阶段交付：宿主挂载 kernel，注册的工具按状态收放；右栏出现「工作台」页签；三栏骨架接上文件投影；人在工作台里签署契约、由宿主写签名；本地一条命令可启动。

明确不做：工作台代推任务状态（状态仍由人手写 `.spec/tasks/*.yaml`）；独立的 `task_transition` 工具；增量刷新；多工作区与权限模型；远端同步；上游文档的全量双语改造。

## 9. 验收标准

- 启动后日志出现解析出的规格根，以及点明十个工具与 `/contract_sign` 的注册行，且没有激活失败。
- 浏览器插件清单包含 `@lcoder/workspace/client.js`，右栏出现「工作台」页签。
- 会话绑定工作区目录后，三栏能读出 `.spec` 的任务与规则。
- `pnpm typecheck`、`pnpm lint`、`pnpm exec vitest run packages/lcoder` 全绿；文档变更时 `pnpm run test:docs` 全绿。

## 10. 关键决策

| 编号 | 决策 | 理由 |
|---|---|---|
| D1 | 数据面走文件投影，不用 typert Remote | 读的是唯一事实源，UI 不承担状态机逻辑 |
| D2 | 挂载走独立 patch 层 | 不改上游清单，升级冲突面最小 |
| D3 | 工具面 fail-closed | 漏配导致能力缺失，而不是权限扩大 |
| D4 | 签署不进模型可调用的工具 | 模型能随时调用签署，S1 就失效；签署留在人机命令面或流程执行器上 |
| D5 | 产品数据与开发台账分离 | `.spec/tasks` 是产品数据；`docs/tasks.yaml` 是开发台账；看板只从开发台账生成 |
| D6 | 单轨治理 | 一个责任线、一个下一步，`active-context.md` 用单文件 |
| D7 | 工具面是状态 × 角色，不是角色单独说话 | 状态是进度、角色是天花板，配错的角色只会削能力，不会给权限 |
| D8 | 任务归属认领写进 `.spec`，不从标题推断 | `.spec` 是产品事实唯一来源；会话标题人可以改，不能当外键 |
| D9 | 并行靠一个工作区多条会话 | 一任务一会话、深度 1，孙代被拒，成本可控而角色仍能委派到评审 |
| D10 | AI 只在三补偿闸同时成立时自签 | 用户 2026-11-06 的决定；打开「只能人签」前提后，靠策略 `sign: auto`、`scope.irreversible` 为空、评审复核证据三闸让 P3 仍然成立 |

## 11. 风险与技术债

- 签署已接通：人机命令 `/contract_sign` 由宿主写签名，工作台的任务详情展示契约正文并给出签署动作。浏览器不写 `.spec`；签名哈希不再覆盖正文时 P3 判签名作废。人签或三闸成立的 AI 自签都算有效；契约记下 `actor` preset 与策略路径、哈希、判定时刻，投影把 AI 自签单独带出。签名验过后，人经 `/task_contract` 把起草态推到已签约；更往后的流转仍是手写 YAML。
- 流程引擎、策略读取与 AI 自签已实现，并有单测与真实文件覆盖。「开工」入口、流程面板与逐任务动作流水已通过人机命令 `/flow_status` 与 `/flow_log` 接通；`selfSignContract` 在测试之外仍没有调用方，所以面板只标出「可自签」，不替人执行。没有 `.spec/automation.yaml` 的仓库仍按全手动运行。
- 没有可用模型时发消息曾经静默失败：准入把消息收进入队就返回接受，回合在宿主侧才失败，事件流里不会出现 `user/message`。`client/model-status.ts` 把 `session/modelCatalog` 折成 ready、empty、unknown 三态；empty 时拦住发送并说清凭据该放哪，会话快照的 `promptError` 与 `lastAgentError` 在浮层就地显示。仓内隔离 home 不带 provider 凭据，全新检出要先有 `DEEPSEEK_API_KEY` 才能跑对话。
- `implementing → verifying` 没有工具入口，状态推进需要人工改任务文件。
- 立项面只收住本包的编辑与命令工具；bundle 注册的工具对该 profile 的每个 Agent 仍可用，所以未立项仓库不会因为 LCoder 就失去改代码能力。用 Agent 作用域 `restrict` 收住它们记为 T-11。
- 产品示例 `DEMO-01` 处于 `drafting`，尚无契约；示例 `env.yaml` 已就位。
- 开发任务不使用 `.spec` 契约与证据，开发门禁见 [PROJECT-RULES.zh.md](PROJECT-RULES.zh.md) §3。
- 上游升级需要同时核对三个 tsconfig/lock 接触面与根 `AGENTS.md` 入口，冲突必须人工评审。
- Windows 上 `dev:web` 的子进程不随 shell 退出，换实例前要按进程树清理。
- 仓库根 `.spec` 是订单佣金示例（`DR-01`/`DR-02`、`DEMO-01`），不是开发任务清单；开发进度以 `docs/tasks.yaml` 为准。
- Windows 与 macOS 安装包在 T-82 之前都未签名，只是内部测试产物。未签名 macOS 自动更新未验证；身份、更新源、签名限制与 macOS 适配矩阵见 [desktop-release.zh.md](desktop-release.zh.md)。

## 12. 运行入口

启动、挂载、验证四步与踩坑记录见 [RUN.md](../lcoder/RUN.md)。开发进度与下一步见 [active-context.zh.md](active-context.zh.md)；开发看板见 [docs/tasks-html/index.html](tasks-html/index.html)。桌面发布身份、更新源、签名缺口与 macOS 适配矩阵见 [desktop-release.zh.md](desktop-release.zh.md)。
