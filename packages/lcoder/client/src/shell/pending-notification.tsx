/** 待处理交互的作答弹窗：会话历史与答题卡，打开状态由 App 提升到任务卡入口统一控制。 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { EventOutcome } from '../contract.ts'
import type { Translate } from '../locale.ts'
import type { SessionSummary } from '../store.ts'
import type { SessionMessage } from '../discussion/history.ts'
import { readMessages } from '../discussion/history.ts'
import { renderMarkdown } from '../markdown/markdown.tsx'
import { sessionOfInteraction, type PendingInteraction, type QuestionDrafts } from '../chat/pending.ts'
import { sessionLabel } from './chat-view.tsx'
import { PendingCards, type AnswerResult } from './pending-cards.tsx'

export type { AnswerResult } from './pending-cards.tsx'

/** 历史加载状态。 */
type HistoryState =
  | { readonly state: 'ready'; readonly messages: readonly SessionMessage[] }
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly message: string }

/** 作答弹窗属性。 */
export interface PendingLayerProps {
  /** 对话页把卡片放进聊天列；弹窗只在其他页出现。 */
  readonly visible: boolean
  readonly t: Translate
  readonly items: readonly PendingInteraction[]
  /** 要在弹窗里展示的交互 id；null 表示关闭。由 App 从任务卡或中性兜底入口写入。 */
  readonly answerIds: readonly string[] | null
  readonly onAnswer: (interaction: PendingInteraction, outcome: EventOutcome) => Promise<AnswerResult>
  /** 会话列表；用来把确定关联的会话标识翻成标题。 */
  readonly sessions: readonly SessionSummary[]
  /** 会话标题映射；优先于会话列表里的路径推断。 */
  readonly titles: Readonly<Record<string, string>>
  /** 关闭弹窗；由 App 清空打开状态。 */
  readonly onClose: () => void
}

function promptSummary(text: string): string {
  const firstLine = text.split(/\r?\n/u).map(line => line.trim()).find(line => line !== '') ?? ''
  return firstLine.length > 100 ? `${firstLine.slice(0, 100)}...` : firstLine
}

/**
 * 把确定关联的会话标识翻成展示标题；没有这个名字时返回 null，由调用方用中性文案兜底。
 * @param sessionId - 会话标识。
 * @param sessions - 会话列表。
 * @param titles - 标题映射。
 * @returns 会话标题或 null。
 */
function titleOf(
  sessionId: string,
  sessions: readonly SessionSummary[],
  titles: Readonly<Record<string, string>>,
): string | null {
  const title = titles[sessionId]
  if (title !== undefined && title !== '') return title
  const session = sessions.find(item => item.sessionId === sessionId)
  return session === undefined ? null : sessionLabel(session, titles)
}

/**
 * 受控的作答弹窗；不再画右下角通知浮层，提问入口只出现在对应任务卡或中性兜底入口。
 *
 * 弹窗经 portal 铺满整个视口、盖住标题栏与左右拖拽条；只加查看态，不切页面、不换会话、
 * 不改运行状态。草稿按交互 id 存在组件内，关闭重开不丢。
 * @param props - 显示条件、交互、会话事实与回执回调。
 * @returns 挂载到 document.body 的弹窗；未打开时为空。
 */
export function PendingLayer({
  visible, t, items, answerIds, onAnswer, sessions, titles, onClose,
}: PendingLayerProps): JSX.Element | null {
  const [draftStore, setDraftStore] = useState<Readonly<Record<string, QuestionDrafts>>>({})
  const [history, setHistory] = useState<HistoryState>({ state: 'ready', messages: [] })
  const dialogRef = useRef<HTMLDivElement | null>(null)

  const answerSet = useMemo(() => new Set(answerIds ?? []), [answerIds])
  const answerItems = useMemo(
    () => items.filter(item => answerSet.has(item.id)),
    [items, answerSet],
  )
  // 同一批交互都来自一个会话才读历史；中性兜底可能混着多个来源，此时只显示答题卡。
  const sessionIds = useMemo(
    () => [...new Set(answerItems.map(sessionOfInteraction).filter((id): id is string => id !== null))],
    [answerItems],
  )
  const historySessionId = sessionIds.length === 1 ? sessionIds[0] ?? null : null
  const open = visible && answerIds !== null && answerItems.length > 0

  const closeView = useCallback((): void => { onClose() }, [onClose])

  useEffect(() => {
    if (!visible && answerIds !== null) onClose()
  }, [visible, answerIds, onClose])

  useEffect(() => {
    if (answerIds !== null && answerItems.length === 0) onClose()
  }, [answerIds, answerItems, onClose])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeView()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, closeView])

  useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (historySessionId === null) {
      setHistory({ state: 'ready', messages: [] })
      return
    }
    let cancelled = false
    setHistory({ state: 'loading' })
    void readMessages(historySessionId).then((result) => {
      if (cancelled) return
      setHistory(result === null
        ? { state: 'failed', message: '' }
        : { state: 'ready', messages: result })
    })
    return () => { cancelled = true }
  }, [historySessionId])

  if (!open) return null

  const title = historySessionId === null
    ? null
    : titleOf(historySessionId, sessions, titles)

  return createPortal(
    <div
      className="pending-dialog-backdrop"
      data-testid="pending-dialog-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) closeView() }}
    >
      <div
        className="pending-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title ?? t('pending.dialogTitleGeneric')}
        data-testid="pending-dialog"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="pending-dialog-head">
          <h2>{title === null ? t('pending.dialogTitleGeneric') : t('pending.dialogTitle', { session: title })}</h2>
          <button
            type="button"
            className="pending-dialog-close"
            data-testid="pending-dialog-close"
            aria-label={t('pending.close')}
            onClick={closeView}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="pending-dialog-history" data-testid="pending-dialog-history">
          {history.state === 'loading'
            ? <p className="pending-hint" data-testid="pending-history-loading">{t('pending.historyLoading')}</p>
            : null}
          {history.state === 'failed'
            ? <p className="pending-error" data-testid="pending-history-error">{t('pending.historyFailed')}</p>
            : null}
          {history.state === 'ready'
            ? history.messages.slice(-20).map((message, index) => (
              <div
                key={index}
                className={`history-row history-${message.role}`}
                data-testid="history-row"
                data-role={message.role}
              >
                <span className="history-role">
                  {message.role === 'user'
                    ? t('pending.historyUser')
                    : message.role === 'assistant'
                      ? t('pending.historyAssistant')
                      : t('pending.historyContext')}
                </span>
                {message.reasoning !== undefined && message.reasoning !== ''
                  ? (
                    <details className="history-thinking" data-testid="history-thinking">
                      <summary>{t('chat.processThought')}</summary>
                      <div className="history-thinking-body">{message.reasoning}</div>
                    </details>
                  )
                  : null}
                {message.role === 'user' && message.text.length > 260
                  ? (
                    <details className="history-prompt-fold" data-testid="history-prompt-fold">
                      <summary>{promptSummary(message.text)}</summary>
                      <div className="history-text markdown-body">{renderMarkdown(message.text)}</div>
                    </details>
                  )
                  : message.text !== ''
                    ? <div className="history-text markdown-body">{renderMarkdown(message.text)}</div>
                    : null}
              </div>
            ))
            : null}
        </div>
        <div className="pending-dialog-answers" data-testid="pending-dialog-answers">
          <PendingCards
            t={t}
            items={answerItems}
            onAnswer={onAnswer}
            drafts={draftStore}
            onDraftsChange={(id, next) => {
              setDraftStore(current => ({ ...current, [id]: next }))
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
