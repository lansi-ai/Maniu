/** 需求详情的评审报告解析与时间戳格式化；纯函数，不依赖 React 或宿主文件通道。 */

/** 待改项的优先级；详情卡片按它选徽标样式。 */
export type ReviewPriority = 'high' | 'medium' | 'low'

/** 报告「待改项」里的一条：正文与可选的优先级。 */
export interface ReviewTodo {
  readonly text: string
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
 * 把「待改项」小节切成一条条记录，并取出每条的优先级。
 * @param text - 待改项小节的原始文本。
 * @returns 按出现顺序排列的待改项。
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
    todos.push({ text: itemText, ...(priority === undefined ? {} : { priority }) })
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
 * @param text - `requirement_review_draft` 落盘的完整 Markdown 报告。
 * @returns 摘要文本与待改项列表。
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

  return { summary: summaryLines.join('\n').trim(), todos: parseTodos(todoLines.join('\n')) }
}
