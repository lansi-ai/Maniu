/** 需求正文的只读修改批注：正文高亮块与右侧批注轨双向联动，不提供输入或改稿入口。 */

import type { JSX } from 'react'
import { Button, Chip } from '@heroui/react'
import { ChevronDown, ChevronRight, MessageSquareText } from 'lucide-react'
import { renderMarkdown } from '../markdown/markdown.tsx'
import { visibleAnnotationBlockIds, visibleAnnotationCards } from '../spec/revision-annotations.ts'
import type {
  AnnotationCard,
  DiffSegment,
  RevisionAnnotations,
  VersionFilter,
} from '../spec/revision-annotations.ts'
import type { MessageKey, Translate } from '../locale.ts'

const BADGE_LIMIT = 160

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

/** 词级片段的展示属性。 */
interface SegmentViewProps {
  readonly segments: readonly DiffSegment[]
  readonly folded: boolean
  readonly t: Translate
}

/** 渲染红删除线与绿新增的片段；相同片段按原样排进正文语序。 */
function SegmentView({ segments, folded, t }: SegmentViewProps): JSX.Element {
  const shown = folded ? segments.slice(0, 12) : segments
  return (
    <>
      {shown.map((segment, index) => {
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

/** 左正文批注层属性。 */
export interface AnnotatedDocumentBodyProps {
  readonly data: RevisionAnnotations
  readonly filter: VersionFilter
  readonly selectedId: string | null
  readonly t: Translate
  readonly onSelect: (id: string) => void
}

/**
 * 渲染带修改高亮与删除锚点的正文，块级节点按语义分块包裹。
 * @param props - 派生数据、筛选、选中项与回调。
 * @returns 正文节点，交给统一文档阅读器套用版式与字号。
 */
export function AnnotatedDocumentBody({ data, filter, selectedId, t, onSelect }: AnnotatedDocumentBodyProps): JSX.Element {
  const visibleBlocks = visibleAnnotationBlockIds(data.cards, filter)
  const cardOf = new Map(data.cards.map(card => [card.blockId, card]))
  const startDeletions = data.cards.filter(card =>
    card.kind === 'removed' && card.anchor?.blockId === null && card.anchor.side === 'start')
  const endDeletions = data.cards.filter(card =>
    card.kind === 'removed' && card.anchor?.blockId === null && card.anchor.side === 'end')

  const deletionMarker = (card: AnnotationCard): JSX.Element | null => {
    if (card.kind !== 'removed') return null
    const newest = card.deletions[0]
    if (newest === undefined) return null
    return (
      <button
        key={card.id}
        type="button"
        className={`requirement-annotation-deleted${selectedId === card.id ? ' is-selected' : ''}`}
        data-testid="requirement-annotation-deleted"
        data-annotation-id={card.id}
        data-annotation-side="body"
        aria-label={t('requirement.annotations.deletedMarker', {
          version: newest.version,
          at: shortTime(newest.at),
          count: card.deletions.length,
        })}
        onClick={() => { onSelect(card.id) }}
      >
        {t('requirement.annotations.deletedMarker', {
          version: newest.version,
          at: shortTime(newest.at),
          count: card.deletions.length,
        })}
      </button>
    )
  }

  return (
    <div className="revision-annotated-body" data-testid="requirement-annotated-body">
      {startDeletions.map(deletionMarker)}
      {data.blocks.map((block) => {
        const card = cardOf.get(block.id)
        const highlighted = card !== undefined && visibleBlocks.has(block.id)
        const classes = ['revision-annotated-block']
        if (card !== undefined) classes.push(`is-${card.kind}`)
        if (highlighted) classes.push('is-visible')
        if (card !== undefined && !highlighted) classes.push('is-filtered-out')
        if (card !== undefined && selectedId === card.id) classes.push('is-selected')
        const before = data.cards.filter(entry =>
          entry.kind === 'removed' && entry.anchor?.blockId === block.id && entry.anchor.side === 'before')
        const after = data.cards.filter(entry =>
          entry.kind === 'removed' && entry.anchor?.blockId === block.id && entry.anchor.side === 'after')
        return (
          <div key={block.id}>
            {before.map(deletionMarker)}
            <div
              className={classes.join(' ')}
              data-testid={card === undefined ? undefined : 'requirement-annotation-block'}
              data-block-id={block.id}
              data-annotation-id={card?.id}
              data-annotation-side={card === undefined ? undefined : 'body'}
              data-change={card?.kind}
              role={card === undefined ? undefined : 'button'}
              tabIndex={card === undefined ? undefined : 0}
              onClick={card === undefined ? undefined : () => { onSelect(card.id) }}
              onKeyDown={card === undefined ? undefined : (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(card.id)
                }
              }}
            >
              {renderMarkdown(block.text)}
            </div>
            {after.map(deletionMarker)}
          </div>
        )
      })}
      {endDeletions.map(deletionMarker)}
    </div>
  )
}

/** 右侧批注单卡属性。 */
interface AnnotationCardViewProps {
  readonly card: AnnotationCard
  readonly selected: boolean
  readonly expanded: boolean
  readonly segmentsFolded: boolean
  readonly t: Translate
  readonly onSelect: (id: string) => void
  readonly onToggleExpand: (id: string) => void
  readonly onToggleSegments: (id: string) => void
}

/** 渲染一张批注卡：类型、版本时间、原因、词级片段与更早修改的演进。 */
function AnnotationCardView({
  card, selected, expanded, segmentsFolded, t, onSelect, onToggleExpand, onToggleSegments,
}: AnnotationCardViewProps): JSX.Element {
  const style = KIND_STYLE[card.kind]
  const segments = card.entries[0]?.segments ?? card.deletions.flatMap((entry, index) => [
    ...(index === 0 ? [] : [{ kind: 'equal' as const, text: '\n' }]),
    ...entry.segments,
  ])
  const total = segments.reduce((sum, segment) => sum + segment.text.length, 0)
  const canFold = total > BADGE_LIMIT || segments.length > 12
  const meta = t('requirement.annotations.cardMeta', {
    version: card.latestVersion,
    at: shortTime(card.latestAt),
  })
  return (
    <article
      className={`revision-annotation-card is-${card.kind}${selected ? ' is-selected' : ''}`}
      data-testid="requirement-annotation-card"
      data-annotation-id={card.id}
      data-annotation-side="track"
      data-change={card.kind}
      data-version={card.latestVersion}
      role="button"
      tabIndex={0}
      onClick={() => { onSelect(card.id) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(card.id)
        }
      }}
    >
      <div className="revision-annotation-card-head">
        <Chip size="sm" variant="soft" color={style.color} className="tag" data-testid="requirement-annotation-kind">
          {t(style.key)}
        </Chip>
        <span className="revision-annotation-meta" data-testid="requirement-annotation-meta">{meta}</span>
      </div>
      {card.reason !== undefined && card.reason !== '' && (
        <p className="revision-annotation-reason" data-testid="requirement-annotation-reason">
          {t('requirement.annotations.reasonLabel')} {card.reason}
        </p>
      )}
      <div className="revision-annotation-segments" data-testid="requirement-annotation-segments">
        <SegmentView segments={segments} folded={canFold && segmentsFolded} t={t} />
      </div>
      {canFold && (
        <button
          type="button"
          className="revision-annotation-more"
          data-testid="requirement-annotation-segment-toggle"
          onClick={(event) => { event.stopPropagation(); onToggleSegments(card.id) }}
        >
          {segmentsFolded ? t('requirement.annotations.expandSegments') : t('requirement.annotations.collapseSegments')}
        </button>
      )}
      {card.entries.length > 1 && (
        <>
          <button
            type="button"
            className="revision-annotation-more"
            data-testid="requirement-annotation-history-toggle"
            onClick={(event) => { event.stopPropagation(); onToggleExpand(card.id) }}
          >
            {expanded
              ? t('requirement.annotations.collapseEarlier', { count: card.entries.length - 1 })
              : t('requirement.annotations.expandEarlier', { count: card.entries.length - 1 })}
          </button>
          {expanded && card.entries.slice(1).map((entry, index) => (
            <div key={`${card.id}-${String(index)}`} className="revision-annotation-earlier" data-testid="requirement-annotation-earlier">
              <span className="revision-annotation-earlier-meta">
                {t('requirement.annotations.cardMeta', { version: entry.version, at: shortTime(entry.at) })}
              </span>
              <div className="revision-annotation-segments">
                <SegmentView segments={entry.segments} folded={false} t={t} />
              </div>
            </div>
          ))}
        </>
      )}
      <span className="revision-annotation-jump" aria-hidden="true">
        {selected ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </span>
    </article>
  )
}

/** 右侧独立批注轨属性。 */
export interface RevisionAnnotationTrackProps {
  readonly data: RevisionAnnotations
  readonly filter: VersionFilter
  readonly selectedId: string | null
  readonly expanded: ReadonlySet<string>
  readonly segmentExpanded: ReadonlySet<string>
  readonly t: Translate
  readonly onFilter: (filter: VersionFilter) => void
  readonly onSelect: (id: string) => void
  readonly onToggleExpand: (id: string) => void
  readonly onToggleSegments: (id: string) => void
}

/**
 * 渲染版本筛选胶囊与按正文顺序排列的批注卡。
 * @param props - 派生数据、筛选与双向联动回调。
 * @returns 独立滚动的批注轨。
 */
export function RevisionAnnotationTrack({
  data, filter, selectedId, expanded, segmentExpanded, t, onFilter, onSelect, onToggleExpand, onToggleSegments,
}: RevisionAnnotationTrackProps): JSX.Element {
  const visible = visibleAnnotationCards(data.cards, filter)
  const versions = data.versions.filter(version => version > 1)
  return (
    <aside
      className="revision-annotation-track"
      data-testid="requirement-annotation-track"
      aria-label={t('requirement.annotations.trackLabel')}
    >
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
      <div className="revision-annotation-cards" data-testid="requirement-annotation-cards">
        {visible.length === 0 && (
          <p className="empty" data-testid="requirement-annotation-empty">{t('requirement.annotations.empty')}</p>
        )}
        {visible.map(card => (
          <AnnotationCardView
            key={card.id}
            card={card}
            selected={selectedId === card.id}
            expanded={expanded.has(card.id)}
            segmentsFolded={!segmentExpanded.has(card.id)}
            t={t}
            onSelect={onSelect}
            onToggleExpand={onToggleExpand}
            onToggleSegments={onToggleSegments}
          />
        ))}
      </div>
    </aside>
  )
}
