/** S1 渲染端：登录门禁、会话列表、发消息与流式正文。 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { HostEvent, HostState, RemoteFailure } from './contract.ts'
import {
  actionOfFrame,
  chatReducer,
  emptyChat,
  summaryOf,
  type SessionSummary,
} from './store.ts'

type Gate =
  | { readonly kind: 'booting' }
  | { readonly kind: 'login'; readonly message: string }
  | { readonly kind: 'cloud-error'; readonly failure: RemoteFailure }
  | { readonly kind: 'ready' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function sessionLabel(session: SessionSummary): string {
  if (session.cwd !== undefined) {
    const parts = session.cwd.split(/[\\/]/).filter(part => part !== '')
    const tail = parts[parts.length - 1]
    if (tail !== undefined) return tail
  }
  return session.sessionId.slice(0, 8)
}

function sortSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((left, right) => right.updatedAt - left.updatedAt)
}

/** 应用根。 */
export function App(): JSX.Element {
  const [host, setHost] = useState<HostState>({ kind: 'starting' })
  const [gate, setGate] = useState<Gate>({ kind: 'booting' })
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [chat, dispatch] = useReducer(chatReducer, emptyChat)
  const [notice, setNotice] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const streamRef = useRef<string | null>(null)
  const activeRef = useRef<string | null>(null)
  const rebaselineRef = useRef(0)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  activeRef.current = active

  const closeStream = useCallback(() => {
    const stream = streamRef.current
    streamRef.current = null
    if (stream !== null) void window.lcoder.cancelStream(stream)
  }, [])

  const openFollow = useCallback(async (sessionId: string) => {
    closeStream()
    dispatch({ type: 'reset' })
    try {
      const stream = await window.lcoder.openStream('session', 'follow', {
        request: {
          address: { kind: 'session', sessionId },
          activate: true,
          assistantStream: true,
          maxMessages: 60,
        },
      })
      streamRef.current = stream
    } catch (error: unknown) {
      dispatch({ type: 'stream-error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [closeStream])

  const selectSession = useCallback((sessionId: string) => {
    setActive(sessionId)
    activeRef.current = sessionId
    localStorage.setItem('lcoder.s1.session', sessionId)
    void openFollow(sessionId)
  }, [openFollow])

  const loadSessions = useCallback(async () => {
    const answer = await window.lcoder.call('session', 'list', { _request: {} })
    if (!answer.ok) {
      setNotice(`${answer.error.code}: ${answer.error.message}`)
      return
    }
    const value = answer.value
    if (!isRecord(value) || !Array.isArray(value.items)) return
    const items = value.items.flatMap(item => summaryOf(item) ?? [])
    setSessions(sortSessions(items))
  }, [])

  const checkCloud = useCallback(async () => {
    setGate({ kind: 'booting' })
    const answer = await window.lcoder.call('lcoderCloud', 'state', {})
    if (!answer.ok) {
      setGate({ kind: 'cloud-error', failure: answer.error })
      return
    }
    const value = answer.value
    if (!isRecord(value)) {
      setGate({ kind: 'cloud-error', failure: { code: 'lcoder/invalid-cloud-state', message: '云端状态字段不合法' } })
      return
    }
    if (value.ok === false) {
      const failure = value.error
      setGate({
        kind: 'cloud-error',
        failure: isRecord(failure)
          ? {
            code: typeof failure.code === 'string' ? failure.code : 'lcoder/cloud-failed',
            message: typeof failure.message === 'string' ? failure.message : '云端调用失败',
          }
          : { code: 'lcoder/cloud-failed', message: '云端调用失败' },
      })
      return
    }
    const state = value.ok === true && isRecord(value.value) ? value.value : undefined
    if (state === undefined) {
      setGate({ kind: 'cloud-error', failure: { code: 'lcoder/invalid-cloud-state', message: '云端状态字段不合法' } })
      return
    }
    if (state.signedIn !== true) {
      setGate({ kind: 'login', message: '当前未登录。S1 只做登录门禁，登录表单在 M3 实现。' })
      return
    }
    setGate({ kind: 'ready' })
    await loadSessions()
  }, [loadSessions])

  useEffect(() => {
    const off = window.lcoder.hostState(setHost)
    void window.lcoder.hostStateNow().then(setHost).catch(() => undefined)
    return off
  }, [])

  useEffect(() => {
    if (host.kind !== 'ready') return
    void checkCloud()
  }, [host, checkCloud])

  useEffect(() => {
    const off = window.lcoder.onEvent((event: HostEvent) => {
      const first = event.args[0]
      if (event.name === 'api-session/added') {
        const summary = summaryOf(first)
        if (summary === undefined) return
        setSessions(current => sortSessions([...current.filter(item => item.sessionId !== summary.sessionId), summary]))
        return
      }
      if (event.name === 'api-session/removed' && typeof first === 'string') {
        setSessions(current => current.filter(item => item.sessionId !== first))
        return
      }
      if (event.name === 'api-session/status' && typeof first === 'string') {
        const running = event.args[1]
        if (typeof running !== 'boolean') return
        setSessions(current => current.map(item => item.sessionId === first ? { ...item, running } : item))
        return
      }
      if (event.name === 'api-session/activity' && typeof first === 'string') {
        const updatedAt = event.args[1]
        if (typeof updatedAt !== 'number') return
        setSessions(current => sortSessions(current.map(item => item.sessionId === first ? { ...item, updatedAt } : item)))
      }
    })
    return off
  }, [])

  useEffect(() => {
    const off = window.lcoder.onStreamFrame((streamId, frame) => {
      if (streamId !== streamRef.current) return
      if (frame.kind === 'item') {
        const action = actionOfFrame(frame.value)
        if (action !== undefined) dispatch(action)
        return
      }
      if (frame.kind === 'error') {
        dispatch({ type: 'stream-error', message: `${frame.error.code}: ${frame.error.message}` })
        const session = activeRef.current
        if (session !== null) void openFollow(session)
      }
    })
    return off
  }, [openFollow])

  useEffect(() => {
    if (chat.rebaseline === rebaselineRef.current) return
    rebaselineRef.current = chat.rebaseline
    const session = activeRef.current
    if (session !== null) void openFollow(session)
  }, [chat.rebaseline, openFollow])

  const createSession = useCallback(async () => {
    setNotice(null)
    const answer = await window.lcoder.call('session', 'create', { request: {} })
    if (!answer.ok) {
      setNotice(`${answer.error.code}: ${answer.error.message}`)
      return
    }
    const value = answer.value
    if (!isRecord(value) || typeof value.sessionId !== 'string') {
      setNotice('session.create 返回了无法识别的会话')
      return
    }
    const sessionId = value.sessionId
    setSessions(current => sortSessions([
      ...current.filter(item => item.sessionId !== sessionId),
      {
        sessionId,
        updatedAt: Date.now(),
        running: false,
        blank: true,
        ...(typeof value.agentPreset === 'string' ? { agentPreset: value.agentPreset } : {}),
      },
    ]))
    selectSession(sessionId)
    await loadSessions()
  }, [loadSessions, selectSession])

  const send = useCallback(async () => {
    const text = composerRef.current?.value.trim() ?? ''
    if (text === '' || sending) return
    let sessionId = activeRef.current
    setSending(true)
    setNotice(null)
    try {
      if (sessionId === null) {
        const created = await window.lcoder.call('session', 'create', { request: {} })
        if (!created.ok) {
          setNotice(`${created.error.code}: ${created.error.message}`)
          return
        }
        const value = created.value
        if (!isRecord(value) || typeof value.sessionId !== 'string') {
          setNotice('session.create 返回了无法识别的会话')
          return
        }
        sessionId = value.sessionId
        selectSession(sessionId)
        await loadSessions()
      }
      const answer = await window.lcoder.call('session', 'prompt', {
        request: {
          requestId: newRequestId(),
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        },
      })
      if (!answer.ok) {
        setNotice(`${answer.error.code}: ${answer.error.message}`)
        return
      }
      if (composerRef.current !== null) composerRef.current.value = ''
    } finally {
      setSending(false)
    }
  }, [loadSessions, selectSession, sending])

  const activeSession = sessions.find(item => item.sessionId === active) ?? null

  return (
    <div className="app" data-lcoder-state={gate.kind}>
      <header className="titlebar" data-testid="titlebar">
        <div className="titlebar-drag">
          <span className="brand">LCoder</span>
          <span className="tag">S1</span>
          <span className="host" data-testid="host-state" data-host-state={host.kind}>
            {host.kind === 'ready' ? '宿主就绪' : host.kind === 'fatal' ? `宿主失败：${host.detail}` : '宿主启动中…'}
          </span>
        </div>
        <div className="window-buttons">
          <button type="button" aria-label="最小化" onClick={() => { void window.lcoder.window('minimize') }}>—</button>
          <button type="button" aria-label="最大化" onClick={() => { void window.lcoder.window('toggle-maximize') }}>□</button>
          <button type="button" aria-label="关闭" onClick={() => { void window.lcoder.window('close') }}>×</button>
        </div>
      </header>

      {gate.kind === 'booting' && (
        <main className="center" data-testid="gate-loading">
          <p>正在读取宿主与登录状态…</p>
          {host.kind === 'fatal' && <pre className="fatal">{host.detail}</pre>}
        </main>
      )}

      {gate.kind === 'cloud-error' && (
        <main className="center" data-testid="cloud-unavailable">
          <h1>云端不可用</h1>
          <p>登录状态读不到，这不是「未登录」。</p>
          <code>{gate.failure.code}: {gate.failure.message}</code>
          <button type="button" onClick={() => { void checkCloud() }}>重新检查</button>
        </main>
      )}

      {gate.kind === 'login' && (
        <main className="center" data-testid="login-placeholder">
          <h1>登录</h1>
          <p>{gate.message}</p>
          <button type="button" onClick={() => { void checkCloud() }}>重新检查</button>
        </main>
      )}

      {gate.kind === 'ready' && (
        <main className="workspace" data-testid="workspace">
          <aside className="sidebar">
            <div className="sidebar-head">
              <span>会话</span>
              <button type="button" data-testid="new-session" onClick={() => { void createSession() }}>新会话</button>
            </div>
            <ul className="session-list" data-testid="session-list">
              {sessions.map(session => (
                <li key={session.sessionId}>
                  <button
                    type="button"
                    data-testid="session-item"
                    data-session-id={session.sessionId}
                    data-running={session.running ? 'true' : 'false'}
                    className={session.sessionId === active ? 'session active' : 'session'}
                    onClick={() => { selectSession(session.sessionId) }}
                  >
                    <span className="dot" />
                    <span className="label">{sessionLabel(session)}</span>
                    {session.running && <span className="running">运行中</span>}
                  </button>
                </li>
              ))}
            </ul>
            {notice !== null && <p className="notice" data-testid="notice">{notice}</p>}
          </aside>

          <section className="chat">
            <div className="chat-head">
              <span data-testid="active-session">{activeSession === null ? '未选择会话' : sessionLabel(activeSession)}</span>
            </div>
            <div className="messages" data-testid="messages">
              {chat.messages.map(message => (
                <article
                  key={message.id}
                  className={`message ${message.role}`}
                  data-testid={`message-${message.role}`}
                >
                  {message.text}
                </article>
              ))}
              {chat.liveText !== '' && (
                <article className="message assistant live" data-testid="message-assistant" data-live="true">
                  {chat.liveText}
                </article>
              )}
              {chat.streamError !== null && <p className="notice" data-testid="stream-error">{chat.streamError}</p>}
            </div>
            <div className="composer">
              <textarea
                ref={composerRef}
                data-testid="composer"
                placeholder="发一条消息…"
                rows={3}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <button type="button" data-testid="send" disabled={sending} onClick={() => { void send() }}>
                {sending ? '发送中…' : '发送'}
              </button>
            </div>
          </section>
        </main>
      )}
    </div>
  )
}
