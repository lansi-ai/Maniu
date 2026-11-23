# LCoder（慢牛 Maniu）现有产品设计全景报告（As-Is 现状基线）

状态：现状基线报告（2026-11-21），基于仓库已落地的真实代码、`@maniu/kernel` 状态机、`@maniu/client` 界面与 `@maniu/desktop` 桌面壳事实整理。

## 1. 产品要做什么（现有定位与核心命题）

- **产品定位**：基于 `.spec` 规格库驱动的桌面端 AI 软件开发工作台（Windows / macOS）。
- **试图解决的核心问题**：克服纯聊天式 AI 编程工具（普通 Chat / 单对话框 Agent）「聊久了失忆、随意破坏既有代码、缺乏持久架构记忆、AI 自己给自己放行」的工程缺陷。
- **现有核心设计思路**：把软件工程的「立项 → 需求评审 → 定稿确认 → 任务拆分 → 契约签署 → 编码实施 → 证据校验收口 → 需求上线」做成一套由内核（`@maniu/kernel`）强约束的状态机；所有产品事实落盘在目标仓库的 `.spec/` 目录下，客户端界面（`@maniu/client`）只读投影，写操作全部通过受控模型工具或人机命令（`/command`）完成。

## 2. 现有产品是怎么做的（核心资产、角色与全流程）

### 2.1 四层核心资产（`.spec/` 目录结构）

| 层级 | 文件路径 | 核心职责与约束 |
| --- | --- | --- |
| 项目与环境事实 | `.spec/project.yaml`<br>`.spec/env.yaml`<br>`.spec/roles.yaml`<br>`.spec/flow.yaml`<br>`.spec/automation.yaml` | 登记项目名称、文档路径与技术轨（Tracks）；登记允许执行的命令与环境；定义自定义岗位名册；配置四节点（`intake / review / revise / split`）岗位与自动衔接开关；配置自动签署等策略开关。 |
| 需求、提案与原型 | `.spec/requirements/REQ-xx.yaml`<br>`.spec/requirements/REQ-xx.md`<br>`.spec/requirements/REQ-xx/versions/v<n>.md`<br>`.spec/requirements/REQ-xx/reviews/R<n>.md`<br>`.spec/proposals/P-xx.yaml`<br>`.spec/prototypes/REQ-xx/index.html` | 需求状态机为 `draft`（草稿）→ `confirmed`（已确认）→ `released`（已上线）/ `closed`（已关闭）；保存历次版本快照与评审报告（带 `pending / accepted / rejected` 裁决态）；保存新建/改稿提案；保存可选的需求级 HTML 原型与参考图 `refs/`。 |
| 规格规则层 | `.spec/spec/rules.yaml` | 提炼业务规则条目，绑定代码落点路径与状态（无来源或无代码绑定的条目不得转为 `confirmed`）。 |
| 任务、契约与证据 | `.spec/tasks/T-xx.yaml`<br>`.spec/contracts/T-xx.contract.yaml`<br>`.spec/evidence/T-xx/*.log`<br>`.spec/deliverables/T-xx.yaml` | 任务状态机为 `drafting` → `contracted` → `implementing` → `verifying` → `closed`（外加 `blocked / cancelled`）；契约锁死允许修改的文件路径 `allowed_paths`、验收命令、不可逆项 `irreversible` 及签名复合哈希；收口依赖实跑日志证据与交付物索引。 |

### 2.2 现有 12 个内置角色（Talent Presets）与工具面隔离

系统通过 `SURFACE[任务状态] ∩ ROLE_TOOLS[角色]` 严格裁剪每个 AI 会话可见的模型工具，并将高权限裁决保留为**人机命令（模型不可调用）**：

1. **需求与原型侧角色**：
   - `maniu-intake`（需求分析师）：最多 7 问选择题访谈立项、起草需求（`requirement_draft`）、按评审报告改稿升版（`requirement_revise`）、提新建需求提案（`requirement_propose`）。
   - `maniu-requirement-editor`（需求修改）：仅针对未锁定的草稿需求生成原地修改提案（`requirement_patch_propose`），由人在界面对比后点「应用修改」落盘，不升版本号。
   - `maniu-pm`（项目经理）：对草稿需求出具结构化 Markdown 评审报告（`requirement_review_draft`）。
   - `maniu-prototype`（原型设计师）：结合参考图与宿主预取的网页样式摘要，生成或按选中 DOM 元素局部修改单文件 HTML 原型（`prototype_draft` / `prototype_patch`）。
2. **研发、质量与管控侧角色**：
   - `maniu-manager`（研发经理）：把已确认需求按技术轨（`h5 / admin / api / desktop / host / general`）拆分为任务（`task_draft`）并产出岗位分配建议（`requirement_split_plan`）。
   - `maniu-architect`（架构师）：起草规格条目、绑定代码落点与起草任务契约（`spec_bind`、`contract_draft`）。
   - `maniu`（实施开发）：在契约签署后，受 `Task.scope.allowed_paths` 硬件门禁约束修改代码（`file_edit`）、运行已登记命令（`cmd_run`）、附加证据（`evidence_attach`）与登记交付物（`deliverable_draft`）。
   - `maniu-review`（代码评审）：只读复核代码与证据，调用 `task_close`（触发 P1/P3/P4 与交付物四道检查器）。
   - `maniu-git`（本地提交，无 `git push`）、`maniu-ops`（运维脚本）、`maniu-scheduler`（智能调度建议）、`maniu-flow`（流程控制诊断）。

### 2.3 现有端到端操作流程（单向线性流）

1. **打开项目**：在「项目」页点击「新建项目」按钮，通过系统原生目录选择器选中本地仓库并切换工作区。
2. **立项或新建需求**：
   - 空仓库在「需求」页点「从想法开始」居中 Modal 弹窗，选择「全新项目 / 已有资料」并输入一句话想法，AI 后台发起最多 7 问的访谈（提问归并到右下角单张任务浮卡，点「回答」弹出带会话上下文的答题窗），确认概要后落盘 `REQ-01（草稿 v1）`。
   - 非空仓库点「+ 新建需求」填写描述，后台生成提案，人工在对比视图点批准后落盘新需求草稿。
3. **草稿修改与评审定稿循环**：
   - **未送审前（未锁定）**：可在需求详情弹窗点「修改需求」，右侧同屏展开修改说明栏 → AI 生成 `patch` 提案 → 用户查看差异并点「应用修改」原地更新当前草稿（不增加版本号）。
   - **发起评审（送审即锁定）**：点「发起评审」后当前版本锁定；项目经理产出 `R1` 评审报告；详情页通过独立文档 Tab 栏切换到「评审报告 R1」，以单行紧凑表格展示待改项（支持点击行展开问题说明与修改建议）；用户逐条选择「采纳 / 拒绝 / 有疑问」并提交 → AI 先解答疑问再按采纳项生成 `v2` 新版本（成为新的未锁定草稿），或用户点「整轮放弃」。
   - **确认需求**：当至少有一轮评审、无未决评审轮次、且 `flow.yaml` 要求的评审岗位配齐后，用户点「确认需求」（`/requirement_approve`），需求转为 `confirmed`（已确认）。
4. **需求原型生成与交互预览（可选）**：
   - 在需求详情「需求原型」区上传参考图或填入参考网页 URL 提取样式摘要，后台调用 `maniu-prototype` 生成单文件 HTML 原型并做自动质量与关键词命中率校验；
   - 支持打开**独立沙箱预览窗口**进行真实交互，并在预览窗中点选 DOM 元素上报回主窗，输入修改指令由 AI 执行元素级 `prototype_patch`。
5. **任务拆分与岗位指派**：
   - 已确认需求点「拆分任务」，研发经理拆出 `drafting` 任务并给出岗位建议；用户在详情表格中逐条点「确认岗位」（`/task_assign`）。
6. **任务签约、开发与收口**：
   - 在「任务」页（6 列看板：`待签约 / 待开发 / 开发中 / 验证中 / 已完成 / 阻塞或取消`），经契约签署（`/contract_sign` + `/task_contract` 或 `/task_split_ready`）进入 `contracted`；
   - 认领会话（`/task_bind`）推进至 `implementing` 写代码、挂测试证据，进入 `verifying` 后由评审调用 `task_close` 通过四道检查器收口。
7. **需求上线与后续演进**：
   - 所有关联任务收口后，点「上线」（`/requirement_release`）转为 `released`。
   - 已确认或已上线的需求不可再原地修改，只能点「基于此版本新建」派生一条新需求 `REQ-02` 重新走评审与拆任务流程。

## 3. 现有产品做成了什么样（当前成果与核心痛点诊断）

### 3.1 已建成的护城河（必须保留的资产）
- **视觉与壳层体验**：已完成 HeroUI Glass 风格统一（左侧 100% 上下贯穿导航栏 + 右侧顶栏与双层毛玻璃主画布、高对比反色胶囊主按钮、全胶囊筛选控件、右下角任务进度与待回答提问合一浮卡）。
- **内核安全防线**：`.spec` 单一数据源、模型与人机命令物理隔离、`allowed_paths` 文件写门禁、AI 自签三重补偿闸门（`sign-gate.ts`）、收口四道检查器（P1/P3/P4 + 交付物），从根源上防止了 AI 失控乱改。

### 3.2 现有流程在真实开发场景下的 5 个核心瓶颈
1. **单向瀑布流焊死，缺乏「大小变更分级通道」**：
   - 需求一旦点「确认需求」进入开发阶段，原需求就被完全锁死。开发中途发现**「某个表单漏了一个字段」（小改）**和**「想加入桌面版」（大改）**在界面上只有同一个「基于此版本新建」重型入口——为了一个字段生出一条新需求 `REQ-02` 再评一遍太重，不改文档直接改代码又会导致 `.spec` 需求文档过期变成废纸。
2. **「先长文、后画面」违背普通用户直觉**：
   - 原型区目前放在需求详情底部当可选附属品。不懂技术的小白在看到界面原型前，面对几千字的需求文档和几十条评审意见根本无法判断对错；往往等需求锁定甚至开发出来看到画面，才发现不是自己想要的。
3. **工程过程术语直接裸露给普通用户**：
   - 任务页把 `drafting / contracted / implementing / verifying`、签署契约、认领任务、绑定规格、P1/P3/P4 等内部治理概念全摆在台面上，小白用户进入任务页后不知道该点哪个按钮推进。
4. **验收环节缺乏「一键实窗试玩 + 指哪打回」**：
   - 任务验证侧重看日志文件（`.log`）和工程文档路径，普通用户无法一键把做好的软件跑起来亲手试玩，也无法在试玩不满意时一句话直接打回重修。
5. **文档、原型与代码之间缺少「反向自动同步」**：
   - 需求 → 原型 → 任务 → 代码目前是单向派生的；开发或原型微调过程中产生的局部变更不会自动回写需求现行本，长期迭代后容易出现“代码是 v1.5，需求文档还停在 v1.0”的脱节。
