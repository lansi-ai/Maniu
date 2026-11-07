# LCoder 漂移审计（2026-11-07）

> 审计对象：一是「预期目标」与「已实现行为」是否一致；二是开发台账 [`docs/tasks.yaml`](tasks.yaml) 的 `status` 与代码、合并事实是否一致。
>
> 结论快照：主检出工作树干净，HEAD 提交标题为「docs(lcoder): 收口 T-85 架构解析报告」，提交日 2026-11-07。审计期间监督窗口仍在并行提交，本报告的所有行号与状态都以该快照为准；引用提交时只写标题与日期，不写提交号，因为文档门禁禁止在维护文档里出现带字母的十六进制提交号。
>
> 只读声明：本次没有改动源码、已有文档、台账与看板，也没有启动桌面实例或安装依赖。新增文件只有本报告一份；另在 `scripts/translation-pairing.manifest.json` 的排除清单里加了一行（原因见 7.2），这是唯一的第二处改动。

## 目录

1. 基线与证据口径
2. 第一问：十个主题逐条对照
3. 第一问的横向发现：PRD 自身与看板的滞后
4. 六条已核实线索的复核
5. 第二问：台账状态与代码事实
6. 优先级清单与未验项
7. 门禁数字

## 摘要

第一问覆盖十个主题（任务五态与准入、模型工具与人工命令、契约签署与三道人签闸、允许路径硬闸、证据与关闭三检查、流程与调度两层、会话模型与附件、云端账号与登录门禁、个人中心与 token 预估、桌面身份与更新源）。结论是：**一致 2 条、部分实现 4 条、未实现 0 条、超出范围 4 条**；此外有一个子项单列为「未实现」——`lcoder://` 深链接路由。四条「超出范围」不是坏事：它们是台账里已经立过任务、但 PRD 从没写过的新能力，漂移在文档而不在代码。

第二问逐条核了 47 条任务：T-56 及其后的全部 32 条，加上当前仍为 `doing` 的 15 条早期任务。结论是：**一致 28 条、部分实现 19 条、未实现 0 条、超出范围 0 条**。没有发现「台账说完成、仓库里找不到产物」的编造式完成；`done` 任务全部能在主线上指到代码或文档。真正的问题是反方向的：15 条 `doing` 任务的实现早已合入主线，状态却停了几周；另有个别 `done` 任务的验收项后来被证实未实现或证据没有留存。

六条已核实线索的复核结果是二真、一半、三已处理：**协议路由未实现**与**主检出跑旧包**在当前快照上仍然成立；**工具数不一致**只成立一半——线索里「PRD 与代码为十二个工具」不成立，代码实际注册 **17** 个模型工具、**9** 条人工命令，PRD 写 12 个，验收段与看板写 10 个，模块注释写 13 个；**command-management 的 win32 两例**、**T-83 的 typecheck 红五错**、**根 README 是上游内容**三条已经修复或改好，当前无残留（T-83 那条的「上一线误报」经修复提交与台账双向核对属实）。

门禁：`pnpm run test:docs` 的 21 项与退出码见第 7 节；本次另外实跑了三项事实检查（`pnpm run typecheck`、`vitest run packages/lcoder`、`apps/desktop` 的 command-management 单例），用于给线索定性。

## 1. 基线与证据口径

### 1.1 预期目标取自哪里

第一问的预期基线按工单取两份：一是 [`docs/prd-and-design.md`](prd-and-design.md)（下称 PRD），它记录产品定位、五态流程、工具面、数据面、MVP 范围与十条关键决策；二是仓库根的 `.spec` 产品示例数据（`spec/rules.yaml`、`tasks/DEMO-01.yaml`、`contracts/DEMO-01.contract.yaml`、`env.yaml`、`project.yaml` 与 `.spec/README.md`），它演示规格条目、任务、契约、命令与证据长什么样。 [`docs/PROJECT-RULES.md`](PROJECT-RULES.md) 作为规则单源，用来校验红线类断言（签署、部署、写入范围、提交边界）。桌面身份这一类 PRD 没写的内容，以 [`docs/desktop-release.md`](desktop-release.md) 为准，因为该文档在第 0 节自述是「LCoder 桌面发布事实的唯一来源」。

这里必须先讲清一个结构性事实：**PRD 仍停在 MVP-0，它没有云端账号、没有个人中心、没有更新源、没有多角色、没有 Git 工具、没有会话附件**。凡是这类能力，本报告不会拿 PRD 里不存在的条款去判「一致」，而是判「超出范围」，再单独核对它与台账、与独立设计文档是否自洽。

### 1.2 四种结论怎么判

- **一致**：预期条目在代码里能指到对应的实现位置，且行为与条文没有可观察的差异。
- **部分实现**：主干机制在，但预期里至少有一条约束/一侧边界没有落实，或实现比条文窄。
- **未实现**：预期明确要求、代码里没有对应实现。
- **超出范围**：代码实现了预期基线没有的能力。它可能是经台账授权的新增，也可能是旧条文该更新而文档没跟上；两种情况都在正文里区分。

### 1.3 证据强度怎么标

每一条都标「已证」或「未证」。**已证**指本次亲手做过的动作：读源码并给出行号、跑命令拿到输出、查 git 与进程状态。**未证**指只有台账文字或别人的回报，本次无法在隔离约束内复现（例如需要真机安装、真实云端、真人点击）。已证也分层：读代码能证明「代码这样写」，不能证明「运行时一定这样表现」；后一类我一律降到未证并在第 6 节列出。

### 1.4 本次实跑的三项事实

- `pnpm run typecheck`：5 项 gate 全过，`run-gates: 5 passed, 0 failed, 0 skipped in 9.18s`，退出 0。
- `node_modules/.bin/vitest run packages/lcoder`：58 个测试文件、590 个用例全过，退出 0。这与台账 T-83 收口行写的「五十八文件五百九十例」一致。
- `node_modules/.bin/vitest run apps/desktop/tests/command-management.spec.ts`：6 个用例全过，退出 0。用于线索三。

三项都在主检出内跑，未起桌面实例、未装依赖、未写 AppData。

## 2. 第一问：十个主题逐条对照

### 2.1 任务五态与准入 —— 部分实现

**预期**（PRD 第 41 至 49 行）：五态是 `drafting`、`contracted`、`implementing`、`verifying`、`closed`；起草态的出口只有一个——合同被有效签署后进入 `contracted`；状态机只判「图上有没有这条边」，能否进 `contracted` 由 P3 判，且刻意不进状态机；没有任务在盘上不算第六态，走立项面。

**实现**：状态集合与五条边在 `packages/lcoder/kernel/src/kernel/task-store.ts:21-30`——`drafting` 可去 `contracted` 与 `closed`，`contracted` 可去 `implementing`、`drafting`、`closed`，`implementing` 只回 `contracted` 或去 `verifying`，`verifying` 去 `closed` 或退回 `implementing`，`closed` 无出口。「签署才准进 `contracted`」落在人机命令 `packages/lcoder/kernel/src/commands/task-contract.ts:82-118`：只接受 `drafting`，契约必须存在、已签，agent 签名要三闸复核，签名哈希要与当前正文一致。没有任务时 `packages/lcoder/kernel/src/plugin.ts:112-137` 返回空任务，工具面退回立项面。

**差在哪里**：两处。第一，`drafting → closed` 这条边在代码里合法，但 PRD 的出口列只写「有效签署 → contracted」，没有「放弃」这条边，读条文的人会以为起草态只能在签署后前进。第二，「进 `contracted` 取决于已签契约」只在 `/task_contract` 的执行体里成立；`task-store.transition()` 本身不看签名，人直接改 YAML 把 `state` 写成 `contracted` 不会被任何代码拦住。PRD 第 49 行明说更往后的转移仍手写 YAML，但没写这条边也允许手写，条文与实现之间留了一个未定义的缺口。

**结论**：部分实现。边与准入机制在，条文的边集少一条，签署约束的生效位置比条文窄。**已证**（读码与行号）；未验项是「真实模型回合里状态迁移的行为」，本次没有模型钥匙也没有起实例，**未证**。

### 2.2 模型工具与人工命令 —— 超出范围

**预期**（PRD 第 55 行）：内核向宿主注册十二个工具，分别是 `file_read`、`project_draft`、`spec_query`、`spec_draft`、`spec_bind`、`contract_draft`、`task_read`、`task_draft`、`file_edit`、`cmd_run`、`evidence_attach`、`task_close`；空看板面只给六个（`file_read`、`project_draft`、`spec_query`、`spec_draft`、`task_read`、`task_draft`）。PRD 第 79 行的验收还写着「注册行点名十个工具加 `/contract_sign`」。规则单源（`docs/PROJECT-RULES.md:21`）另外钉死四条永远不做成模型工具的人工命令：`contract_sign`、`task_bind`、`task_contract`、`proposal_approve`。

**实现**：实际注册 **17** 个模型工具。逐文件点得到：`file_read`、`file_list`、`file_edit`、`cmd_run`、`evidence_attach`（`tools/edit-tools.ts`），`git_status`、`git_diff`、`git_commit`（`tools/git-tools.ts`），`project_draft`（`tools/project-tools.ts`），`proposal_draft`（`tools/proposal-tools.ts`），`spec_query`、`spec_draft`、`spec_bind`、`contract_draft`（`tools/spec-tools.ts`），`task_read`、`task_draft`、`task_close`（`tools/task-tools.ts`）。`dev` 角色的天花板在 `kernel/surface.ts:144-162` 正好列了这 17 个，`tests/surface.spec.ts:157` 用一条等式把「角色表等于全部注册工具」钉住，所以这 17 个不是漏配。空看板面在 `kernel/surface.ts:107-118` 是 **10** 个，比 PRD 多的四个是 `file_list`、`proposal_draft`、`git_status`、`git_diff`。人工命令实际注册 **9** 条：`contract_sign`、`task_bind`、`task_contract`、`task_schedule`、`flow_status`、`flow_log`、`agent_bind`、`proposal_approve`、`deploy`（`plugin.ts:165-175`）。

**四条不变式仍然成立**：`contract_sign`、`task_bind`、`task_contract`、`proposal_approve` 在 `surface.ts` 的任何状态表与任何角色表里都查不到，它们是命令面上的入口，模型回合里看不到。

**差在哪里**：数字对不上，而且四个地方互不一致——PRD 正文 12、PRD 验收 10、[`docs/active-context.md`](active-context.md) 第 9 行 10、`plugin.ts:7` 的注释写「十三个」。多出来的五个工具与五条命令都有台账出处（`file_list` 来自 T-32，`proposal_draft` 与 `/proposal_approve` 来自 T-42，`git_*` 来自 T-43，`/deploy` 来自 T-44，`/task_schedule`、`/flow_*`、`/agent_bind` 来自 T-51、T-59、T-60），也就是说这是经批准的范围扩张，不是偷偷加的能力。结论判「超出范围」，漂移落在文档。

**结论**：超出范围。**已证**（工具名逐个来自源码，注册行为读 `plugin.ts:139-160`；四条人工命令的排除读 `surface.ts:28-179`）。

### 2.3 契约签署与三道人签闸 —— 部分实现

**预期**（PRD 第 49、101 行；PROJECT-RULES 第 21 行）：签名必须覆盖当前契约正文；人签，或 AI 自签且三闸同时成立——策略里 `sign: auto`、任务 `scope.irreversible` 为空、该契约有非空 `review*.log`；正文被改过则签名作废；宿主复算正文哈希后写 `sig`。

**实现**：正文哈希是 `sha256:` 前缀的规范化哈希，见 `packages/lcoder/kernel/src/kernel/contract.ts:38`。人签命令在 `commands/contract-sign.ts:92-103` 复算 `bodyHash` 后写 `{ by: 'human', at, hash }`，同值重签会被拒，变值重签在回执里说明。三闸判定是纯函数 `kernel/sign-gate.ts:33-39`，P3 在 `checkers/index.ts:97-152` 复用同一口径：agent 签名若三闸不全则违规，签名哈希与当前正文不一致也违规。`/task_contract` 在推进状态前再复核一遍（`commands/task-contract.ts:98-118`），把「签名有效」与「允许开工」分成两步。

**差在哪里**：三条。第一，`selfSignContract`（`commands/contract-sign.ts:128`）只有测试调用，生产代码里没有任何调用方；PRD 第 102 行也承认「still has no caller outside tests」。所以三闸目前是**判定能力**，不是**执行能力**——没有任何路径会真的替 AI 签字。第二，P3 在 `irreversible` 为空时直接返回通过（`checkers/index.ts:98-99`），而 PRD 第 49 行写的是「P3 requires a signature…」没有写这条豁免；实现的口径是「P3 只管不可逆项」，条文的口径是「收口一律要签名」，两者不完全等价。第三，桌面签署按钮走的是人机命令链路，本次无法验证真人点击后的写盘结果，只能确认代码路径。

**结论**：部分实现。**已证**（哈希、三闸、P3、重签路径都能指到行号；`selfSignContract` 无生产调用方由全仓检索确认）；桌面真人签署**未证**。

### 2.4 允许路径硬闸 —— 一致

**预期**（PROJECT-RULES 第 25 行）：`Task.scope.allowed_paths` 是 `file_edit` 的硬闸；任务声明范围后，越界写入被拒；空列表或会话背后没有任务则不额外设限；这是代码里的闸，不是提示词。

**实现**：`plugin.ts:134-137` 把当前任务的 `allowed_paths` 取出，作为依赖注入给编辑工具；`tools/edit-tools.ts:133-145` 的 `assertInScope` 做前缀比较，先按正斜杠归一（Windows 上 `relative` 带反斜杠），空列表与 null 都直接放行，越界抛错并在文案里给出允许前缀、目标路径与「改 scope 或换任务」的出路；调用点在 `edit-tools.ts:266`，位置在算绝对路径之后、建目录与写文件之前。单测 `kernel/tests/edit-tools.spec.ts:172-182` 覆盖了范围内放行（含不带斜杠的前缀与反斜杠路径）与范围外拒绝。

**差在哪里**：没有。条文只约束 `file_edit`，实现也只约束 `file_edit`；`cmd_run` 仍可跑任意登记命令，这与条文一致，不是缺口。

**结论**：一致。**已证**（代码加单测）。桌面真窗口里点一次越界编辑**未证**，但这一条的判定在纯函数与工具执行体里，风险很低。

### 2.5 证据与关闭三检查 —— 一致

**预期**（PRD 第 31、49 行）：只有非空文件才算证据；收口是 `task_close` 串起 P1（每条生效条目有落点）、P3（合法签署且覆盖当前正文）、P4（每个声明项都有非空证据），任一不过状态不变。

**实现**：`tools/task-tools.ts:193-230` 的 `task_close` 先 `loadEvidence` 拿到「名字到字节数」，再依次跑 P1、P3、P4；违规清单非空就原样返回、状态不动。P1 在 `checkers/index.ts:46-74` 复用落点校验；P4 在 `checkers/index.ts:162-185` 把「缺文件」与「文件为空」分别报错，空文件不算证据。证据读法在 `kernel/evidence-store.ts:26`，复核证据识别在 `:46`。

**差在哪里**：没有实质差异。值得记一句：P1 检查的是整个规格库的生效条目，不是「本任务引用的条目」，这与 PRD「每条生效条目都要有落点」的措辞一致，不是越权。

**结论**：一致。**已证**（代码与 22 条 task-tools 单测）。真实桌面收口点击**未证**。

### 2.6 流程与调度两层 —— 部分实现

**预期**（PRD 第 67 至 69 行）：流程引擎是只读纯函数，输入任务事实、策略与已用预算，输出九种动作之一——`draft`、`contract`、`sign`、`implement`、`verify`、`close`、`commit`、`external`、`stop`——并带理由与挡住原因（签名、依赖、预算、外部）；两个常驻调度会话记在 `.spec/agents.yaml`，缺失或失效时按 preset 重新找回；流程面板读 `/flow_status`，把每次开工结果追加到 `/flow_log`，两条命令都不推进任务状态；驱动既有命令的执行器归流程控制入口。

**实现**：动作集合与纯函数在 `kernel/flow.ts:17-26` 与 `:120`，单任务判定在 `:339`、批量计划在 `:370`；事实装配在 `kernel/flow-store.ts:43` 与 `:89`，策略读取在 `kernel/automation.ts:54`（缺文件返回全手动）。人机命令 `flow_status`、`flow_log` 分别在 `commands/flow-status.ts:45`、`commands/flow-log.ts:53`，后者把结果写 `.spec/evidence/<任务>/flow.jsonl`（`:118`）。常驻会话的 schema 在 `schema/spec.ts:309-323`，写回命令是 `commands/agent-bind.ts:54`，查回与标题校正分别在 `workspace/src/client/singleton.ts:54`、`:78`、`:93`。外壳的「开工」批量入口在 `Shell.tsx` 的 `flowBatch` 判定之后（约 1484、1528 行），按计划逐条走既有会话启动，不写任务状态。

**差在哪里**：三处。第一，执行器只接了一半：批量开工能拉起会话，但「自签」这个动作没有执行者（同 2.3），PRD 第 102 行自己承认这条。第二，「调度两层」里的判定层（等依赖按住、无依赖入队、无匹配才新开、跨工作副本硬闸）在 PRD 里完全没有条目，只在台账 T-51、T-53、T-55 里定义；拿 PRD 当基线时这部分属于未记录的能力。第三，产品示例 `.spec` 里既没有 `automation.yaml` 也没有 `agents.yaml`，所以「缺省全手动」和「失效重建」只有单测与历史实测，当前检出上没有可复看的样例。

**结论**：部分实现。**已证**（纯函数、命令、写盘位置、schema 都有行号；调度层的判定与硬闸在 `workspace/src/client/scheduling.ts:65` 与 `:140`）；自签执行与常驻会话运行时行为**未证**。

### 2.7 会话模型与附件 —— 超出范围

**预期**：PRD 没有这条。模型切换与图片/文件上传来自台账 T-66、T-67，属于 MVP-0 之后追加的能力，本条只能说「PRD 未覆盖」。

**实现**：模型选择是一层纯函数加一个面板——`shell/chat-composer.ts:69` 解析当前模型、`:196` 归约面板状态、`:153` 判当前项；面板组件是 `shell/ChatExtras.tsx`，选中同时作用于当前会话与全局默认。附件侧：上限读会话投影的 `imageLimits`（`Shell.tsx:813`），文件上传走 `remote.fileUploads.upload`（`workspace/src/client/index.ts:287`），拼装顺序与发送前校验在 `chat-composer.ts:312`、`:333`、`:269`。

**差在哪里**：相对 PRD 是能力多出来；相对台账没有发现缺项。可记的风险是「模型不支持图片时入口无法预置灰」，T-66 与 T-67 的台账都写过这一点，属于已知限制而非漂移。

**结论**：超出范围（PRD 未覆盖），与台账自洽。**已证**（代码与单测）；真实模型回合里的附件投递**未证**（台账称有会话日志取证，本次没有钥匙也不解码会话日志）。

### 2.8 云端账号、免费额度与登录门禁 —— 超出范围

**预期**：PRD 没有云端条目。基线只在台账 T-75（设计包，独立仓 LCoder-cloud）与 T-76（桌面接入）：匿名可用立项分析；立项之后的新会话、任务对话、签署、批准、批量开工、模型服务、常驻会话一律弹登录；令牌 15 分钟、刷新令牌 30 天轮换。

**实现**：门禁判定是纯函数 `cloud/gate.ts:44-53`，入口枚举九项（`onboarding`、`onboardingFollowup`、`newSession`、`agentSession`、`taskConversation`、`contractSign`、`proposalApprove`、`flowBatch`、`modelSettings`）；云端面装配在 `workspace/src/client/index.ts:203-233`，装不上时降到 `unavailableCloudFace`；宿主侧客户端在 `kernel/src/cloud/`（`api.ts`、`controller.ts`、`tokens.ts`、`guest.ts`）。匿名领取与设备指印在 `cloud/guest.ts:152-178`。

**差在哪里**：三处值得记。第一，`modelSettings` 的九项枚举只在单测里用到，真实界面是 `Shell.tsx` 约 3098 行按 `cloud !== undefined && !signedIn` 内联渲染一句「锁定」，两条判定并存，行为一致但实现重复。第二，`gateEntry` 在 `cloudUnavailable` 时对所有入口返回 `blocked`（`gate.ts:45`），只有立项入口例外；这意味着云端通道挂掉时产品退化成「只能立项」，建会话、任务对话与签署全部不可用。这是 fail-closed 的极端形态，台账没有把它写进风险。第三，云端工作全部在独立仓的未合入分支上，本仓只有客户端接入，真实联调没有发生。

**结论**：超出范围（PRD 未覆盖），与台账大体自洽，但门禁总闸的退化形态未被记录。**已证**（代码）；真实云端、真实短信与刷新生命周期**未证**。

### 2.9 个人中心与 token 预估 —— 超出范围

**预期**：PRD 没有这条。台账 T-83 的口径是：独立页面加弹窗摘要；区间下限按输入全部未命中缓存价、上限按全部命中缓存价；换算只在云端算，桌面只渲染，不得出现单价常量；匿名也显示预估；缺价时显示不可用而不是零。

**实现**：页面在 `workspace/src/client/cloud/PersonalCenter.tsx`（271 行），区间格式化在 `cloud/estimate.ts:56`，不可用原因映射在 `:61-69`，金额折美元在 `:22`。`estimate.ts` 里没有任何单价数字，测试 `tests/personal-center.client.spec.tsx:127` 钉死 20 美元算例的下限 64935064 与上限 187969924，`:239` 一节标题就是「单价只在云端」。

**差在哪里**：无明显缺项。唯一可复核的缺口是证据留存：T-83 声称 32 张截图，本次在仓内只找到 t73、t74 两套归档，见第 5.4 节。

**结论**：超出范围（PRD 未覆盖），与台账自洽。**已证**（代码与单测）；真实云端返回的数值准确性**未证**。

### 2.10 桌面身份与更新源 —— 部分实现（子项「深链接路由」未实现）

**预期**：以 [`docs/desktop-release.md`](desktop-release.md) 为准：§1.1 应用身份（产品名 LCoder、标识 `ai.lansi.lcoder`、URL 方案 `lcoder`、产物前缀 `lcoder-`、更新缓存目录 `lcoder-updater`）、§1.2 独立发布版本从 0.1.0 起、§1.3 数据与日志目录、§1.4 深链接「唯一支持 `lcoder://open`」、§3 更新源走 COS 的 `lcoder-desk` 路径；PRD 第 111 行补充「T-82 之前两端安装包未签名，只作内部测试产物」。

**实现**：身份集中在一个对象里——`apps/desktop/scripts/desktop-product-identity.mjs:55-63` 定义 LCoder 默认值，`:108-118` 做字段校验与回退，上游身份保留为回退。打包层在 `apps/desktop/scripts/electron-builder-config.mjs:115` 用 `identity.protocolScheme` 注册系统方案，`:105` 让未签名包在没有显式开关时不带更新源，`:123` 把版本写进产物。更新界面尚未实现：`workspace` 源码里搜不到 `currentVersion` 或更新状态机，台账 T-79 仍是 `todo`，与代码一致。

**差在哪里**：三处。第一，**深链接路由未实现**。打包层注册的是 `lcoder`，但应用层 `apps/desktop/src/main.ts:1408` 仍调用 `setAsDefaultProtocolClient('dsh')`，`:1411` 的 `open-url` 只匹配 `dsh://open`，`apps/desktop/src/single-instance.ts:24` 的 `second-instance` 监听签名是无参回调、不解析 URL。效果是任何 `lcoder://` 地址只能拉起或聚焦窗口，不按路径路由。第二，**文档仍在按已支持描述**：`docs/desktop-release.md:59-60`（中文配对同号）写「唯一支持的深链接是 `lcoder://open`……未知路径同样只聚焦主窗口」，`:248` 的接触面表写「把 `open-url` 路由到单实例处理器」，`:307` 的 T-78 验收写「能路由 `lcoder://open`」；这三处与代码不符。根 README 已在 T-84 改成「路由未实现」，但权威文档没跟上。第三，产物本身、安装后的身份、`%APPDATA%\LCoder` 数据目录与真实 COS 上传都没有验证，台账与看板都承认。

**结论**：部分实现；其中「`lcoder://` 深链接按路径路由」单列为**未实现**。**已证**（三处代码行与三处文档行都比对过）；安装态、产物名、数据目录、COS 上传**未证**。

## 3. 第一问的横向发现：PRD 自身与看板的滞后

这一节不重复第 2 节的主题结论，只记「拿 PRD 或看板当基线时会把读者带偏」的地方。它们大多不是代码错，而是文档停在旧快照上。

### 3.1 PRD 内部有四处自相矛盾或滞后

1. **工具数三处不同**：第 55 行写十二个，第 79 行写十个，实际十七个（见 2.2）。同一份文档的正文与验收段就已经对不上，说明后续每加一个工具都没回头改验收。
2. **MVP 边界与自己描述的能力冲突**：第 75 行把「工作台推进任务状态」列为明确不做，并把状态说成「手写在 YAML 里」；但第 46 行说 `verifying` 状态下模型可以用 `task_close` 收口，第 55 行也把 `task_close` 列进模型工具，代码在 `tools/task-tools.ts:193` 真的会写 `closed`。同一段还写「多工作区与权限模型」不在 MVP，可项目切换、多角色天花板与任务认领都已实现。读这一行会低估产品实际能力。
3. **产品示例的描述与仓库不符**：PRD 第 106 行写「DEMO-01 在起草态、还没有契约」；实际 `.spec/contracts/DEMO-01.contract.yaml` 存在且已入库，只是 `sig` 为空，[`.spec/README.md`](../.spec/README.md) 也明写「示例契约……`sig` 为空，等人在任务详情里签署」。PRD 与产品示例自带的说明互相打脸。
4. **数据面决策 D1 只对一半成立**：第 59 行与第 88 行说工作台「不自建 Remote、不用 typert 生成器」。`.spec` 数据面确实仍走上游 `workspaceFiles` 投影（`workspace/src/client/projection.ts:7`），但云端面是标准 Typert Remote——`workspace/src/client/cloud/remote.generated.ts:1-5` 的头部就写着「Generated by @deepseek-ai/dsh-typert-generator」，宿主在 `workspace/src/client/index.ts:233` 用 `$mount` 挂载。决策没有更新，读者会以为全仓只有一种数据通道。

### 3.2 看板 `active-context.md` 的风险段整体过期

[`docs/active-context.md`](active-context.md) 第 37 至 48 行「Risks and technical debt」有七条与当前代码相反，逐条核对如下：

| 看板原文（行号） | 当前事实 | 证据 |
|---|---|---|
| 第 37 行：契约签署通道未实现，P3 要靠手写 YAML | 人机命令 `/contract_sign` 已实现并写哈希签名 | `commands/contract-sign.ts:92-103` |
| 第 40 行：`file_read`/`file_edit` 仍以规格根为边界 | 已改为仓库根，规格根只管 `.spec` | `plugin.ts:104-105`、`:145` |
| 第 41 行：桌面 profile 仍链旧 `WorkBuddy/LCoder` 包 | 全仓检索 `WorkBuddy` 零命中 | `lcoder/desktop-profile.patch.yml` 无该项 |
| 第 45 行：桌面「打开仓库」永不返回（T-12） | T-12 已收口，另有 T-17 的超时与可区分文案 | 台账 T-12、T-17 均为 done |
| 第 46 行：kernel 在桌面 profile 装载两次，日志打印十工具行两遍 | 桌面 profile 只在九个 preset 内各挂一份；自检行打印 17 个工具与 9 条命令 | `plugin.ts:165-190`、`desktop-profile.patch.yml` 九处 preset |
| 第 47 行：`DEMO-01.contract.yaml` 未入库 | 已入库 | `git ls-files .spec` 含该文件 |
| 第 43 行：浮层只渲染最终文本，没有流式 | 已有流式增量、贴底跟随、Markdown 与审批/提问弹窗；工具卡片仍没有 | `shell/shell-data.ts` 的 `live-chunk` 折叠、`Shell.module.css:706` |

另外，第 9 行「注册十个工具加 `/contract_sign`」与第 18 行的当前焦点（只列到 T-83、把 `lcoder://` 写成「待验」）也都过期：当前已收口到 T-87，而 `lcoder://` 已由 T-78 的补核改判「未实现」。看板是开发进度的单源，这一段属于「当前窗口没维护」，不是历史归档。

### 3.3 十条关键决策的现状核对

| 决策 | 现状 | 判定 |
|---|---|---|
| D1 文件投影、不自建 Remote | `.spec` 面成立，云端面用 Typert Remote | 部分 |
| D2 独立补丁层挂载，不改上游清单 | `lcoder/cordis.patch.yml` 与 `desktop-profile.patch.yml` 承担全部装配 | 一致 |
| D3 工具面 fail-closed | 按状态白名单加角色天花板求交，漏配即不可见 | 一致 |
| D4 签署不做成模型工具 | 四条人工命令都不在任何角色表里 | 一致 |
| D5 产品数据与开发台账分离 | `.spec` 与 `docs/tasks.yaml` 各自独立，看板只从台账生成 | 一致 |
| D6 单轨治理、单一看板 | 看板仍是单文件（云与桌面两线写在同一个「当前焦点」里） | 一致 |
| D7 工具面是「状态 × 角色」 | `allowedTools()` 求交，`dev` 角色表由测试钉死等于全量 | 一致 |
| D8 任务归属由 `.spec` 认领 | `task_bind` 写入、会话号取宿主事实、失效回落 | 一致 |
| D9 一仓 N 会话、深度 1 | 多会话与角色委派在；委派深度上限沿用上游默认，本次未验证是否真的拒绝孙代 | 未证 |
| D10 AI 自签三闸 | 判定在 `sign-gate.ts`，P3 与 `/task_contract` 都复核；但没有执行方 | 部分 |

## 4. 六条已核实线索的复核

工单给的六条线索全部自行复核过，没有直接采信。结论是：两条在当前快照上仍然成立，一条只成立一半，三条已被修复或改好；另有一处行号需要更正。

### 4.1 线索一：协议路由未实现，文档曾写成已支持 —— 成立

**复核动作**：顺着打包层与应用层各读一遍，再对文档做全文检索。

**证据**：`apps/desktop/scripts/desktop-product-identity.mjs:55-63` 里 LCoder 身份的 `protocolScheme` 是 `lcoder`；`apps/desktop/scripts/electron-builder-config.mjs:115` 把它写进安装包的 `protocols` 字段。应用层三处仍是上游口径：`apps/desktop/src/main.ts:1408` 调用 `setAsDefaultProtocolClient('dsh')`，`:1411` 的 `open-url` 判断只认 `dsh://open` 与 `dsh://open/`，`apps/desktop/src/single-instance.ts:24` 的 `second-instance` 监听是一个无参回调，拿不到命令行里的 URL。行为上，`lcoder://` 只会拉起应用或聚焦已有窗口，路径被忽略。

**行号更正**：监督窗口给的是「约 1409 行 open-url 只匹配」，实际 `open-url` 注册在 1410 行、匹配判断在 1411 行；结论不变。

**文档残留**（这是比代码更值得修的部分）：`docs/desktop-release.md` 与中文配对 `desktop-release.zh.md` 的第 59-60 行仍写「唯一支持的深链接是 `lcoder://open`；它聚焦主窗口，应用没有窗口时创建主窗口。未知路径同样只聚焦主窗口」，`:248` 的 macOS 接触面表写「把 `open-url` 路由到单实例处理器」，`:307` 的 T-78 验收写「能路由 `lcoder://open`」。根 README 第 47 行已经改成「应用侧协议路由未实现」，三处权威文档没跟上。

**证据级别**：已证（代码三处、文档三处逐行比对）。

### 4.2 线索二：看板写十个工具、PRD 与代码写十二个 —— 只成立一半

**复核动作**：数实际注册的工具与命令，逐个文件点名字。

**证据**：`docs/active-context.md:9` 确实写「注册十个工具加 `/contract_sign`」；PRD 第 55 行写十二个，第 79 行又写十个。但「代码为十二个」不成立——实际是 **17** 个模型工具（见 2.2 的逐文件清单），`dev` 角色表在 `kernel/surface.ts:144-162` 正好这 17 个，`tests/surface.spec.ts:157` 用 `expect([...ROLE_TOOLS.dev].sort()).toEqual(allToolNames())` 钉住。命令是 **9** 条。另外 `plugin.ts:7` 的模块注释写「十三个工具」，也不对。

**结论**：线索的「文档之间数字不一致」成立；「prd 与代码为十二」这一半不成立，代码已经超出 PRD 两轮。

**证据级别**：已证（读码计数；`test:docs` 与 vitest 都跑过，改数字不会影响行为）。

### 4.3 线索三：主线自 2026-11-05 起有 `command-management` 的 win32 两例红 —— 已修复，无残留

**复核动作**：直接跑那个测试文件。

**证据**：`node_modules/.bin/vitest run apps/desktop/tests/command-management.spec.ts` 输出 `Test Files 1 passed (1)`、`Tests 6 passed (6)`，退出 0。台账 T-78 的收口行记录了根因：「那次品牌改名只改了期望 JSON 没同步 spec 输入夹具」，修复提交的标题是「fix(lcoder): 同步夹具并补齐固定下载目录」。

**边界**：只跑了这一个文件；`apps/desktop` 全量在本机有已知环境失败（缺 `vswhere`、`tar` 不认 C 盘符），本次没有全量跑，所以「整个桌面测试面全绿」**未证**。

**证据级别**：当前无残留已证；历史红只有台账文字，**未证**。

### 4.4 线索四：T-83 上一实现线报 typecheck 全过，实际红五错 —— 当前已绿，误报属实

**复核动作**：跑 `pnpm run typecheck`，并读修复提交的文件清单。

**证据**：`run-gates: 5 passed, 0 failed, 0 skipped in 9.18s`，退出 0。修复提交只改了两个测试文件：`packages/lcoder/kernel/tests/cloud-api.spec.ts` 改两行、`tests/cloud-tokens.spec.ts` 加一行，`src` 零改动。这与台账 T-83 写的「五个错全在 T-83 自己的两个测试文件里，原因是新增的 usage 方法没进测试替身、fetch 替身类型不对」对得上。台账已经把上一线的「全过」结论改成「不成立」，看板第 18 行也记了这一条。

**结论**：上一线的回报是误报，台账已更正，当前类型检查是绿的。**历史那五个错**只能从台账转述，本次无法复现（提交已修），属未证；**当前绿**是已证。

### 4.5 线索五：根 README 长期是上游内容 —— 已改写，且改法正确

**复核动作**：读当前 README 与它的提交历史。

**证据**：根 `README.md` 现在 70 行，首行是 `# LCoder`，第 5 行给出 LCoder 的一句话定位，第 9 行起写与上游的关系与基线 `0.2.2-alpha.2`。提交历史里能看到「docs(lcoder): 根 README 改写为 LCoder 身份」这一条，之前是上游的 Discord 邀请、dev:web、BibTeX 等改动。关键在于改法：第 47 行没有把深链接写成已支持，而是明写「安装包会注册 `lcoder` 方案，但应用侧协议路由未实现……只匹配上游的 `dsh://open`」，与 4.1 的代码事实一致。

**残留**：T-84 的台账自己记了一处语义残差——上游 `docs/user` 正文仍按 Web UI 口径写启动步骤，而 README 的 `run` 锚点已指向桌面启动。这属于未改范围，不是新漂移。

**证据级别**：已证（读文件与提交历史）。

### 4.6 线索六：主检出桌面实例长期运行早于合入的旧包 —— 当前仍在发生

**复核动作**：查进程与启动参数、比对产物时间、在产物里搜 T-83 的文案。

**证据**：主进程 PID 22100 的启动时间是 2026-11-07 15:09:50，命令行带 `--user-data-dir=E:\Projects\LCoder\apps\desktop\.desktop-build\development\electron-user-data`，确认是主检出的开发实例。它加载的 `packages/lcoder/workspace/lib/client.js` 修改时间是 15:08:52，`packages/lcoder/kernel/lib/index.js` 是 15:08:45；而 T-83 的合入在当晚 21 点之后（台账写 21:20 合入）。产物里搜「个人中心」命中 0 次，源码 `locales.ts` 命中 2 次；搜 `tokenEstimate` 同样为 0。也就是说这个窗口看不到个人中心，它跑的是 T-83 合入之前的包。

**影响**：这期间任何在主窗口里做的目视验收，验的都是旧包。旁证是 T-72 的台账也踩过同类问题（「当前运行的是旧工作树产物，需按层重建 workspace 再刷新」）。

**结论**：不是历史事件，是当前状态。**已证**（进程启动时间、产物时间、产物内文案三路证据）。本次没有停这个实例，也没有起新实例。

## 5. 第二问：台账状态与代码事实

### 5.1 范围与方法

台账共 85 条任务。本问逐条核了 47 条：T-56 及其后的全部 32 条，加上当前仍为 `doing` 的 15 条早期任务（T-24、T-25、T-33 至 T-37、T-39、T-40、T-42 至 T-47）。其余 38 条按工单归为已归档：其中 35 条 `done`、3 条 `todo`（T-11、T-18、T-28）。归档部分没有逐条核，但抽查了五条承重能力，结果都在主线上：契约签署（T-20/T-21，`commands/contract-sign.ts`）、签署后推进（T-29，`commands/task-contract.ts`）、立项入口幂等（T-49/T-54，`workspace/src/client/onboarding.ts:37` 的 `onboardingAction`）、依赖与环检测（T-50，`kernel/task-store.ts:141`、`:156`）、跨工作副本硬闸（T-55，`workspace/src/client/scheduling.ts:123` 的 `sameWorkspace`）。抽查只能说明这五条没有丢，不能替代全量复核。

每条的判定方法固定三步：第一，看台账 `note` 声称交付了什么；第二，在主线里找对应文件/函数/测试，找不到才算「未实现」；第三，看状态与验收证据是否对得上。`done` 的定义按台账自己的口径是「门禁全绿并收口」，`doing` 按台账的实际用法更像「实现完成、等人验收」——这条定义与看板列的用法不一致，本身就是第 5.4 节要说的漂移。

### 5.2 T-56 至 T-87 逐条

| 任务 | 状态 | 台账声称的产物 | 主线事实（证据） | 判定 |
|---|---|---|---|---|
| T-56 | done | 流程引擎纯函数与事实装配 | `kernel/flow.ts`、`kernel/flow-store.ts` 在主线，动作集与九种动作一致；执行器未接是台账与 PRD 都写明的遗留 | 一致 |
| T-57 | done | 策略 schema、加载器与 `.spec/automation.yaml` | `kernel/automation.ts:54`、`schema/spec.ts:256-266` 在；但 `.spec/automation.yaml` 从未入库（`git log` 对该路径零提交） | 部分 |
| T-58 | done | 三闸判定与 P3 复核 | `kernel/sign-gate.ts:33-39`、`checkers/index.ts:125-140` 在；`selfSignContract` 无生产调用方，台账与 PRD 都写明 | 一致 |
| T-59 | done | 开工入口、流程面板、两条命令 | `commands/flow-status.ts`、`commands/flow-log.ts` 在；`flow.jsonl` 写盘在 `flow-log.ts:118` | 一致 |
| T-60 | done | 两个常驻会话、单例解析、写回命令 | `commands/agent-bind.ts`、`client/singleton.ts:54-93`、九个 preset 在；`agents.yaml` 缺省即未绑定，属正常 | 一致 |
| T-61 | done | 九个 preset 的压缩阈值与浮层可见性 | `desktop-profile.patch.yml` 有 9 处 `thresholdRatio`；但「真正跑到阈值触发压缩」至今没有补验记录 | 部分 |
| T-62 | done | 两档立项咒语与模板单测 | `shell/shell-data.ts` 的 `buildIntakePrompt`/`buildOnboardingPrompt` 在，`tests/intake.client.spec.ts` 在 | 一致 |
| T-63 | done | 提问走选择框 | `desktop-profile.patch.yml` 有 9 处 `tool-ask-user`；真窗口触发仍无记录 | 一致 |
| T-64 | done | 牛头标三张 PNG、三张 SVG、托盘 ICO | `apps/desktop/resources/icon.svg`、`tray-windows.ico` 等在，`render-tray-icon` 管线有测试 | 一致 |
| T-65 | done | 首屏默认关闭 | `apps/desktop/src/main.ts:74` 的 `WELCOME_ENABLED` 默认 false；重启目视未补记 | 一致 |
| T-66 | done | 模型 chip、分组面板与纯函数层 | `shell/chat-composer.ts`、`shell/ChatExtras.tsx` 在，`tests/chat-composer.client.spec.ts` 在 | 一致 |
| T-67 | done | 图片/文件上传与失败保留 | `index.ts:287` 的 `fileUploads.upload`、`chat-composer.ts:269-380` 在 | 一致 |
| T-68 | done | 上游同步体检脚本 | `lcoder/scripts/upstream-sync-check.ps1` 与 `.cmd` 入库 | 一致 |
| T-69 | done | 按层重建脚本 | `lcoder/scripts/rebuild.ps1` 与 `.cmd` 入库 | 一致 |
| T-70 | done | 流式折叠、贴底跟随、隐形滚动条 | `shell/shell-data.ts` 处理 `live-chunk`；真窗口一整轮未验 | 一致 |
| T-71 | done | 遮罩对齐标题区 | `Shell.module.css:706` 的 `inset: 0` 与 `z-index` 分层在 | 一致 |
| T-72 | done | 立项咒语不进正文 | `shell-data.ts:410` 的 `isBuiltinIntakePrompt` 与 `hidden` 标记在 | 一致 |
| T-73 | done | 详情三处裁剪 | 已合入主线，`tests/shell-detail.client.spec.tsx` 四条用例，证据归档 `docs/evidence-archive/t73` | 一致 |
| T-74 | done | 立项结果页与重新开始 | `shell/IntakeResultPage.tsx` 在，证据归档 `docs/evidence-archive/t74` 九张 | 一致 |
| T-75 | done | 云端设计包（独立仓） | `E:\Projects\LCoder-cloud` 的 `main` 上有 `docs/` 设计包与 `db/`；本地仓无远端 | 一致 |
| T-76 | done | 云端接入与登录门禁 | `kernel/src/cloud/*`、`cloud/gate.ts`、`cloud-login` 用例在；真实云端未联调 | 一致 |
| T-77 | done | 发布事实源文档 | `docs/desktop-release.md` 与中文配对在 | 一致 |
| T-78 | done | 身份、协议、COS 路径、版本 | 身份与打包层在（见 2.10）；但深链接路由后知未实现，验收项与文档未同步 | 部分 |
| T-79 | todo | 版本与更新界面 | `workspace` 源码搜不到 `currentVersion`/更新状态机，确未做 | 一致 |
| T-80 | todo | macOS 专属适配与 unsigned 打包 | 上游已有平台分支与 `package:mac:*:unsigned` 脚本；LCoder 专属适配与真机验收未做 | 一致 |
| T-81 | todo | COS/CDN 发布回滚 | 只有身份里的路径常量，上传适配未做 | 一致 |
| T-82 | todo | 两端签名与公证 | 无证书、无签名脚本改动 | 一致 |
| T-83 | done | 个人中心与 token 预估 | `cloud/PersonalCenter.tsx`、`cloud/estimate.ts` 在；台账称 32 张截图，仓内无归档 | 部分 |
| T-84 | done | 根 README 与中文配对 | 两份各 70 行，身份与深链接口径正确 | 一致 |
| T-85 | done | 单文件 HTML 报告 | 1256 行、161887 字节、18 个二级标题、65 个三级标题、外链与图片均 0 | 一致 |
| T-86 | doing | 本报告 | 正在写 | 一致 |
| T-87 | done | 冒烟入口与三个探针 | `lcoder/scripts/smoke.cmd`、`smoke.mjs`、`smoke-cdp.mjs`、`smoke-env.mjs`、`smoke-rpc.mjs` 入库 | 一致 |

统计：32 条中一致 28、部分实现 4（T-57、T-61、T-78、T-83）、未实现 0、超出范围 0。

### 5.3 仍在 `doing` 的 15 条早期任务

这 15 条的共同形态是：实现已经合入主线，台账的 `note` 也写着「待重启后目视」「未验：桌面真窗口」，但状态没有收。它们不是「在做」，而是「做完了等人看」。

| 任务 | 代码事实 | 台账自述的未验项 | 判定 |
|---|---|---|---|
| T-24 卡片对话状态 | `client/task-session.ts:68` 认领、`:85` 六态折取；`Shell.tsx:562`、`:1019` 在用 | 「在跑」「失败」两态取不到 | 部分（状态滞后） |
| T-25 多角色与委派 | `surface.ts:136-179` 九角色、`desktop-profile.patch.yml` 九 preset | 委派深度上限未实测 | 部分 |
| T-33 复用上游渲染 | Markdown、折叠思考、审批/提问回传都在；工具卡片仍无 | 真窗口手点 | 部分（范围也未全做） |
| T-34 去首屏账户 | `desktop-profile.patch.yml:475` 禁用 `ui-settings-account` | 重启目视 | 部分 |
| T-35 界面现代化 | `Shell.module.css` 视觉 token 与 `frame:false` 自绘栏在 | 用户点头与深浅两套复核 | 部分 |
| T-36 品牌去上游 | `apps/desktop/src/locale.ts` 95 处 LCoder、`:479` 禁用 `ui-brand-official` | 重启目视 | 部分 |
| T-37 咒语技能引用 | `shell-data.ts:302` 的 `TASK_FLOW_MENTION_PREFIX`，发送不带、复制才补 | C 级，无目视必要 | 部分（状态滞后最明显） |
| T-39 OS 图标 | 三 SVG、三 PNG、托盘 ICO 在（随后被 T-64 换图） | 任务栏与托盘目视 | 部分 |
| T-40 看板筛选搜索 | `client/task-filter.ts` 与四条单测在 | 重启目视 | 部分 |
| T-42 方案落盘 | `tools/proposal-tools.ts`、`commands/proposal-approve.ts`、`kernel/proposal-store.ts` 在 | 真窗口 | 部分 |
| T-43 Git 工具 | `tools/git-tools.ts` 三工具、`git` 角色在 | 真窗口 | 部分 |
| T-44 运维与部署 | `commands/deploy.ts`（只收 `exec: human`，`:82`）、`kernel/env-store.ts` 在 | 真窗口 | 部分 |
| T-45 写入硬闸 | `tools/edit-tools.ts:133-145` 与两条单测在 | 桌面手点 | 部分 |
| T-46 专家面板 | `client/experts.ts` 与面板在 | 真窗口 | 部分 |
| T-47 等待要叫人 | `task-card-visual.ts`、`ipc.ts:44` 的 `windowAttention`、`main.ts:1168` 在 | 真窗口 | 部分 |

统计：15 条全部是「实现已在主线、状态仍是 doing」。加上 5.2 的 4 条，第二问 47 条的结论是：**一致 28、部分实现 19、未实现 0、超出范围 0**。

### 5.4 三类重点漂移的结论

**(1) `done` 但未合入主线：0 条。** 这 32 条里有 27 条 `done`，产物都能在主线上指到。有分支可查的（T-73、T-74、T-76 等）用 `git merge-base --is-ancestor` 复核过，分支都已并入 `lcoder/main`；T-75 的产物在独立仓的 `main` 上。没有发现「在分支上自称收口、主线没有」的情况。

**(2) `doing` 但无提交：严格意义 0 条，反向问题 15 条。** 没有哪条 `doing` 任务是完全没动手的；相反，15 条的代码都已经合入主线。最刺眼的是 T-37 与 T-40：用任务号检索全部提交，命中数为 **0**，但它们的代码（`TASK_FLOW_MENTION_PREFIX`、`task-filter.ts`）就在当前主线上，说明它们是搭在别的任务的合并里进来的，台账既没有自己的落地提交，也没有收口记录。

**(3) 标注「未验」却无记录：至少 8 处。** 这里的「无记录」指既没有后续补验条目，也没有可复看的证据文件，台账里那句「未验」从写下那天起就没有下文。清单：T-61（压缩触发）、T-63（选择框真窗口）、T-65（首屏重启）、T-70（一整轮流式）、T-76（签署/批准/批量/模型服务四项门禁只有单测）、T-78（安装态四项）、T-83（真实云端与真人点击）、T-87（主检出未复跑，但这条它自己写清了原因）。反过来，T-58、T-60、T-73、T-74 是正面样板：它们把「没验什么」写得足够具体，T-73/T-74 还把截图归档进仓，后来的人能自己复核。

**证据留存的制度缺口**：`docs/evidence-archive` 目前只有 `t73`（4 张）与 `t74`（9 张）两套。T-83 声称 32 张正片、T-76 声称 10 张、T-10 的 7 问立项实跑会话日志，这些都不在仓内；工作树一删，证据就只剩台账里的一句话。这与「每条结论都要能复核」的产品主张不一致，也是本报告里大量「未证」的直接原因。

## 6. 优先级清单与未验项

### 6.1 必须修（会把下一条线或验收带偏）

1. **深链接的口径先统一**。`docs/desktop-release.md:59-60`、`:248`、`:307` 三处把 `lcoder://open` 写成已支持，代码却只认 `dsh://open`。两条路选一条：要么把这三处改成「安装包注册方案、应用层未路由」，要么补应用层实现（读 `open-url` 与第二实例的命令行，按 `identity.protocolScheme` 判定）。建议先改文档、实现单立任务，因为文档现在会让验收人直接判错。
2. **重写看板的风险段**。`docs/active-context.md` 第 37 至 47 行的七条风险已经与代码相反（见 3.2），第 9 行的工具数也过期。看板自述是「当前进度单源」，现在它比 PRD 更容易误导，例如「契约签署通道未实现」会让新线重复造一遍。
3. **把工具与命令的数字收敛到一处**。PRD 第 55 行（十二）、第 79 行（十）、看板第 9 行（十）、`plugin.ts:7` 注释（十三）这四套文档数字，与实际（17 个工具、9 条命令）打架。建议 PRD 不再逐个数，改成「以 `kernel/surface.ts` 的角色表为准」，只在需要时列出四条人工命令的红线。
4. **给 `doing` 一个可区分的意思**。15 条已合入主线的实现还挂在 `doing`，看板因此把「已经交付、只差人看」和「正在做」画成同一种状态。要么逐条补验收口，要么在台账约定里加一档（例如 `review` 或 `verify`），让状态与事实一一对应。
5. **把验收证据变成可复核的资产**。至少给 T-83（32 张）、T-76（10 张）补归档到 `docs/evidence-archive/<任务>/`，或在台账固定写明「证据不随仓留存，位置在哪」。第 5.4 节的 8 处「未验却无记录」，根因都是证据随工作树一起删了。

### 6.2 可以接受（有代价，但不影响正确性）

- **PRD 不覆盖云端、个人中心、更新源、多角色、附件、Git/运维角色**。PRD 事实上已冻结在 MVP-0，后续能力由 [`docs/desktop-release.md`](desktop-release.md) 与台账承载。建议在 PRD 开头加一句「本文是 MVP-0 基线；后续能力见台账与 desktop-release」，不必重写全篇。
- **AI 自签没有执行方**。用户 2026-11-06 的决定是「允许在三闸下自签」，授权不等于必须今天接线；P3 已经在拦非法自签，`/task_contract` 也会复核。把执行器留给流程接线任务即可，但不要再写成「已支持」。
- **云端不可用时产品退化为「只能立项」**。这是 fail-closed 的极端形态，行为可解释但值得写进风险清单（`cloud/gate.ts:45`）。
- **`.spec` 里没有 `automation.yaml` 与 `agents.yaml`**。缺文件即「全手动」「未绑定」，这是 schema 规定的合法状态，不是缺件；但 T-57 台账说「新增该文件」，与仓库不符，按 6.3 处理。
- **`git`、`ops`、`pm` 等角色超出 MVP 边界**。它们由 T-42 至 T-45 逐条拍板过，属授权的范围扩张。

### 6.3 只是文档滞后（改字或补一句即可）

- `docs/desktop-release.md` 第 59-60、248、307 行：深链接写成已支持。
- PRD 第 55 行（十二个工具）、第 79 行（十个工具）、第 75 行（工作台不推进状态）、第 106 行（DEMO-01 无契约）。
- `docs/active-context.md` 第 9 行（十个工具）与第 37 至 47 行（七条假风险）。
- `packages/lcoder/kernel/src/plugin.ts:7` 的注释「十三个工具」。
- `lcoder/desktop-profile.patch.yml` 第 58 行注释「四个 preset」，实际是九个。
- `.spec/README.md` 与 PRD 对 DEMO-01 契约的描述互斥，二者择一。
- `.spec/automation.yaml` 的入库状态：要么补示例文件，要么把 T-57 台账那句「新增产品数据文件」改成「提供加载器，示例仓未放」。

### 6.4 需要代码或环境动作，不能只改字

- 深链接路由：代码（若选实现路线）。
- 主检出旧包实例：环境动作。当前实例 PID 22100 起于 15:09:50，加载的是 15:08 的产物，缺 T-83 之后的全部改动；任何目视验收前都要按层重建并重启，否则验的是旧包（线索六）。
- 证据归档：流程动作，最好在任务收口模板里加一行「证据归档路径」。

### 6.5 建议顺序

先做 6.1 的第 1 项（深链接口径）、第 3 项（工具与命令数字收敛）与第 2 项（看板风险段），三处都是纯文档，一小时量级，能立刻消除「按文档验收会判错」的最大风险；第 4、5 项需要人工盘点，排在下一轮；6.2 的 PRD 免责句可以和第 3 项一起做。

## 7. 门禁数字与未验项

### 7.1 门禁

本节数字在写完正文后实跑，明细见下：

- `pnpm run typecheck`：5 passed / 0 failed，退出 0。
- `node_modules/.bin/vitest run packages/lcoder`：58 文件 / 590 用例，全过，退出 0。
- `node_modules/.bin/vitest run apps/desktop/tests/command-management.spec.ts`：6 用例全过，退出 0。
- `pnpm run test:docs`：21 项，见 7.2。

### 7.2 文档门禁的 21 项

第一次跑 `pnpm run test:docs` 的结果是 `19 passed, 2 failed`，两项失败如下，处理后复跑全绿：

- **markdown wrap**：本文件第 3 行的引用块被当成跨行段落。改成三个独立引用段（中间加 `>` 空行）后通过。
- **translation pairing**：新增的 `docs/audit-2026-11-07-drift.md` 落在 `docs/` 扫描范围内，门禁要求补齐中文/英文配对与 `.i18n.yaml` 记录。本报告是中文单语的一次性审计件，按 `docs/AGENTS.md` 的同类先例（英文单语文档列入排除清单）在 `scripts/translation-pairing.manifest.json` 的 `excluded` 里加了一行。这是唯一一处超出「只新增一个文件」的改动，理由是不改清单就只能伪造一份翻译配对；没有删除任何内容来绕门禁。

复跑数字：`run-gates: 21 passed, 0 failed, 0 skipped`，退出 **0**（修完两项后连续三次复跑均为此结果，单次 17 秒上下）。21 项逐项为：Session format references、agent note classification、agent note format、archived agent notes、concrete terms、doc budgets、doc refs、documentation standard tests、markdown links、markdown wrap、npm dependency catalog、package README Summaries、package README limitations、package README model experience、public repository links、repository references、skill invocation metadata、translation pairing、translation prompt、type equivalence、upgrade guides。

### 7.3 未验项

- 真实模型回合下的一切行为：状态迁移、压缩触发、选择框、流式输出、附件投递。隔离约束下本次没有使用模型钥匙，也没有起实例，所以这些只有台账转述。
- 桌面真窗口的目视验收：深浅主题、遮罩几何、托盘与任务栏图标、首屏关闭。全部只有台账转述。
- 安装态：产物名、EXE 与开始菜单身份、`%APPDATA%\LCoder` 数据目录、`lcoder://` 冷热启动。需要真安装，与隔离红线冲突。
- 真实云端：登录、短信、令牌轮换、额度与预估数值。独立仓的分支未合入、未联调。
- `apps/desktop` 全量测试面：本机有已知环境失败，本次只跑了线索三那一个文件。
- D9 的委派深度：没有验证孙代是否真的被拒。
- 监督窗口在审计期间仍在提交，本报告的行号以文首「结论快照」那一段为准；若之后有人改了对应文件，行号可能偏移，结论需要按新快照复核。
