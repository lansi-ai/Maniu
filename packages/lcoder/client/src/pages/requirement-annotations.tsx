/** 需求正文的只读修改批注：吸顶版本筛选条与逐块双栏配对，不提供输入或改稿入口。 */

import { useState } from 'react'
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Button, Chip } from '@heroui/react'
import { ChevronDown, ChevronUp, MessageSquareText } from 'lucide-react'
import { renderMarkdown } from '../markdown/markdown.tsx'
import { visibleAnnotationBlockIds, visibleAnnotationCards } from '../spec/revision-annotations.ts'
import type {
  AnnotationCard,
  DiffSegment,
  RevisionAnnotations,
  VersionFilter,
} from '../spec/revision-annotations.ts'
import type { MessageKey, Translate } from '../locale.ts'

/** 批注卡默认显示的可见字数上限。 */
const SEGMENT_CHAR_LIMIT = 160

/** 变更类型标签的语义色与词典键。 */
const KIND_STYLE: Readonly<Record<AnnotationCard['kind'], { readonly color: 'success' | 'warning' | 'danger'; readonly key: MessageKey }>> = {
  added: { color: 'success', key: 'requirement.annotations.kindAdded' },
  modified: { color: 'warning', key: 'requirement.annotations.kindModified' },
  removed: { color: 'danger', key: 'requirement.annotations.kindRemoved' },
}

/** ISO 时间压成 `MM-DD HH:mm`；解析不了时原样返回。 */
function shortTime(value: string): string {
  const trimmed = value.trim()
  const ms = Date.parse(trimmed)
  if (Number.isNaN(ms)) return trimmed
  const date = new Date(ms)
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 批注切换按钮；带总修改处数角标，仅多版本需求渲染。 */
export interface AnnotationToggleProps {
  readonly open: boolean
  readonly count: number
  readonly t: Translate
  readonly onToggle: () => void
}

/**
 * 渲染正文工具栏里的只读批注开关。
 * @param props - 开关状态、修改处数与回调。
 * @returns 图标按钮。
 */
export function AnnotationToggle(props: AnnotationToggleProps): JSX.Element {
  const label = props.t(props.open ? 'requirement.annotations.hide' : 'requirement.annotations.show')
  return (
    <Button
      isIconOnly
      size="sm"
      variant={props.open ? 'primary' : 'ghost'}
      className="requirement-annotation-toggle"
      data-testid="requirement-annotation-toggle"
      data-open={props.open ? 'true' : 'false'}
      aria-label={label}
      aria-pressed={props.open}
      ref={(node) => { if (node !== null) node.title = label }}
      onPress={props.onToggle}
    >
      <MessageSquareText size={14} aria-hidden="true" />
      <span className="requirement-annotation-badge" data-testid="requirement-annotation-badge">{props.count}</span>
    </Button>
  )
}

/** 带来源变更类型的单个字符，用于在不丢字的前提下改写片段文本。 */
interface DiffChar {
  readonly ch: string
  readonly kind: DiffSegment['kind']
}

/** 按可见字数折叠片段的结果。 */
export interface FoldedSegments {
  readonly shown: readonly DiffSegment[]
  readonly hidden: boolean
}

/** 把片段展开成字符序列，逐字符记下来源变更类型；按 UTF-16 码元拆分以与标记位置对齐。 */
function toDiffChars(segments: readonly DiffSegment[]): DiffChar[] {
  const chars: DiffChar[] = []
  for (const segment of segments) {
    for (let index = 0; index < segment.text.length; index += 1) {
      chars.push({ ch: segment.text.charAt(index), kind: segment.kind })
    }
  }
  return chars
}

/** 单词字符判定：字母、数字与下划线，用于避免把标识符里的下划线当成强调标记。 */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch)
}

/** 去掉行首标题标记，并把行首无序列表符号换成圆点；缩进原样保留。 */
function stripLineStartMarkers(chars: DiffChar[]): DiffChar[] {
  const dropped = new Array<boolean>(chars.length).fill(false)
  let lineStart = 0
  while (lineStart < chars.length) {
    let lineEnd = lineStart
    while (lineEnd < chars.length && chars[lineEnd]?.ch !== '\n') lineEnd += 1
    let marker = lineStart
    while (marker < lineEnd && (chars[marker]?.ch === ' ' || chars[marker]?.ch === '\t')) marker += 1
    let hashes = 0
    let hashEnd = marker
    while (hashEnd < lineEnd && chars[hashEnd]?.ch === '#' && hashes < 6) {
      hashes += 1
      hashEnd += 1
    }
    if (hashes > 0) {
      for (let index = marker; index < hashEnd; index += 1) dropped[index] = true
      while (hashEnd < lineEnd && (chars[hashEnd]?.ch === ' ' || chars[hashEnd]?.ch === '\t')) {
        dropped[hashEnd] = true
        hashEnd += 1
      }
    } else if (
      marker + 1 < lineEnd
      && (chars[marker]?.ch === '-' || chars[marker]?.ch === '*' || chars[marker]?.ch === '+')
      && chars[marker + 1]?.ch === ' '
    ) {
      chars[marker] = { ch: '•', kind: chars[marker]?.kind ?? 'equal' }
    }
    lineStart = lineEnd + 1
  }
  return chars.filter((_char, index) => dropped[index] !== true)
}

/**
 * 标记成对定界符的位置，只删标记、保留内容。
 * @param text - 待处理文本。
 * @param dropped - 与文本等长的删除标记，按位置写入。
 * @param delimiter - 定界符字面量。
 * @param pairedOnlyAtWordEdge - 是否要求开口前与收口后都是非单词边界。
 */
function markDelimiter(text: string, dropped: boolean[], delimiter: string, pairedOnlyAtWordEdge: boolean): void {
  const width = delimiter.length
  let index = 0
  while (index < text.length) {
    if (dropped[index] === true || !text.startsWith(delimiter, index)) {
      index += 1
      continue
    }
    const openEdge = !pairedOnlyAtWordEdge || index === 0 || !isWordChar(text[index - 1])
    if (!openEdge || text[index + width] === undefined || /\s/u.test(text[index + width] ?? '')) {
      index += width
      continue
    }
    let closeAt = -1
    let scan = index + width
    while (scan < text.length) {
      if (dropped[scan] === true) {
        scan += 1
        continue
      }
      if (text.startsWith(delimiter, scan) && scan > index + width) {
        const closeEdge = !pairedOnlyAtWordEdge || scan + width >= text.length || !isWordChar(text[scan + width])
        if (closeEdge && !/\s/u.test(text[scan - 1] ?? '')) {
          closeAt = scan
          break
        }
      }
      scan += 1
    }
    if (closeAt === -1) {
      index += width
      continue
    }
    for (let offset = 0; offset < width; offset += 1) {
      dropped[index + offset] = true
      dropped[closeAt + offset] = true
    }
    index = closeAt + width
  }
}

/** 标记反引号、链接地址与强调标记的位置；内容本身全部保留。 */
function markInlineMarkers(text: string): boolean[] {
  const dropped = new Array<boolean>(text.length).fill(false)
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '`') dropped[index] = true
  }
  for (const match of text.matchAll(/\[([^\]\n]*)\]\(([^)\n]*)\)/gu)) {
    const start = match.index
    const label = match[1] ?? ''
    dropped[start] = true
    for (let index = start + 1 + label.length; index < start + match[0].length; index += 1) dropped[index] = true
  }
  markDelimiter(text, dropped, '**', false)
  markDelimiter(text, dropped, '__', false)
  markDelimiter(text, dropped, '*', true)
  markDelimiter(text, dropped, '_', true)
  return dropped
}

/**
 * 清理批注片段里的 Markdown 标记，只改显示文本，不改片段类型。
 *
 * 段落行的标题与列表标记、强调、行内代码与链接都按显示语序改写；删除片段同样清理，
 * 仍保留 `removed` 类型以便继续画删除线。
 * @param segments - 待展示的词级片段。
 * @returns 清理后的片段；相邻同类型片段合并，空片段丢弃。
 */
export function cleanDiffSegments(segments: readonly DiffSegment[]): readonly DiffSegment[] {
  const chars = stripLineStartMarkers(toDiffChars(segments))
  const text = chars.map(char => char.ch).join('')
  const dropped = markInlineMarkers(text)
  const merged: { kind: DiffSegment['kind']; text: string }[] = []
  for (let index = 0; index < chars.length; index += 1) {
    if (dropped[index] === true) continue
    const char = chars[index]
    if (char === undefined) continue
    const last = merged[merged.length - 1]
    if (last !== undefined && last.kind === char.kind) last.text += char.ch
    else merged.push({ kind: char.kind, text: char.ch })
  }
  return merged
}

/**
 * 从片段头部累计可见字数，超出上限时在片段中间截断并保持该片段类型。
 * @param segments - 已清理的片段。
 * @param limit - 可见字数上限；非正数表示不展示任何内容。
 * @returns 折叠后的片段与是否存在被截掉的内容。
 */
export function foldSegmentsByChars(segments: readonly DiffSegment[], limit: number): FoldedSegments {
  const shown: DiffSegment[] = []
  let remaining = Math.max(limit, 0)
  let hidden = false
  for (const segment of segments) {
    if (segment.text.length === 0) continue
    if (remaining <= 0) {
      hidden = true
      continue
    }
    if (segment.text.length <= remaining) {
      shown.push(segment)
      remaining -= segment.text.length
      continue
    }
    shown.push({ kind: segment.kind, text: segment.text.slice(0, remaining) })
    remaining = 0
    hidden = true
  }
  return { shown, hidden }
}

/** 词级片段的展示属性。 */
interface SegmentViewProps {
  readonly segments: readonly DiffSegment[]
  readonly folded: boolean
  readonly t: Translate
}

/** 渲染红删除线与绿新增的片段；相同片段按原样排进正文语序。 */
function SegmentView({ segments, folded, t }: SegmentViewProps): JSX.Element {
  return (
    <>
      {segments.map((segment, index) => {
        const key = `seg-${String(index)}`
        if (segment.kind === 'removed') return <del key={key} className="revision-seg-removed">{segment.text}</del>
        if (segment.kind === 'added') return <ins key={key} className="revision-seg-added">{segment.text}</ins>
        return <span key={key}>{segment.text}</span>
      })}
      {folded && <span className="revision-seg-ellipsis">…</span>}
      {folded && <span className="revision-seg-fold-note">{t('requirement.annotations.segmentsFolded')}</span>}
    </>
  )
}

/** 吸顶版本筛选条属性。 */
export interface RevisionAnnotationFiltersProps {
  readonly data: RevisionAnnotations
  readonly filter: VersionFilter
  readonly t: Translate
  readonly onFilter: (filter: VersionFilter) => void
}

/**
 * 渲染批注视图顶部的版本胶囊与当前匹配条数。
 * @param props - 派生数据、当前筛选与筛选回调。
 * @returns 版本筛选条；由调用方放进吸顶容器。
 */
export function RevisionAnnotationFilters({
  data, filter, t, onFilter,
}: RevisionAnnotationFiltersProps): JSX.Element {
  const visible = visibleAnnotationCards(data.cards, filter)
  const versions = data.versions.filter(version => version > 1)
  return (
    <div className="requirement-annotation-filter-bar" data-testid="requirement-annotation-filter-bar">
      <div className="revision-annotation-filters" role="group" aria-label={t('requirement.annotations.filterLabel')}>
        <button
          type="button"
          className={`revision-annotation-pill${filter === 'all' ? ' is-active' : ''}`}
          data-testid="requirement-annotation-filter"
          data-version="all"
          aria-pressed={filter === 'all'}
          onClick={() => { onFilter('all') }}
        >
          {t('requirement.annotations.filterAll', { count: data.changeCount })}
        </button>
        {versions.map(version => (
          <button
            key={version}
            type="button"
            className={`revision-annotation-pill${filter === version ? ' is-active' : ''}`}
            data-testid="requirement-annotation-filter"
            data-version={version}
            aria-pressed={filter === version}
            onClick={() => { onFilter(version) }}
          >
            {t('requirement.annotations.filterVersion', { version })}
          </button>
        ))}
      </div>
      <span className="requirement-annotation-match" data-testid="requirement-annotation-match">
        {visible.length === 0
          ? t('requirement.annotations.empty')
          : t('requirement.annotations.matchCount', { count: visible.length })}
      </span>
    </div>
  )
}

/** 左正文批注层属性。 */
export interface AnnotatedDocumentBodyProps {
  readonly data: RevisionAnnotations
  readonly filter: VersionFilter
  readonly selectedId: string | null
  readonly expanded: ReadonlySet<string>
  readonly segmentExpanded: ReadonlySet<string>
  readonly t: Translate
  readonly onSelect: (id: string) => void
  readonly onToggleExpand: (id: string) => void
  readonly onToggleSegments: (id: string) => void
}

/**
 * 渲染带修改高亮与删除锚点的正文；每个段落占一行，右侧列只放该段自己的批注卡。
 * @param props - 派生数据、筛选、展开状态与回调。
 * @returns 正文节点，交给统一文档阅读器套用版式与字号。
 */
export function AnnotatedDocumentBody({
  data, filter, selectedId, expanded, segmentExpanded, t, onSelect, onToggleExpand, onToggleSegments,
}: AnnotatedDocumentBodyProps): JSX.Element {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const visibleCards = visibleAnnotationCards(data.cards, filter)
  const visibleBlocks = visibleAnnotationBlockIds(data.cards, filter)
  const cardOf = new Map(data.cards
    .filter(card => card.kind !== 'removed')
    .map(card => [card.blockId, card]))

  const deletionMarker = (card: AnnotationCard): JSX.Element | null => {
    const newest = card.deletions[0]
    if (newest === undefined) return null
    const classes = ['requirement-annotation-deleted']
    if (selectedId === card.id) classes.push('is-selected')
    if (hoveredId === card.id) classes.push('is-hovered')
    return (
      <button
        key={card.id}
        type="button"
        className={classes.join(' ')}
        data-testid="requirement-annotation-deleted"
        data-annotation-id={card.id}
        data-annotation-side="body"
        aria-label={t('requirement.annotations.deletedMarker', {
          version: newest.version,
          at: shortTime(newest.at),
          count: card.deletions.length,
        })}
        onClick={() => { onSelect(card.id) }}
        onMouseEnter={() => { setHoveredId(card.id) }}
        onMouseLeave={() => { setHoveredId(null) }}
      >
        {t('requirement.annotations.deletedMarkerShort', { version: newest.version, count: card.deletions.length })}
      </button>
    )
  }

  const cardView = (card: AnnotationCard): JSX.Element => (
    <AnnotationCardView
      key={card.id}
      card={card}
      selected={selectedId === card.id}
      hovered={hoveredId === card.id}
      expanded={expanded.has(card.id)}
      segmentsFolded={!segmentExpanded.has(card.id)}
      t={t}
      onSelect={onSelect}
      onHover={setHoveredId}
      onToggleExpand={onToggleExpand}
      onToggleSegments={onToggleSegments}
    />
  )

  const anchorRow = (key: string, cards: readonly AnnotationCard[]): JSX.Element | null => {
    if (cards.length === 0) return null
    return (
      <div
        key={key}
        className="requirement-annotation-row is-deletion-anchor"
        data-testid="requirement-annotation-row"
        data-block-id={key}
      >
        <div className="requirement-annotation-text">{cards.map(deletionMarker)}</div>
        <div className="requirement-annotation-row-cards" data-testid="requirement-annotation-row-cards">
          {cards.map(cardView)}
        </div>
      </div>
    )
  }

  const startCards = visibleCards.filter(card =>
    card.kind === 'removed' && card.anchor?.blockId === null && card.anchor.side === 'start')
  const endCards = visibleCards.filter(card =>
    card.kind === 'removed' && card.anchor?.blockId === null && card.anchor.side === 'end')

  return (
    <div className="revision-annotated-body" data-testid="requirement-annotated-body">
      {anchorRow('start', startCards)}
      {data.blocks.map((block) => {
        const card = cardOf.get(block.id)
        const highlighted = card !== undefined && visibleBlocks.has(block.id)
        const activeCard = highlighted ? card : undefined
        const classes = ['revision-annotated-block']
        if (card !== undefined) classes.push(`is-${card.kind}`)
        if (highlighted) classes.push('is-visible')
        if (card !== undefined && !highlighted) classes.push('is-filtered-out')
        if (card !== undefined && selectedId === card.id) classes.push('is-selected')
        if (card !== undefined && hoveredId === card.id) classes.push('is-hovered')
        const rowCards = [
          ...(activeCard === undefined ? [] : [activeCard]),
          ...visibleCards.filter(entry => entry.kind === 'removed' && entry.anchor?.blockId === block.id),
        ]
        const before = rowCards.filter(entry => entry.kind === 'removed' && entry.anchor?.side === 'before')
        const after = rowCards.filter(entry => entry.kind === 'removed' && entry.anchor?.side === 'after')
        const interactivity = activeCard === undefined
          ? {}
          : {
            role: 'button' as const,
            tabIndex: 0,
            onClick: () => { onSelect(activeCard.id) },
            onMouseEnter: () => { setHoveredId(activeCard.id) },
            onMouseLeave: () => { setHoveredId(null) },
            onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(activeCard.id)
              }
            },
          }
        return (
          <div
            key={block.id}
            className="requirement-annotation-row"
            data-testid="requirement-annotation-row"
            data-block-id={block.id}
          >
            <div className="requirement-annotation-text">
              {before.map(deletionMarker)}
              <div
                className={classes.join(' ')}
                data-testid={card === undefined ? undefined : 'requirement-annotation-block'}
                data-block-id={block.id}
                data-annotation-id={card?.id}
                data-annotation-side={card === undefined ? undefined : 'body'}
                data-change={card?.kind}
                {...interactivity}
              >
                {renderMarkdown(block.text)}
              </div>
              {after.map(deletionMarker)}
            </div>
            {rowCards.length > 0 && (
              <div className="requirement-annotation-row-cards" data-testid="requirement-annotation-row-cards">
                {rowCards.map(cardView)}
              </div>
            )}
          </div>
        )
      })}
      {anchorRow('end', endCards)}
    </div>
  )
}

/** 批注卡属性；`onHover` 传入 `null` 表示指针离开。 */
interface AnnotationCardViewProps {
  readonly card: AnnotationCard
  readonly selected: boolean
  readonly hovered: boolean
  readonly expanded: boolean
  readonly segmentsFolded: boolean
  readonly t: Translate
  readonly onSelect: (id: string) => void
  readonly onHover: (id: string | null) => void
  readonly onToggleExpand: (id: string) => void
  readonly onToggleSegments: (id: string) => void
}

/** 渲染一张批注卡：类型、版本时间、原因、词级片段与更早修改的演进。 */
function AnnotationCardView({
  card, selected, hovered, expanded, segmentsFolded, t, onSelect, onHover, onToggleExpand, onToggleSegments,
}: AnnotationCardViewProps): JSX.Element {
  const style = KIND_STYLE[card.kind]
  const segments = cleanDiffSegments(card.entries[0]?.segments ?? card.deletions.flatMap((entry, index) => [
    ...(index === 0 ? [] : [{ kind: 'equal' as const, text: '\n' }]),
    ...entry.segments,
  ]))
  const fold = foldSegmentsByChars(segments, SEGMENT_CHAR_LIMIT)
  const folded = fold.hidden && segmentsFolded
  const classes = ['revision-annotation-card', `is-${card.kind}`]
  if (selected) classes.push('is-selected')
  if (hovered) classes.push('is-hovered')
  return (
    <article
      className={classes.join(' ')}
      data-testid="requirement-annotation-card"
      data-annotation-id={card.id}
      data-annotation-side="track"
      data-change={card.kind}
      data-version={card.latestVersion}
      role="button"
      tabIndex={0}
      onClick={() => { onSelect(card.id) }}
      onMouseEnter={() => { onHover(card.id) }}
      onMouseLeave={() => { onHover(null) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(card.id)
        }
      }}
    >
      <div className="revision-annotation-card-head">
        <Chip size="sm" variant="soft" color={style.color} className="tag revision-annotation-kind" data-testid="requirement-annotation-kind">
          {t(style.key)}
        </Chip>
        <span className="revision-annotation-version" data-testid="requirement-annotation-version">
          {t('requirement.annotations.filterVersion', { version: card.latestVersion })}
        </span>
        <time className="revision-annotation-meta" data-testid="requirement-annotation-meta" dateTime={card.latestAt}>
          {shortTime(card.latestAt)}
        </time>
      </div>
      {card.reason !== undefined && card.reason !== '' && (
        <p className="revision-annotation-reason" data-testid="requirement-annotation-reason">
          {t('requirement.annotations.reasonLabel')} {card.reason}
        </p>
      )}
      <div className="revision-annotation-segments" data-testid="requirement-annotation-segments">
        <SegmentView segments={folded ? fold.shown : segments} folded={folded} t={t} />
      </div>
      {fold.hidden && (
        <button
          type="button"
          className="revision-annotation-more"
          data-testid="requirement-annotation-segment-toggle"
          aria-expanded={!segmentsFolded}
          onClick={(event) => { event.stopPropagation(); onToggleSegments(card.id) }}
        >
          {segmentsFolded
            ? <ChevronDown size={14} aria-hidden="true" />
            : <ChevronUp size={14} aria-hidden="true" />}
          <span>
            {segmentsFolded ? t('requirement.annotations.expandSegments') : t('requirement.annotations.collapseSegments')}
          </span>
        </button>
      )}
      {card.entries.length > 1 && (
        <div className="revision-annotation-history">
          <button
            type="button"
            className="revision-annotation-more"
            data-testid="requirement-annotation-history-toggle"
            aria-expanded={expanded}
            onClick={(event) => { event.stopPropagation(); onToggleExpand(card.id) }}
          >
            {expanded
              ? <ChevronUp size={14} aria-hidden="true" />
              : <ChevronDown size={14} aria-hidden="true" />}
            <span>
              {expanded
                ? t('requirement.annotations.collapseEarlier', { count: card.entries.length - 1 })
                : t('requirement.annotations.expandEarlier', { count: card.entries.length - 1 })}
            </span>
          </button>
          {expanded && card.entries.slice(1).map((entry, index) => (
            <div key={`${card.id}-${String(index)}`} className="revision-annotation-earlier" data-testid="requirement-annotation-earlier">
              <span className="revision-annotation-earlier-meta">
                {t('requirement.annotations.cardMeta', { version: entry.version, at: shortTime(entry.at) })}
              </span>
              <div className="revision-annotation-segments">
                <SegmentView segments={cleanDiffSegments(entry.segments)} folded={false} t={t} />
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}
