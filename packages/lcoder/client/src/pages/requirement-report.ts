/** 需求详情的评审报告解析与时间戳格式化；纯函数，不依赖 React 或宿主文件通道。 */

/** 待改项的优先级；详情卡片按它选徽标样式。 */
export type ReviewPriority = 'high' | 'medium' | 'low'

/** 报告「待改项」里的一条：完整正文、精简摘要、优先级，以及可拆出的四个展示字段。 */
export interface ReviewTodo {
  readonly text: string
  readonly summary: string
  readonly priority?: ReviewPriority
  /** 所属分类子标题（如「文档完备性」）；报告未分组时缺省。 */
  readonly category?: string
  /** 一句话核心问题，用于紧凑表格单行展示。 */
  readonly title: string
  /** 涉及位置；报告未标注时为空串。 */
  readonly location: string
  /** 位置之后、建议之前的正文说明。 */
  readonly problem: string
  /** 可执行的修改建议。 */
  readonly suggestion: string
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
/** 分类子标题：`### 文档完备性` 或更细的 `#### 边界与例外`。 */
const CATEGORY_HEADING = /^#{3,4}\s+(.+?)\s*$/u
/** 无 Markdown 标记的分类子标题：纯中文/字母短行，不含冒号与优先级标记。 */
const CATEGORY_PLAIN = /^[\u4e00-\u9fa5A-Za-z（）()、\s]{2,16}$/u
/** 评审固定维度：即使紧跟在上一条之后也按分类标题切分。 */
const KNOWN_CATEGORIES: readonly string[] = [
  '文档完备性', '合理性', '需求角度', '技术实现角度', '技术可行性', '技术角度', '实现角度', '边界与例外',
]
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
 * 去掉包裹的加粗星号与残留优先级标记。
 * @param text - 待清理的字段文本。
 * @returns 可展示的纯文本。
 */
function cleanField(text: string): string {
  return text
    .replace(/\*\*/gu, '')
    .replace(PRIORITY_MARK, ' ')
    .replace(/[。；;]\s*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * 把一条待改项拆成标题、位置、问题与建议四个展示字段。
 * @param itemText - 去掉列表符号后的完整正文。
 * @returns 四字段与所属分类。
 */
function parseTodoItem(itemText: string): Pick<ReviewTodo, 'title' | 'location' | 'problem' | 'suggestion' | 'priority'> {
  const label = PRIORITY_LABEL.exec(itemText)
  const mark = label?.[1] ?? label?.[2]
  const priority: ReviewPriority | undefined = mark === '高'
    ? 'high'
    : mark === '中'
      ? 'medium'
      : mark === '低'
        ? 'low'
        : undefined
  const work = itemText.replace(PRIORITY_MARK, ' ').replace(/\s*\n\s*/gu, ' ').replace(/[ \t]+/gu, ' ').trim()

  // 标题：开头加粗的一句话优先；否则取破折号前，或第一句。
  let title = ''
  let rest = work
  const bold = /^\*\*(.+?)\*\*/u.exec(work)
  if (bold !== null) {
    title = cleanField(bold[1] ?? '')
    rest = work.slice(bold[0].length).trim()
  } else {
    const dash = work.indexOf('——')
    const stop = dash >= 0 ? dash : work.search(/[。！？.!?]/u)
    const raw = (stop >= 0 ? work.slice(0, stop) : work).trim()
    title = cleanField(raw.replace(/^位置[:：]\s*/u, ''))
  }

  const locationMatch = /位置[:：]?\s*([^。；;！？\n]+)/u.exec(rest)
  const location = locationMatch?.[1] === undefined ? '' : cleanField(locationMatch[1])

  const suggestionMatch = /建议[:：]?\s*([\s\S]*)$/u.exec(rest)
  const suggestion = suggestionMatch?.[1] === undefined ? '' : cleanField(suggestionMatch[1])

  const beforeSuggestion = suggestionMatch === null ? rest : rest.slice(0, suggestionMatch.index)
  const afterLocation = locationMatch === null
    ? beforeSuggestion
    : beforeSuggestion.slice(locationMatch.index + locationMatch[0].length)
  const problem = cleanField(afterLocation.replace(/^[。；;，,、\s]+/u, '').replace(/^问题[:：]?\s*/u, ''))

  return {
    ...(priority === undefined ? {} : { priority }),
    title: title === '' ? summaryOf(itemText) : title,
    location,
    problem,
    suggestion,
  }
}

/**
 * 把「待改项」小节切成一条条记录，识别分类子标题并拆出四个展示字段。
 * @param text - 待改项小节的原始文本。
 * @returns 按出现顺序排列的待改项，每条含完整正文、精简摘要与四字段。
 */
function parseTodos(text: string): readonly ReviewTodo[] {
  const todos: ReviewTodo[] = []
  let current: string[] | undefined
  let category: string | undefined

  const flush = (): void => {
    if (current === undefined) return
    const lines = current
    current = undefined
    const itemText = lines.join('\n').trim()
    if (itemText === '') return
    todos.push({
      text: itemText,
      summary: summaryOf(itemText),
      ...(category === undefined || category === '' ? {} : { category }),
      ...parseTodoItem(itemText),
    })
  }

  for (const line of text.split('\n')) {
    const heading = CATEGORY_HEADING.exec(line)
    if (heading !== null) {
      flush()
      category = heading[1]?.trim() || undefined
      continue
    }
    const trimmed = line.trim()
    if (KNOWN_CATEGORIES.includes(trimmed) || (current === undefined && CATEGORY_PLAIN.test(trimmed))) {
      flush()
      category = trimmed
      continue
    }
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
