/** 操作进度浮卡：后台操作的标题、岗位、步骤与状态色；可最小化成胶囊，查看对话自愿跳转。 */

import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '@heroui/react'
import { AlertTriangle, CheckCircle2, Loader2, MessageSquareText, Minus, X } from 'lucide-react'
import { renderMarkdown } from '../markdown/markdown.tsx'
import type { Translate } from '../locale.ts'
import type { OpLiveFeed } from './op-live-feed.ts'

/** 浮卡三态：进行中蓝、完成绿、失败警示色。 */
export type OperationStatus = 'running' | 'done' | 'failed'

/** 步骤四态：已完成、进行中、未开始、失败。 */
export type OperationStepState = 'done' | 'active' | 'pending' | 'failed'

/** 浮卡里的一条步骤。 */
export interface OperationStep {
  readonly label: string
  readonly state: OperationStepState
}

/** 一张浮卡的呈现事实；状态与步骤由持有轮询判定的一方算好下传。 */
export interface OperationCardView {
  readonly key: string
  readonly title: string
  readonly roleLabel: string
  readonly sourceLabel: string
  readonly status: OperationStatus
  readonly statusText: string
  readonly steps: readonly OperationStep[]
  readonly sessionId: string | null
  readonly minimized: boolean
  /** 人工衔接节点里等待发起的下一岗位名；有值时卡上画「下一岗位」按钮。 */
  readonly nextRoleLabel?: string
  /** 立项等待人工确认概要：卡上画「确认需求」按钮，查看对话入口改标「查看概要」。 */
  readonly awaitingConfirm?: boolean
  /** 提案已写未确认：卡上画「去对比」按钮，打开对比视图而不跳对话。 */
  readonly compareProposalId?: string
  /** 该操作会话名下待回答的题目数；大于零时卡上高亮并给「回答」入口。 */
  readonly pendingCount?: number
  /** 打开作答弹窗时交给回调的标识；与会话标识同值。 */
  readonly pendingKey?: string
  /** 后台会话的实时过程与最新输出；运行中持续更新，失败时可留作最后现场。 */
  readonly liveFeed?: OpLiveFeed
}

function formatLiveSize(chars: number): string {
  if (chars >= 1024) return `${(chars / 1024).toFixed(1)} KB`
  return `${String(chars)} B`
}

function livePhaseLabel(feed: OpLiveFeed, t: Translate): string {
  const prefix = feed.step > 0 ? t('op.live.stepPrefix', { step: feed.step }) : ''
  switch (feed.phase) {
    case 'connecting':
      return t('op.live.connecting')
    case 'thinking':
      return `${prefix}${t('op.live.thinking')}`
    case 'streaming':
      return `${prefix}${t('op.live.streaming')}`
    case 'tool-streaming': {
      const tool = feed.toolName ?? 'tool'
      if (feed.toolChars !== undefined && feed.toolChars > 0) {
        return `${prefix}${t('op.live.toolStreamingChars', { tool, size: formatLiveSize(feed.toolChars) })}`
      }
      return `${prefix}${t('op.live.toolStreaming', { tool })}`
    }
    case 'tool-running': {
      const tool = feed.toolName ?? 'tool'
      if (feed.toolDetail !== undefined && feed.toolDetail !== '') {
        return `${prefix}${t('op.live.toolRunningDetail', { tool, detail: feed.toolDetail })}`
      }
      return `${prefix}${t('op.live.toolRunning', { tool })}`
    }
    case 'retrying': {
      const attempt = feed.retryAttempt ?? 1
      if (feed.retryMax !== undefined && feed.retryMax !== null) {
        return t('op.live.retryingMax', { attempt, max: feed.retryMax })
      }
      return t('op.live.retrying', { attempt })
    }
    case 'auto-continuing':
      return `${prefix}${t('op.autoContinuing')}`
    case 'idle':
      return `${prefix}${t('op.live.idle')}`
  }
}

/**
 * 浮卡内嵌的实时输出面板：展示当前阶段/工具与滚动中的最新输出片段。
 * @param props - 实时进度快照、卡片状态与文案函数。
 * @returns 实时过程面板；非运行且无输出内容时不渲染。
 */
function OpLivePanel({
  feed,
  status,
  t,
}: {
  readonly feed: OpLiveFeed
  readonly status: OperationStatus
  readonly t: Translate
}): JSX.Element | null {
  const bodyRef = useRef<HTMLDivElement>(null)
  const hasReasoning = feed.reasoning !== undefined && feed.reasoning !== ''
  const hasContent = feed.snippet !== '' || hasReasoning || (feed.lastToolNote !== undefined && feed.lastToolNote !== '')
  useEffect(() => {
    const node = bodyRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [feed.snippet, feed.reasoning, feed.lastToolNote, feed.phase, feed.toolChars])

  if (status === 'done') return null
  if (status === 'failed' && !hasContent) return null

  const fallbackText = feed.lastToolNote !== undefined && feed.lastToolNote !== ''
    ? feed.lastToolNote
    : t('op.live.empty')

  return (
    <section className="op-live" data-testid="op-live-panel" data-status={status} aria-label={t('op.live.title')}>
      <div className="op-live-head">
        {status === 'running' && <span className="op-live-pulse" aria-hidden="true" />}
        <span className="op-live-phase" data-testid="op-live-phase">{livePhaseLabel(feed, t)}</span>
      </div>
      {hasReasoning && (
        <details className="op-live-thinking" data-testid="op-live-thinking">
          <summary>{t('chat.processThought')}</summary>
          <div className="op-live-thinking-body">{feed.reasoning}</div>
        </details>
      )}
      {feed.snippet !== '' ? (
        <div ref={bodyRef} className="op-live-body markdown-body" data-testid="op-live-output">
          {renderMarkdown(feed.snippet)}
        </div>
      ) : (
        <div ref={bodyRef} className="op-live-body" data-testid="op-live-output">{fallbackText}</div>
      )}
      {feed.snippet !== '' && feed.lastToolNote !== undefined && feed.lastToolNote !== '' && (
        <p className="op-live-tool-note" data-testid="op-live-tool-note">{feed.lastToolNote}</p>
      )}
    </section>
  )
}

/**
 * 状态图标：运行中旋转、完成绿勾、失败警示；颜色由卡的状态类决定。
 * @param props - 浮卡状态。
 * @returns 状态图标。
 */
function StatusIcon({ status }: { readonly status: OperationStatus }): JSX.Element {
  if (status === 'running') return <Loader2 className="op-status-icon op-spin" size={16} aria-hidden="true" />
  if (status === 'done') return <CheckCircle2 className="op-status-icon" size={16} aria-hidden="true" />
  return <AlertTriangle className="op-status-icon" size={16} aria-hidden="true" />
}

/** 浮卡列表属性。 */
export interface OperationCardsProps {
  readonly cards: readonly OperationCardView[]
  readonly onToggleMinimize: (key: string) => void
  readonly onOpenSession: (sessionId: string) => void
  readonly onClose: (key: string) => void
  /** 人工衔接：点「下一岗位」发起下一岗。 */
  readonly onNextRole?: (key: string) => void
  /** 立项等待确认：点「确认需求」向该会话发送确认指令。 */
  readonly onConfirmIntake?: (key: string) => void
  /** 提案等待对比：点「去对比」打开该提案的对比视图。 */
  readonly onCompare?: (proposalId: string) => void
  /** 立项等待确认：点「查看概要」在需求页内就地预览概要；未给时回退到打开会话。 */
  readonly onViewSummary?: (key: string) => void
  /** 有待回答题目时点「回答」打开作答弹窗；回调收到该卡的 pendingKey。 */
  readonly onAnswerRequest?: (key: string) => void
  readonly t: Translate
}

/**
 * 单张非最小化浮卡：支持标题栏拖拽移动、顶部快捷查看对话及底部操作区。
 * @param props - 卡片数据与操作回调。
 * @returns 浮卡元素。
 */
function OpCardItem({
  card,
  onToggleMinimize,
  onOpenSession,
  onClose,
  onNextRole,
  onConfirmIntake,
  onCompare,
  onViewSummary,
  onAnswerRequest,
  t,
}: Omit<OperationCardsProps, 'cards'> & { readonly card: OperationCardView }): JSX.Element {
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (card.minimized) {
      setOffset({ x: 0, y: 0 })
      setDragging(false)
    }
  }, [card.minimized])

  useEffect(() => {
    if (!dragging) return
    const onMove = (event: PointerEvent): void => {
      const drag = dragRef.current
      if (drag === null) return
      const rawX = drag.originX + (event.clientX - drag.startX)
      const rawY = drag.originY + (event.clientY - drag.startY)
      const x = Math.max(-window.innerWidth + 120, Math.min(20, rawX))
      const y = Math.max(-window.innerHeight + 120, Math.min(20, rawY))
      setOffset({ x, y })
    }
    const onUp = (): void => {
      dragRef.current = null
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging])

  const onHeadPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button, .op-head-actions') !== null) return
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y }
    setDragging(true)
  }

  const sessionId = card.sessionId
  const testId = card.status === 'running'
    ? 'requirement-op-running'
    : card.status === 'done'
      ? 'requirement-op-success'
      : 'requirement-op-timeout'
  const showAnswer = card.pendingCount !== undefined && card.pendingCount > 0
    && card.pendingKey !== undefined && onAnswerRequest !== undefined
  const showConfirm = card.awaitingConfirm === true && card.status === 'running' && onConfirmIntake !== undefined
  const showCompare = card.compareProposalId !== undefined && card.status === 'running' && onCompare !== undefined
  const showNextRole = card.nextRoleLabel !== undefined && card.status === 'running' && onNextRole !== undefined
  const showViewSummary = sessionId !== null && card.awaitingConfirm === true
  const hasBottomActions = showAnswer || showConfirm || showCompare || showNextRole || showViewSummary

  return (
    <article
      className={`op-card op-${card.status}`}
      data-testid={testId}
      data-op-key={card.key}
      data-dragging={dragging ? 'true' : 'false'}
      style={offset.x !== 0 || offset.y !== 0 ? { transform: `translate(${String(offset.x)}px, ${String(offset.y)}px)` } : undefined}
    >
      <header className="op-head" onPointerDown={onHeadPointerDown}>
        <StatusIcon status={card.status} />
        <div className="op-heading">
          <h3>{card.title}</h3>
          {card.pendingCount !== undefined && card.pendingCount > 0 ? (
            <span className="op-step-answer op-pending-pill" data-testid="op-pending-count">
              {t('op.pendingCount', { count: card.pendingCount })}
            </span>
          ) : null}
        </div>
        <div className="op-head-actions">
          {sessionId !== null && card.awaitingConfirm !== true && (
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="op-icon-button"
              data-testid={card.status === 'failed' ? 'requirement-op-timeout-session' : 'op-view-session'}
              aria-label={t('op.viewSession')}
              ref={(node) => { if (node !== null) node.title = t('op.viewSession') }}
              onPress={() => { onOpenSession(sessionId) }}
            >
              <MessageSquareText size={14} aria-hidden="true" />
            </Button>
          )}
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            className="op-icon-button"
            data-testid="op-minimize"
            aria-label={t('op.minimize')}
            onPress={() => { onToggleMinimize(card.key) }}
          >
            <Minus aria-hidden="true" />
          </Button>
          {card.status !== 'running' && (
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="op-icon-button"
              data-testid={card.status === 'failed' ? 'requirement-op-timeout-reload' : 'op-close'}
              aria-label={card.status === 'failed' ? t('requirement.opTimeoutReload') : t('op.close')}
              onPress={() => { onClose(card.key) }}
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>
      <ol className="op-steps op-steps-horizontal" title={card.statusText}>
        {card.steps.map((step, index) => (
          <li
            key={`${card.key}-${String(index)}`}
            className={`op-step-${step.state}`}
            {...(index === 0 ? { 'data-testid': 'op-step-role', title: `${card.roleLabel} · ${card.sourceLabel}` } : {})}
          >
            <span className="op-step-dot" aria-hidden="true" />
            <span className="op-step-text">{index === 0 ? card.roleLabel : step.label}</span>
          </li>
        ))}
      </ol>
      {(card.liveFeed === undefined || card.status !== 'running') && (
        <p className={card.status === 'failed' ? 'op-status op-status-error' : 'op-status'}>{card.statusText}</p>
      )}
      {card.liveFeed !== undefined && (
        <OpLivePanel feed={card.liveFeed} status={card.status} t={t} />
      )}
      {hasBottomActions && (
        <div className="op-actions">
          {showAnswer && (
            <Button
              size="sm"
              variant="primary"
              data-testid="op-answer-pending"
              onPress={() => { onAnswerRequest(card.pendingKey ?? '') }}
            >
              {t('op.answerPending')}
            </Button>
          )}
          {showConfirm && (
            <Button
              size="sm"
              variant="primary"
              data-testid="op-confirm-intake"
              onPress={() => { onConfirmIntake(card.key) }}
            >
              {t('op.confirmIntake')}
            </Button>
          )}
          {showCompare && (
            <Button
              size="sm"
              variant="primary"
              data-testid="op-go-compare"
              data-proposal-id={card.compareProposalId}
              onPress={() => { onCompare(card.compareProposalId ?? '') }}
            >
              {t('op.goCompare')}
            </Button>
          )}
          {showNextRole && (
            <Button
              size="sm"
              variant="primary"
              data-testid="op-next-role"
              onPress={() => { onNextRole(card.key) }}
            >
              {t('op.nextRole')}
            </Button>
          )}
          {showViewSummary && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="op-view-session"
              onPress={() => {
                if (onViewSummary !== undefined) onViewSummary(card.key)
                else onOpenSession(sessionId)
              }}
            >
              {t('op.viewSummary')}
            </Button>
          )}
        </div>
      )}
    </article>
  )
}

/**
 * 画右下角浮卡堆叠；最小化态只留标题与状态色胶囊。
 * @param props - 卡片事实与三个回调。
 * @returns 浮卡层；没有卡片时不渲染。
 */
export function OperationCards({ cards, ...handlers }: OperationCardsProps): JSX.Element | null {
  if (cards.length === 0) return null
  return (
    <div className="op-layer" data-testid="operation-cards">
      {cards.map((card) => {
        if (card.minimized) {
          return (
            <button
              key={card.key}
              type="button"
              className={`op-capsule op-${card.status}`}
              data-testid="op-capsule"
              data-op-key={card.key}
              title={handlers.t('op.expand')}
              onClick={() => { handlers.onToggleMinimize(card.key) }}
            >
              <span className="op-dot" aria-hidden="true" />
              <span>{card.title}</span>
            </button>
          )
        }
        return <OpCardItem key={card.key} card={card} {...handlers} />
      })}
    </div>
  )
}
