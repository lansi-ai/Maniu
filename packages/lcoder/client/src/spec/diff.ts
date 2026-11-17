/** 需求正文的行级差异：提案对比视图用它列变更条目并给全文对照着色。 */

/** 一行差异的类型：未变、新增、删除。 */
export type DiffLineKind = 'same' | 'added' | 'removed'

/** 一行差异。 */
export interface DiffLine {
  readonly kind: DiffLineKind
  readonly text: string
}

/** 一条变更条目：新增或删除的章节标题/清单条目。 */
export interface DiffEntry {
  readonly kind: 'added' | 'removed'
  readonly text: string
}

/** LCS 动态规划的规模上限；超过时中段整体按删除加新增处理，不做逐行对齐。 */
const LCS_CELL_LIMIT = 4_000_000

/**
 * 逐行比对两份正文：先去掉公共前后缀，中段用 LCS 对齐；超大文档中段整体记为删除加新增。
 * @param oldText - 旧正文。
 * @param newText - 新正文。
 * @returns 按阅读顺序排列的差异行；旧正文行只出现在 same/removed，新正文行只出现在 same/added。
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  let head = 0
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head += 1
  let oldTail = oldLines.length
  let newTail = newLines.length
  while (oldTail > head && newTail > head && oldLines[oldTail - 1] === newLines[newTail - 1]) {
    oldTail -= 1
    newTail -= 1
  }

  const result: DiffLine[] = oldLines.slice(0, head).map(text => ({ kind: 'same', text }))
  const oldMid = oldLines.slice(head, oldTail)
  const newMid = newLines.slice(head, newTail)
  if (oldMid.length * newMid.length > LCS_CELL_LIMIT) {
    for (const text of oldMid) result.push({ kind: 'removed', text })
    for (const text of newMid) result.push({ kind: 'added', text })
  } else {
    pushLcs(result, oldMid, newMid)
  }
  for (const text of oldLines.slice(oldTail)) result.push({ kind: 'same', text })
  return result
}

/** LCS 对齐中段并追加差异行；表按 (n+1)*(m+1) 存最长公共子序列长度。 */
function pushLcs(result: DiffLine[], oldMid: readonly string[], newMid: readonly string[]): void {
  const n = oldMid.length
  const m = newMid.length
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = oldMid[i] === newMid[j]
        ? (table[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    const oldLine = oldMid[i] ?? ''
    const newLine = newMid[j] ?? ''
    if (oldLine === newLine) {
      result.push({ kind: 'same', text: oldLine })
      i += 1
      j += 1
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      result.push({ kind: 'removed', text: oldLine })
      i += 1
    } else {
      result.push({ kind: 'added', text: newLine })
      j += 1
    }
  }
  while (i < n) {
    result.push({ kind: 'removed', text: oldMid[i] ?? '' })
    i += 1
  }
  while (j < m) {
    result.push({ kind: 'added', text: newMid[j] ?? '' })
    j += 1
  }
}

/** 章节标题或清单条目的形态：Markdown 标题行与无序/有序列表行。 */
function isEntry(text: string): boolean {
  const trimmed = text.trim()
  return /^#{1,6}\s/.test(trimmed) || /^([-*+]|\d+[.)])\s/.test(trimmed)
}

/**
 * 从差异行里提取变更的章节与清单条目，供对比视图列「改了哪些条目」。
 * @param lines - 逐行差异。
 * @returns 新增与删除的条目，按出现顺序。
 */
export function changedEntries(lines: readonly DiffLine[]): DiffEntry[] {
  return lines.flatMap((line): DiffEntry[] => {
    if (line.kind === 'same' || !isEntry(line.text)) return []
    return [{ kind: line.kind, text: line.text.trim() }]
  })
}
