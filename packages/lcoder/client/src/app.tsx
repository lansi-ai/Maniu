/** 新客户端根：登录门禁、会话聊天与工作台五页。 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { HostEvent, HostState, HostWaterfall } from '@lcoder/desktop/contract'
import { actionOfFrame, chatReducer, emptyChat, summaryOf, type SessionSummary } from './store.ts'
import { translate, type MessageKey, type Translate } from './locale.ts'
import { browserStorage, markWelcomeSeen, usePreferences, welcomeSeen } from './prefs.ts'
import { useCloudSession } from './account/use-cloud.ts'
import { PersonalCenter } from './account/personal-center.tsx'
import { ProjectInfoPage } from './pages/project-info.tsx'
import { ProjectsPage } from './pages/projects.tsx'
import { RequirementsPage } from './pages/requirements.tsx'
import { SettingsPage } from './pages/settings.tsx'
import { TasksPage } from './pages/tasks.tsx'
import { RolesPage } from './pages/roles.tsx'
import { ChatView, type PendingNote } from './shell/chat-view.tsx'
import { GateView } from './shell/gate-view.tsx'
import { Titlebar } from './shell/titlebar.tsx'
import { useWindowState } from './shell/use-window-state.ts'
import { ensureScopeSession, useWorkspaceList, type ProjectScope, type WorkspaceRow } from './workspace/use-workspaces.ts'
import { useProjection } from './workspace/use-projection.ts'

/** 工作台页面。 */
type PageId = 'chat' | 'requirements' | 'tasks' | 'projects' | 'project-info' | 'roles' | 'settings' | 'account'

/** 新会话默认使用的角色；工作台作用域会话靠它拿到人机命令面。 */
const WORKBENCH_PRESET = 'lcoder-workbench'

const NAV_ITEMS: readonly { readonly id: PageId; readonly key: MessageKey }[] = [
  { id: 'chat', key: 'nav.chat' },
  { id: 'requirements', key: 'nav.requirements' },
  { id: 'tasks', key: 'nav.tasks' },
  { id: 'projects', key: 'nav.projects' },
  { id: 'project-info', key: 'nav.projectInfo' },
  { id: 'roles', key: 'nav.roles' },
  { id: 'settings', key: 'nav.settings' },
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

/** 宿主状态的稳定优先级：晚到的初始读取不得把 ready/fatal 降回 starting。 */
const HOST_RANK: Readonly<Record<HostState['kind'], number>> = {
  starting: 0,
  ready: 1,
  fatal: 2,
  stopped: 3,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function sortSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((left, right) => right.updatedAt - left.updatedAt)
}

function pendingTextOf(event: HostWaterfall, t: Translate): string {
  const request = event.request
  if (isRecord(request) && Array.isArray(request.questions)) {
    const questions = request.questions.flatMap((question) => {
      if (!isRecord(question)) return []
      if (typeof question.question === 'string') return [question.question]
      if (typeof question.header === 'string') return [question.header]
      return []
    })
    if (questions.length > 0) return questions.join(t('pending.join'))
  }
  if (isRecord(request)) {
    const reason = request.displayReason ?? request.reason
    if (typeof reason === 'string' && reason !== '') return reason
    const tool = request.toolName
    if (typeof tool === 'string') return t('pending.toolApproval', { tool })
  }
  return event.name === 'approval/request' ? t('pending.waitingApproval') : t('pending.waitingQuestion')
}

/** 应用根。 */
export function App(): JSX.Element {
  const prefs = usePreferences()
  const t = useCallback<Translate>((key, params) => translate(prefs.locale, key, params), [prefs.locale])
  const [host, setHost] = useState<HostState>({ kind: 'starting' })
  const cloud = useCloudSession(host.kind === 'ready')
  const windowState = useWindowState()
  const [showWelcome, setShowWelcome] = useState(() => !welcomeSeen(browserStorage()))
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [chat, dispatch] = useReducer(chatReducer, emptyChat)
  const [notice, setNotice] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [page, setPage] = useState<PageId>('chat')
  const [returnPage, setReturnPage] = useState<PageId>('chat')
  const [project, setProject] = useState<ProjectScope | null>(savedProject)
  const [projectNotice, setProjectNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<readonly PendingNote[]>([])

  const workspaces = useWorkspaceList(host.kind === 'ready')
  const projection = useProjection(project?.scopeSessionId ?? null)

  const streamRef = useRef<string | null>(null)
  const activeRef = useRef<string | null>(null)
  const rebaselineRef = useRef(0)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const hostEventSeen = useRef(false)

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
    if (host.kind === 'ready') void loadSessions()
  }, [host.kind, loadSessions])

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
      setPending(current => [...current.slice(-3), { id: event.eventId, kind: event.name, text: pendingTextOf(event, t) }])
    })
    return off
  }, [t])

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

  const chooseWorkspace = useCallback(async (workspace: WorkspaceRow) => {
    setProjectNotice(null)
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
    if (project === null) return { ok: false, message: t('flow.projectMissing') }
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
    return { ok: true, message: t('flow.startSent', { id: sessionId.slice(0, 8) }) }
  }, [loadSessions, project, selectSession, t])

  const dismissWelcome = useCallback(() => {
    markWelcomeSeen(browserStorage())
    setShowWelcome(false)
  }, [])

  const openAccount = useCallback(() => {
    setReturnPage(page)
    setPage('account')
  }, [page])

  const gateKind: 'booting' | 'cloud-error' | 'signed-out' | 'ready' =
    host.kind !== 'ready'
      ? 'booting'
      : cloud.state !== null && cloud.state.signedIn
        ? 'ready'
        : cloud.error !== null && cloud.state === null
          ? 'cloud-error'
          : cloud.state === null ? 'booting' : 'signed-out'

  const nav = useMemo(() => NAV_ITEMS.map(item => ({ ...item, label: t(item.key) })), [t])

  return (
    <div className="app" {...(gateKind === 'booting' ? {} : { 'data-lcoder-state': gateKind })}>
      <div className="ambient-layer" data-testid="ambient-layer" aria-hidden="true">
        <span className="ambient-blob blob-a" />
        <span className="ambient-blob blob-b" />
        <span className="ambient-blob blob-c" />
        <span className="ambient-blob blob-d" />
        <span className="ambient-blob blob-e" />
        <span className="ambient-grain" data-testid="ambient-grain" />
      </div>

      <Titlebar
        t={t}
        host={host}
        project={project}
        windowState={windowState}
        cloud={cloud.state}
        onPersonalCenter={openAccount}
        onCloudChanged={cloud.refresh}
      />

      {gateKind !== 'ready' && (
        <GateView
          kind={gateKind}
          t={t}
          host={host}
          failure={cloud.error}
          showWelcome={showWelcome}
          onRetry={() => { void cloud.refresh() }}
          onSignIn={dismissWelcome}
          onSkipWelcome={dismissWelcome}
          onAuthenticated={async () => {
            dismissWelcome()
            await cloud.refresh()
          }}
        />
      )}

      {gateKind === 'ready' && (
        <main className="shell" data-testid="workspace">
          <nav className="nav lg-glass" data-testid="nav">
            <div className="nav-brand">{t('app.name')}</div>
            {nav.map(item => (
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
              {project === null ? t('titlebar.noProject') : project.title}
            </div>
          </nav>

          <div className="shell-body">
            {page === 'chat' && (
              <ChatView
                t={t}
                sessions={sessions}
                active={active}
                chat={chat}
                pending={pending}
                notice={notice}
                sending={sending}
                composerRef={composerRef}
                onSelect={selectSession}
                onCreate={() => { void createSession() }}
                onSend={() => { void send() }}
                onDismissPending={(id) => { setPending(current => current.filter(entry => entry.id !== id)) }}
              />
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

            {page === 'settings' && (
              <SettingsPage
                t={t}
                prefs={prefs}
                sessionId={active}
                onModelsChanged={() => { void loadSessions() }}
              />
            )}

            {page === 'account' && (
              <PersonalCenter
                state={cloud.state}
                t={t}
                onBack={() => { setPage(returnPage) }}
              />
            )}

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
