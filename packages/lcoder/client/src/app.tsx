/** 新客户端根：登录门禁、会话聊天与工作台五页。 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { HostEvent, HostState, HostWaterfall, RemoteFailure } from './contract.ts'
import {
  actionOfFrame,
  chatReducer,
  emptyChat,
  summaryOf,
  type SessionSummary,
} from './store.ts'
import { ProjectInfoPage } from './pages/project-info.tsx'
import { ProjectsPage } from './pages/projects.tsx'
import { RequirementsPage } from './pages/requirements.tsx'
import { SettingsPage } from './pages/settings.tsx'
import { TasksPage } from './pages/tasks.tsx'
import { RolesPage } from './pages/roles.tsx'
import { ensureScopeSession, useWorkspaceList, type ProjectScope, type WorkspaceRow } from './workspace/use-workspaces.ts'
import { useProjection } from './workspace/use-projection.ts'

/** 工作台页面。 */
type PageId = 'chat' | 'requirements' | 'tasks' | 'projects' | 'project-info' | 'roles' | 'settings'

/** 新会话默认使用的角色；工作台作用域会话靠它拿到人机命令面。 */
const WORKBENCH_PRESET = 'lcoder-workbench'

const NAV_ITEMS: readonly { readonly id: PageId; readonly label: string }[] = [
  { id: 'chat', label: '对话' },
  { id: 'requirements', label: '需求' },
  { id: 'tasks', label: '任务' },
  { id: 'projects', label: '项目' },
  { id: 'project-info', label: '项目信息' },
  { id: 'roles', label: '角色' },
  { id: 'settings', label: '设置' },
]

const PROJECT_KEY = 'lcoder.m2.project'

function savedProject(): ProjectScope | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const fields = value as Record<string, unknown>
    if (typeof fields.workspaceId !== 'string' || typeof fields.path !== 'string'
      || typeof fields.title !== 'string' || typeof fields.scopeSessionId !== 'string') return null
    return {
      workspaceId: fields.workspaceId,
      path: fields.path,
      title: fields.title,
      scopeSessionId: fields.scopeSessionId,
    }
  } catch {
    return null
  }
}

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

/** 宿主状态的稳定优先级：晚到的初始读取不得把 ready/fatal 降回 starting。 */
const HOST_RANK: Readonly<Record<HostState['kind'], number>> = {
  starting: 0,
  ready: 1,
  fatal: 2,
  stopped: 3,
}

/** 云端状态读取的上限；超时按云端不可用展示，不留在 booting。 */
const CLOUD_STATE_TIMEOUT_MS = 15_000

function cloudFailureOf(error: unknown): RemoteFailure {
  return {
    code: 'lcoder/cloud-unreachable',
    message: error instanceof Error ? error.message : String(error),
  }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(message)) }, milliseconds)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

function pendingTextOf(event: HostWaterfall): string {
  const request = event.request
  if (isRecord(request) && Array.isArray(request.questions)) {
    const questions = request.questions.flatMap((question) => {
      if (!isRecord(question)) return []
      if (typeof question.question === 'string') return [question.question]
      if (typeof question.header === 'string') return [question.header]
      return []
    })
    if (questions.length > 0) return questions.join('；')
  }
  if (isRecord(request)) {
    const reason = request.displayReason ?? request.reason
    if (typeof reason === 'string' && reason !== '') return reason
    const tool = request.toolName
    if (typeof tool === 'string') return `工具 ${tool} 请求审批`
  }
  return event.name === 'approval/request' ? '有一个工具在等待审批' : '模型正在等待回答'
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
  const [page, setPage] = useState<PageId>('chat')
  const [project, setProject] = useState<ProjectScope | null>(savedProject)
  const [projectNotice, setProjectNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<readonly { readonly id: string; readonly kind: string; readonly text: string }[]>([])

  const workspaces = useWorkspaceList(gate.kind === 'ready')
  const projection = useProjection(project?.scopeSessionId ?? null)

  const streamRef = useRef<string | null>(null)
  const activeRef = useRef<string | null>(null)
  const rebaselineRef = useRef(0)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const hostEventSeen = useRef(false)
  const cloudSeq = useRef(0)

  activeRef.current = active

  const applyHost = useCallback((next: HostState) => {
    setHost(current => HOST_RANK[next.kind] >= HOST_RANK[current.kind] ? next : current)
  }, [])

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
    try {
      const answer = await window.lcoder.call('session', 'list', { _request: {} })
      if (!answer.ok) {
        setNotice(`${answer.error.code}: ${answer.error.message}`)
        return
      }
      const value = answer.value
      if (!isRecord(value) || !Array.isArray(value.items)) return
      const items = value.items.flatMap(item => summaryOf(item) ?? [])
      setSessions(sortSessions(items))
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const checkCloud = useCallback(async () => {
    const run = ++cloudSeq.current
    const apply = (next: Gate): void => { if (run === cloudSeq.current) setGate(next) }
    apply({ kind: 'booting' })

    let failure: RemoteFailure | undefined
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const answer = await withTimeout(
          window.lcoder.call('lcoderCloud', 'state', {}),
          CLOUD_STATE_TIMEOUT_MS,
          '云端状态读取超时',
        )
        if (!answer.ok) {
          failure = answer.error
        } else {
          const value = answer.value
          if (!isRecord(value)) {
            failure = { code: 'lcoder/invalid-cloud-state', message: '云端状态字段不合法' }
          } else if (value.ok === false) {
            const error = value.error
            failure = isRecord(error)
              ? {
                code: typeof error.code === 'string' ? error.code : 'lcoder/cloud-failed',
                message: typeof error.message === 'string' ? error.message : '云端调用失败',
              }
              : { code: 'lcoder/cloud-failed', message: '云端调用失败' }
          } else {
            const state = value.ok === true && isRecord(value.value) ? value.value : undefined
            if (state === undefined) {
              failure = { code: 'lcoder/invalid-cloud-state', message: '云端状态字段不合法' }
            } else if (state.signedIn !== true) {
              apply({ kind: 'login', message: '当前未登录。S1 只做登录门禁，登录表单在 M3 实现。' })
              return
            } else {
              apply({ kind: 'ready' })
              await loadSessions()
              return
            }
          }
        }
      } catch (error: unknown) {
        failure = cloudFailureOf(error)
      }
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 300))
    }
    apply({ kind: 'cloud-error', failure: failure ?? { code: 'lcoder/cloud-failed', message: '云端调用失败' } })
  }, [loadSessions])

  useEffect(() => {
    const off = window.lcoder.hostState((state) => {
      hostEventSeen.current = true
      applyHost(state)
    })
    // 挂载时补读一次；事件已到达时以事件为准，避免晚到的旧快照把 ready 降级。
    void window.lcoder.hostStateNow()
      .then((state) => { if (!hostEventSeen.current) applyHost(state) })
      .catch(() => undefined)
    return off
  }, [applyHost])

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
    const off = window.lcoder.onWaterfall((event: HostWaterfall) => {
      setPending(current => [...current.slice(-3), { id: event.eventId, kind: event.name, text: pendingTextOf(event) }])
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

  const chooseWorkspace = useCallback(async (workspace: WorkspaceRow) => {    setProjectNotice(null)
    let scope = await ensureScopeSession(workspace, sessions, WORKBENCH_PRESET)
    if (!scope.ok) scope = await ensureScopeSession(workspace, sessions)
    if (!scope.ok) {
      setProjectNotice(scope.message)
      return
    }
    const next: ProjectScope = {
      workspaceId: workspace.workspaceId,
      path: workspace.path,
      title: workspace.title,
      scopeSessionId: scope.sessionId,
    }
    setProject(next)
    localStorage.setItem(PROJECT_KEY, JSON.stringify(next))
    setPage('tasks')
    await loadSessions()
  }, [loadSessions, sessions])

  const startSession = useCallback(async (prompt: string) => {
    if (project === null) return { ok: false, message: '先选择一个项目' }
    const created = await window.lcoder.call('session', 'create', {
      request: { workspaceId: project.workspaceId, agentPreset: WORKBENCH_PRESET },
    })
    if (!created.ok) return { ok: false, message: `${created.error.code}: ${created.error.message}` }
    const value = created.value
    if (!isRecord(value) || typeof value.sessionId !== 'string') {
      return { ok: false, message: 'session.create 返回了无法识别的会话' }
    }
    const sessionId = value.sessionId
    const sent = await window.lcoder.call('session', 'prompt', {
      request: {
        requestId: newRequestId(),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: prompt }],
      },
    })
    if (!sent.ok) return { ok: false, message: `${sent.error.code}: ${sent.error.message}` }
    selectSession(sessionId)
    setPage('chat')
    await loadSessions()
    return { ok: true, message: `指令已发送到会话 ${sessionId.slice(0, 8)}；模型会先访谈，确认需求后才落盘。` }
  }, [loadSessions, project, selectSession])

  return (
    <div className="app" {...(gate.kind === 'booting' ? {} : { 'data-lcoder-state': gate.kind })}>
      <div className="ambient-layer" data-testid="ambient-layer" aria-hidden="true">
        <span className="ambient-blob blob-a" />
        <span className="ambient-blob blob-b" />
        <span className="ambient-blob blob-c" />
        <span className="ambient-blob blob-d" />
        <span className="ambient-blob blob-e" />
        <span className="ambient-grain" data-testid="ambient-grain" />
      </div>

      <header className="titlebar lg-glass" data-testid="titlebar">
        <div className="titlebar-drag">
          <span className="brand">LCoder</span>
          <span className="tag">M2</span>
          <span className="tag" data-testid="titlebar-project">{project === null ? '未选择项目' : project.title}</span>
          <span className="host" data-testid="host-state" data-host-state={host.kind}>
            {host.kind === 'ready' ? '宿主就绪' : host.kind === 'fatal' ? `宿主失败：${host.detail}` : '宿主启动中…'}
          </span>
        </div>
        <div className="window-buttons">
          <button type="button" className="lg-sheen" aria-label="最小化" onClick={() => { void window.lcoder.window('minimize') }}>—</button>
          <button type="button" className="lg-sheen" aria-label="最大化" onClick={() => { void window.lcoder.window('toggle-maximize') }}>□</button>
          <button type="button" className="lg-sheen" data-role="close" aria-label="关闭" onClick={() => { void window.lcoder.window('close') }}>×</button>
        </div>
      </header>

      {gate.kind === 'booting' && (
        <main className="center" data-testid="gate-loading">
          <section className="gate-card lg-glass">
            <h1>正在启动</h1>
            <p>正在读取宿主与登录状态…</p>
            {host.kind === 'fatal' && <pre className="fatal">{host.detail}</pre>}
          </section>
        </main>
      )}

      {gate.kind === 'cloud-error' && (
        <main className="center" data-testid="cloud-unavailable">
          <section className="gate-card lg-glass">
            <h1>云端不可用</h1>
            <p>登录状态读不到，这不是「未登录」。</p>
            <code>{gate.failure.code}: {gate.failure.message}</code>
            <button type="button" className="pill pill-accent lg-sheen lg-lift" onClick={() => { void checkCloud() }}>重新检查</button>
          </section>
        </main>
      )}

      {gate.kind === 'login' && (
        <main className="center" data-testid="login-placeholder">
          <section className="gate-card lg-glass">
            <h1>登录</h1>
            <p>{gate.message}</p>
            <button type="button" className="pill pill-accent lg-sheen lg-lift" onClick={() => { void checkCloud() }}>重新检查</button>
          </section>
        </main>
      )}

      {gate.kind === 'ready' && (
        <main className="shell" data-testid="workspace">
          <nav className="nav lg-glass" data-testid="nav">
            <div className="nav-brand">LCoder</div>
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                type="button"
                data-testid={`nav-${item.id}`}
                className={page === item.id ? 'nav-item active lg-sheen' : 'nav-item lg-sheen'}
                onClick={() => { setPage(item.id) }}
              >
                {item.label}
              </button>
            ))}
            <div className="nav-foot" data-testid="nav-project">
              {project === null ? '未选择项目' : project.title}
            </div>
          </nav>

          <div className="shell-body">
            {page === 'chat' && (
              <>
                <aside className="sidebar lg-glass">
                  <div className="sidebar-head">
                    <span>会话</span>
                    <button type="button" className="pill lg-sheen lg-lift" data-testid="new-session" onClick={() => { void createSession() }}>新会话</button>
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
                  <div className="chat-head lg-glass">
                    <span data-testid="active-session">{activeSession === null ? '未选择会话' : sessionLabel(activeSession)}</span>
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
                          <span className="tool-line" data-testid="message-tools">工具：{message.tools.join('、')}</span>
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
                          <strong>{item.kind === 'approval/request' ? '工具审批（纯文本）' : '等待回答（纯文本）'}</strong>
                          <p>{item.text}</p>
                          <button type="button" className="pill" onClick={() => { setPending(current => current.filter(entry => entry.id !== item.id)) }}>知道了</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="composer lg-glass">
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
                    <button type="button" className="pill pill-accent lg-sheen lg-lift" data-testid="send" disabled={sending} onClick={() => { void send() }}>
                      {sending ? '发送中…' : '发送'}
                    </button>
                  </div>
                </section>
              </>
            )}

            {page === 'requirements' && (
              <RequirementsPage
                project={project}
                projection={projection.projection}
                sessions={sessions}
                loading={projection.loading}
                error={projection.error}
                onReload={projection.reload}
                onStartSession={startSession}
              />
            )}

            {page === 'tasks' && (
              <TasksPage
                project={project}
                projection={projection.projection}
                sessions={sessions}
                loading={projection.loading}
                error={projection.error}
                onReload={projection.reload}
              />
            )}

            {page === 'projects' && (
              <ProjectsPage
                items={workspaces.items}
                current={project}
                error={projectNotice ?? workspaces.error}
                onSelect={(workspace) => { void chooseWorkspace(workspace) }}
                onOpened={(workspace) => { void chooseWorkspace(workspace) }}
              />
            )}

            {page === 'project-info' && (
              <ProjectInfoPage
                project={project}
                projection={projection.projection}
                loading={projection.loading}
                error={projection.error}
                onReload={projection.reload}
              />
            )}

            {page === 'settings' && <SettingsPage />}

            {page === 'roles' && (
              <RolesPage
                projection={projection.projection}
                sessions={sessions}
                reloadToken={0}
              />
            )}
          </div>
        </main>
      )}
    </div>
  )
}
