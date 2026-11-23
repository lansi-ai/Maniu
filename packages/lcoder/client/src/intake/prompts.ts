/** 立项、需求新建与改稿、评审、拆分的提示词模板；正文由模型执行，界面只负责发送。 */

/** 立项概要确认指令：人设约定用户回复「确认需求」后才落盘；浮卡确认按钮原样发送。 */
export const INTAKE_CONFIRM_PROMPT = '确认需求'

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
- 仓库是空的、没有远端、没有文档或测试，都不中止访谈：缺的项标「尚未提供」。`
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
- 需要确认文档位置时，用 ask_user_question 把 file_list 实际列出的候选做成选项，不要让人手打路径。`
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
 * 生成需求拆分提示词（研发经理）。
 *
 * 拆分与岗位建议都由研发经理做：先按技术维度用 `task_draft` 建任务，
 * 再用 `requirement_split_plan` 写逐条建议；分配仍等人确认后走 `/task_assign`。
 * @param requirement - 需求编号与标题。
 * @param document - 需求正文。
 * @param tracks - 可用轨的显示文本。
 * @returns 可直接发送给研发经理会话的提示词。
 */
export function buildManagerSplitPrompt(
  requirement: { readonly id: string; readonly title: string },
  document: string,
  tracks: readonly string[],
): string {
  const body = bodyOf(document)
  return `需求拆分：请把需求 ${requirement.id}（${requirement.title}）拆分成可执行的开发任务，并逐条给出岗位建议。

依据：以末尾附上的《项目需求概要》（.spec/requirements/${requirement.id}.md）为唯一范围依据；文档里暂不开发的范围不要拆成任务。

执行身份：你是这条需求的研发经理，负责按技术维度拆分任务，并判断每条任务该由什么岗位来做。
- 用户已在界面上确认需求并亲自点击「拆分任务」，这就是明确的拆分授权；不要重复追问。
- 不改需求文档、.spec/project.yaml、已有方案与规格条目，不开始实现，不调用编辑与命令工具。

第一步，建任务：
- 按技术维度用 task_draft 建任务，state 一律 drafting。
- 每条任务写 description（范围与验收标准）、grade、rules、depends_on、scope.allowed_paths、track 与 requirement: ${requirement.id}。
- 每条任务必须标一条轨，只能取：${tracks.join('、')}。
- 空仓时第一条任务必须是「项目基础框架与脚手架」，所有功能任务在 depends_on 里依赖它；已有可运行框架只补实际缺口。

第二步，写岗位建议：
- 任务建完后调用 requirement_split_plan：参数 id 为 ${requirement.id}，tasks 逐条给 task（刚建的任务编号）、role（岗位 id，优先取 .spec/roles.yaml；也可用内置角色 id）与 reason（一句技术理由）。
- 计划写到 .spec/requirements/${requirement.id}/split-plan.yaml，覆盖上一份计划。
- 只给建议：不分配岗位、不改任务状态；分配由人在界面上逐条确认后执行 /task_assign，不要假称已分配。

完成后列出每条任务的编号、标题、轨、依赖与建议岗位，然后停下。

《项目需求概要》正文：
"""
${body}
"""`
}

/**
 * 生成需求评审提示词。
 *
 * 评审只出报告：报告由评审岗位（项目经理或研发经理）用 `requirement_review_draft` 落盘，
 * 正文与状态都不改，过审仍由人在界面上完成。
 * @param requirement - 需求编号与标题。
 * @param document - 当前需求正文。
 * @returns 可直接发送给评审岗位会话的提示词。
 */
export function buildReviewPrompt(
  requirement: { readonly id: string; readonly title: string },
  document: string,
): string {
  const body = bodyOf(document)
  return `需求评审：请对需求 ${requirement.id}（${requirement.title}）做一轮独立评审，把报告落盘。这一轮不改正文，也不签不批。

执行身份：你是这条需求的评审岗位，负责在需求确认前按你的岗位视角做独立评审。

四个角度都要写到，不能合并或省略：
1. 文档完备性：目标、范围、验收口径、边界与例外是否写全，缺什么。
2. 合理性：目标与手段是否匹配，约束、代价与优先级是否成立。
3. 需求角度：用户价值、使用场景、与已有需求的冲突或重复。
4. 技术实现角度：可行性、影响面、数据与接口、依赖与风险。

要求：
- 用 requirement_review_draft 落盘：参数 id 为 ${requirement.id}，report 是完整 Markdown 报告；每条意见写清位置与可执行的修改建议。
- 报告固定三个二级小节，按顺序用原标题，不改名、不合并、不新增同级小节：
  1. ## 摘要：两三句给出整体判断与最关键的问题。
  2. ## 结论：给出「可以确认」或「需要修改」。
  3. ## 待改项：每条用列表项，写清位置、可执行的修改建议与优先级（高/中/低）；没有待改项写「无」。
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
第二步，按需求大小出文档：小改动出短文档（目标、范围、验收几条即可），大改动出完整文档；保留用户已确认的内容，被评审否定的部分要改，并在正文里回应评审意见；需要收缩范围时写明理由。
第三步，用 ask_user_question 请用户确认文档方向，一次只问一个问题；用户确认后才进入下一步。
第四步，确认后调用 requirement_revise：id 为 ${requirement.id}，content 是完整新正文（不是差异片段）；内核会把正文记为下一个版本，自动保留历史快照并闭环未决评审。

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
 - 按需要收缩或补充的地方，直接产出改好的**完整新正文**（不是差异片段），风格、标题层级与原文保持一致。
 - 调用 requirement_patch_propose：target 为 ${requirement.id}，content 为完整新正文，analysis 写清这次改了什么与为什么。
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
- 小需求出短文档：目标、范围、验收几条即可。
- 大需求出完整文档：目标、背景、范围、验收口径、边界与例外。

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
1. 增量修订原则：**只围绕本次差异章节起草修订提案**（说明新增/调整的功能规则、数据口径、权限边界与增量验收标准），不要重写未涉及的既有章节，更**不要推翻或改动已完成的老任务与历史基线**。
2. 用 file_read / task_read 读清 ${requirement.id} 的现状与已拆任务，如有关键口径歧义，用 ask_user_question 一次只问一个问题确认后再落提案。
3. 确认方向后调用 requirement_propose：
   - mode 为 new，target 为 ${requirement.id}，base_version 为 ${String(baseVersion)}（记录所依据的基线版本）。
   - content 写清本次增量修订的完整提案正文（突出差异章节与增量范围，标注后续只需拆出 1–2 条 B 级增量任务）。
   - analysis 写清影响面分析、与既有规则的兼容性及“保留老任务不动、仅拆增量任务”的建议。
4. 边界：不调用 requirement_amend、requirement_draft 或 file_edit，不推翻历史已完成任务，不写代码或签契约；提案落盘后回报提案编号与差异摘要，等待用户在界面对比确认（/proposal_approve）。

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
3. 需求分析与完整成文：补齐新里程碑的目标、背景、功能范围、跨端/模块复用边界与验收口径；有关键选型或范围未决时，用 ask_user_question 一次只问一个问题确认。
4. 确认后调用 requirement_propose：
   - mode 为 new，title 用不超过 16 字的短业务短语，content 为完整独立新需求正文，analysis 写清与现有需求的解耦关系、新轨需求与独立验收建议。
${baseLine}
5. 边界：不调用 requirement_draft、requirement_amend 或 file_edit，不改写 .spec/project.yaml，不打断当前在途任务；写完提案后回报提案编号与立项摘要，等待用户在界面对比确认。`
}
