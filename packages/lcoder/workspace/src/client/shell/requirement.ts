/**
 * 需求卡片的判定、时间展示与拆分指令。
 *
 * 需求卡片只给「已确认、等待拆分」的 drafting 任务：它们带 `proposal` 回指，
 * 是从方案里落下的需求本体，不是后续开发任务。其它状态仍走普通任务详情。
 */
import type { ShellMessage, ShellTask } from './shell-data.ts'

/**
 * 任务是否是需求卡片要看的那一条。
 * @param task - 看板任务。
 * @returns 状态为 drafting 且带方案回指时为 true。
 */
export function isRequirementTask(task: ShellTask): boolean {
  return task.state === 'drafting' && task.proposal !== undefined
}

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
 * 拆分任务时发给分析师的指令。
 *
 * 只要求把这一条需求拆成 drafting 任务写进 `.spec/tasks`；不改需求、项目与方案，
 * 不开始实现，也不推进状态。
 * @param task - 被拆分的需求任务。
 * @returns 中文指令正文。
 */
export function buildRequirementSplitPrompt(task: ShellTask): string {
  return [
    `需求拆分：请把需求 ${task.id}（${task.title}）拆分成可执行的开发任务，写入 .spec/tasks。`,
    '',
    '要求：',
    '- 每条任务 state 为 drafting；标题用可交付的业务结果，不要用技术步骤堆叠。',
    '- 每条任务写清 description（范围与验收标准）、grade、rules、depends_on 与 scope.allowed_paths；规则只能引用需求里已确认的编号。',
    '- 拆出的任务保持可独立验收；有先后依赖的用 depends_on 表达。',
    '- 不要修改需求本身、.spec/project.yaml、已有方案与规格条目；不要开始实现、不要签契约、不要推进任务状态。',
    '- 完成后列出新建的任务编号、标题与依赖关系。',
  ].join('\n')
}
