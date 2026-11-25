/** 对话页：会话列表、聊天正文、审批/提问卡与输入器。 */

import { useEffect, useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'
import { Button, Input } from '@heroui/react'
import { Pencil } from 'lucide-react'
import type { EventOutcome } from '../contract.ts'
import type { Translate } from '../locale.ts'
import type {
  ChatImageLimits, ChatModelAvailability, ChatModelOption, ChatModelSelectionView, ChatContextUsage,
  ChatPendingAttachment,
} from '../chat/composer.ts'
import type { PendingInteraction } from '../chat/pending.ts'
import type { ChatState, SessionSummary } from '../store.ts'
import { currentPresetId } from '../talents/model.ts'
import { isFlowSession, seedHiddenOf } from './session-groups.ts'
import { Composer } from './composer.tsx'
import { ChatTranscript } from './chat-transcript.tsx'
import { PendingCards, type AnswerResult } from './pending-cards.tsx'

/** 对话页属性。 */
export interface ChatViewProps {
  readonly t: Translate
  readonly sessions: readonly SessionSummary[]
  /** 会话标题；来自 follow 的 `session/title` 与本次改名。 */
  readonly titles: Readonly<Record<string, string>>
  readonly active: string | null
  readonly chat: ChatState
  readonly notice: string | null
  readonly sending: boolean
  readonly running: boolean
  readonly limits: ChatImageLimits
  readonly models: readonly ChatModelOption[]
  readonly selection: ChatModelSelectionView | undefined
  readonly availability: ChatModelAvailability
  readonly usage: ChatContextUsage
  readonly composerRef: RefObject<HTMLTextAreaElement | null>
  /** 人才 preset id → 显示名；会话列表据此标注归属。 */
  readonly talentNames: Readonly<Record<string, string>>
  /** 等待人处理的审批与提问；在对话列内渲染，不再走右下浮层。 */
  readonly pending: readonly PendingInteraction[]
  readonly onAnswer: (interaction: PendingInteraction, outcome: EventOutcome) => Promise<AnswerResult>
  readonly onSelect: (sessionId: string) => void
  readonly onCreate: () => void
  readonly onSend: (text: string, attachments: readonly ChatPendingAttachment[]) => Promise<boolean>
  readonly onStop: () => void
  readonly onRename: (title: string) => Promise<boolean>
  readonly ensureSession: () => Promise<string | null>
  readonly onSelectModel: (provider: string, model: string) => Promise<boolean>
}

const SIDEBAR_WIDTH_KEY = 'lcoder.chat.sidebarWidth'
const SIDEBAR_DEFAULT_WIDTH = 260
const SIDEBAR_MIN_WIDTH = 200
const SIDEBAR_MAX_WIDTH = 520

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

function readSidebarWidth(): number {
  try {
    const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    if (Number.isFinite(raw) && raw >= SIDEBAR_MIN_WIDTH && raw <= SIDEBAR_MAX_WIDTH) return Math.round(raw)
  } catch {
    // 忽略本地存储读取失败，回落默认宽度。
  }
  return SIDEBAR_DEFAULT_WIDTH
}

/**
 * 会话短名：已改名或事件缓存标题优先，其次列表投影自带标题，其次 cwd 尾段，最后是会话标识前缀。
 * @param session - 会话摘要。
 * @param titles - 已读到的标题。
 * @returns 展示名。
 */
export function sessionLabel(session: SessionSummary, titles: Readonly<Record<string, string>>): string {
  const title = titles[session.sessionId]
  if (title !== undefined && title !== '') return title
  if (session.title !== undefined && session.title !== '') return session.title
  if (session.cwd !== undefined) {
    const parts = session.cwd.split(/[\\/]/).filter(part => part !== '')
    const tail = parts[parts.length - 1]
    if (tail !== undefined) return tail
  }
  return session.sessionId.slice(0, 8)
}

/**
 * 对话页。
 * @param props - 会话、聊天状态、交互与动作。
 * @returns 侧栏与聊天列。
 */
export function ChatView({
  t, sessions, titles, active, chat, notice, sending, running, limits, models, selection,
  availability, usage, composerRef, talentNames, pending, onAnswer, onSelect, onCreate, onSend, onStop, onRename,
  ensureSession, onSelectModel,
}: ChatViewProps): JSX.Element {
  const activeSession = sessions.find(item => item.sessionId === active) ?? null
  const firstRow = chat.rows.find(row => row.kind === 'user')
  const firstUserText = firstRow?.text ?? ''
  // 后台流程的首条系统指令留在日志里，界面上整行收起，避免蓝底原文淹没正文。
  const seedHidden = seedHiddenOf(activeSession, firstUserText)
  const chatSessions = sessions.filter(session => !isFlowSession(session))
  const flowSessions = sessions.filter(session => isFlowSession(session))
  const [chatOpen, setChatOpen] = useState(true)
  const [flowOpen, setFlowOpen] = useState(true)
  const headTitle = active === null
    ? t('chat.noSession')
    : activeSession === null ? active.slice(0, 8) : sessionLabel(activeSession, titles)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [renameProblem, setRenameProblem] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState<number>(readSidebarWidth)
  const [resizing, setResizing] = useState(false)
  const resizeRef = useRef<{ readonly startX: number; readonly startWidth: number } | null>(null)

  useEffect(() => {
    if (!resizing) return
    const onMove = (event: PointerEvent): void => {
      const drag = resizeRef.current
      if (drag === null) return
      const next = clampSidebarWidth(drag.startWidth + (event.clientX - drag.startX))
      setSidebarWidth(next)
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next))
      } catch {
        // 忽略本地存储写入失败。
      }
    }
    const stop = (): void => {
      resizeRef.current = null
      setResizing(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [resizing])

  const beginRename = (): void => {
    if (active === null) return
    setDraft(headTitle)
    setRenameProblem(null)
    setEditing(true)
  }

  const commitRename = async (): Promise<void> => {
    const title = draft.trim()
    if (title === '') {
      setRenameProblem(t('chat.renameEmpty'))
      return
    }
    const accepted = await onRename(title)
    if (accepted) {
      setEditing(false)
      setRenameProblem(null)
    }
  }

  /** 一组会话：小标题带数量与折叠按钮，默认展开，既有 testid 保持不变。 */
  const sessionGroup = (
    kind: 'chat' | 'flow',
    label: string,
    items: readonly SessionSummary[],
    open: boolean,
    onToggle: () => void,
  ): JSX.Element => (
    <li className="session-group" data-testid={`session-group-${kind}`}>
      <button
        type="button"
        className="session-group-head"
        data-testid={`session-group-${kind}-head`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="session-group-label">{label}</span>
        <span className="session-group-count">{items.length}</span>
        <span className="session-group-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {!open ? null : (
        <ul className="session-group-items">
          {items.length === 0
            ? <li className="session-group-empty">{kind === 'chat' ? t('chat.groupEmptyChat') : t('chat.groupEmptyFlow')}</li>
            : items.map((session) => {
              const label = sessionLabel(session, titles)
              const talent = session.agentPreset === undefined ? undefined : talentNames[currentPresetId(session.agentPreset)]
              const fullTitle = talent === undefined ? label : `${label} · ${talent}`
              return (
                <li key={session.sessionId}>
                  <button
                    type="button"
                    data-testid="session-item"
                    data-session-id={session.sessionId}
                    data-running={session.running ? 'true' : 'false'}
                    className={session.sessionId === active ? 'session active' : 'session'}
                    title={fullTitle}
                    onClick={() => { onSelect(session.sessionId) }}
                  >
                    <span className="dot" />
                    <span className="label">{label}</span>
                    {talent !== undefined
                      ? <span className="session-talent" data-testid="session-talent">{talent}</span>
                      : null}
                    {session.running && <span className="running">{t('chat.running')}</span>}
                  </button>
                </li>
              )
            })}
        </ul>
      )}
    </li>
  )

  return (
    <>
      <aside
        className="sidebar"
        style={{ width: `${String(sidebarWidth)}px`, flexBasis: `${String(sidebarWidth)}px` }}
      >
        <div className="sidebar-head">
          <span>{t('chat.sessions')}</span>
          <Button
            className="new-session-btn"
            data-testid="new-session"
            variant="secondary"
            size="sm"
            onPress={onCreate}
          >
            {t('chat.newSession')}
          </Button>
        </div>
        <ul className="session-list" data-testid="session-list">
          {sessionGroup('chat', t('chat.groupChat'), chatSessions, chatOpen, () => { setChatOpen(value => !value) })}
          {sessionGroup('flow', t('chat.groupFlow'), flowSessions, flowOpen, () => { setFlowOpen(value => !value) })}
        </ul>
        {notice !== null && <p className="notice" data-testid="notice">{notice}</p>}
      </aside>
      <div
        className="sidebar-resizer"
        data-testid="sidebar-resizer"
        data-dragging={resizing ? 'true' : 'false'}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('chat.sessions')}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          resizeRef.current = { startX: event.clientX, startWidth: sidebarWidth }
          setResizing(true)
        }}
      />

      <section className="chat">
        <div className="chat-head">
          {editing ? (
            <div className="rename-row">
              <Input
                className="rename-input"
                data-testid="session-rename-input"
                value={draft}
                aria-label={t('chat.rename')}
                autoFocus
                variant="secondary"
                onChange={(event) => { setDraft(event.target.value); setRenameProblem(null) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); void commitRename() }
                  if (event.key === 'Escape') { setEditing(false) }
                }}
              />
              <Button
                className="rename-action"
                variant="primary"
                size="sm"
                data-testid="session-rename-save"
                onPress={() => { void commitRename() }}
              >
                {t('chat.renameSave')}
              </Button>
              <Button
                className="rename-action"
                variant="secondary"
                size="sm"
                data-testid="session-rename-cancel"
                onPress={() => { setEditing(false) }}
              >
                {t('chat.renameCancel')}
              </Button>
              {renameProblem === null ? null : <span className="rename-problem">{renameProblem}</span>}
            </div>
          ) : (
            <>
              <span data-testid="active-session">{headTitle}</span>
              {active === null ? null : (
                <Button
                  className="rename-action"
                  variant="ghost"
                  size="sm"
                  data-testid="session-rename"
                  onPress={beginRename}
                >
                  <Pencil aria-hidden="true" />
                  {t('chat.rename')}
                </Button>
              )}
              {running ? <span className="running" data-testid="session-running">{t('chat.running')}</span> : null}
            </>
          )}
        </div>

        <ChatTranscript
          t={t}
          sessionId={active}
          chat={chat}
          seedHidden={seedHidden}
          pendingCount={pending.length}
          pending={pending.length === 0 ? null : (
            <div className="chat-pending" data-testid="chat-pending">
              <PendingCards t={t} items={pending} onAnswer={onAnswer} />
            </div>
          )}
        />

        <Composer
          t={t}
          sessionId={active}
          running={running}
          sending={sending}
          limits={limits}
          models={models}
          selection={selection}
          availability={availability}
          usage={usage}
          composerRef={composerRef}
          ensureSession={ensureSession}
          onSend={onSend}
          onStop={onStop}
          onSelectModel={onSelectModel}
        />
      </section>
    </>
  )
}
