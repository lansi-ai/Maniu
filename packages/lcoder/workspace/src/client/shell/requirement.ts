/**
 * 需求的展示值与拆分指令。
 *
 * 需求是独立的 REQ 实体：正文在 `.spec/requirements/<编号>.md`，拆分以需求为输入，
 * 拆出的任务用 `requirement` 回指 REQ 编号。这里只保留时间展示、正文上限与指令模板，
 * 进度判定见 `requirement-page.ts`（调用 kernel 的派生函数）。
 */
import type { ShellMessage, ShellTask } from './shell-data.ts'
import { BUILTIN_TRACKS } from '@lcoder/kernel/src/schema/tracks.ts'
import type { TrackDescriptor } from '@lcoder/kernel/src/schema/tracks.ts'

/**
 * 任务开立时间的展示值。
 *
 * 只读 `opened_at` 写下的时间；缺失或读不懂时给空串，由界面显示破折号，
 * 不拿文件修改时间冒充。
 * @param value - 任务 YAML 的 `opened_at`。
 * @returns 本地时间字符串；缺失或非法时为空串。
 */
export function formatOpenedAt(value: string | undefined): string {
  if (value === undefined || value.trim() === '') return ''
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleString()
}

/** 立项问答里的一问一答。 */
export interface RequirementAnswer {
  readonly id: string
  /** 题目的短标题；工具调用里没写就不出现。 */
  readonly header?: string
  readonly question: string
  /** 用户的选择，已拼成一句；没有可用答案的题不会出现。 */
  readonly answer: string
}

/** 立项访谈用的工具名；只认这一个工具的问题与回答。 */
const ASK_USER_QUESTION = 'ask_user_question'

/**
 * 从会话消息里读出立项问答。
 *
 * 题目取自 `ask_user_question` 调用参数里的 `questions`，回答取自同一次调用的结果
 * JSON（`answers[].selected` 与 `custom`）。按题号去重并保持首次出现顺序；
 * 解析失败、结果缺失或答案为空的那一题直接跳过，不拿别的题的回答顶上。
 * @param messages - 外壳的消息列表。
 * @returns 逐题的问题与用户回答。
 */
export function intakeAnswersOf(messages: readonly ShellMessage[]): RequirementAnswer[] {
  const out: RequirementAnswer[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'process') continue
    for (const item of message.items) {
      if (item.kind !== 'tool' || item.name !== ASK_USER_QUESTION || item.result === undefined) continue
      const questions = questionsOf(item.args)
      const answers = answersOf(item.result)
      if (questions === null || answers === null) continue
      for (const question of questions) {
        if (seen.has(question.id)) continue
        const values = answers.get(question.id)
        if (values === undefined || values.length === 0) continue
        seen.add(question.id)
        out.push({
          id: question.id,
          ...(question.header === undefined ? {} : { header: question.header }),
          question: question.question,
          answer: values.join('、'),
        })
      }
    }
  }
  return out
}

/** 一道题在工具参数里的字段。 */
interface AskedQuestion {
  readonly id: string
  readonly header?: string
  readonly question: string
}

/** 工具参数里的题目；不是对象、没有题目或任一条读不懂时返回 null。 */
function questionsOf(args: string): readonly AskedQuestion[] | null {
  const value = jsonRecord(args)
  if (value === null || !Array.isArray(value.questions)) return null
  const questions: AskedQuestion[] = []
  for (const entry of value.questions) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.question !== 'string') return null
    if (entry.id === '' || entry.question.trim() === '') return null
    questions.push({
      id: entry.id,
      question: entry.question,
      ...(typeof entry.header === 'string' && entry.header !== '' ? { header: entry.header } : {}),
    })
  }
  return questions.length === 0 ? null : questions
}

/** 工具结果里的回答：题号 → 选项与自定义回答按显示顺序拼成的值。 */
function answersOf(result: string): Map<string, readonly string[]> | null {
  const value = jsonRecord(result)
  if (value === null || value.pending === true || !Array.isArray(value.answers)) return null
  const answers = new Map<string, readonly string[]>()
  for (const entry of value.answers) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !Array.isArray(entry.selected)) continue
    const selected = entry.selected.filter((item): item is string => typeof item === 'string' && item !== '')
    const custom = typeof entry.custom === 'string' && entry.custom.trim() !== '' ? entry.custom.trim() : ''
    const values = custom === '' ? selected : [...selected, custom]
    if (values.length > 0) answers.set(entry.id, values)
  }
  return answers
}

/** 工具 JSON 文本 → 对象；读不懂时返回 null。 */
function jsonRecord(text: string): Record<string, unknown> | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    // 坏 JSON 只是这一题读不出来，界面照实说没读到。
    void error
    return null
  }
  return isRecord(value) ? value : null
}

/** 只接受普通对象；数组与 null 不算。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 任务描述摘要：压成一行并截断。
 *
 * 只给拆分与方案讨论的指令判断范围，不替代原文；空描述如实写成一句话。
 * @param task - 看板任务。
 * @returns 单行摘要，最长 240 字。
 */
export function taskDigest(task: ShellTask): string {
  const text = task.description.replace(/\s+/gu, ' ').trim()
  if (text === '') return '（任务没有描述）'
  return text.length > 240 ? `${text.slice(0, 240)}…` : text
}

/** 拆分指令附带需求正文的上限；超出时按段落边界截断，不切半句。 */
const MAX_DOCUMENT_CHARS = 8000

/**
 * 拆分指令可用的需求正文来源。
 *
 * 优先用落盘的需求文档；没有文件时退回任务回指方案的正文。两者都没有时，指令只带
 * 任务描述并说明读不到需求文档，不让分析师凭空补范围。
 */
export interface RequirementSplitSource {
  /** `.spec/requirements/<方案编号>.md` 的完整正文；没有落盘文件时为 undefined。 */
  readonly document?: string | undefined
  /** 任务回指方案的 `problem` 正文；方案文件也没读到时为 undefined。 */
  readonly proposal?: string | undefined
}

/**
 * 按段落或句子边界截断正文，保留完整的一句。
 *
 * 只在上限内找最近的段落空行、换行或句末标点；一个边界都没有时才硬切。
 * @param text - 已去掉首尾空白的正文。
 * @returns 截断后的正文与是否发生截断。
 */
function boundDocument(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_DOCUMENT_CHARS) return { text, truncated: false }
  const head = text.slice(0, MAX_DOCUMENT_CHARS)
  const cuts = ['\n\n', '\n', '。', '；', '！', '？'].map(mark => head.lastIndexOf(mark))
  const at = Math.max(...cuts)
  // 边界在首字附近时截出来几乎没有内容，退回硬切更诚实。
  const kept = at > MAX_DOCUMENT_CHARS / 4 ? head.slice(0, at + 1) : head
  return { text: kept.trimEnd(), truncated: true }
}

/** 拆分与讨论用的需求引用：稳定编号与标题。 */
export interface RequirementRef {
  readonly id: string
  readonly title: string
}

/**
 * 需求文档在 `.spec` 里的路径。
 * @param requirement - 需求编号与标题。
 * @returns 同名 Markdown 的相对路径。
 */
export function requirementDocumentPath(requirement: RequirementRef): string {
  return `.spec/requirements/${requirement.id}.md`
}

/** 指令里可附上的需求正文；`truncated` 说明是否按边界截断。 */
export interface RequirementDocumentExcerpt {
  readonly text: string
  readonly truncated: boolean
}

/**
 * 把一段需求正文收进指令上限：去首尾空白，超长时在最近的边界处截断。
 * @param text - 需求正文原文。
 * @returns 指令内正文与是否截断；空白正文得到空串。
 */
export function boundRequirementText(text: string): RequirementDocumentExcerpt {
  const trimmed = text.trim()
  return trimmed === '' ? { text: '', truncated: false } : boundDocument(trimmed)
}

/**
 * 拆分任务的基础指令；项目经理会话的指令在它后面补执行身份与边界。
 *
 * 带需求文档时以它为唯一范围依据：只拆文档里的第一版功能清单与验收标准，暂不开发的
 * 范围不拆。缺文档时退回任务描述与方案正文，并说明读不到文档。无论哪种来源，都只把
 * 这一条需求拆成 drafting 任务写进 `.spec/tasks`；不改需求、项目与方案，不开始实现，
 * 也不推进状态。
 * @param requirement - 被拆分的需求：REQ 编号与标题。
 * @param source - 已读到的需求文档与旧方案正文；都没有时省略。
 * @param tracks - 这次可用的轨；缺省为内置六轨。
 * @returns 中文指令正文。
 */
export function buildRequirementSplitPrompt(
  requirement: RequirementRef,
  source: RequirementSplitSource = {},
  tracks: readonly TrackDescriptor[] = BUILTIN_TRACKS.map(track => ({ id: track.id, name: track.name })),
): string {
  const document = source.document?.trim() ?? ''
  const proposal = source.proposal?.trim() ?? ''
  const path = requirementDocumentPath(requirement)
  const trackList = tracks.map(track => `${track.id}（${track.name}）`).join('、')
  const lines = [
    `需求拆分：请把需求 ${requirement.id}（${requirement.title}）拆分成可执行的开发任务，写入 .spec/tasks。`,
    '',
    document === ''
      ? `依据：没有读到这条需求对应的需求文档（${path}），只能退回任务描述与方案正文划分范围；两者冲突时以任务描述为准，并在结果里说明缺了需求文档。`
      : `依据：以末尾附上的《项目需求概要》（${path}）为唯一范围依据——只覆盖文档里的第一版功能清单与验收标准；文档里标为暂不开发的范围不要拆成任务。`,
    '',
    '要求：',
    '- 每条任务对应一个可独立验收的业务结果，不按纯技术步骤堆叠。',
    `- 每条任务 state 为 drafting；写清 description（范围与验收标准）、grade、rules（只引用需求里已确认的规则编号）、depends_on、scope.allowed_paths 与 track，并写 requirement: ${requirement.id}。`,
    '- 不要写 proposal：需求就是 REQ，旧方案编号不再用于新任务。',
    '- 有先后依赖的用 depends_on 表达。',
    '- 不要修改需求本身、.spec/project.yaml、已有方案与规格条目；不要开始实现、不要签契约、不要推进任务状态。',
    '- 完成后列出新建的任务编号、标题、轨与依赖关系。',
    '',
    '调研（拆分前先做）：',
    '- 先用 file_list 查看仓库根目录与关键目录，再读 README 与构建清单（如 package.json、csproj、pyproject.toml、Cargo.toml），判断这是空仓、只有需求文档，还是已有可运行框架以及它用的技术栈。',
    '- 把判断与依据写进回复；不得只凭需求文档猜技术选型。',
    '',
    '轨（每条任务必须标一条）：',
    `- track 只能取：${trackList}；一任务一轨。`,
    '- 基础框架任务按项目主技术栈定轨；拿不准时用 general。',
    '- 不要写 role，也不要调用任何分配命令——具体岗位留到实施阶段由人指派。',
  ]
  if (document === '') {
    lines.push(
      '',
      '任务描述：',
      boundDocument(requirement.title.trim()).text || '（需求没有标题）',
      '',
      '方案正文：',
      proposal === '' ? '（读不到方案正文）' : boundDocument(proposal).text,
    )
    return lines.join('\n')
  }
  const bounded = boundRequirementText(document)
  lines.push('', `《项目需求概要》正文（${path}）：`, '"""', bounded.text, '"""')
  if (bounded.truncated) {
    lines.push('', `（正文在本指令里按段落截断在上限内；未附上的部分请读取 ${path} 后再拆，不要凭猜测补范围。）`)
  }
  return lines.join('\n')
}
