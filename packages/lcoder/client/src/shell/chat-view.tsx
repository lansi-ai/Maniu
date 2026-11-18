/** 对话页：会话列表、聊天正文、审批/提问卡与输入器。 */

import { useState } from 'react'
import type { JSX, RefObject } from 'react'
import { Button } from '@heroui/react'
import type { EventOutcome } from '../contract.ts'
import type { Translate } from '../locale.ts'
import type {
  ChatImageLimits, ChatModelAvailability, ChatModelOption, ChatModelSelectionView, ChatContextUsage,
  ChatPendingAttachment,
} from '../chat/composer.ts'
import type { PendingInteraction } from '../chat/pending.ts'
import type { ChatState, SessionSummary } from '../store.ts'
import { currentPresetId, isIntakePreset } from '../talents/model.ts'
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

/**
 * 会话短名：已改名的标题优先，其次 cwd 尾段，最后是会话标识前缀。
 * @param session - 会话摘要。
 * @param titles - 已读到的标题。
 * @returns 展示名。
 */
export function sessionLabel(session: SessionSummary, titles: Readonly<Record<string, string>>): string {
  const title = titles[session.sessionId]
  if (title !== undefined && title !== '') return title
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
  // 立项会话的首条消息是整段指令；正文留在会话日志里，界面上整行不渲染。
  const intake = activeSession !== null && isIntakePreset(activeSession.agentPreset)
  const headTitle = active === null
    ? t('chat.noSession')
    : activeSession === null ? active.slice(0, 8) : sessionLabel(activeSession, titles)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [renameProblem, setRenameProblem] = useState<string | null>(null)

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

  return (
    <>
      <aside className="sidebar lg-glass">
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
          {sessions.map(session => (
            <li key={session.sessionId}>
              <button
                type="button"
                data-testid="session-item"
                data-session-id={session.sessionId}
                data-running={session.running ? 'true' : 'false'}
                className={session.sessionId === active ? 'session active lg-sheen' : 'session lg-sheen'}
                onClick={() => { onSelect(session.sessionId) }}
              >
                <span className="dot" />
                <span className="label">{sessionLabel(session, titles)}</span>
                {session.agentPreset !== undefined && talentNames[currentPresetId(session.agentPreset)] !== undefined
                  ? <span className="session-talent" data-testid="session-talent">{talentNames[currentPresetId(session.agentPreset)]}</span>
                  : null}
                {session.running && <span className="running">{t('chat.running')}</span>}
              </button>
            </li>
          ))}
        </ul>
        {notice !== null && <p className="notice" data-testid="notice">{notice}</p>}
      </aside>

      <section className="chat">
        <div className="chat-head lg-glass">
          {editing ? (
            <div className="rename-row">
              <input
                className="rename-input"
                data-testid="session-rename-input"
                value={draft}
                aria-label={t('chat.rename')}
                autoFocus
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
                  variant="secondary"
                  size="sm"
                  data-testid="session-rename"
                  onPress={beginRename}
                >
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
          seedHidden={intake}
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
