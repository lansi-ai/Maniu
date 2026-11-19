/** 需求详情的评审报告解析与时间戳格式化；纯函数，不依赖 React 或宿主文件通道。 */

/** 待改项的优先级；详情卡片按它选徽标样式。 */
export type ReviewPriority = 'high' | 'medium' | 'low'

/** 报告「待改项」里的一条：完整正文、精简摘要与可选的优先级。 */
export interface ReviewTodo {
  readonly text: string
  readonly summary: string
  readonly priority?: ReviewPriority
}

/** 从完整 Markdown 报告里抽出的结构化片段；缺失的小节留空。 */
export interface ParsedReviewReport {
  readonly summary: string
  readonly todos: readonly ReviewTodo[]
}

const ISO_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/
const ITEM_LINE = /^\s*(?:[-*+]|\d+[.)])\s+/u
const PRIORITY_LABEL = /(?:优先级\s*[:：]?\s*)(高|中|低)|[【\[]\s*(高|中|低)\s*[】\]]/u
/** 摘要里去掉全部优先级标记；与 PRIORITY_LABEL 同源，但不保留 exec 的 lastIndex 状态。 */
const PRIORITY_MARK = new RegExp(PRIORITY_LABEL, 'gu')
/** 摘要字数上限；超出补省略号。 */
const SUMMARY_CHARS = 72

/**
 * 从待改项正文生成精简摘要：去掉冗余优先级标记，取第一句，超长按字数截断。
 * 完整正文仍留在 `text` 字段供展开阅读。
 * @param text - 一条待改项的完整正文。
 * @returns 可单独展示的简明摘要。
 */
function summaryOf(text: string): string {
  const cleaned = text.replace(PRIORITY_MARK, ' ').replace(/\s+/gu, ' ').trim()
  const firstSentence = /^(.+?[。！？.!?])/u.exec(cleaned)?.[1] ?? cleaned
  return firstSentence.length > SUMMARY_CHARS ? `${firstSentence.slice(0, SUMMARY_CHARS)}…` : firstSentence
}

/** 未标注优先级的待改项排在三级之后。 */
function priorityRank(priority: ReviewPriority | undefined): number {
  return priority === 'high' ? 0 : priority === 'medium' ? 1 : priority === 'low' ? 2 : 3
}

/**
 * 把 ISO 时间戳按原文时区截断成 `YYYY-MM-DD HH:mm`；非法值原样返回。
 * @param value - 详情里展示的时间字符串。
 * @returns 可读时间或原始字符串。
 */
export function formatTimestamp(value: string): string {
  const match = ISO_TIMESTAMP.exec(value.trim())
  if (match === null || Number.isNaN(Date.parse(value))) return value
  return `${match[1]} ${match[2]}`
}

/**
 * 把「待改项」小节切成一条条记录，取出优先级并生成摘要。
 * @param text - 待改项小节的原始文本。
 * @returns 按出现顺序排列的待改项，每条含完整正文与精简摘要。
 */
function parseTodos(text: string): readonly ReviewTodo[] {
  const todos: ReviewTodo[] = []
  let current: string[] | undefined

  const flush = (): void => {
    if (current === undefined) return
    const lines = current
    current = undefined
    const itemText = lines.join('\n').trim()
    if (itemText === '') return
    const match = PRIORITY_LABEL.exec(itemText)
    const label = match?.[1] ?? match?.[2]
    const priority: ReviewPriority | undefined = label === '高'
      ? 'high'
      : label === '中'
        ? 'medium'
        : label === '低'
          ? 'low'
          : undefined
    todos.push({ text: itemText, summary: summaryOf(itemText), ...(priority === undefined ? {} : { priority }) })
  }

  for (const line of text.split('\n')) {
    if (ITEM_LINE.test(line)) {
      flush()
      current = [line.replace(ITEM_LINE, '')]
    } else if (line.trim() !== '' && current !== undefined) {
      current.push(line.trim())
    }
  }
  flush()
  return todos
}

/**
 * 从完整评审报告里抽出「摘要」与「待改项」两段。
 *
 * 只认二级标题，标题外的正文一律忽略；续行缩进归入上一条待改项，空行只是分隔。
 * 待改项按高、中、低、无优先级稳定排序，同级保持原报告顺序。
 * @param text - `requirement_review_draft` 落盘的完整 Markdown 报告。
 * @returns 摘要文本与按优先级排序的待改项列表。
 */
export function parseReviewReport(text: string): ParsedReviewReport {
  const summaryLines: string[] = []
  const todoLines: string[] = []
  let section: 'summary' | 'todos' | undefined

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line)
    if (heading !== null) {
      const title = heading[1]?.trim() ?? ''
      section = title === '摘要' ? 'summary' : title === '待改项' ? 'todos' : undefined
      continue
    }
    if (section === 'summary') summaryLines.push(line)
    if (section === 'todos') todoLines.push(line)
  }

  const todos = [...parseTodos(todoLines.join('\n'))]
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority))
  return { summary: summaryLines.join('\n').trim(), todos }
}
