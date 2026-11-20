/** 非对话页的待回答通知：右下角非阻塞提醒，点开后带会话历史的回答弹窗。 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Volume2, VolumeX, X } from 'lucide-react'
import type { EventOutcome } from '../contract.ts'
import type { Translate } from '../locale.ts'
import type { SessionSummary } from '../store.ts'
import type { SessionMessage } from '../discussion/history.ts'
import { readMessages } from '../discussion/history.ts'
import { renderMarkdown } from '../markdown/markdown.tsx'
import {
  groupPending, summaryOfInteraction, type PendingInteraction, type QuestionDrafts,
} from '../chat/pending.ts'
import { sessionLabel } from './chat-view.tsx'
import { PendingCards, type AnswerResult } from './pending-cards.tsx'
import { playPendingTone } from './pending-sound.ts'

export type { AnswerResult } from './pending-cards.tsx'

/** 音效开关的本地存储键；偏好 IPC 没有音效字段，故不并入 Preferences 契约。 */
const SOUND_KEY = 'lcoder.pending-sound'

/** 历史加载状态。 */
type HistoryState =
  | { readonly state: 'ready'; readonly messages: readonly SessionMessage[] }
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly message: string }

/** 通知层属性。 */
export interface PendingLayerProps {
  /** 对话页把卡片放进聊天列，通知只在其他页出现。 */
  readonly visible: boolean
  readonly t: Translate
  readonly items: readonly PendingInteraction[]
  readonly onAnswer: (interaction: PendingInteraction, outcome: EventOutcome) => Promise<AnswerResult>
  /** 会话列表；用来把确定关联的会话标识翻成标题。 */
  readonly sessions: readonly SessionSummary[]
  /** 会话标题映射；优先于会话列表里的路径推断。 */
  readonly titles: Readonly<Record<string, string>>
}

function readSound(): boolean {
  try {
    return globalThis.localStorage.getItem(SOUND_KEY) === '1'
  } catch {
    return false
  }
}

function writeSound(enabled: boolean): void {
  try {
    globalThis.localStorage.setItem(SOUND_KEY, enabled ? '1' : '0')
  } catch {
    // 存储不可用只影响下次启动，本次开关仍然生效。
  }
}

/**
 * 把确定关联的会话标识翻成展示标题；没有确定关联时由调用方显示来源不可用。
 * @param sessionId - 会话标识。
 * @param sessions - 会话列表。
 * @param titles - 标题映射。
 * @returns 会话标题；完全没有这个名字时返回 null。
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
 * 非对话页右下角的待处理交互通知与查看弹窗。
 *
 * 通知不抢焦点、不遮罩页面；弹窗只加查看态，不切页面、不换会话、不改运行状态。
 * @param props - 显示条件、交互、会话事实与回执回调。
 * @returns 通知层与可选弹窗；不可见或无交互时为空。
 */
export function PendingLayer({
  visible, t, items, onAnswer, sessions, titles,
}: PendingLayerProps): JSX.Element | null {
  const groups = useMemo(() => groupPending(items), [items])
  const [viewKey, setViewKey] = useState<string | null>(null)
  const [draftStore, setDraftStore] = useState<Readonly<Record<string, QuestionDrafts>>>({})
  const [soundEnabled, setSoundEnabled] = useState(readSound)
  const [history, setHistory] = useState<HistoryState>({ state: 'ready', messages: [] })
  const playedRef = useRef<Set<string>>(new Set())
  const triggerRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const openGroup = groups.find(group => group.key === viewKey) ?? null

  useEffect(() => {
    if (!soundEnabled) {
      for (const item of items) playedRef.current.add(item.id)
      return
    }
    const fresh = items.filter(item => !playedRef.current.has(item.id))
    if (fresh.length === 0) return
    for (const item of fresh) playedRef.current.add(item.id)
    playPendingTone()
  }, [items, soundEnabled])

  useEffect(() => {
    if (!visible) setViewKey(null)
  }, [visible])

  useEffect(() => {
    if (viewKey !== null && !groups.some(group => group.key === viewKey)) setViewKey(null)
  }, [groups, viewKey])

  const closeView = useCallback((): void => {
    setViewKey(null)
    triggerRef.current?.focus()
    triggerRef.current = null
  }, [])

  useEffect(() => {
    if (viewKey === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeView()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [viewKey, closeView])

  useEffect(() => {
    if (viewKey !== null) dialogRef.current?.focus()
  }, [viewKey])

  useEffect(() => {
    const sessionId = openGroup?.sessionId ?? null
    if (sessionId === null) {
      setHistory({ state: 'ready', messages: [] })
      return
    }
    let cancelled = false
    setHistory({ state: 'loading' })
    void readMessages(sessionId).then((result) => {
      if (cancelled) return
      setHistory(result === null
        ? { state: 'failed', message: '' }
        : { state: 'ready', messages: result })
    })
    return () => { cancelled = true }
  }, [openGroup?.sessionId])

  const toggleSound = (): void => {
    setSoundEnabled((current) => {
      const next = !current
      writeSound(next)
      return next
    })
  }

  const openView = (key: string, trigger: HTMLElement): void => {
    triggerRef.current = trigger
    setViewKey(key)
  }

  const summaryText = (interaction: PendingInteraction): string => {
    const summary = summaryOfInteraction(interaction)
    return summary.kind === 'approval'
      ? t('pending.summaryApproval', { tool: summary.toolName ?? 'tool' })
      : t('pending.summaryQuestion', { count: summary.count })
  }

  if (!visible || groups.length === 0) return null

  const title = openGroup === null || openGroup.sessionId === null
    ? null
    : titleOf(openGroup.sessionId, sessions, titles)

  return (
    <>
      <div className="pending-layer" data-testid="pending-notifications">
        {groups.map((group) => {
          const groupTitle = group.sessionId === null ? null : titleOf(group.sessionId, sessions, titles)
          const source = group.items.find(item => item.source !== undefined)?.source
          return (
            <section
              key={group.key}
              className="pending-notice"
              data-testid="pending-notice"
              data-group-key={group.key}
              data-session-id={group.sessionId ?? ''}
            >
              <header className="pending-notice-head">
                <span className="pending-notice-source" data-testid="pending-notice-source">
                  {groupTitle ?? t('pending.sourceUnavailable')}
                </span>
                <span className="pending-notice-count" data-testid="pending-notice-count">
                  {t('pending.count', { count: group.items.length })}
                </span>
                <button
                  type="button"
                  className="pending-sound-toggle"
                  data-testid="pending-sound-toggle"
                  aria-pressed={soundEnabled}
                  aria-label={soundEnabled ? t('pending.soundMute') : t('pending.soundUnmute')}
                  title={soundEnabled ? t('pending.soundMute') : t('pending.soundUnmute')}
                  onClick={toggleSound}
                >
                  {soundEnabled ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
                </button>
              </header>
              {source === undefined ? null : (
                <p className="pending-notice-operation" data-testid="pending-notice-operation">
                  {source.title}
                  {source.roleLabel === undefined && source.sourceLabel === undefined
                    ? null
                    : ` · ${[source.roleLabel, source.sourceLabel].filter(value => value !== undefined).join(' · ')}`}
                </p>
              )}
              <ul className="pending-notice-items">
                {group.items.map(interaction => (
                  <li key={interaction.id} className="pending-notice-item" data-testid="pending-notice-item">
                    {summaryText(interaction)}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="pending-review"
                data-testid="pending-review"
                onClick={(event) => { openView(group.key, event.currentTarget) }}
              >
                {t('pending.review')}
              </button>
            </section>
          )
        })}
      </div>

      {openGroup === null ? null : (
        <div className="pending-dialog-backdrop">
          <div
            className="pending-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('pending.dialogTitle')}
            data-testid="pending-dialog"
            ref={dialogRef}
            tabIndex={-1}
          >
            <header className="pending-dialog-head">
              <h2>{t('pending.dialogTitle', { session: title ?? t('pending.sourceUnavailable') })}</h2>
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
              {openGroup.sessionId === null
                ? <p className="pending-hint">{t('pending.sourceUnavailableHint')}</p>
                : null}
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
                    <div className="history-text">{renderMarkdown(message.text)}</div>
                  </div>
                ))
                : null}
            </div>
            <div className="pending-dialog-answers" data-testid="pending-dialog-answers">
              <PendingCards
                t={t}
                items={openGroup.items}
                onAnswer={onAnswer}
                drafts={draftStore}
                onDraftsChange={(id, next) => {
                  setDraftStore(current => ({ ...current, [id]: next }))
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
