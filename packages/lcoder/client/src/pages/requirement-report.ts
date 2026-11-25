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
const PRIORITY_LABEL = new RegExp(
  [
    '(?:优先级\\s*[:：]?\\s*)(高优?|中优?|低优?|P[012])',
    '[【\\[]\\s*(高优?|中优?|低优?|P[012])\\s*[】\\]]',
    '^\\*\\*\\s*(高优?|中优?|低优?|P[012])\\s*\\*\\*(?:\\s*[｜|:：—\\-]\\s*|\\s+)',
    '^(高优?|中优?|低优?|P[012])\\s*[｜|:：]\\s*',
  ].join('|'),
  'iu',
)
/** 摘要里去掉全部优先级标记；与 PRIORITY_LABEL 同源，但不保留 exec 的 lastIndex 状态。 */
const PRIORITY_MARK = new RegExp(PRIORITY_LABEL.source, 'giu')
/** 仅匹配裸优先级词，防止把优先级当作待改项标题。 */
const BARE_PRIORITY = /^(?:高优?|中优?|低优?|P[012])$/iu
const LEADING_SEPARATORS = /^[｜|:：—\-\s]+/u
/** 分类子标题：`### 文档完备性` 或更细的 `#### 边界与例外`。 */
const CATEGORY_HEADING = /^#{3,4}\s+(.+?)\s*$/u
/** 无 Markdown 标记的分类子标题：纯中文/字母短行，不含冒号与优先级标记。 */
const CATEGORY_PLAIN = /^[\u4e00-\u9fa5A-Za-z（）()、\s]{2,16}$/u
/** 评审固定维度：即使紧跟在上一条之后也按分类标题切分。 */
const KNOWN_CATEGORIES: readonly string[] = [
  '文档完备性', '合理性', '需求角度', '技术实现角度', '技术可行性', '技术角度', '实现角度', '边界与例外',
]
/** 作为摘要段识别的二级标题；待改项表格也可以落在这些标题下。 */
const SUMMARY_HEADINGS: ReadonlySet<string> = new Set(['摘要', '评审结论', '总体结论', '结论'])
/** 作为待改项段识别的二级标题。 */
const TODO_HEADINGS: ReadonlySet<string> = new Set(['待改项', '问题清单', '评审意见', '修改建议'])
/** Markdown 表格列到待改项字段的映射；`id` 列只占位，不进入展示字段。 */
type TableColumn = 'id' | 'priority' | 'location' | 'problem' | 'suggestion'
const TABLE_HEADER: Readonly<Record<string, TableColumn | undefined>> = {
  '编号': 'id', '序号': 'id', '#': 'id',
  '严重度': 'priority', '优先级': 'priority', '级别': 'priority',
  '所在章节': 'location', '章节': 'location', '位置': 'location', '涉及位置': 'location',
  '问题说明': 'problem', '问题描述': 'problem', '问题': 'problem', '说明': 'problem',
  '修改建议': 'suggestion', '建议': 'suggestion', '整改建议': 'suggestion', '处理建议': 'suggestion',
}
/** 无表头时按列数推断：五列含编号，四列以严重度开头。 */
const FALLBACK_COLUMNS: readonly TableColumn[] = ['id', 'priority', 'location', 'problem', 'suggestion']
const FOUR_COLUMNS: readonly TableColumn[] = ['priority', 'location', 'problem', 'suggestion']
/** 分隔行的每个单元格形如 `---`、`:---:` 或 `---:`。 */
const TABLE_SEPARATOR_CELL = /^:?-{2,}:?$/u
/** 摘要字数上限；超出补省略号。 */
const SUMMARY_CHARS = 72

/** 截断超长文本到摘要上限。 */
function clampSummary(text: string): string {
  return text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS)}…` : text
}

/**
 * 从待改项正文生成精简摘要：去掉冗余优先级标记，取第一句，超长按字数截断。
 * 完整正文仍留在 `text` 字段供展开阅读。
 * @param text - 一条待改项的完整正文。
 * @returns 可单独展示的简明摘要。
 */
function summaryOf(text: string): string {
  const cleaned = text.replace(PRIORITY_MARK, ' ').replace(/\s+/gu, ' ').trim().replace(LEADING_SEPARATORS, '')
  const firstSentence = /^(.+?[。！？.!?])/u.exec(cleaned)?.[1] ?? cleaned
  return clampSummary(firstSentence)
}

/** 未标注优先级的待改项排在三级之后。 */
function priorityRank(priority: ReviewPriority | undefined): number {
  return priority === 'high' ? 0 : priority === 'medium' ? 1 : priority === 'low' ? 2 : 3
}

/**
 * 把正则捕获到的优先级词归一到三级枚举。
 * @param mark - 优先级关键词（高/中/低/P0/P1/P2）。
 * @returns 归一后的优先级，未识别时缺省。
 */
function mapPriority(mark: string | undefined): ReviewPriority | undefined {
  if (mark === undefined) return undefined
  const upper = mark.toUpperCase()
  if (upper.startsWith('高') || upper === 'P0') return 'high'
  if (upper.startsWith('中') || upper === 'P1') return 'medium'
  if (upper.startsWith('低') || upper === 'P2') return 'low'
  return undefined
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

/** 去掉反引号与 Markdown 标题井号，使派生标题干净可读。 */
function stripMarkdownMarkers(text: string): string {
  return cleanField(text.replace(/`/gu, '').replace(/(?:^|\s)#{1,6}\s+/gu, ' '))
}

/**
 * 把一条待改项拆成标题、位置、问题与建议四个展示字段。
 * @param itemText - 去掉列表符号后的完整正文。
 * @returns 四字段与所属分类。
 */
function parseTodoItem(itemText: string): Pick<ReviewTodo, 'title' | 'location' | 'problem' | 'suggestion' | 'priority'> {
  const label = PRIORITY_LABEL.exec(itemText)
  const mark = label?.[1] ?? label?.[2] ?? label?.[3] ?? label?.[4]
  const priority = mapPriority(mark)
  let work = itemText
    .replace(PRIORITY_MARK, ' ')
    .replace(/\s*\n\s*/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .trim()
    .replace(LEADING_SEPARATORS, '')

  // 标题：开头加粗的一句话（非裸优先级词）优先；否则取破折号前，或第一句。
  let title = ''
  let rest = work
  const bold = /^\*\*(.+?)\*\*/u.exec(work)
  if (bold !== null) {
    const candidate = cleanField(bold[1] ?? '')
    if (candidate !== '' && !BARE_PRIORITY.test(candidate)) {
      title = candidate
      rest = work.slice(bold[0].length).trim()
    } else {
      work = work.slice(bold[0].length).replace(LEADING_SEPARATORS, '').trim()
      rest = work
    }
  }
  if (title === '') {
    const dash = work.indexOf('——')
    const stop = dash >= 0 ? dash : work.search(/[。！？.!?]/u)
    const raw = (stop >= 0 ? work.slice(0, stop) : work).trim()
    const cleaned = stripMarkdownMarkers(raw.replace(/^位置[:：]\s*/u, ''))
    if (cleaned !== '' && !BARE_PRIORITY.test(cleaned)) {
      title = clampSummary(cleaned)
    }
  }

  const locationMatch = /位置[:：]?\s*([^。；;！？\n]+)/u.exec(rest)
  const location = locationMatch?.[1] === undefined ? '' : cleanField(locationMatch[1])

  const suggestionMatch = /建议[:：]?\s*([\s\S]*)$/u.exec(rest)
  const suggestion = suggestionMatch?.[1] === undefined ? '' : cleanField(suggestionMatch[1])

  const beforeSuggestion = suggestionMatch === null ? rest : rest.slice(0, suggestionMatch.index)
  const afterLocation = locationMatch === null
    ? beforeSuggestion
    : beforeSuggestion.slice(locationMatch.index + locationMatch[0].length)
  const problem = cleanField(afterLocation.replace(/^[。；;，,、—\-\s]+/u, '').replace(/^问题[:：]?\s*/u, ''))

  if (title === '' || BARE_PRIORITY.test(title)) {
    const firstProblemSentence = /^(.+?[。！？.!?])/u.exec(problem)?.[1] ?? problem
    const fromProblem = clampSummary(cleanField(firstProblemSentence))
    const fromLocation = clampSummary(stripMarkdownMarkers(location))
    const fromWork = summaryOf(work)
    title = fromProblem !== '' && !BARE_PRIORITY.test(fromProblem)
      ? fromProblem
      : fromLocation !== '' && !BARE_PRIORITY.test(fromLocation)
        ? fromLocation
        : fromWork
  }

  return {
    ...(priority === undefined ? {} : { priority }),
    title: title === '' || BARE_PRIORITY.test(title) ? summaryOf(itemText) : title,
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
 * 判断一行是否为 Markdown 表格行：以 `|` 开头且至少还有一根分隔符。
 * @param line - 报告原文的一行。
 * @returns 是否按表格数据处理。
 */
function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.indexOf('|', 1) > 0
}

/**
 * 去掉行首行尾的 `|` 后按 `|` 切列，单元格去首尾空白。
 * @param line - 一行 Markdown 表格文本。
 * @returns 单元格数组。
 */
function splitTableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/u, '').replace(/\|$/u, '')
  return inner.split('|').map(cell => cell.trim())
}

/**
 * 把表格里的严重度/优先级文字归一到既有优先级枚举。
 * @param text - 表格优先级列的文本。
 * @returns 归一后的优先级，未识别时缺省。
 */
function tablePriority(text: string): ReviewPriority | undefined {
  const value = text.trim()
  if (value.includes('高') || /high/iu.test(value)) return 'high'
  if (value.includes('中') || /medium/iu.test(value)) return 'medium'
  if (value.includes('低') || /low/iu.test(value)) return 'low'
  return undefined
}

/**
 * 解析一段连续的 Markdown 表格行，产出与列表解析同契约的待改项。
 *
 * 表头按列名映射，缺列名时按四列或五列的位置推断；分隔行与表头行跳过。
 * 单元格文本先经 `cleanField` 归一化，再拼成合成条目交给 `parseTodoItem`
 * 拆字段，保证 title/location/problem/suggestion 的口径与列表解析一致。
 * @param lines - 同一张表格的连续行。
 * @returns 表格数据行对应的待改项。
 */
function parseTableTodos(lines: readonly string[]): readonly ReviewTodo[] {
  const todos: ReviewTodo[] = []
  let columns: readonly TableColumn[] | undefined

  for (const line of lines) {
    const cells = splitTableCells(line)
    if (cells.length === 0 || cells.every(cell => TABLE_SEPARATOR_CELL.test(cell))) continue
    if (columns === undefined) {
      const mapped = cells.map(cell => TABLE_HEADER[cell.trim()])
      if (mapped.filter(column => column !== undefined).length >= 2) {
        columns = cells.map((cell, index) => TABLE_HEADER[cell.trim()] ?? FALLBACK_COLUMNS[index] ?? 'id')
        continue
      }
      columns = cells.length === 4
        ? FOUR_COLUMNS
        : cells.length >= 5
          ? FALLBACK_COLUMNS
          : []
    }
    const cell = (column: TableColumn): string => {
      const index = columns?.indexOf(column) ?? -1
      return index < 0 ? '' : (cells[index] ?? '').trim()
    }
    const problem = cleanField(cell('problem'))
    const location = cleanField(cell('location'))
    const suggestion = cleanField(cell('suggestion'))
    if (problem === '' && location === '' && suggestion === '') continue
    const priority = tablePriority(cell('priority'))
    const itemText = [
      problem,
      location === '' ? '' : `位置：${location}`,
      suggestion === '' ? '' : `建议：${suggestion}`,
      priority === undefined ? '' : `优先级：${priority === 'high' ? '高' : priority === 'medium' ? '中' : '低'}`,
    ].filter(part => part !== '').join('。')
    todos.push({ text: itemText, summary: summaryOf(itemText), ...parseTodoItem(itemText), problem })
  }
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
 * 摘要段与待改项段都支持列表和 Markdown 表格：同节混排时表格行不进摘要，
 * 表格按表头列名或固定列数拆出四要素，列表仍沿用原有续行与分类规则。
 * 待改项按高、中、低、无优先级稳定排序，同级保持原报告顺序。
 * @param text - `requirement_review_draft` 落盘的完整 Markdown 报告。
 * @returns 摘要文本与按优先级排序的待改项列表。
 */
export function parseReviewReport(text: string): ParsedReviewReport {
  const summaryLines: string[] = []
  const todoLines: string[] = []
  const tableBlocks: string[][] = []
  let tableBlock: string[] = []
  let section: 'summary' | 'todos' | undefined

  const flushTable = (): void => {
    if (tableBlock.length === 0) return
    tableBlocks.push(tableBlock)
    tableBlock = []
  }

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line)
    if (heading !== null) {
      flushTable()
      const title = heading[1]?.trim() ?? ''
      section = SUMMARY_HEADINGS.has(title) ? 'summary' : TODO_HEADINGS.has(title) ? 'todos' : undefined
      continue
    }
    if (isTableRow(line)) {
      if (section !== undefined) tableBlock.push(line)
      continue
    }
    flushTable()
    if (section === 'summary') summaryLines.push(line)
    if (section === 'todos') todoLines.push(line)
  }
  flushTable()

  const todos = [
    ...parseTodos(todoLines.join('\n')),
    ...tableBlocks.flatMap(block => parseTableTodos(block)),
  ].sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority))
  return { summary: summaryLines.join('\n').trim(), todos }
}

/**
 * 判断评审报告是否达到「可以确认」且无待改项的直接过审条件。
 * @param text - 评审报告 Markdown 原文。
 * @returns 结论小节包含「可以确认」、不含「需要修改」且解析后无待改项时返回 true。
 */
export function isConfirmableReviewReport(text: string): boolean {
  const conclusionLines: string[] = []
  let inConclusion = false
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^##\s+(?:结论|评审结论|总体结论)\s*$/u.test(line)) {
      inConclusion = true
      continue
    }
    if (inConclusion && /^##\s+/u.test(line)) break
    if (inConclusion) conclusionLines.push(line)
  }
  const conclusion = conclusionLines.join('\n')
  return conclusion.includes('可以确认')
    && !conclusion.includes('需要修改')
    && parseReviewReport(text).todos.length === 0
}
