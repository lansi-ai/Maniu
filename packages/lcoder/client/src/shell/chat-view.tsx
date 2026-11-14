/** 对话页：会话列表、消息流、待办提示与输入器。 */

import type { JSX, RefObject } from 'react'
import type { Translate } from '../locale.ts'
import type { ChatState, SessionSummary } from '../store.ts'

/** 待办提示。 */
export interface PendingNote {
  readonly id: string
  readonly kind: string
  readonly text: string
}

/** 对话页属性。 */
export interface ChatViewProps {
  readonly t: Translate
  readonly sessions: readonly SessionSummary[]
  readonly active: string | null
  readonly chat: ChatState
  readonly pending: readonly PendingNote[]
  readonly notice: string | null
  readonly sending: boolean
  readonly composerRef: RefObject<HTMLTextAreaElement>
  readonly onSelect: (sessionId: string) => void
  readonly onCreate: () => void
  readonly onSend: () => void
  readonly onDismissPending: (id: string) => void
}

/**
 * 会话短名：优先取 cwd 尾段。
 * @param session - 会话摘要。
 * @returns 展示名。
 */
export function sessionLabel(session: SessionSummary): string {
  if (session.cwd !== undefined) {
    const parts = session.cwd.split(/[\\/]/).filter(part => part !== '')
    const tail = parts[parts.length - 1]
    if (tail !== undefined) return tail
  }
  return session.sessionId.slice(0, 8)
}

/**
 * 对话页。
 * @param props - 会话、消息、提示与动作。
 * @returns 侧栏与聊天列。
 */
export function ChatView({
  t, sessions, active, chat, pending, notice, sending, composerRef, onSelect, onCreate, onSend, onDismissPending,
}: ChatViewProps): JSX.Element {
  const activeSession = sessions.find(item => item.sessionId === active) ?? null
  return (
    <>
      <aside className="sidebar lg-glass">
        <div className="sidebar-head">
          <span>{t('chat.sessions')}</span>
          <button type="button" className="pill lg-sheen lg-lift" data-testid="new-session" onClick={onCreate}>
            {t('chat.newSession')}
          </button>
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
                <span className="label">{sessionLabel(session)}</span>
                {session.running && <span className="running">{t('chat.running')}</span>}
              </button>
            </li>
          ))}
        </ul>
        {notice !== null && <p className="notice" data-testid="notice">{notice}</p>}
      </aside>

      <section className="chat">
        <div className="chat-head lg-glass">
          <span data-testid="active-session">
            {activeSession === null ? t('chat.noSession') : sessionLabel(activeSession)}
          </span>
        </div>
        <div className="messages" data-testid="messages">
          {chat.messages.map(message => (
            <article
              key={message.id}
              className={message.role === 'assistant' ? 'message assistant lg-glass-card' : 'message user'}
              data-testid={`message-${message.role}`}
            >
              {message.text}
              {message.tools !== undefined && (
                <span className="tool-line" data-testid="message-tools">
                  {t('chat.tools', { tools: message.tools.join(', ') })}
                </span>
              )}
            </article>
          ))}
          {chat.liveText !== '' && (
            <article className="message assistant live lg-glass-card" data-testid="message-assistant" data-live="true">
              {chat.liveText}
            </article>
          )}
          {chat.streamError !== null && <p className="notice" data-testid="stream-error">{chat.streamError}</p>}
        </div>
        {pending.length > 0 && (
          <div className="pending-stack" data-testid="pending-stack">
            {pending.map(item => (
              <div
                key={item.id}
                className="pending-note lg-glass-card"
                data-testid={item.kind === 'approval/request' ? 'pending-approval' : 'pending-question'}
              >
                <strong>{item.kind === 'approval/request' ? t('pending.approvalTitle') : t('pending.questionTitle')}</strong>
                <p>{item.text}</p>
                <button type="button" className="pill" onClick={() => { onDismissPending(item.id) }}>
                  {t('pending.ack')}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer lg-glass">
          <textarea
            ref={composerRef}
            data-testid="composer"
            placeholder={t('chat.placeholder')}
            rows={3}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                onSend()
              }
            }}
          />
          <button
            type="button"
            className="pill pill-accent lg-sheen lg-lift"
            data-testid="send"
            disabled={sending}
            onClick={onSend}
          >
            {sending ? t('chat.sending') : t('chat.send')}
          </button>
        </div>
      </section>
    </>
  )
}
