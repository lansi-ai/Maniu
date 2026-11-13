/**
 * 任务详情的展示派生：把写给模型的原始 `description` 压成一句人话，并从约定里
 * 提炼人话要点。
 *
 * 摘要只做文本整形，不改投影数据；原文由详情页的「完整说明」折叠区原样呈现，
 * 所以清理与截断可以放心丢掉 Markdown 噪声。解析只认第一段含人话的文字：
 * 标题、清单与引用行不构成摘要，提到路径、台账编号或规格措辞的句子也整句跳过。
 *
 * 约定要点同样只读投影：默认视图只给几条人话主旨，完整四栏仍由折叠区原样展示。
 */

/** 摘要的字数上限；按 Unicode 码点计数，不拆代理对。 */
export const TASK_SUMMARY_LIMIT = 140

/** 行首的 Markdown 块级符号：标题、引用、无序/有序清单、任务框。 */
const BLOCK_MARKERS = [
  /^#{1,6}\s*/,
  /^>\s?/,
  /^(?:[-*+]|\d{1,3}[.)])(?:\s+|$)/,
  /^\[[ xX]\]\s*/,
] as const

/** 行首的来源前缀；中英混写都见过，大小写不敏感。 */
const TEXT_PREFIX = /^(?:需求依据|需求来源|需求背景|背景信息|背景|来源|依据|说明|描述|description|requirement|source|context|background)\s*[:：]\s*/i

/** 去掉前缀后只剩编号或文件路径的行：是引用，不是正文。 */
const CITATION = /^(?:[A-Za-z]{1,8}-\d{1,4}|[A-Za-z0-9_./-]+\.(?:md|yaml|yml|json|ts|tsx|js|jsx))$/

/** 判断一整段是不是只有标题行；这类段落是导航标签，不构成摘要正文。 */
const HEADING_LINE = /^#{1,6}\s*/

/** 句末标点；切句时留在句尾，拼回去仍是原句。 */
const SENTENCE_END = /(?<=[。；;!?！？])/

/** 技术引用特征：路径、台账编号、规格措辞。命中的句子整句不进摘要。 */
const TECHNICAL_REFERENCE = [
  /\.spec\b/i,
  /\.ya?ml\b/i,
  /\bREQ-\d+/i,
  /\bR-\d+/,
  /README/i,
  /契约/,
  /规格/,
  /需求依据/,
] as const

/**
 * 判断一句话是不是只在交代技术引用。
 * @param sentence - 已去掉行首符号的一句原文。
 * @returns 含路径、编号或规格措辞时为 `true`。
 */
function isTechnicalReference(sentence: string): boolean {
  return TECHNICAL_REFERENCE.some(pattern => pattern.test(sentence))
}

/** 拼句时两侧任一是中日韩文字或全角标点就不加空格。 */
const CJK_EDGE = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/

/**
 * 去掉行首的块级符号；`- # 标题` 这类叠加写法剥到不再变化为止。
 * @param line - 原始一行。
 * @returns 去掉行首符号并裁剪空白后的文本。
 */
function stripMarkers(line: string): string {
  let text = line.trim()
  for (let guard = 0; guard < 4; guard += 1) {
    const before = text
    for (const pattern of BLOCK_MARKERS) text = text.replace(pattern, '')
    text = text.trim()
    if (text === before) break
  }
  return text
}

/**
 * 去掉行内 Markdown 记号，保留可读内容。
 * @param line - 已去掉行首符号的一行。
 * @returns 去掉加粗、行内代码与链接语法后的文本。
 */
function stripInline(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim()
}

/**
 * 把一段里的软换行拼成一行；中文之间不插空格。
 * @param pieces - 已清理的非空行。
 * @returns 压成单行并合并多余空白的文本。
 */
function joinPieces(pieces: readonly string[]): string {
  let text = ''
  for (const piece of pieces) {
    if (text === '') {
      text = piece
      continue
    }
    const previous = text[text.length - 1] ?? ''
    const next = piece[0] ?? ''
    text += CJK_EDGE.test(previous) || CJK_EDGE.test(next) ? piece : ` ${piece}`
  }
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 清理一段文字；全是符号、引用或技术说明时返回空串。
 *
 * 段落先按行拆，再按句末标点拆句；含技术引用特征的句子整句丢弃，剩下的句子
 * 拼回一行。整段都被丢光时返回空串，由调用方换下一段。
 * @param paragraph - 原始段落。
 * @returns 可作为摘要的文本，没有有效文字时为空串。
 */
function paragraphText(paragraph: string): string {
  const pieces: string[] = []
  for (const rawLine of paragraph.split(/\r?\n/)) {
    for (const rawSentence of stripMarkers(rawLine).split(SENTENCE_END)) {
      if (isTechnicalReference(rawSentence)) continue
      const withoutPrefix = rawSentence.replace(TEXT_PREFIX, '').trim()
      if (withoutPrefix === '' || CITATION.test(withoutPrefix)) continue
      const sentence = stripInline(withoutPrefix)
      if (sentence !== '') pieces.push(sentence)
    }
  }
  return joinPieces(pieces)
}

/**
 * 把任意长度的单行摘要截到上限，超长时以省略号收尾。
 * @param text - 已压成单行的文本。
 * @param limit - 码点上限。
 * @returns 不超过 `limit` 个码点加省略号的文本。
 */
function truncateTo(text: string, limit: number): string {
  const chars = Array.from(text)
  if (chars.length <= limit) return text
  return `${chars.slice(0, limit).join('').trimEnd()}…`
}

/**
 * 把任意长度的单行摘要截到 {@link TASK_SUMMARY_LIMIT}。
 * @param text - 已压成单行的文本。
 * @returns 不超过上限加省略号的摘要。
 */
function truncate(text: string): string {
  return truncateTo(text, TASK_SUMMARY_LIMIT)
}

/**
 * 从任务原始描述派生一句人类可读的摘要。
 *
 * 取第一段落在人话上的文字，去掉 Markdown 块级符号与来源前缀，压成单行并截断到
 * {@link TASK_SUMMARY_LIMIT}；整段都在交代技术引用就换下一段，全部段落都没有
 * 可读内容时返回空串，界面只留标题与状态。
 * @param description - 任务 YAML 里的 `description` 原文。
 * @returns 单行摘要；没有有效文字时为空串。
 */
export function taskDescriptionSummary(description: string): string {
  if (description.trim() === '') return ''
  /** 只有标题的段落先当兜底，后面找不到正文时再用。 */
  let headingFallback = ''
  for (const paragraph of description.split(/\r?\n[ \t]*\r?\n/)) {
    const lines = paragraph.split(/\r?\n/).filter(line => line.trim() !== '')
    if (lines.length > 0 && lines.every(line => HEADING_LINE.test(line.trim()))) {
      if (headingFallback === '') headingFallback = paragraphText(paragraph)
      continue
    }
    const text = paragraphText(paragraph)
    if (text !== '') return truncate(text)
  }
  return headingFallback === '' ? '' : truncate(headingFallback)
}

/** 每栏最多取几条约定要点。 */
export const CONTRACT_HIGHLIGHT_LIMIT = 3

/** 要点正文的码点上限；比摘要短，保证一首屏能看完。 */
export const CONTRACT_HIGHLIGHT_TEXT_LIMIT = 90

/** 约定要点里冒号前的标签至少要有这么多码点，否则退回整句。 */
const MIN_COLON_HEAD = 4

/** 要点只保留首句：句末标点之后的内容进完整约定折叠。英文句点只在词尾算断句。 */
const HIGHLIGHT_SENTENCE_END = /[。；;!?！？]|\.(?=\s|$)/

/** 中英文冒号；冒号前通常是主旨，冒号后是细节。 */
const HIGHLIGHT_COLON = /[:：]/

/** 句尾标点与空白；要点末尾不保留，读起来更整齐。 */
const HIGHLIGHT_TAIL = /[。；;.!?！？、\s]+$/

/** 技术词特征：命中的条目不做首屏要点，技术条目不够时才回退。 */
const CONTRACT_TECHNICAL_TERM = [
  /\bSQL\b/i,
  /\bUNIQUE\b/i,
  /schema/i,
  /fastify/i,
  /better-sqlite3/i,
  /\btsx\b/i,
  /\bpnpm\b/i,
  /\.spec\b/i,
] as const

/** 一条约定要点：`label` 是栏名，`text` 是清理后的主旨。 */
export interface ContractHighlight {
  readonly label: string
  readonly text: string
}

/** 两栏的本地化栏名；纯函数不读词典，由调用方给。 */
export interface ContractHighlightLabels {
  readonly change: string
  readonly acceptance: string
}

/**
 * 把一条约定原文收成一句主旨：取首个非空行，剥掉 Markdown 与代码符号，
 * 依次尝试冒号前主旨与首句，最后截断到 {@link CONTRACT_HIGHLIGHT_TEXT_LIMIT}。
 * @param item - 约定数组里的一条原文。
 * @returns 可显示的主旨；清理后为空时为空串。
 */
function highlightText(item: string): string {
  const line = item.split(/\r?\n/).map(stripMarkers).find(text => text !== '') ?? ''
  const cleaned = stripInline(line)
  const sentence = trimTail((cleaned.split(HIGHLIGHT_SENTENCE_END)[0] ?? '').trim())
  const colon = sentence.search(HIGHLIGHT_COLON)
  const head = colon === -1 ? '' : trimTail(sentence.slice(0, colon).trim())
  const focus = Array.from(head).length >= MIN_COLON_HEAD ? head : sentence
  return truncateTo(focus, CONTRACT_HIGHLIGHT_TEXT_LIMIT)
}

/**
 * 去掉句尾的标点与空白。
 * @param text - 已裁剪的文本。
 * @returns 不以句末标点结尾的文本。
 */
function trimTail(text: string): string {
  return text.replace(HIGHLIGHT_TAIL, '').trim()
}

/**
 * 一栏约定取至多 {@link CONTRACT_HIGHLIGHT_LIMIT} 条要点：先取不含技术词的条目，
 * 不够时再按原顺序回退到技术条目；同一栏里重复的主旨只留第一条。
 * @param items - 一栏约定原文。
 * @param label - 这一栏的本地化名称。
 * @returns 该栏的要点；没有可读条目时为空数组。
 */
function highlightSection(items: readonly string[], label: string): readonly ContractHighlight[] {
  const rows = items
    .map(item => ({ text: highlightText(item), technical: CONTRACT_TECHNICAL_TERM.some(term => term.test(item)) }))
    .filter(row => row.text !== '')
  const seen = new Set<string>()
  const picked: ContractHighlight[] = []
  for (const technical of [false, true]) {
    for (const row of rows) {
      if (row.technical !== technical || seen.has(row.text)) continue
      seen.add(row.text)
      picked.push({ label, text: row.text })
      if (picked.length === CONTRACT_HIGHLIGHT_LIMIT) return picked
    }
  }
  return picked
}

/**
 * 从一份约定派生人话要点：要交付什么与怎么验收各最多三条。
 *
 * 默认视图只显示这些要点，完整四栏由界面折叠区原样展示；这里不改投影，
 * 也不替模型补充内容。
 * @param contract - 约定投影，只读 `change` 与 `acceptance` 两栏。
 * @param labels - 两栏的本地化名称。
 * @returns 先「要交付什么」后「怎么验收」的要点；没有可读条目时为空数组。
 */
export function contractHighlights(
  contract: { readonly change: readonly string[]; readonly acceptance: readonly string[] },
  labels: ContractHighlightLabels,
): readonly ContractHighlight[] {
  return [
    ...highlightSection(contract.change, labels.change),
    ...highlightSection(contract.acceptance, labels.acceptance),
  ]
}
