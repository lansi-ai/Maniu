/**
 * 状态大盘的关系图：任务按五态分列、会话一行排开，三类边区分依赖、认领与联调组。
 *
 * 布局与边的生成在 `dashboard-graph.ts`；这个文件只画 SVG、接任务点击回调。
 * 没有任务时画空态；没有会话时仍画任务与依赖，并提示只显示依赖。
 * 标题由大盘页给，组件不重复画节头。
 */
import { useId } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { LcoderWorkspaceKey } from '../locales.ts'
import { SHELL_STATES } from './shell-data.ts'
import {
  GRAPH_COLUMN_HEADER_HEIGHT, GRAPH_PADDING, layoutDashboardGraph,
} from './dashboard-graph.ts'
import type {
  DashboardGraphColumnState, DashboardGraphEdge, DashboardGraphEdgeKind, DashboardGraphInput,
  DashboardGraphSessionNode, DashboardGraphTaskNode,
} from './dashboard-graph.ts'
import css from './DashboardGraph.module.css'

/** 词典函数。 */
type Translate = (key: LcoderWorkspaceKey) => string

/** 关系图 props。 */
export interface DashboardGraphProps {
  readonly data: DashboardGraphInput
  /** 词典函数；空态、图例与状态列名都走它。 */
  readonly t: Translate
  /** 点任务节点时把任务号交回去；缺省时节点不可点。 */
  readonly onOpenTask?: ((taskId: string) => void) | undefined
}

const STATE_LABELS = new Map<string, LcoderWorkspaceKey>(
  SHELL_STATES.map(state => [state.id, state.labelKey] as const),
)

const EDGE_CLASSES: Readonly<Record<DashboardGraphEdgeKind, string | undefined>> = {
  depends_on: css.edgeDependsOn,
  claims: css.edgeClaims,
  group: css.edgeGroup,
}

/** 状态点取壳里的五态颜色变量；未知状态落到兜底色。 */
function stateFill(state: DashboardGraphColumnState): string {
  return `var(--lc-graph-${state})`
}

/** 会话状态点：等人回答优先于在跑，都不用主色以外的新色。 */
function sessionFill(node: DashboardGraphSessionNode): string {
  if (node.awaitingInteraction) return 'var(--lc-status-warn)'
  return node.running ? 'var(--lc-brand)' : 'var(--lc-faint)'
}

/** 按字形簇切分，截断与计数都不拆坏组合字符。 */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** 单行文本截断；按字形簇计，超出时留省略号。 */
function truncate(text: string, max: number): string {
  const pieces = [...GRAPHEMES.segment(text)].map(part => part.segment)
  return pieces.length <= max ? text : `${pieces.slice(0, max - 1).join('')}…`
}

/** 边的曲线：两端锚点在同一纵向中线上加两个控制点，跨列或同行都平滑。 */
function pathOf(edge: DashboardGraphEdge): string {
  const midY = (edge.y1 + edge.y2) / 2
  return `M ${String(edge.x1)} ${String(edge.y1)} C ${String(edge.x1)} ${String(midY)}, ${String(edge.x2)} ${String(midY)}, ${String(edge.x2)} ${String(edge.y2)}`
}

/**
 * 画关系图。
 * @param props - 输入数据、词典函数与可选的点击回调。
 * @returns 画布、图例与空态/提示。
 */
export function DashboardGraph({ data, t, onOpenTask }: DashboardGraphProps): ReactNode {
  const markerBase = `graph-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const layout = layoutDashboardGraph(data)

  if (layout.empty) {
    return (
      <div className={css.graph} role="group" aria-label={t('shell.graph')}>
        <p className={css.empty}>{t('shell.graphEmpty')}</p>
      </div>
    )
  }

  const open = onOpenTask
  const markerOf = (kind: DashboardGraphEdgeKind): string | undefined => {
    if (kind === 'group') return undefined
    return `url(#${markerBase}-${kind === 'depends_on' ? 'depends' : 'claims'})`
  }

  const activate = (node: DashboardGraphTaskNode, event: KeyboardEvent<SVGGElement>): void => {
    if (open === undefined) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    open(node.taskId)
  }

  return (
    <div className={css.graph}>
      <svg
        className={css.canvas}
        viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
        preserveAspectRatio="xMidYMin meet"
        role="group"
        aria-label={t('shell.graph')}
      >
        <defs>
          <marker
            id={`${markerBase}-depends`}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L8 4 L0 8 Z" className={css.arrowDepends} />
          </marker>
          <marker
            id={`${markerBase}-claims`}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L8 4 L0 8 Z" className={css.arrowClaims} />
          </marker>
        </defs>

        {layout.columns.map((column) => {
          const labelKey = STATE_LABELS.get(column.state)
          return (
            <g key={column.state}>
              <circle
                cx={column.x + 4}
                cy={GRAPH_PADDING + 9}
                r={3.5}
                fill={stateFill(column.state)}
              />
              <text
                x={column.x + 14}
                y={GRAPH_PADDING + GRAPH_COLUMN_HEADER_HEIGHT / 2 + 4}
                className={css.columnLabel}
              >
                {labelKey === undefined ? t('shell.graphUnknownState') : t(labelKey)}
              </text>
              <text
                x={column.x + column.width}
                y={GRAPH_PADDING + GRAPH_COLUMN_HEADER_HEIGHT / 2 + 4}
                textAnchor="end"
                className={css.columnCount}
              >
                {column.count}
              </text>
            </g>
          )
        })}

        {layout.edges.map(edge => (
          <path
            key={`${edge.kind}:${edge.from}->${edge.to}`}
            className={EDGE_CLASSES[edge.kind]}
            d={pathOf(edge)}
            markerEnd={markerOf(edge.kind)}
          />
        ))}

        {layout.taskNodes.map(node => (
          <g
            key={node.id}
            className={open === undefined ? css.taskNode : `${css.taskNode ?? ''} ${css.clickable ?? ''}`}
            role={open === undefined ? undefined : 'button'}
            tabIndex={open === undefined ? undefined : 0}
            aria-label={`${node.taskId} ${node.title}`}
            onClick={open === undefined ? undefined : () => { open(node.taskId) }}
            onKeyDown={open === undefined ? undefined : (event) => { activate(node, event) }}
          >
            <title>{`${node.taskId} ${node.title}`}</title>
            <rect
              className={css.taskRect}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx={10}
            />
            <circle cx={node.x + 13} cy={node.y + 15} r={3.5} fill={stateFill(node.state)} />
            <text x={node.x + 23} y={node.y + 19} className={css.taskTitle}>
              {truncate(node.title, 14)}
            </text>
            <text x={node.x + 23} y={node.y + 34} className={css.taskMeta}>
              {truncate(node.role === undefined ? node.taskId : `${node.taskId} · ${node.role}`, 22)}
            </text>
          </g>
        ))}

        {layout.sessionNodes.map(node => (
          <g key={node.id}>
            <title>{node.role === undefined ? node.label : `${node.label} · ${node.role}`}</title>
            <rect
              className={css.sessionRect}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx={10}
            />
            <circle cx={node.x + 13} cy={node.y + node.height / 2} r={3.5} fill={sessionFill(node)} />
            <text x={node.x + 23} y={node.y + node.height / 2 + 4} className={css.sessionLabel}>
              {truncate(node.label, 12)}
            </text>
            {node.pending > 0 && (
              <text
                x={node.x + node.width - 12}
                y={node.y + node.height / 2 + 4}
                textAnchor="end"
                className={css.sessionPending}
              >
                {`+${String(node.pending)}`}
              </text>
            )}
          </g>
        ))}
      </svg>

      <div className={css.legend}>
        <span className={css.legendItem}>
          <i className={css.swatch} />
          {t('shell.graphDependsOn')}
        </span>
        <span className={css.legendItem}>
          <i className={`${css.swatch ?? ''} ${css.swatchClaims ?? ''}`} />
          {t('shell.graphClaims')}
        </span>
        <span className={css.legendItem}>
          <i className={`${css.swatch ?? ''} ${css.swatchGroup ?? ''}`} />
          {t('shell.graphGroup')}
        </span>
      </div>
      {layout.hasSessions ? null : <p className={css.hint}>{t('shell.graphNoSessions')}</p>}
    </div>
  )
}
