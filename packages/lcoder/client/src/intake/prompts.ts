/** 立项与拆分的提示词模板；正文由模型执行，界面只负责发送。 */

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
 * @returns 可直接发送的提示词。
 */
export function buildIntakePrompt(project: IntakeProject, mode: IntakeMode): string {
  const head = mode === 'fresh' ? '全新项目立项：' : '已有资料立项：'
  const facts = `${project.name}（${project.path}，${project.branch}）`
  if (mode === 'fresh') {
    return `${head}${facts}

第 0 步 先看清仓库：
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
 * 评审只出报告：报告由项目经理用 `requirement_review_draft` 落盘，
 * 正文与状态都不改，过审仍由人在界面上完成。
 * @param requirement - 需求编号与标题。
 * @param document - 当前需求正文。
 * @returns 可直接发送给项目经理会话的提示词。
 */
export function buildReviewPrompt(
  requirement: { readonly id: string; readonly title: string },
  document: string,
): string {
  const body = bodyOf(document)
  return `需求评审：请对需求 ${requirement.id}（${requirement.title}）做一轮独立评审，把报告落盘。这一轮不改正文，也不签不批。

执行身份：你是这条需求的项目经理，负责在需求确认前做评审。

四个角度都要写到，不能合并或省略：
1. 文档完备性：目标、范围、验收口径、边界与例外是否写全，缺什么。
2. 合理性：目标与手段是否匹配，约束、代价与优先级是否成立。
3. 需求角度：用户价值、使用场景、与已有需求的冲突或重复。
4. 技术实现角度：可行性、影响面、数据与接口、依赖与风险。

要求：
- 用 requirement_review_draft 落盘：参数 id 为 ${requirement.id}，report 是完整 Markdown 报告；每条意见写清位置与可执行的修改建议。
- 只读查看需求正文与仓库事实；不改需求正文、不改状态、不签契约、不推进任务、不调用过审命令。
- 结尾给出结论：可以确认，或需要修改（列出必须修改项）。
- 输出完停下，不自行改稿，也不自行过审。

《需求正文》：
"""
${body}
"""`
}

/**
 * 生成需求改稿提示词。
 *
 * 改稿只动正文与版本：需求分析师用 `requirement_revise` 写入完整新正文，
 * 状态、过审与其他需求都不动。
 * @param requirement - 需求编号与标题。
 * @param document - 当前需求正文。
 * @param reviewReport - 最近一份评审报告相对 `.spec` 的路径。
 * @returns 可直接发送给需求分析师会话的提示词。
 */
export function buildRevisePrompt(
  requirement: { readonly id: string; readonly title: string },
  document: string,
  reviewReport?: string,
): string {
  const body = bodyOf(document)
  const report = reviewReport === undefined || reviewReport.trim() === ''
    ? '这条需求还没有评审报告：按正文自身的问题做必要修订，不要编造评审意见。'
    : `最近一份评审报告：.spec/${reviewReport.replace(/^\.?[\\/]/, '').replace(/^\.spec[\\/]/, '')}`
  return `需求改稿：请修订需求 ${requirement.id}（${requirement.title}）的正文，并落成新版本。

执行身份：你是这条需求的需求分析师。
${report}
- 先用 file_read 读评审报告；逐条处理其中的意见。
- 用 requirement_revise 写入完整的新正文，不是差异片段；保留用户已确认的内容，被评审否定的部分要改，并在正文里回应评审意见。
- 只改需求正文与版本：不改状态、不签不批、不推进任务、不改其他需求。
- 写完回报新版本号、改了哪些段落，以及哪些评审意见保留待议。

要求：
- 新正文保持原结构与既有约定，补上评审指出的缺失项。
- 不删用户已确认的范围；需要收缩范围时写明理由。

《当前需求正文》：
"""
${body}
"""`
}
