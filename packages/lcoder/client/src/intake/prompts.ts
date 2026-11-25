/** 立项、需求新建与改稿、评审、拆分的提示词模板；正文由模型执行，界面只负责发送。 */

/** 立项概要确认指令：人设约定用户回复「确认需求」后才落盘；浮卡确认按钮原样发送。 */
export const INTAKE_CONFIRM_PROMPT = '确认需求'

/** 统一 6 段式 Spec-Driven PRD 标准与 3 条正文红线；供立项、新建、评审、改稿、补丁、增量与里程碑提示词共用。 */
export const REQUIREMENT_PRD_STANDARD = `统一 6 段式 Spec-Driven PRD 标准（每条需求正文固定包含以下 6 个二级章节，按顺序组织）：
1. ## 背景与目标：写清业务痛点、业务目标与可衡量效果。
2. ## 适用角色与范围边界：写清目标角色、交付颗粒度定位（如轻量可用版 / 完整生产级）、本期包含（In Scope）、本期不做（Non-Goals，把容易被评审追问但本期不做的边缘项写清楚）与关联约束。
3. ## 核心用户流程：写清 1–3 条端到端主流程，服务原型设计与研发对齐。
4. ## 功能与业务规则：写清字段与数据口径，并使用 EARS 触发-响应句式表述规则：「当 <触发> 时，系统应 <响应>」或「在 <状态> 下，系统应 <约束>」。
5. ## 权限、空态与异常边界：写清数据可见性与操作权限、空态/临界态表现，以及失败/防重/非法输入兜底。
6. ## 验收标准：使用带编号 \`AC-1\`、\`AC-2\`… 的二元可测条件，句式为「当…且…时，应…」。

3 条正文红线（必须严格遵守）：
- 正文纯净：严禁把「评审意见回应表」「本轮修改了什么」等过程流水写进需求正文。
- 零模糊词：禁止出现“合理提示、适当限制、优雅处理”等不可测试表述。
- What ≠ How：聚焦可观测业务行为与口径，不写具体代码实现或数据库 DDL。

排版规则（正文可读性，必须遵守）：
- 一条一行：并列内容用无序列表分条，不用顿号、分号串成长句。
- 范围边界三段：本期包含 / 本期不做 / 关联约束各用粗体小标题加分条，每条约 40 字以内。
- 核心用户流程：每条主流程一个三级标题，步骤用有序列表，每步一句话。
- 功能与业务规则：每条 EARS 规则单独一条列表；字段多时用表格（字段 / 含义 / 取值与限制）。
- 权限、空态与异常：按「场景 → 表现」分条列出。
- 验收标准：每条 \`AC-n\` 单独一行。
- 每章节开头最多一句概述，其余内容进入列表。
- 排版只调整组织方式，不改变业务含义，也不放宽上面的红线。`

/** 立项项目事实。 */
export interface IntakeProject {
  readonly name: string
  readonly path: string
  readonly branch: string
  readonly docs: { readonly product: string; readonly architecture: string; readonly tests: string }
}

/** 立项档位。 */
export type IntakeMode = 'fresh' | 'onboarding'

/**
 * 生成立项提示词。
 *
 * 访谈纪律（七问、需求概要、确认后落盘顺序、失败口径与边界）只由
 * `maniu-intake` 人设承载；这里只给项目事实与第 0 步的读法，避免两处口径漂移。
 * @param project - 当前项目。
 * @param mode - 全新项目或已有资料。
 * @param idea - 用户在向导里填的项目初步想法；仅全新项目档且非空时附到提示词。
 * @returns 可直接发送的提示词。
 */
export function buildIntakePrompt(project: IntakeProject, mode: IntakeMode, idea?: string): string {
  const head = mode === 'fresh' ? '全新项目立项：' : '已有资料立项：'
  const facts = `${project.name}（${project.path}，${project.branch}）`
  if (mode === 'fresh') {
    const trimmedIdea = idea?.trim() ?? ''
    const ideaNote = trimmedIdea === ''
      ? ''
      : `用户已说明的项目初步想法（第 1 问已答）："""
${trimmedIdea}
"""
第 1 问"你想做一个什么软件"视为已答，跳过第 1 问：不要盲猜，也不要按仓库目录名猜软件类别；直接从第 2 问（主要给谁使用）及后续的核心功能、必须遵守的规则、验收标准开始，生成贴合该业务的选项逐题追问；用户描述里已经明确的信息跳过不重问。

`
    return `${head}${facts}

${ideaNote}第 0 步 先看清仓库：
- 用 file_list 看根目录与 .spec 是否存在，用 file_read 读实际存在的说明文档；不猜路径，不把不存在的文件说成已存在。
- 能自己查到的技术信息（目录、仓库名、分支、现有文档）自己查，不要问不懂技术的用户。
- 仓库是空的、没有远端、没有文档或测试，都不中止访谈：缺的项标「尚未提供」。

需求成文与落盘口径：
${REQUIREMENT_PRD_STANDARD}`
  }
  const declared = [
    { label: '产品文档', path: project.docs.product },
    { label: '架构文档', path: project.docs.architecture },
    { label: '测试用例', path: project.docs.tests },
  ].filter(entry => entry.path !== '')
  const sources = declared.length === 0
    ? '- 文档来源：.spec/project.yaml 没有声明交付文档；先用 file_list 看仓库里有没有文档，再向用户确认产品文档在哪，不要猜路径。'
    : declared.map(entry => `- ${entry.label}：${entry.path}`).join('\n')
  return `${head}${facts}

第 0 步 先读资料，再来问：
- 用 file_list 看清结构，用 file_read 逐个读下面的文档与关键代码入口；路径必须是实际读到的，不要猜。
${sources}
- 先列出「从仓库已确认的事实」：项目类型、技术栈、目录结构、已完成的功能线索；这些不要再拿去问用户。
- 只问文档回答不了的：业务目标、第一版范围、验收口径、约束与待确认项。
- 需要确认文档位置时，用 ask_user_question 把 file_list 实际列出的候选做成选项，不要让人手打路径。

需求成文与落盘口径：
${REQUIREMENT_PRD_STANDARD}`
}

/**
 * 生成多岗立项的接续提示词：首岗之后的岗位从自己的视角复核并补齐立项结论。
 * @param project - 项目名与路径。
 * @returns 可直接发送给接续岗位会话的提示词。
 */
export function buildIntakeFollowupPrompt(project: { readonly name: string; readonly path: string }): string {
  return `需求调研接续：项目「${project.name}」（${project.path}）的立项调研已由前一岗位完成首轮。

执行身份：你是本项目立项流程的接续岗位，从自己的专业视角复核立项结论。
- 先用 file_read 读 .spec/requirements 下已登记的需求与 .spec/project.yaml，弄清前一岗位已经确认了什么。
- 补齐你这一岗看到的缺口：范围、验收口径、约束与风险；需要向用户确认时用 ask_user_question 一次问一个问题。
- 确有新的独立需求时用 requirement_draft 登记成起草态需求；不重复登记已有需求，不改已有需求正文。
- 只读查看仓库事实，不改代码、不跑命令、不签契约、不推进任何状态。
- 完成后回报你补了什么、登记了哪条需求，然后停下。`
}

/** 内置轨的提示词显示文本；项目追加轨在调用处补上。 */
export const BUILTIN_SPLIT_TRACKS: readonly string[] = [
  'h5（H5 前端）',
  'admin（管理端）',
  'api（接口）',
  'desktop（桌面端）',
  'host（宿主端）',
  'general（通用）',
]

function bodyOf(document: string): string {
  return document.trim() === '' ? '（读不到需求正文；请先读取 .spec/requirements 下的同名文档）' : document.trim()
}

/**
 * 生成需求拆分提示词。
 * @param requirement - 需求编号与标题。
 * @param document - 需求正文。
 * @param tracks - 可用轨的显示文本。
 * @returns 可直接发送给项目经理会话的提示词。
 */
export function buildSplitPrompt(
  requirement: { readonly id: string; readonly title: string },
  document: string,
  tracks: readonly string[],
): string {
  const body = bodyOf(document)
  return `需求拆分：请把需求 ${requirement.id}（${requirement.title}）拆分成可执行的开发任务，写入 .spec/tasks。

依据：以末尾附上的《项目需求概要》（.spec/requirements/${requirement.id}.md）为唯一范围依据；文档里暂不开发的范围不要拆成任务。

执行身份：你是这条需求的项目经理，负责把已确认的需求拆成开发任务。
- 用户已在界面上确认需求并亲自点击「拆分任务」，这就是明确的拆分授权；不要重复追问。
- 只产出 .spec/tasks 下的任务文件，state 一律 drafting；只做只读查看，不开始实现，不调用编辑与命令工具。
- 不改需求文档、.spec/project.yaml、已有方案与规格条目，不推进任何任务状态。
- 拆完只回报新建任务的编号、标题、轨与依赖，然后停下；岗位分配给实施阶段的人。

要求：
- 每条任务对应一个可独立验收的业务结果，不按纯技术步骤堆叠。
- 写清 description（范围与验收标准）、grade、rules、depends_on、scope.allowed_paths 与 track，并写 requirement: ${requirement.id}。
- 每条任务必须标一条轨，只能取：${tracks.join('、')}。
- 空仓时第一条任务必须是「项目基础框架与脚手架」，所有功能任务在 depends_on 里依赖它；已有可运行框架只补实际缺口。
- 完成后列出新建任务的编号、标题、轨与依赖关系。

《项目需求概要》正文：
"""
${body}
"""`
}

/**
 * 生成架构师技术方案提示词（生成任务流程第 1 棒）。
 *
 * 先扫描现有代码与已有方案；若存在未明确的关键技术选型（语言、框架、数据库等），
 * 必须通过 `ask_user_question` 询问用户确认后再用 `proposal_draft` 落盘，不擅自拍板。
 * @param requirement - 需求编号与标题。
 * @param document - 需求正文。
 * @param existingProposals - 已有方案摘要，避免重复定调。
 * @returns 可直接发送给架构师会话的提示词。
 */
export function buildArchitectPlanPrompt(
  requirement: { readonly id: string; readonly title: string },
  document: string,
  existingProposals: readonly { readonly id: string; readonly title: string; readonly recommendation?: string }[] = [],
): string {
  const body = bodyOf(document)
  const existingBlock = existingProposals.length === 0
    ? '（当前尚无已登记的技术方案）'
    : existingProposals
      .slice(-5)
      .map(item => `- ${item.id} ${item.title}${item.recommendation !== undefined ? `：${item.recommendation}` : ''}`)
      .join('\n')

  return `技术方案设计：请为已定稿需求 ${requirement.id}（${requirement.title}）制定可落地的技术方案，供后续研发经理拆解开发任务。

执行身份：你是项目架构师（只做调研、询问选型并出技术方案，不建任务、不改业务代码、不跑命令）。

第一步，摸清现状：
- 先用 file_list / file_read 查看当前仓库是否已有应用源代码与依赖配置（如 package.json、pyproject.toml、go.mod、pom.xml 等）；注意 \`.spec/prototypes/\` 下的 HTML 只是设计预览原型，**绝不能**当成项目正式代码技术栈（不要因此直接定为 H5 静态页）。
- 如果 \`.spec/prototypes/__project__/index.html\` 或 \`.spec/prototypes/${requirement.id}/index.html\` 存在，请顺带读取它以了解页面结构与交互视图：**原型不决定技术选型，但开发出来的页面布局、交互与视觉样式必须与原型严格保持一致**，请在技术方案中明确前端页面需严格对齐该原型。

第二步，不确定时必须询问用户（严禁擅自拍板）：
- 如果当前需求或项目属于新搭建/新模块，且现有仓库与需求文档均未明确以下关键决策之一：
  1. 编程语言与运行时（如 TypeScript/Node.js、Python、Go、Java 等）；
  2. 前后端框架或 UI 方案；
  3. 数据库与持久化存储选型（如 PostgreSQL、MySQL、SQLite、Redis、本地文件等）；
  4. 其它影响全局架构的重要分叉（如鉴权方式、部署形态、跨端通信协议）；
- 请务必先调用 \`ask_user_question\` 向用户确认！每个问题提供 2~4 个具体可选方案并标注推荐项与简要取舍，等用户选完后再继续，绝对不要自己直接拍板定死。
- 若仓库已有明确技术栈且需求未引入新技术分叉，可直接沿用现有技术栈并在方案中说明，无需打扰用户。

第三步，落盘技术方案（proposal_draft）：
- 技术选型明确后，调用 \`proposal_draft\` 将方案写入 \`.spec/proposals/\`：
  - title 以 \`[${requirement.id}] \` 开头，概括本需求的技术方案主题；
  - problem 写清需要解决的技术问题、约束与兼容基线；
  - option_names / option_summaries / option_costs 给出方案细节（包含技术栈、模块/目录划分、核心数据模型与字段、关键接口约定）；
  - recommendation 明确最终确定的技术方案与各端落点约定，供研发经理拆任务时直接对齐。
- 方案落盘后即可结束，不要调用 \`task_draft\`（任务拆解由下一棒研发经理接手）。

【已有方案参考】
${existingBlock}

【需求正文（${requirement.id}）】
"""
${body}
"""`
}

/**
 * 生成需求拆分提示词（研发经理）。
 *
 * 拆分与岗位建议都由研发经理做：先按技术维度用 `task_draft` 建任务，
 * 再用 `requirement_split_plan` 写逐条建议；分配仍等人确认后走 `/task_assign`。
 * @param requirement - 需求编号与标题。
 * @param document - 需求正文。
 * @param tracks - 可用轨的显示文本。
 * @param technicalPlan - 可选技术方案摘要（来自上一棒架构师）。
 * @returns 可直接发送给研发经理会话的提示词。
 */
export function buildManagerSplitPrompt(
  requirement: { readonly id: string; readonly title: string },
  document: string,
  tracks: readonly string[],
  technicalPlan?: { readonly id: string; readonly title: string; readonly recommendation?: string },
): string {
  const body = bodyOf(document)
  const planBlock = technicalPlan === undefined
    ? ''
    : `\n\n【架构技术方案基线（请严格对齐）】\n方案编号：${technicalPlan.id}（${technicalPlan.title}）\n${technicalPlan.recommendation !== undefined ? `选型与约定：${technicalPlan.recommendation}\n` : ''}请先用 spec_query / file_read 读取 .spec/proposals/${technicalPlan.id}.yaml 中的技术栈、目录落点与接口约定，再据此拆出一致的开发任务（可在 task_draft 的 proposal 字段填写 ${technicalPlan.id}）。`
  return `需求拆分：请把需求 ${requirement.id}（${requirement.title}）拆分成可执行的开发任务，并逐条给出岗位建议。

依据：以末尾附上的《项目需求概要》（.spec/requirements/${requirement.id}.md）为唯一范围依据；文档里暂不开发的范围不要拆成任务。${planBlock}

执行身份：你是这条需求的研发经理，负责按技术维度拆分任务，并判断每条任务该由什么岗位来做。
- 用户已在界面上确认需求并亲自点击「拆分任务」，这就是明确的拆分授权；不要重复追问。
- 不改需求文档、.spec/project.yaml、已有方案与规格条目，不开始实现，不调用编辑与命令工具。

第一步，建任务：
- 若 \`.spec/prototypes/__project__/index.html\` 或 \`.spec/prototypes/${requirement.id}/index.html\` 存在，先读取确认界面结构，作为划分界面任务模块的依据。
- 按业务与模块维度用 task_draft 建任务，state 一律 drafting。
- **任务描述写法（简洁人话，留在「待确认」供人审核）**：
  - description 先用 1~2 段简洁易懂的人话，说清「这条任务要做成什么业务功能、完成后用户能看到什么效果」；**严禁在正文里写「按 P-03 方案 A」这类内部编号黑话**（方案编号只填在 proposal 字段中）。
  - 概述后追加 \`## 详细设计\` 二级标题。详细设计回答「系统怎么运转」，读者是产品、业务与评审；**严禁出现文件路径、函数名或类名、接口地址、数据库表字段、技术栈与命令**，这些留给确认推进时再补的 \`## 技术实施细节\`。
  - 详细设计按小标题 + 列表组织，依次写：
    - 业务流程：有序列表，把先后顺序与分支写清；
    - 系统规则：每条写成「当…时，系统应…」，写清状态、数值与校验；数字写明，禁止「合理」「适当」等模糊措辞；
    - 空态与异常：没数据、权限不足、重复操作、中途失败时用户各看到什么；
    - 用户能看到的结果（可选，最多 3 条）；
    - 本任务不做：明确排除项，避免范围蔓延。
  - 限长：每个小标题最多 8 条，每条约 60 字以内，整段详细设计约 800 字以内；写不下就提示「建议拆成更小的任务」，不要硬塞；同一规则不要重复。
  - 在「待确认」阶段**不需要**提前写底层实现步骤、具体函数名或代码规范（这些在确认推进「待开发」时再结合最新仓库代码精准生成）。
- 每条任务写 description、grade、rules、depends_on、scope.allowed_paths、track 与 requirement: ${requirement.id}。
- 每条任务必须标一条轨，只能取：${tracks.join('、')}。
- 空仓时第一条任务必须是「项目基础框架与脚手架」，所有功能任务在 depends_on 里依赖它；已有可运行框架只补实际缺口。

第二步，准备项目成员并写岗位建议：
- 先检查 .spec/roles.yaml 是否已有覆盖各任务所需技术栈的项目成员；若有缺口，**必须先调用 role_draft 为本项目创建需要的中文成员**（name 必须按「岗位-姓名」格式，如「前端工程师-林夕」「接口工程师-陈默」「测试工程师-苏晴」，填写 inherits、persona 提示词与 derived_from 派生来源——从系统内置人才如「实施」「架构」「项目经理」「评审」中选择对应来源，无对应来源时填「新建项目人才」；persona 只写该成员在项目中的职责分工、技术栈与通用工程规范，不要把某一条具体需求或任务内容写死进成员提示词），确保办公室里的每个人都有真实名字且中文可见。
- 任务建完后调用 requirement_split_plan：参数 id 为 ${requirement.id}，tasks 逐条给 task（刚建的任务编号）、role（优先取刚创建或已有的 .spec/roles.yaml 成员 id）与 reason（一句技术理由）。
- 计划写到 .spec/requirements/${requirement.id}/split-plan.yaml，覆盖上一份计划。
- 只给建议：不分配岗位、不改任务状态；分配由人在界面上逐条确认后执行 /task_assign，不要假称已分配。

完成后列出每条任务的编号、标题、轨、依赖与建议岗位，然后停下。

《项目需求概要》正文：
"""
${body}
"""`
}

/**
 * 构造「修改待确认任务」提示词：让研发经理按人输入的意见原地更新 drafting 任务。
 * @param task - 当前任务信息。
 * @param instruction - 人的修改意见。
 * @param technicalPlan - 可选全局技术方案参考。
 * @returns 发给 maniu-manager 的提示词。
 */
export function buildTaskModifyPrompt(
  task: {
    readonly id: string
    readonly title: string
    readonly grade: string
    readonly description: string
    readonly track?: string | undefined
    readonly proposal?: string | undefined
    readonly requirement?: string | undefined
    readonly dependsOn: readonly string[]
    readonly paths: readonly string[]
  },
  instruction: string,
  technicalPlan?: { readonly id: string; readonly title: string; readonly recommendation?: string | undefined },
): string {
  const planLine = technicalPlan === undefined
    ? ''
    : `\n全局技术方案参考：${technicalPlan.id}（${technicalPlan.title}）${technicalPlan.recommendation !== undefined ? ` — ${technicalPlan.recommendation}` : ''}`
  return `修改待确认任务：请根据用户反馈原地更新任务 ${task.id}（${task.title}），不要新建另一条任务。

【用户修改意见】
${instruction.trim()}${planLine}

【当前任务信息】
- 编号：${task.id}
- 当前标题：${task.title}
- 分级：${task.grade}
- 所属端：${task.track ?? '未指定'}
- 依赖前置：${task.dependsOn.length === 0 ? '无' : task.dependsOn.join('、')}
- 允许路径：${task.paths.length === 0 ? '未限定' : task.paths.join('、')}
- 当前说明：
${task.description.trim()}

【执行要求】
1. 调用 \`task_draft\` 时必须传入 \`task_id: "${task.id}"\` 与 \`update_draft: true\`，原地更新该任务（严禁新开任务）。
2. description 保持简洁易懂的人话，不要出现「按 P-03 方案 A」这类内部编号黑话；已有 \`## 详细设计\` 必须保留，并按本次意见更新，不得删除或压缩。
3. 若涉及所属端、依赖前置或路径边界调整，一并在参数中更新。完成后简短汇报改了什么。`
}

/**
 * 构造「补写详细设计」提示词：给缺详细设计的待确认任务原地补上，不改状态与负责人。
 * @param task - 当前任务信息。
 * @param requirementText - 所属需求正文，作为业务范围依据；为空时只按任务标题与概述写。
 * @returns 发给 maniu-manager 的提示词。
 */
export function buildTaskDesignPrompt(
  task: {
    readonly id: string
    readonly title: string
    readonly grade: string
    readonly description: string
    readonly track?: string | undefined
    readonly proposal?: string | undefined
    readonly requirement?: string | undefined
    readonly dependsOn: readonly string[]
    readonly paths: readonly string[]
  },
  requirementText: string,
): string {
  const scoped = requirementText.trim()
  const requirementBlock = scoped === '' ? '（未提供需求正文，请只依据任务标题与当前说明）' : scoped
  return `补充详细设计：任务 ${task.id}（${task.title}）还在「待确认」，但缺少可评审的详细设计。请只补写 description，不新建任务、不改状态与负责人。

【所属需求正文（业务范围依据）】
"""
${requirementBlock}
"""

【当前任务信息】
- 编号：${task.id}
- 标题：${task.title}
- 分级：${task.grade}
- 所属端：${task.track ?? '未指定'}
- 当前说明：
${task.description.trim()}

【执行要求】
1. 调用 \`task_draft\` 时必须传入 \`task_id: "${task.id}"\` 与 \`update_draft: true\`，只更新 description。
2. 保留现有概述并放在最前面；在概述后追加 \`## 详细设计\`，按「业务流程 / 系统规则 / 空态与异常 / 本任务不做」组织，用户能看到的结果可选写。
3. 详细设计回答「系统怎么运转」，读者是产品、业务与评审；**严禁出现文件路径、函数名或类名、接口地址、数据库表字段、技术栈与命令**。
4. 每个小标题最多 8 条、每条约 60 字、整段约 800 字以内；写不下就说明「建议拆成更小的任务」，不要硬塞；同一规则不重复。
5. 不改任务状态、不改负责人、不写技术实施细节、不改业务代码，完成后简短汇报。`
}

/**
 * 构造「确认推进到待开发」时生成精确技术实施方案的提示词。
 * 保持大局观：同时注入全局技术方案、同需求全量任务清单与最新代码/原型检查要求。
 * @param task - 目标任务。
 * @param siblingTasks - 同需求下的所有任务（用于把握上下游衔接与边界）。
 * @param technicalPlan - 全局技术方案摘要。
 * @returns 发给 maniu-architect 的提示词。
 */
export function buildTaskImplementPlanPrompt(
  task: {
    readonly id: string
    readonly title: string
    readonly grade: string
    readonly description: string
    readonly track?: string | undefined
    readonly proposal?: string | undefined
    readonly requirement?: string | undefined
    readonly dependsOn: readonly string[]
    readonly paths: readonly string[]
  },
  siblingTasks: readonly {
    readonly id: string
    readonly title: string
    readonly state: string
    readonly dependsOn: readonly string[]
  }[],
  technicalPlan?: { readonly id: string; readonly title: string; readonly recommendation?: string | undefined },
): string {
  const siblingsBlock = siblingTasks.length === 0
    ? '（无其他关联任务）'
    : siblingTasks.map(item => `- ${item.id}（${item.state}）：${item.title}${item.dependsOn.length > 0 ? ` [依赖: ${item.dependsOn.join(', ')}]` : ''}`).join('\n')
  const planBlock = technicalPlan === undefined
    ? '（暂无显式全局方案编号，请先用 spec_query / file_list 核查项目技术基线）'
    : `方案 ${technicalPlan.id}（${technicalPlan.title}）：${technicalPlan.recommendation ?? '请用 spec_query 读取方案详情'}`

  return `补充开发实施方案：任务 ${task.id}（${task.title}）即将由人拍板进入「待开发」，请结合全局技术方案与当前仓库最新代码，为它补充精确、可直接指导开发的技术实施细节。

【全局技术方案（保持大局一致）】
${planBlock}

【同需求全量任务清单（把握上下游边界，不越界不重复）】
${siblingsBlock}

【当前任务（${task.id}）】
- 标题：${task.title}
- 分级：${task.grade}
- 所属端：${task.track ?? '未指定'}
- 依赖前置：${task.dependsOn.length === 0 ? '无' : task.dependsOn.join('、')}
- 当前人话目标：
${task.description.trim()}

【执行要求】
1. 先用 file_list / file_read 查看当前仓库最新代码与前序任务已落地的接口/目录结构；若有 \`.spec/prototypes/\` 原型文件且本任务涉及前端页面，务必读取并明确要求「页面布局、交互与视觉样式严格与对应原型保持一致」。
2. 调用 \`task_draft\` 时必须传入 \`task_id: "${task.id}"\` 与 \`update_draft: true\`，原地更新该任务：
   - **保留简洁易懂的人话目标与已有的 \`## 详细设计\`**（不要写「按 P-03 方案 A」等内部编号）；**不得覆盖、合并或改写详细设计**；若详细设计与本次技术实现不一致，以详细设计为准，并在回复里明确指出不一致点；
   - 在详细设计之后**追加** \`## 技术实施细节\` 二级标题，写清精确的文件落点（并更新 \`allowed_paths\`）、接口/数据字段约定、命令以及可验证的验收标准。
3. 只更新任务描述与范围，不要修改业务代码、不要跑命令、不要新建其他任务。`
}

/** 发起需求评审时的上下文：用于区分初评与复评回归，并注入历史已排除项。 */
export interface ReviewPromptContext {
  readonly completedRounds?: number | undefined
  readonly previousReport?: string | undefined
  readonly dismissedIssues?: readonly { readonly title: string; readonly reason: string }[] | undefined
}

/**
 * 生成需求评审提示词。
 *
 * 评审只出报告：报告由评审岗位（项目经理或研发经理）用 `requirement_review_draft` 落盘，
 * 正文与状态都不改，过审仍由人在界面上完成。
 * @param requirement - 需求编号与标题。
 * @param document - 当前需求正文。
 * @param context - 可选评审上下文（已评审轮次、上一轮报告路径、历史已排除项）。
 * @returns 可直接发送给评审岗位会话的提示词。
 */
export function buildReviewPrompt(
  requirement: { readonly id: string; readonly title: string },
  document: string,
  context?: ReviewPromptContext,
): string {
  const body = bodyOf(document)
  const completedRounds = context?.completedRounds ?? 0
  const isRegression = completedRounds >= 1
  const nextRound = completedRounds + 1
  const previousReport = context?.previousReport?.trim() ?? ''
  const previousReportNote = previousReport === ''
    ? '（未提供上一轮报告路径，请先读取 .spec/requirements 下最近一轮评审报告对照核验）'
    : `上一轮评审报告：.spec/${previousReport}（请先用 file_read 读取并对照逐条核验）`

  const reviewModeSection = isRegression
    ? `回归核验模式（第 R${nextRound} 轮复评）：
- ${previousReportNote}
- 本轮只做两件事：1) 逐条核验上一轮被采纳的待改项是否已在最新《需求正文》中落实；2) 检查本次改稿是否引入新的逻辑矛盾或破坏既有验收标准（AC）。
- 严禁重提上一轮已被拒绝/排除的问题，也严禁在复评阶段发明新的低价值吹毛求疵或扩写范围。`
    : `四个角度都要写到，不能合并或省略：
1. 文档完备性：对照统一 6 段式 PRD 标准的 6 大维度（背景与目标、适用角色与范围边界、核心用户流程、功能与业务规则、权限/空态与异常边界、验收标准）检查目标、范围、流程、规则、边界与例外是否写全，缺什么。
2. 合理性：目标与手段是否匹配，约束、代价与优先级是否成立，EARS 触发-响应规则是否自洽、无歧义。
3. 需求角度：用户价值、使用场景、与已有需求的冲突或重复，以及权限/空态/异常边界与 AC-1 验收标准是否二元可测。
4. 技术实现角度：可行性、影响面、数据与接口、依赖与风险，同时检查正文是否越界写入具体代码实现或数据库 DDL。`

  const dismissed = context?.dismissedIssues ?? []
  const dismissedSection = dismissed.length === 0
    ? ''
    : `
《已确认非本期 / 永久排除清单（严禁再次提出）》：
${dismissed.map((item, index) => `${String(index + 1)}. ${item.title}（排除原因：${item.reason}）`).join('\n')}
`

  return `需求评审：请对需求 ${requirement.id}（${requirement.title}）做一轮独立评审，把报告落盘。这一轮不改正文，也不签不批。

执行身份：你是这条需求的评审岗位，负责在需求确认前按你的岗位视角做独立评审。

边界锁定与防范围蔓延（严禁越界扩写）：
- 严禁把《需求正文》中「本期不做（Non-Goals）」明确列出的边缘项当作缺失或待改项提出。
- 严禁突破需求既定的初始边界与交付颗粒度定位（如把轻量可用版强行拔高为完整生产级，或追加未约定的外围功能）。
${dismissedSection}
${reviewModeSection}

对照标准与正文红线逐项核查：
${REQUIREMENT_PRD_STANDARD}
- 若正文出现缺失章节、未用 EARS 句式、缺少编号 AC-1 二元可测验收标准、混入「评审意见回应表」/修改流水、含模糊词（如“合理提示、适当限制、优雅处理”）或越界写代码/DDL，必须在 ## 待改项 中逐条指出位置与可执行修改建议。

收敛门槛与交互确认：
- 收敛门槛（无高优硬伤必给「可以确认」）：\`high\` 仅用于阻塞性缺陷、逻辑矛盾或不可测的验收标准（AC）；若无 \`high\` 级硬伤，\`conclusion\` 必须为 \`'可以确认'\`（整体已可交付时鼓励直接传 \`items: []\`）。
- 交互确认（ask_user_question）：在调用 \`requirement_review_draft\` 落盘前，若发现候选待改项，必须先用 \`ask_user_question\` 逐条或分批向用户确认每条候选问题「是否属于本期真实缺陷，还是非本期 / 刻意不做」：
  - 用户确认为本期问题的 → 写入 \`items\`。
  - 用户判定为非本期 / 刻意不做的 → 不得写入 \`items\`，改写入 \`dismissed\`（每条传 \`{ title, reason }\`），由内核自动记录到 \`REQ-xx.yaml\` 元数据中，不改需求正文。
  - 若没有任何候选待改项，跳过 \`ask_user_question\`，直接调用 \`requirement_review_draft\`（\`conclusion: '可以确认'\`，\`items: []\`）。

要求：
- 用 requirement_review_draft 落盘（工具会自动把结构化字段渲染成标准 Markdown 报告落盘），传入结构化参数：
  - id：${requirement.id}
  - summary：2–3 句整体判断与最关键的问题
  - conclusion：'可以确认' 或 '需要修改'
  - items：逐条待改项数组（没有待改项传 []），每条必须包含：
    - priority：'high' / 'medium' / 'low'
    - title：一句话核心问题（不带优先级前缀）
    - location：涉及章节与条款位置
    - problem：具体问题说明
    - suggestion：可执行修改建议
    - category（可选）：评审维度（文档完备性 / 合理性 / 需求角度 / 技术实现角度）
  - dismissed（可选）：经 ask_user_question 与用户确认属于「非本期 / 刻意不做」的排除项数组，每条包含 title 与 reason
- 控制篇幅：单轮待改项聚焦最关键的问题，一般不超过 10 条，合并同类项、不凑数；每条 problem 与 suggestion 各控制在 1–2 句内，避免单次工具调用过长导致流式中断。
- 只读查看需求正文与仓库事实；不改需求正文、不改状态、不签契约、不推进任务、不调用过审命令。
- 输出完停下，不自行改稿，也不自行过审。

《需求正文》：
"""
${body}
"""`
}

/**
 * 用户对逐条评审意见的裁决；由评审报告的紧凑表格逐条收集，随改稿指令传给 AI。
 *
 * 三数组都按报告里的条目文本记录：`accepted` 含用户补充改法时直接拼进条目文本，
 * `questioned` 的 `question` 是用户填写的疑问或指定改法。
 */
export interface ReviewDecisions {
  readonly accepted: readonly string[]
  readonly questioned: readonly { readonly item: string; readonly question: string }[]
  readonly rejected: readonly string[]
}

/** 把一组条目文本编号成清单；空组回退成一句「无」。 */
function decisionList(items: readonly string[]): string {
  return items.length === 0
    ? '无。'
    : items.map((item, index) => `${String(index + 1)}. ${item}`).join('\n')
}

/**
 * 生成需求改稿提示词：分析-文档-确认-落版四步，改稿直接写下一个版本。
 *
 * 基线是当前正文与最近评审报告；需求分析师用 `requirement_revise` 把完整新正文写成
 * 新版本，内核自动保留历史版本快照并把未决评审闭环，无需人再对比确认。
 * 传入 `decisions` 时，AI 只处理用户勾选采纳与有疑问的条目，被拒条目正文原样保留；
 * 有疑问时先逐条用 ask_user_question 解释并征询方案，等用户确认后才进入改稿。
 * @param requirement - 需求编号与标题。
 * @param document - 当前需求正文。
 * @param reviewReport - 最近一份评审报告相对 `.spec` 的路径。
 * @param baseVersion - 当前正文的版本号；旧需求没有版本表时按 1。
 * @param decisions - 可选的用户逐条裁决；不传时行为与旧版一致。
 * @returns 可直接发送给需求分析师会话的提示词。
 */
export function buildRevisePrompt(
  requirement: { readonly id: string; readonly title: string },
  document: string,
  reviewReport?: string,
  baseVersion = 1,
  decisions?: ReviewDecisions,
): string {
  const body = bodyOf(document)
  const report = reviewReport === undefined || reviewReport.trim() === ''
    ? '这条需求还没有评审报告：按正文自身的问题做必要修订，不要编造评审意见。'
    : `最近一份评审报告：.spec/${reviewReport.replace(/^\.?[\\/]/, '').replace(/^\.spec[\\/]/, '')}`
  const decisionBlock = decisions === undefined
    ? ''
    : `
【用户对逐条评审意见的裁决】
只处理下面列出的条目，不要自行重新解释或扩大范围；评审报告里未列出的意见不主动新增改动。
用户确认采纳的条目（含补充改法）：
${decisionList(decisions.accepted)}
用户明确拒绝、禁止修改的条目（这些条目的正文必须原样保留，一个字都不要改）：
${decisionList(decisions.rejected)}
用户有疑问的条目：
${decisions.questioned.length === 0
  ? '无。'
  : decisions.questioned.map((entry, index) => `${String(index + 1)}. 条目：${entry.item}\n   用户疑问：${entry.question}`).join('\n')}
`
  const questionStep = decisions !== undefined && decisions.questioned.length > 0
    ? `第零步（先于下面四步，必须最先做）：用 ask_user_question 针对上面每一条疑问逐一给出解释和可选方案，一次只问一条，选项至少覆盖「维持原样」「按评审建议改」「按用户指定改法改」；等用户确认是否修改以及怎么改之后，才进入下面的四步。用户未确认前不得调用 requirement_revise 落版。
`
    : ''
  return `需求改稿：请修订需求 ${requirement.id}（${requirement.title}）的正文，直接写入新版本 v${String(baseVersion + 1)}。

执行身份：你是这条需求的需求分析师。
${report}
基线：当前正文（附在末尾）与最近评审报告；当前正文版本号是 v${String(baseVersion)}。
${decisionBlock}
按四步走：
${questionStep}第一步，需求层分析：用 file_read 读评审报告，逐条处理其中的意见；结合当前正文分析与现有需求的冲突/重复、影响面大小，给出优先级建议。只做需求层分析，明确禁止代码层判断：不评估技术实现方案，不给代码结论。
第二步，按需求大小与统一 6 段式标准修订完整正文：小改动保留精炼表述，大改动补齐全部细节，但都必须严格维持 6 段式结构、EARS 触发-响应规则与编号 AC-1 验收标准；保留用户已确认的内容，修改被评审否定的部分，需要收缩范围时写明理由。**严禁在正文或正文末尾追加「评审意见回应表」「本轮修改了什么」或任何修改过程说明**，只输出干净、纯粹的完整需求正文；改动说明留待落版后在对话中向用户汇报。
第三步，用 ask_user_question 请用户确认文档方向，一次只问一个问题；用户确认后才进入下一步。
第四步，确认后调用 requirement_revise：id 为 ${requirement.id}，content 是完整新正文（不是差异片段）；内核会把正文记为下一个版本，自动保留历史快照并闭环未决评审。

${REQUIREMENT_PRD_STANDARD}

边界：
- 不调用 requirement_propose 出提案；改稿由 requirement_revise 直接落新版本，无需人再对比确认。
- 只处理这一条需求：不改状态、不签不批、不推进任务、不改其他需求、不写 .spec/project.yaml。
- 写完回报新版本号、改了哪些段落，以及哪些评审意见保留待议，然后停下。

《当前需求正文》：
"""
${body}
"""`
}

/**
 * 生成「修改当前草稿」提示词：严格按用户说明拟稿，只生成提案，不直接写正文、不要求版本号。
 *
 * 评审记录不决定这条流程是否可用，也不在这里处理；AI 只按用户给出的修改说明产出完整新正文，
 * 宿主把提案绑定到调用时实际读到的当前正文作为基线，应用仍由人点「应用修改」完成。
 * @param requirement - 需求编号与标题。
 * @param document - 当前草稿正文，作为唯一修改底稿。
 * @param note - 用户填写的修改说明；调用方已确认去空白后非空。
 * @returns 可直接发送给草稿修改会话的提示词。
 */
export function buildRequirementPatchPrompt(
  requirement: { readonly id: string; readonly title: string },
  document: string,
  note: string,
): string {
  const body = bodyOf(document)
  return `修改需求：请按用户说明修改需求 ${requirement.id}（${requirement.title}）的当前草稿正文，生成一份待确认的修改提案。

 执行身份：你是这条需求的草稿修改角色，只能生成修改提案，不能直接写需求正文。

 用户修改说明（本次改动的唯一范围）：
 """
 ${note.trim()}
 """

 要求：
 - 只按上面的说明改动：说明里没提的内容原样保留，不要自行找问题、不要扩大范围、不要重写你没被要求改的段落。
 - 按需要收缩或补充的地方，直接产出改好的**完整新正文**（不是差异片段），风格、标题层级与原文保持一致；新增或修改业务规则与验收口径时，严格遵循 6 段式结构、EARS 触发-响应句式与编号 AC-1 验收标准，遵守正文纯净（不写过程流水或回应表）、零模糊词、What ≠ How 三条红线。
 - 调用 requirement_patch_propose：target 为 ${requirement.id}，content 为完整新正文，analysis 写清这次改了什么与为什么。

${REQUIREMENT_PRD_STANDARD}
 - 基线由宿主绑定：不要给版本号、版本摘要或快照路径；本操作不生成新版本，也不覆盖历史版本。
 - 不直接写正文：不要调用 requirement_revise、requirement_draft、requirement_propose、file_edit 或任何写文件的工具；不改状态、不处置评审、不动其他需求与 .spec 文件。
 - 说明不清时用 ask_user_question 一次只问一个问题，确认后再产出提案。
 - 落盘后把提案编号、改了哪些段落讲给用户，并说明需人在界面点「应用修改」才会更新当前草稿，然后停下。

 《当前草稿正文》（唯一修改底稿）：
 """
 ${body}
 """`
}

/**
 * 生成新建需求提示词：分析-文档-确认-提案四步，只登记一条新需求，不做整项目立项。
 *
 * 用户描述随首条消息发出（可为空，空时先问用户）；需求分析师用 `requirement_propose`
 * （mode new）写待确认提案，人对比确认后需求本体才落盘。
 * @param description - 用户在抽屉里输入的需求描述；空白表示没有提供。
 * @param base - 依据的已确认需求与版本号；给出时提案必须带 target 与 base_version。
 * @returns 可直接发送给需求分析师会话的提示词。
 */
export function buildRequirementCreatePrompt(
  description: string,
  base?: { readonly id: string; readonly title: string; readonly version: number },
): string {
  const trimmed = description.trim()
  const userText = trimmed === ''
    ? '（用户没有提供描述：先用 ask_user_question 问用户想登记一条什么需求，一次只问一个问题。）'
    : trimmed
  const baseLine = base === undefined
    ? '- 若本需求基于某条已确认需求，用 target 与 base_version 记录依据（该需求编号与版本号）；确认态需求只能这样作为新需求的依据，不能改稿。'
    : `- 本需求基于已确认需求 ${base.id}（${base.title}）v${String(base.version)}：调用 requirement_propose 时 target 为 ${base.id}，base_version 为 ${String(base.version)}；确认态需求只能这样作为新需求的依据，不能改稿。`
  return `新建需求：请为本项目登记一条新需求，只登记这一条，不做整项目立项。

标题口径：需求标题（requirement_propose 的 title）用不超过 16 字的短业务短语，直接说要做什么（一句话业务目标，例：自营订单佣金改造），不用文档名；不要「让小团队在浏览器里维护…替代 Excel…」这种场景加手段长句；文档标题留在正文 H1。

用户描述：
"""
${userText}
"""

执行身份：你是本项目的需求分析师。按四步走：

第一步，需求层分析：
- 用 file_read 读 .spec/requirements 下已登记的需求，分析本需求与现有需求的冲突/重复、影响面大小，给出优先级建议。
- 只做需求层分析，明确禁止代码层判断：不读代码评估实现方式，不给技术实现结论。

第二步，按需求大小出文档：
- 小需求出短文档：每个章节精炼写 1–3 条即可。
- 大需求出完整文档：完整写清目标、背景、范围、流程、规则、边界与验收口径。
- 无论大小需求，正文必须固定包含以下 6 段式结构，并严格遵守 EARS 规则写法、编号 AC-1 验收标准与 3 条正文红线：
${REQUIREMENT_PRD_STANDARD}

第三步，用 ask_user_question 请用户确认文档方向，一次只问一个问题；用户确认后才进入下一步。

第四步，确认后调用 requirement_propose：mode 为 new，content 是完整新正文，analysis 是需求层分析结论。
${baseLine}
- 不调用 requirement_draft；需求本体由人在界面对比确认后才落盘。
- 不做整项目立项、不写 .spec/project.yaml、不动其他需求、不签契约、不推进任何状态。
- 写完提案回报提案编号与分析结论，然后停下。`
}

/** S 级轻量微调提示词的上下文可选项。 */
export interface RequirementAmendPromptOptions {
  /** 与目标需求关联且尚未收口的在途任务。 */
  readonly activeTasks?: readonly { readonly id: string; readonly title: string; readonly state: string }[]
  /** 可用交付轨的显示文本。 */
  readonly tracks?: readonly string[]
  /** 当前已累计的 S 级修补次数。 */
  readonly amendCount?: number
}

/**
 * 生成 S 级轻量微调提示词：指导 `maniu-intake` 调用 `requirement_amend` 并遵守运行时升级护栏。
 *
 * 允许在保持 `confirmed` 状态、不重走评审、不新建 `REQ-xx` 的前提下直接更新需求正文并追加 `[S级微调]`
 * 变更记录；若触及超 3 文件、不可逆变更、权限/schema 破坏性变更或新轨/跨端架构变更，必须遵循
 * `requirement_amend` 返回的 `escalateTo`（`M` 或 `L`）停止写盘并告知用户。
 * @param requirement - 已确认的目标需求编号与标题。
 * @param document - 当前需求正文。
 * @param description - 用户输入的一句话局部微调诉求。
 * @param options - 可选的在途任务、交付轨与已累计补丁数。
 * @returns 可直接发送给 `maniu-intake` 后台会话的提示词。
 */
export function buildRequirementAmendPrompt(
  requirement: { readonly id: string; readonly title: string },
  document: string,
  description: string,
  options?: RequirementAmendPromptOptions,
): string {
  const body = bodyOf(document)
  const trimmed = description.trim()
  const requestText = trimmed === ''
    ? '（用户尚未写明具体微调内容：先用 ask_user_question 询问要微调的字段、文案或细节，一次只问一个问题。）'
    : trimmed
  const activeTasks = options?.activeTasks ?? []
  const taskLine = activeTasks.length === 0
    ? '- 关联任务：当前没有在途任务。若本次微调需要代码落地，在完成需求修补后用 task_draft 新建一条 grade 为 C、state 为 drafting、requirement 为 ' + requirement.id + ' 的 C 级快修任务。'
    : `- 关联在途任务：${activeTasks.map(task => `${task.id}（${task.title}，${task.state}）`).join('、')}。若本次微调属于上述在途任务同一功能面，请在回报中明确建议关联到该在途任务；若已有任务与本次微调不匹配，用 task_draft 新建一条 grade 为 C、requirement 为 ${requirement.id} 的 C 级快修任务。`
  const tracksLine = options?.tracks !== undefined && options.tracks.length > 0
    ? `- 新建 C 级快修任务时 track 只能取：${options.tracks.join('、')}。`
    : ''
  const countLine = options?.amendCount !== undefined && options.amendCount >= 4
    ? `- 一致性提醒：该需求已累计 ${String(options.amendCount)} 次 S 级修补，本次若触发 needsConsistencyCheck: true，务必向用户提醒对正文与规格规则做轻量一致性核对。`
    : ''

  return `S 级轻量微调：请对已确认需求 ${requirement.id}（${requirement.title}）执行 S 级局部微调。

用户诉求：
"""
${requestText}
"""

执行身份：你是本项目的需求分析师（maniu-intake）。按以下规则执行：
1. 先用 file_read / task_read 确认需求正文与关联任务状态，明确本次只做局部微调。
2. 调用 requirement_amend：
   - id 为 ${requirement.id}，summary 用一句话概括本次微调，content 为更新后的完整 Markdown 正文（保留原有章节结构，不要删除既定业务规则）。
   - 必须如实填写范围与风险参数：affected_files（预计影响文件路径列表，最多 3 个）、irreversible（不可逆变更项，S 级必须为空）、new_track / architecture_change / schema_or_permission_change。
3. **严格遵守运行时升级护栏**：
   - 若你评估或 requirement_amend 工具返回 rejected: true 与 escalateTo（'M' 或 'L'）——例如预计触及超过 3 个文件、涉及不可逆变更、涉及核心权限或数据 schema 变更、或需要引入新轨/跨端架构变更——**必须立即停止写盘**，严禁强行以 S 级写入，直接把工具返回的 escalateTo 级别与拒绝原因清楚告知用户，建议改走 M 级增量修订或 L 级独立立项。
4. 保持需求状态为 confirmed，不重走评审，不新建 REQ-xx，不改动历史评审报告。
${taskLine}
${tracksLine}
${countLine}
5. 边界：不调用 file_edit、cmd_run，不签契约，不推进任务状态；完成后回报修改摘要、变更记录行与关联/新建任务结果，然后停下。

《当前需求正文》（${requirement.id}）：
"""
${body}
"""`
}

/**
 * 生成 M 级增量修订提示词：围绕差异章节起草增量修订提案，不推翻已完成的老任务。
 * @param requirement - 目标需求编号、标题与基线版本号。
 * @param document - 当前需求正文。
 * @param description - 用户输入的一句话功能扩充或规则变更诉求。
 * @returns 可直接发送给 `maniu-intake` 后台会话的提示词。
 */
export function buildRequirementDeltaPrompt(
  requirement: { readonly id: string; readonly title: string; readonly version?: number },
  document: string,
  description: string,
): string {
  const body = bodyOf(document)
  const baseVersion = requirement.version ?? 1
  const trimmed = description.trim()
  const requestText = trimmed === ''
    ? '（用户尚未写明具体变更内容：先用 ask_user_question 询问要扩充的功能或要调整的核心规则，一次只问一个问题。）'
    : trimmed

  return `M 级增量修订（Feature Delta）：请围绕需求 ${requirement.id}（${requirement.title}）v${String(baseVersion)} 起草一份增量修订提案。

用户诉求：
"""
${requestText}
"""

执行身份：你是本项目的需求分析师（maniu-intake）。按以下规则执行：
1. 增量修订原则：**只围绕本次差异章节起草修订提案**（对应 6 段式结构中的差异章节，写清新增/调整的业务规则、EARS 触发-响应约束、数据口径、权限/异常边界与编号 AC-1 增量验收标准），不要重写未涉及的既有章节，更**不要推翻或改动已完成的老任务与历史基线**。
2. 用 file_read / task_read 读清 ${requirement.id} 的现状与已拆任务，如有关键口径歧义，用 ask_user_question 一次只问一个问题确认后再落提案。
3. 确认方向后调用 requirement_propose：
   - mode 为 new，target 为 ${requirement.id}，base_version 为 ${String(baseVersion)}（记录所依据的基线版本）。
   - content 写清本次增量修订的完整提案正文（突出差异章节与增量范围，标注后续只需拆出 1–2 条 B 级增量任务），严格遵守正文纯净（严禁写入评审回应表或修改过程流水）、零模糊词、What ≠ How 三条红线。
   - analysis 写清影响面分析、与既有规则的兼容性及“保留老任务不动、仅拆增量任务”的建议。
4. 边界：不调用 requirement_amend、requirement_draft 或 file_edit，不推翻历史已完成任务，不写代码或签契约；提案落盘后回报提案编号与差异摘要，等待用户在界面对比确认（/proposal_approve）。

${REQUIREMENT_PRD_STANDARD}

《基线需求正文》（${requirement.id} v${String(baseVersion)}）：
"""
${body}
"""`
}

/** L 级独立里程碑立项提示词的可选项。 */
export interface RequirementMilestonePromptOptions {
  /** 若用户从某条需求页发起，可附带该需求作为参考依据。 */
  readonly base?: { readonly id: string; readonly title: string; readonly version: number }
  /** 当前项目已配置的交付轨显示文本。 */
  readonly tracks?: readonly string[]
  /** 建议的下一里程碑需求编号（如 REQ-02）。 */
  readonly nextRequirementId?: string
}

/**
 * 生成 L 级独立里程碑立项提示词：发起独立新需求提案（如 `REQ-02`），明确不打断当前在途开发。
 * @param description - 用户输入的一句话跨端/新轨/架构级扩展诉求。
 * @param options - 可选的参考需求、现有交付轨与下一个需求编号提示。
 * @returns 可直接发送给 `maniu-intake` 后台会话的提示词。
 */
export function buildRequirementMilestonePrompt(
  description: string,
  options?: RequirementMilestonePromptOptions,
): string {
  const trimmed = description.trim()
  const requestText = trimmed === ''
    ? '（用户尚未写明新模块/新端诉求：先用 ask_user_question 询问目标平台、新模块范围与核心场景，一次只问一个问题。）'
    : trimmed
  const nextId = options?.nextRequirementId ?? 'REQ-02'
  const tracksText = options?.tracks !== undefined && options.tracks.length > 0
    ? options.tracks.join('、')
    : '（读取 .spec/project.yaml 获取当前已登记交付轨）'
  const baseLine = options?.base === undefined
    ? '- 本提案为独立新需求里程碑，不绑定或修改任何已有需求的在途正文；如确需参考既有需求作为依据，可用 target 与 base_version 注明。'
    : `- 若需记录与 ${options.base.id}（${options.base.title}）v${String(options.base.version)} 的演进关联，可在 requirement_propose 中附带 target: ${options.base.id} 与 base_version: ${String(options.base.version)}，但绝对不改动 ${options.base.id} 的正文与在途任务。`

  return `L 级独立里程碑立项：请为本项目起草一条独立的新需求提案（如 ${nextId}），用于承载跨端、新交付轨或架构级大模块扩展。

用户诉求：
"""
${requestText}
"""

执行身份：你是本项目的需求分析师（maniu-intake）。按以下规则执行：
1. **明确隔离在途开发**：首先向用户明确说明——本次扩展属于 L 级独立里程碑（将作为独立需求如 ${nextId} 立项），**不会打断、修改或阻塞当前正在进行的需求与在途开发任务**。
2. 读清当前仓库事实：用 file_read 读 .spec/project.yaml 与 .spec/requirements 下已有需求。当前已知轨参考：${tracksText}；分析本需求是否需要引入新交付轨（如 desktop 桌面端等），并说明后续将由架构阶段在 .spec/project.yaml 正式登记新轨与复用边界。
3. 需求分析与完整成文：严格按统一 6 段式 Spec-Driven PRD 标准写清独立新需求（含背景与目标、适用角色与范围边界、核心用户流程、EARS 功能与业务规则、权限/空态与异常边界、编号 AC-1 验收标准，以及跨端/模块复用边界），并遵守正文纯净（严禁写入评审回应表或过程流水）、零模糊词、What ≠ How 三条红线；有关键选型或范围未决时，用 ask_user_question 一次只问一个问题确认。

${REQUIREMENT_PRD_STANDARD}
4. 确认后调用 requirement_propose：
   - mode 为 new，title 用不超过 16 字的短业务短语，content 为完整独立新需求正文，analysis 写清与现有需求的解耦关系、新轨需求与独立验收建议。
${baseLine}
5. 边界：不调用 requirement_draft、requirement_amend 或 file_edit，不改写 .spec/project.yaml，不打断当前在途任务；写完提案后回报提案编号与立项摘要，等待用户在界面对比确认。`
}
