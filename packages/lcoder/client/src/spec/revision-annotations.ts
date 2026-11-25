/** 需求正文跨版本批注的纯函数派生：语义分块、逐版血缘、删除锚定与词级片段。 */

/** Markdown 语义块的排版类型。 */
export type RevisionBlockKind = 'heading' | 'paragraph' | 'list' | 'table' | 'code' | 'quote'

/** 一处批注的变更类型。 */
export type RevisionChangeKind = 'added' | 'modified' | 'removed'

/** 词级片段的类型：未变、删除、新增。 */
export type SegmentKind = 'equal' | 'removed' | 'added'

/** 一个词级片段。 */
export interface DiffSegment {
  readonly kind: SegmentKind
  readonly text: string
}

/** 一个语义块；`id` 在版本对齐后保持稳定，用于批注与正文互指。 */
export interface SemanticBlock {
  readonly id: string
  readonly kind: RevisionBlockKind
  readonly text: string
}

/** 一份按版本号升序排列的正文快照。 */
export interface VersionSnapshot {
  readonly version: number
  readonly at: string
  readonly note?: string | undefined
  readonly text: string
}

/** 一条修补摘要，用于没有逐版备注时补出修改原因。 */
export interface AmendmentSummary {
  readonly at: string
  readonly summary: string
}

/** 某版对某个块的一次变更。 */
export interface AnnotationEntry {
  readonly version: number
  readonly at: string
  readonly note?: string | undefined
  readonly kind: 'added' | 'modified'
  readonly segments: readonly DiffSegment[]
}

/** 一个被删除块的原文片段。 */
export interface RemovedEntry {
  readonly version: number
  readonly at: string
  readonly note?: string | undefined
  readonly segments: readonly DiffSegment[]
}

/** 删除内容在当前正文里的锚点；`blockId` 为空表示文首或文尾。 */
export interface DeletionAnchor {
  readonly blockId: string | null
  readonly side: 'before' | 'after' | 'start' | 'end'
}

/** 右侧批注卡；`entries` 与 `deletions` 都按时间倒序。 */
export interface AnnotationCard {
  readonly id: string
  readonly kind: RevisionChangeKind
  readonly blockId: string
  readonly entries: readonly AnnotationEntry[]
  readonly deletions: readonly RemovedEntry[]
  readonly anchor?: DeletionAnchor | undefined
  readonly reason?: string | undefined
  readonly latestVersion: number
  readonly latestAt: string
}

/** 派生结果：当前正文的分块、批注卡与版本筛选范围。 */
export interface RevisionAnnotations {
  readonly blocks: readonly SemanticBlock[]
  readonly cards: readonly AnnotationCard[]
  readonly changeCount: number
  readonly versions: readonly number[]
}

/** 版本筛选：`all` 不过滤，数字只留该版本留下的批注。 */
export type VersionFilter = 'all' | number

interface Lineage {
  readonly id: string
  kind: RevisionBlockKind
  text: string
  origin: 'initial' | 'added'
  entries: AnnotationEntry[]
}

interface RemovalRecord {
  readonly index: number
  readonly anchorIndex: number | null
  readonly side: DeletionAnchor['side']
  readonly text: string
  readonly kind: RevisionBlockKind
}

interface AlignResult {
  readonly ids: readonly string[]
  readonly entries: ReadonlyMap<number, AnnotationEntry>
  readonly removals: readonly RemovalRecord[]
}

interface OrderedCard {
  readonly card: AnnotationCard
  readonly order: number
}

interface Op {
  readonly type: 'same' | 'removed' | 'added'
  readonly prev: number
  readonly next: number
}

const LCS_CELL_LIMIT = 1_000_000

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|')
}

function isListLine(line: string): boolean {
  return /^(?:[-*+]|\d{1,3}[.)])\s+\S/u.test(line.trim())
}

function isSpecial(line: string): boolean {
  return /^```|^#{1,6}\s|^>\s?|^(?:[-*+]|\d{1,3}[.)])\s+|^\|/u.test(line.trim())
}

/**
 * 按 Markdown 渲染边界切分正文，保留原文与顺序。
 * @param text - 一版 Markdown 正文。
 * @returns 带稳定序号的语义块。
 */
export function splitMarkdownBlocks(text: string): readonly SemanticBlock[] {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  const blocks: SemanticBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') { index += 1; continue }
    const start = index
    let kind: RevisionBlockKind
    if (/^```/u.test(line.trim())) {
      kind = 'code'
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) index += 1
      if (index < lines.length) index += 1
    } else if (/^#{1,6}\s/u.test(line)) {
      kind = 'heading'
      index += 1
    } else if (/^>\s?/u.test(line)) {
      kind = 'quote'
      while (index < lines.length && /^>\s?/u.test(lines[index] ?? '')) index += 1
    } else if (isTableRow(line) && index + 1 < lines.length
      && /^\|[\s:|-]+\|$/u.test((lines[index + 1] ?? '').trim())) {
      kind = 'table'
      index += 2
      while (index < lines.length && isTableRow(lines[index] ?? '')) index += 1
    } else if (isListLine(line)) {
      kind = 'list'
      while (index < lines.length && isListLine(lines[index] ?? '')) index += 1
    } else {
      kind = 'paragraph'
      index += 1
      while (index < lines.length) {
        const next = (lines[index] ?? '').trim()
        if (next === '' || isSpecial(next)) break
        index += 1
      }
    }
    blocks.push({ id: `b${String(blocks.length)}`, kind, text: lines.slice(start, index).join('\n') })
  }
  return blocks
}

function tokenize(text: string): readonly string[] {
  return text.match(/[\u3400-\u9fff]|[A-Za-z0-9_]+|\s+|[^\s]/gu) ?? []
}

/**
 * 词级与字符级混合差异：中文逐字、英文按词，连续同类的 LCS 结果合并为一段。
 * @param oldText - 旧文本。
 * @param newText - 新文本。
 * @returns 按阅读顺序排列的片段。
 */
export function diffSegments(oldText: string, newText: string): readonly DiffSegment[] {
  if (oldText === newText) return [{ kind: 'equal', text: oldText }]
  const before = tokenize(oldText)
  const after = tokenize(newText)
  if (before.length * after.length > LCS_CELL_LIMIT) {
    return [
      ...(before.length === 0 ? [] : [{ kind: 'removed' as const, text: before.join('') }]),
      ...(after.length === 0 ? [] : [{ kind: 'added' as const, text: after.join('') }]),
    ]
  }
  const width = after.length + 1
  const table = new Uint32Array((before.length + 1) * width)
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = before[i] === after[j]
        ? (table[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
    }
  }
  const raw: DiffSegment[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      raw.push({ kind: 'equal', text: before[i] ?? '' })
      i += 1
      j += 1
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      raw.push({ kind: 'removed', text: before[i] ?? '' })
      i += 1
    } else {
      raw.push({ kind: 'added', text: after[j] ?? '' })
      j += 1
    }
  }
  while (i < before.length) { raw.push({ kind: 'removed', text: before[i] ?? '' }); i += 1 }
  while (j < after.length) { raw.push({ kind: 'added', text: after[j] ?? '' }); j += 1 }
  const merged: DiffSegment[] = []
  for (const segment of raw) {
    const last = merged[merged.length - 1]
    if (last?.kind === segment.kind) merged[merged.length - 1] = { kind: last.kind, text: last.text + segment.text }
    else merged.push(segment)
  }
  return merged
}

function lcsOps(before: readonly string[], after: readonly string[]): readonly Op[] {
  const n = before.length
  const m = after.length
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = before[i] === after[j]
        ? (table[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) { ops.push({ type: 'same', prev: i, next: j }); i += 1; j += 1 }
    else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      ops.push({ type: 'removed', prev: i, next: j }); i += 1
    } else {
      ops.push({ type: 'added', prev: i, next: j }); j += 1
    }
  }
  while (i < n) { ops.push({ type: 'removed', prev: i, next: j }); i += 1 }
  while (j < m) { ops.push({ type: 'added', prev: i, next: j }); j += 1 }
  return ops
}

/** 把一段连续增删按同类优先配成「修改」，剩下的仍是新增或删除。 */
function pairGap(gap: readonly Op[], beforeKinds: readonly RevisionBlockKind[], afterBlocks: readonly SemanticBlock[]): readonly (Op | { type: 'modified'; prev: number; next: number })[] {
  const removed = gap.filter(op => op.type === 'removed')
  const added = gap.filter(op => op.type === 'added')
  const used = new Set<number>()
  const pairs: { prev: number; next: number }[] = []
  for (const removal of removed) {
    const match = added.find((entry, index) => !used.has(index)
      && afterBlocks[entry.next]?.kind === beforeKinds[removal.prev])
    if (match !== undefined) {
      used.add(added.indexOf(match))
      pairs.push({ prev: removal.prev, next: match.next })
    }
  }
  for (const removal of removed) {
    if (pairs.some(pair => pair.prev === removal.prev)) continue
    const index = added.findIndex((entry, at) => !used.has(at) && !pairs.some(pair => pair.next === entry.next))
    if (index < 0) break
    used.add(index)
    pairs.push({ prev: removal.prev, next: added[index]?.next ?? 0 })
  }
  const pairedPrev = new Set(pairs.map(pair => pair.prev))
  const pairedNext = new Set(pairs.map(pair => pair.next))
  const result: (Op | { type: 'modified'; prev: number; next: number })[] = []
  for (const op of gap) {
    if (op.type === 'added' && pairedNext.has(op.next)) continue
    if (op.type === 'removed' && pairedPrev.has(op.prev)) continue
    result.push(op)
  }
  for (const pair of pairs) result.push({ type: 'modified', ...pair })
  return result.sort((left, right) => left.next - right.next)
}

/**
 * 对齐相邻两版的语义块：未变块沿用血缘，增删块按同类优先配成修改并记录删除锚点。
 * @param before - 上一版的语义块。
 * @param beforeIds - 上一版各块对应的血缘编号。
 * @param after - 下一版的语义块（或当前正文）。
 * @param snapshot - 下一版的版本信息。
 * @param nextId - 为新增血缘分配编号。
 * @returns 下一版的血缘编号、逐块变更与删除记录。
 */
function alignBlocks(
  before: readonly SemanticBlock[],
  beforeIds: readonly string[],
  after: readonly SemanticBlock[],
  snapshot: VersionSnapshot,
  nextId: () => string,
): AlignResult {
  const ops = lcsOps(before.map(block => block.text), after.map(block => block.text))
  const grouped: (Op | { type: 'modified'; prev: number; next: number })[] = []
  for (let index = 0; index < ops.length;) {
    if (ops[index]?.type === 'same') {
      grouped.push(ops[index] as Op)
      index += 1
      continue
    }
    let end = index
    while (end < ops.length && ops[end]?.type !== 'same') end += 1
    grouped.push(...pairGap(ops.slice(index, end), before.map(block => block.kind), after))
    index = end
  }
  const ids: string[] = Array.from({ length: after.length }, () => '')
  const entries = new Map<number, AnnotationEntry>()
  const removals: RemovalRecord[] = []
  const meta = { version: snapshot.version, at: snapshot.at, ...(snapshot.note === undefined ? {} : { note: snapshot.note }) }
  for (const op of grouped) {
    if (op.type === 'same') {
      ids[op.next] = beforeIds[op.prev] ?? ''
    } else if (op.type === 'modified') {
      ids[op.next] = beforeIds.at(op.prev) ?? ''
      const oldText = before.at(op.prev)?.text ?? ''
      const newText = after.at(op.next)?.text ?? ''
      entries.set(op.next, { ...meta, kind: 'modified', segments: diffSegments(oldText, newText) })
    } else if (op.type === 'added') {
      ids[op.next] = nextId()
      const newText = after.at(op.next)?.text ?? ''
      entries.set(op.next, { ...meta, kind: 'added', segments: [{ kind: 'added', text: newText }] })
    } else {
      const cursor = op.next
      const anchorIndex = cursor < after.length ? cursor : cursor > 0 ? cursor - 1 : null
      removals.push({
        index: op.prev,
        anchorIndex,
        side: anchorIndex === null ? 'start' : cursor < after.length ? 'before' : 'after',
        text: before.at(op.prev)?.text ?? '',
        kind: before.at(op.prev)?.kind ?? 'paragraph',
      })
    }
  }
  return { ids, entries, removals }
}

function reasonOf(
  entry: { readonly at: string; readonly note?: string | undefined },
  amendments: readonly AmendmentSummary[],
): string | undefined {
  if (entry.note !== undefined && entry.note !== '') return entry.note
  return amendments.find(amendment => amendment.at === entry.at)?.summary
}

/**
 * 从升序快照与当前正文派生批注数据；不做任何文件读写。
 * @param snapshots - 版本号升序的快照，至少一份。
 * @param currentText - 当前草稿正文。
 * @param amendments - 轻量修补摘要，用于补出缺省的修改原因。
 * @returns 当前分块、批注卡与可筛选版本。
 */
export function deriveRevisionAnnotations(
  snapshots: readonly VersionSnapshot[],
  currentText: string,
  amendments: readonly AmendmentSummary[] = [],
): RevisionAnnotations {
  const ordered = [...snapshots].sort((left, right) => left.version - right.version)
  if (ordered.length === 0) {
    const blocks = splitMarkdownBlocks(currentText)
    return { blocks, cards: [], changeCount: 0, versions: [] }
  }
  const first = splitMarkdownBlocks(ordered[0]?.text ?? '')
  const lineages = new Map<string, Lineage>(first.map((block, index) => [
    `b${String(index)}`,
    { id: `b${String(index)}`, kind: block.kind, text: block.text, origin: 'initial', entries: [] },
  ]))
  let blockIds: readonly string[] = first.map(block => block.id)
  let versionIndex = 1
  let counter = 0
  const nextId = (): string => `c${String(counter++)}`
  const deletions: { entry: RemovedEntry; anchor: DeletionAnchor }[] = []

  const apply = (before: readonly SemanticBlock[], after: readonly SemanticBlock[], snapshot: VersionSnapshot): void => {
    const result = alignBlocks(before, blockIds, after, snapshot, nextId)
    const ids = result.ids.map(id => id === '' ? nextId() : id)
    for (let index = 0; index < after.length; index += 1) {
      const entry = result.entries.get(index)
      if (entry === undefined) continue
      const id = ids[index] ?? ''
      let lineage = lineages.get(id)
      if (lineage === undefined) {
        lineage = { id, kind: after[index]?.kind ?? 'paragraph', text: '', origin: 'added', entries: [] }
        lineages.set(id, lineage)
      }
      lineage.entries.unshift(entry)
      lineage.text = after[index]?.text ?? ''
      lineage.kind = after[index]?.kind ?? 'paragraph'
    }
    for (const removal of result.removals) {
      const anchorId = removal.anchorIndex === null ? null : ids[removal.anchorIndex] ?? null
      const anchor: DeletionAnchor = removal.anchorIndex === null
        ? { blockId: null, side: 'start' }
        : { blockId: anchorId, side: removal.side }
      deletions.push({
        entry: {
          version: snapshot.version,
          at: snapshot.at,
          ...(snapshot.note === undefined ? {} : { note: snapshot.note }),
          segments: [{ kind: 'removed', text: removal.text }],
        },
        anchor,
      })
    }
    blockIds = ids
  }

  while (versionIndex < ordered.length) {
    const previous = ordered[versionIndex - 1] as VersionSnapshot
    const current = ordered[versionIndex] as VersionSnapshot
    apply(splitMarkdownBlocks(previous.text), splitMarkdownBlocks(current.text), current)
    versionIndex += 1
  }

  const latest = ordered[ordered.length - 1] as VersionSnapshot
  const currentBlocks = splitMarkdownBlocks(currentText)
  if (currentText !== latest.text) apply(splitMarkdownBlocks(latest.text), currentBlocks, latest)

  const order = new Map(blockIds.map((id, index) => [id, index]))
  const orderedCards: OrderedCard[] = []
  for (const lineage of lineages.values()) {
    const newest = lineage.entries[0]
    if (newest === undefined) continue
    orderedCards.push({
      order: order.get(lineage.id) ?? Number.MAX_SAFE_INTEGER,
      card: {
        id: `ann-${lineage.id}`,
        kind: lineage.origin === 'added' ? 'added' : 'modified',
        blockId: lineage.id,
        entries: lineage.entries,
        deletions: [],
        reason: reasonOf(newest, amendments),
        latestVersion: newest.version,
        latestAt: newest.at,
      },
    })
  }
  // 同一版本、同一锚点处删除的多个块合成一张卡，正文锚点直接给出真实删除处数。
  const groups = new Map<string, { readonly entry: RemovedEntry; readonly anchor: DeletionAnchor; entries: RemovedEntry[] }>()
  for (const deletion of deletions) {
    const key = `${String(deletion.entry.version)}|${deletion.anchor.blockId ?? ''}|${deletion.anchor.side}`
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, {
        entry: deletion.entry,
        anchor: deletion.anchor,
        entries: [deletion.entry],
      })
    } else {
      existing.entries.push(deletion.entry)
    }
  }
  for (const group of groups.values()) {
    const newest = group.entry
    const anchorIndex = group.anchor.blockId === null ? -1 : order.get(group.anchor.blockId) ?? -1
    const position = anchorIndex < 0
      ? (group.anchor.side === 'end' ? Number.MAX_SAFE_INTEGER : -1)
      : anchorIndex + (group.anchor.side === 'before' ? -0.5 : 0.5)
    orderedCards.push({
      order: position,
      card: {
        id: `ann-del-${String(orderedCards.length)}`,
        kind: 'removed',
        blockId: group.anchor.blockId ?? '',
        entries: [],
        deletions: group.entries,
        anchor: group.anchor,
        reason: reasonOf(newest, amendments),
        latestVersion: newest.version,
        latestAt: newest.at,
      },
    })
  }
  orderedCards.sort((left, right) =>
    left.order - right.order
    || right.card.latestVersion - left.card.latestVersion
    || left.card.id.localeCompare(right.card.id))
  const cards = orderedCards.map(entry => entry.card)
  return {
    blocks: currentBlocks.map((block, index) => ({ ...block, id: blockIds[index] ?? block.id })),
    cards,
    changeCount: cards.length,
    versions: [...new Set(ordered.map(snapshot => snapshot.version))].sort((left, right) => left - right),
  }
}

/** 当前筛选下保留的批注卡。 */
export function visibleAnnotationCards(
  cards: readonly AnnotationCard[],
  filter: VersionFilter,
): readonly AnnotationCard[] {
  if (filter === 'all') return cards
  return cards.filter(card =>
    card.entries.some(entry => entry.version === filter) || card.deletions.some(entry => entry.version === filter))
}

/** 当前筛选下需要在正文高亮的块编号。 */
export function visibleAnnotationBlockIds(
  cards: readonly AnnotationCard[],
  filter: VersionFilter,
): ReadonlySet<string> {
  return new Set(visibleAnnotationCards(cards, filter)
    .filter(card => card.kind !== 'removed')
    .map(card => card.blockId))
}
