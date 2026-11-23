/** 新客户端根：登录门禁、会话聊天与工作台五页。 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  FileText, FolderGit2, Frame, Info, LayoutTemplate, MessageSquare, Settings, SquareKanban, Users,
  type LucideIcon,
} from 'lucide-react'
import type { CloseRequest, EventOutcome, HostEvent, HostState, HostWaterfall, HostWaterfallCancel, PrototypeStudioDockState } from '@maniu/desktop/contract'
import { actionOfFrame, chatReducer, emptyChat, summaryOf, type ChatAction, type SessionSummary } from './store.ts'
import { translate, type MessageKey, type Translate } from './locale.ts'
import { browserStorage, markWelcomeSeen, usePreferences, welcomeSeen } from './prefs.ts'
import { useCloudSession } from './account/use-cloud.ts'
import { PersonalCenter } from './account/personal-center.tsx'
import type { IntakeResult } from './pages/intake-wizard.tsx'
import { ProjectInfoPage } from './pages/project-info.tsx'
import { ProjectsPage } from './pages/projects.tsx'
import { RequirementsPage } from './pages/requirements.tsx'
import { SettingsPage } from './pages/settings.tsx'
import { TasksPage } from './pages/tasks.tsx'
import { TalentsPage } from './pages/talents.tsx'
import { PrototypeLibraryPage } from './pages/prototype-library.tsx'
import { PrototypePage } from './pages/prototype-page.tsx'
import { ChatView } from './shell/chat-view.tsx'
import { visibleSessionsOf } from './shell/session-groups.ts'
import { PendingLayer, type AnswerResult } from './shell/pending-notification.tsx'
import { GateChrome } from './shell/gate-chrome.tsx'
import { GateView } from './shell/gate-view.tsx'
import { QuitConfirm } from './shell/quit-confirm.tsx'
import { Titlebar } from './shell/titlebar.tsx'
import { WindowGutter } from './shell/window-gutter.tsx'
import { useWindowState } from './shell/use-window-state.ts'
import { ensureScopeSession, useWorkspaceList, type ProjectScope, type WorkspaceRow } from './workspace/use-workspaces.ts'
import { useProjection } from './workspace/use-projection.ts'
import {
  buildPromptContent, contextUsageOf, currentChatModel, imageLimitsOf, modelAvailabilityOf,
  modelCatalogOf, recordedModelOf, type ChatModelCatalog, type ChatPendingAttachment,
} from './chat/composer.ts'
import { interactionOf, type PendingInteraction } from './chat/pending.ts'
import { useSessionControl } from './chat/use-session-control.ts'
import { createFrameBatcher, type FrameBatcher } from './chat/stream-batch.ts'
import { useTalents } from './talents/use-talents.ts'
import { studioDockApi } from './prototype-studio/dock-api.ts'
import { StudioDock } from './prototype-studio/studio-dock.tsx'
import { INTAKE_PRESET_ID, isIntakePreset } from './talents/model.ts'
import { hasIntakeWork } from './intake/eligibility.ts'
import { INTAKE_CONFIRM_PROMPT } from './intake/prompts.ts'
import { titleIntakeSession } from './intake/session-title.ts'

/** 工作台页面。 */
type PageId = 'chat' | 'requirements' | 'prototype' | 'tasks' | 'projects' | 'project-info' | 'talents' | 'prototype-library' | 'settings' | 'account'

/** 新会话默认使用的角色；工作台作用域会话靠它拿到人机命令面。 */
const WORKBENCH_PRESET = 'maniu-workbench'

interface NavItem {
  readonly id: PageId
  readonly key: MessageKey
  readonly icon: LucideIcon
}

/** 导航上组：对话与研发过程。 */
const NAV_TOP: readonly NavItem[] = [
  { id: 'chat', key: 'nav.chat', icon: MessageSquare },
  { id: 'requirements', key: 'nav.requirements', icon: FileText },
  { id: 'prototype', key: 'nav.prototype', icon: Frame },
  { id: 'tasks', key: 'nav.tasks', icon: SquareKanban },
]

/** 导航下组：项目与个人配置，贴底显示。 */
const NAV_BOTTOM: readonly NavItem[] = [
  { id: 'projects', key: 'nav.projects', icon: FolderGit2 },
  { id: 'project-info', key: 'nav.projectInfo', icon: Info },
  { id: 'talents', key: 'nav.talents', icon: Users },
  { id: 'prototype-library', key: 'nav.prototypeLibrary', icon: LayoutTemplate },
  { id: 'settings', key: 'nav.settings', icon: Settings },
]

const PROJECT_KEY = 'lcoder.m2.project'
const SESSION_KEY = 'lcoder.s1.session'

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
  /** 原型页从需求详情带来的上下文；进导航的「原型」时清空，回到项目级视图。 */
  const [prototypeContext, setPrototypeContext] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectScope | null>(savedProject)
  const [intakeResult, setIntakeResult] = useState<IntakeResult | null>(null)
  // 立项结果属于发起它的项目；切项目即清除，避免新仓向导显示别仓旧结果。
  const intakeWorkspaceRef = useRef<string | null>(null)
  if (intakeWorkspaceRef.current !== (project?.workspaceId ?? null)) {
    intakeWorkspaceRef.current = project?.workspaceId ?? null
    if (intakeResult !== null) setIntakeResult(null)
  }
  const [taskRequirement, setTaskRequirement] = useState<string | null>(null)
  const [projectNotice, setProjectNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<readonly PendingInteraction[]>([])
  // 作答弹窗的打开状态提升到 App：任务卡入口与中性兜底入口都经这里打开同一个弹窗。
  const [answerIds, setAnswerIds] = useState<readonly string[] | null>(null)
  const [closeRequest, setCloseRequest] = useState<CloseRequest | null>(null)
  /** 最小化到主窗的工作台；非 null 时右下角显示停靠胶囊。 */
  const [studioDock, setStudioDock] = useState<PrototypeStudioDockState | null>(null)
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>({})
  const [catalog, setCatalog] = useState<{ readonly value: unknown; readonly error: string | null }>({
    value: null,
    error: null,
  })

  const workspaces = useWorkspaceList(host.kind === 'ready')
  const projection = useProjection(project?.scopeSessionId ?? null, host.kind === 'ready')
  const control = useSessionControl(host.kind === 'ready')
  const talents = useTalents({
    signedIn: cloud.state?.signedIn === true,
    projectPath: project?.path ?? null,
    hostReady: host.kind === 'ready',
  })

  const streamRef = useRef<string | null>(null)
  const activeRef = useRef<string | null>(null)
  const rebaselineRef = useRef(0)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(false)
  const hostEventSeen = useRef(false)
  // 流式帧先排队、按 80ms 合并提交；逐帧 dispatch 会让整段消息与背景层反复重绘。
  const batcherRef = useRef<FrameBatcher<ChatAction> | null>(null)
  batcherRef.current ??= createFrameBatcher<ChatAction>((actions) => {
    for (const action of actions) dispatch(action)
  })
  const batcher = batcherRef.current

  activeRef.current = active

  useEffect(() => () => { batcher.dispose() }, [batcher])

  const applyHost = useCallback((next: HostState) => {
    setHost(current => HOST_RANK[next.kind] >= HOST_RANK[current.kind] ? next : current)
  }, [])

  const closeStream = useCallback(() => {
    const stream = streamRef.current
    streamRef.current = null
    if (stream !== null) void window.lcoder.cancelStream(stream)
  }, [])

  /**
   * 打开跟随流。切会话才清空主链；重连保留已画出的历史与草稿，
   * 由随后的快照原子替换，避免「空历史/满历史」逐帧交替。
   */
  const openFollow = useCallback(async (sessionId: string, mode: 'switch' | 'reconnect') => {
    batcher.dispose()
    closeStream()
    if (mode === 'switch') dispatch({ type: 'reset' })
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
  }, [batcher, closeStream])

  const selectSession = useCallback((sessionId: string) => {
    setActive(sessionId)
    activeRef.current = sessionId
    localStorage.setItem(SESSION_KEY, sessionId)
    void openFollow(sessionId, 'switch')
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

  const loadCatalog = useCallback(async () => {
    try {
      const answer = await window.lcoder.call('session', 'modelCatalog', {})
      setCatalog(answer.ok
        ? { value: answer.value, error: null }
        : { value: null, error: `${answer.error.code}: ${answer.error.message}` })
    } catch (error: unknown) {
      setCatalog({ value: null, error: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  useEffect(() => {
    // 工作台最小化后由主进程推状态；主窗重载时主进程会补发一次当前值。
    const off = studioDockApi()?.onPrototypeStudioDockState?.((state) => {
      setStudioDock(state.open && state.minimized ? state : null)
    })
    return () => { off?.() }
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
    if (host.kind === 'ready') {
      void loadSessions()
      void loadCatalog()
    }
  }, [host.kind, loadCatalog, loadSessions])

  useEffect(() => {
    const off = window.lcoder.onEvent((event: HostEvent) => {
      const first = event.args[0]
      if (event.name === 'llm/models-updated' || event.name === 'llm/adapters-updated'
        || event.name === 'credentials/reference-updated' || event.name === 'settings/document-updated') {
        void loadCatalog()
      }
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
  }, [loadCatalog])

  useEffect(() => {
    const off = window.lcoder.onWaterfall((event: HostWaterfall) => {
      const interaction = interactionOf(event.name, event.clientId, event.eventId, event.request, event.agentId)
      if (interaction === undefined) return
      // 审批/提问卡出现时先把排队中的流式帧落下去，卡片与工具卡不会差一帧先后。
      batcher.flush()
      setPending((current) => {
        // 重连后同一请求会带新代际重投；回执必须用新一代的 clientId。
        if (current.some(item => item.id === interaction.id)) {
          return current.map(item => item.id === interaction.id ? interaction : item)
        }
        return [...current.slice(-3), interaction]
      })
    })
    return off
  }, [batcher])

  useEffect(() => {
    const off = window.lcoder.onWaterfallCancel((event: HostWaterfallCancel) => {
      setPending(current => current.filter(item => item.eventId !== event.eventId))
    })
    return off
  }, [])

  useEffect(() => window.lcoder.onCloseRequest(setCloseRequest), [])

  useEffect(() => {
    const off = window.lcoder.onStreamFrame((streamId, frame) => {
      if (streamId !== streamRef.current) return
      if (frame.kind === 'item') {
        const action = actionOfFrame(frame.value)
        if (action !== undefined) batcher.push(action)
        return
      }
      if (frame.kind === 'error') {
        // 先落已到的帧，再把错误与重开排上；排队中的旧帧不能越过错误被提交。
        batcher.flush()
        dispatch({ type: 'stream-error', message: `${frame.error.code}: ${frame.error.message}` })
        const session = activeRef.current
        if (session !== null) void openFollow(session, 'reconnect')
      }
    })
    return off
  }, [batcher, openFollow])

  useEffect(() => {
    if (chat.rebaseline === rebaselineRef.current) return
    rebaselineRef.current = chat.rebaseline
    const session = activeRef.current
    if (session !== null) void openFollow(session, 'reconnect')
  }, [chat.rebaseline, openFollow])

  useEffect(() => {
    const title = chat.title
    if (active === null || title === null) return
    setTitles(current => current[active] === title ? current : { ...current, [active]: title })
  }, [active, chat.title])

  const createAndSelect = useCallback(async (): Promise<string | null> => {
    setNotice(null)
    const answer = await window.lcoder.call('session', 'create', {
      request: project === null ? {} : { workspaceId: project.workspaceId },
    })
    if (!answer.ok) {
      setNotice(`${answer.error.code}: ${answer.error.message}`)
      return null
    }
    const value = answer.value
    if (!isRecord(value) || typeof value.sessionId !== 'string') {
      setNotice('session.create 返回了无法识别的会话')
      return null
    }
    const sessionId = value.sessionId
    setSessions(current => sortSessions([
      ...current.filter(item => item.sessionId !== sessionId),
      {
        sessionId,
        updatedAt: Date.now(),
        running: false,
        blank: true,
        ...(project === null ? {} : { cwd: project.path }),
        ...(typeof value.agentPreset === 'string' ? { agentPreset: value.agentPreset } : {}),
      },
    ]))
    selectSession(sessionId)
    await loadSessions()
    return sessionId
  }, [loadSessions, project, selectSession])

  const createSession = useCallback((): void => {
    if (sendingRef.current) return
    void createAndSelect()
  }, [createAndSelect])

  const ensureSession = useCallback(async (): Promise<string | null> => {
    const current = activeRef.current
    return current !== null ? current : createAndSelect()
  }, [createAndSelect])

  const send = useCallback(async (
    text: string,
    attachments: readonly ChatPendingAttachment[],
  ): Promise<boolean> => {
    if (sendingRef.current) return false
    sendingRef.current = true
    setSending(true)
    setNotice(null)
    try {
      const sessionId = activeRef.current ?? await createAndSelect()
      if (sessionId === null) return false
      let content: ReturnType<typeof buildPromptContent>
      try {
        content = buildPromptContent(text, attachments)
      } catch (error: unknown) {
        setNotice(error instanceof Error ? error.message : String(error))
        return false
      }
      const answer = await window.lcoder.call('session', 'prompt', {
        request: {
          requestId: newRequestId(),
          sessionId,
          mode: 'queue',
          content,
        },
      })
      if (!answer.ok) {
        setNotice(`${answer.error.code}: ${answer.error.message}`)
        return false
      }
      return true
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [createAndSelect])

  const stop = useCallback(async (): Promise<void> => {
    const sessionId = activeRef.current
    if (sessionId === null) return
    const answer = await window.lcoder.call('session', 'cancel', { request: { sessionId } })
    if (!answer.ok) setNotice(`${answer.error.code}: ${answer.error.message}`)
  }, [])

  const rename = useCallback(async (title: string): Promise<boolean> => {
    const sessionId = activeRef.current
    if (sessionId === null) return false
    const answer = await window.lcoder.call('session', 'rename', { request: { sessionId, title } })
    if (!answer.ok) {
      setNotice(`${answer.error.code}: ${answer.error.message}`)
      return false
    }
    setTitles(current => ({ ...current, [sessionId]: title }))
    return true
  }, [])

  const answer = useCallback(async (
    interaction: PendingInteraction,
    outcome: EventOutcome,
  ): Promise<AnswerResult> => {
    try {
      await window.lcoder.eventResult(interaction.clientId, interaction.eventId, outcome)
      setPending(current => current.filter(item => item.id !== interaction.id))
      return { ok: true }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }, [])

  /** 任务卡或中性兜底入口请求作答：接收要展示的交互 id 集合，弹窗留在 App 层打开。 */
  const openAnswers = useCallback((ids: readonly string[]): void => {
    if (ids.length > 0) setAnswerIds(ids)
  }, [])

  const selectModel = useCallback(async (provider: string, model: string): Promise<boolean> => {
    const sessionId = activeRef.current ?? await createAndSelect()
    if (sessionId === null) return false
    const answer = await window.lcoder.call('session', 'selectModel', { request: { sessionId, provider, model } })
    if (!answer.ok) {
      setNotice(`${answer.error.code}: ${answer.error.message}`)
      return false
    }
    return true
  }, [createAndSelect])

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

  const launchSession = useCallback(async (prompt: string, agentPreset = WORKBENCH_PRESET, route = true): Promise<{
    readonly ok: boolean
    readonly message: string
    readonly sessionId?: string
  }> => {
    if (project === null) return { ok: false, message: t('flow.projectMissing') }
    const created = await window.lcoder.call('session', 'create', {
      request: { workspaceId: project.workspaceId, agentPreset },
    })
    if (!created.ok) return { ok: false, message: `${created.error.code}: ${created.error.message}` }
    const value = created.value
    if (!isRecord(value) || typeof value.sessionId !== 'string') {
      return { ok: false, message: 'session.create 返回了无法识别的会话' }
    }
    const sessionId = value.sessionId
    // 先登记进列表：首帧可能早于 session/list 回来，没有 preset 就会把立项指令摊开。
    setSessions(current => sortSessions([
      ...current.filter(item => item.sessionId !== sessionId),
      {
        sessionId,
        updatedAt: Date.now(),
        running: false,
        blank: true,
        cwd: project.path,
        agentPreset,
      },
    ]))
    if (isIntakePreset(agentPreset)) {
      // 宿主按首条消息起的标题对访谈没有意义；改成本地化的固定标题。
      const title = t('intake.sessionTitle')
      const failure = await titleIntakeSession(
        (namespace, method, args) => window.lcoder.call(namespace, method, args),
        sessionId,
        title,
      )
      if (failure === null) setTitles(current => ({ ...current, [sessionId]: title }))
      else setNotice(t('intake.titleFailed', { detail: failure }))
    }
    const sent = await window.lcoder.call('session', 'prompt', {
      request: {
        requestId: newRequestId(),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: prompt }],
      },
    })
    if (!sent.ok) return { ok: false, message: `${sent.error.code}: ${sent.error.message}` }
    const message = t('flow.startSent', { id: sessionId.slice(0, 8) })
    // route=false 时后台发起：会话只登记进列表，不抢占当前页面。
    if (route) {
      selectSession(sessionId)
      setPage('chat')
    }
    await loadSessions()
    return { ok: true, message, sessionId }
  }, [loadSessions, project, selectSession, t])

  const startSession = useCallback(async (prompt: string, agentPreset?: string) => {
    return launchSession(prompt, agentPreset, false)
  }, [launchSession])

  const openSession = useCallback((sessionId: string): void => {
    selectSession(sessionId)
    setPage('chat')
  }, [selectSession])

  // 立项浮卡的确认入口：向既有立项会话发「确认需求」，不新建会话、不跳转对话。
  const confirmIntake = useCallback(async (sessionId: string): Promise<{ readonly ok: boolean; readonly message: string }> => {
    const answer = await window.lcoder.call('session', 'prompt', {
      request: {
        requestId: newRequestId(),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: INTAKE_CONFIRM_PROMPT }],
      },
    })
    if (!answer.ok) return { ok: false, message: `${answer.error.code}: ${answer.error.message}` }
    return { ok: true, message: t('flow.startSent', { id: sessionId.slice(0, 8) }) }
  }, [t])

  const startIntake = useCallback(async (prompt: string) => {
    // 即便向导已经打开，非空项目也不再允许开新立项。
    if (hasIntakeWork(projection.projection)) return { ok: false, message: t('intake.blocked') }
    setIntakeResult(null)
    // 立项后台发起：留在需求页，进度由操作浮卡接管，提问卡走非对话页浮层。
    const answer = await launchSession(prompt, INTAKE_PRESET_ID, false)
    if (answer.ok && answer.sessionId !== undefined) {
      setIntakeResult({ message: answer.message, sessionId: answer.sessionId })
    }
    return { ok: answer.ok, message: answer.message, ...(answer.sessionId === undefined ? {} : { sessionId: answer.sessionId }) }
  }, [launchSession, projection.projection, t])

  const dismissWelcome = useCallback(() => {
    markWelcomeSeen(browserStorage())
    setShowWelcome(false)
  }, [])

  const openAccount = useCallback(() => {
    setReturnPage(page)
    setPage('account')
  }, [page])

  const catalogView: ChatModelCatalog = useMemo(() => modelCatalogOf(catalog.value), [catalog.value])
  // 流程岗位显示名：内置 preset 名册在前，云端人才名覆盖同名 id。
  const flowRoleNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const row of talents.builtins) {
      if (row.name !== undefined) names[row.id] = row.name
    }
    return { ...names, ...talents.presetNames }
  }, [talents.builtins, talents.presetNames])
  const availability = useMemo(
    () => catalog.error !== null
      ? { kind: 'unknown' as const, detail: catalog.error }
      : modelAvailabilityOf(catalog.value),
    [catalog.error, catalog.value],
  )
  const mergedProjection = useMemo(() => {
    const values: Record<string, unknown> = { ...chat.projections }
    const live = active === null ? undefined : control.bySession[active]
    if (live !== undefined) {
      for (const [key, entry] of Object.entries(live)) {
        if (entry.seq > chat.projectionSeq || !(key in values)) values[key] = entry.value
      }
    }
    return values
  }, [active, chat.projectionSeq, chat.projections, control.bySession])
  const selection = currentChatModel(recordedModelOf(mergedProjection.modelSelection), catalogView.defaultChoice)
  const limits = imageLimitsOf(mergedProjection.imageLimits)
  const usage = contextUsageOf(mergedProjection.contextPressure)
  const running = active !== null && sessions.find(item => item.sessionId === active)?.running === true
  // 回合在跑或正文还在流时冻结背景漂移；两者都不是时恢复。
  const busy = running || chat.attempt !== null
  // 对话页只显示当前项目的会话；需求页等后台观察仍读完整 sessions。
  const visibleSessions = useMemo(
    () => visibleSessionsOf(sessions, project, workspaces.items, active),
    [active, project, sessions, workspaces.items],
  )
  // 原型页的工作室需要一个需求上下文；投影按编号升序，这里翻成新到旧。
  const requirementIds = useMemo(
    () => projection.projection.requirements.map(row => row.id).reverse(),
    [projection.projection.requirements],
  )

  const gateKind: 'booting' | 'cloud-error' | 'signed-out' | 'ready' =
    host.kind !== 'ready'
      ? 'booting'
      : cloud.state !== null && cloud.state.signedIn
        ? 'ready'
        : cloud.error !== null && cloud.state === null
          ? 'cloud-error'
          : cloud.state === null ? 'booting' : 'signed-out'

  const nav = useMemo(() => ({
    top: NAV_TOP.map(item => ({ ...item, label: t(item.key) })),
    bottom: NAV_BOTTOM.map(item => ({ ...item, label: t(item.key) })),
  }), [t])

  const navButton = (item: { readonly id: PageId; readonly label: string; readonly icon: LucideIcon }): JSX.Element => {
    const Icon = item.icon
    const selected = page === item.id
    return (
      <button
        key={item.id}
        type="button"
        data-testid={`nav-${item.id}`}
        className={selected ? 'nav-item active' : 'nav-item'}
        aria-current={selected ? 'page' : undefined}
        onClick={() => {
          if (item.id === 'prototype') setPrototypeContext(null)
          setPage(item.id)
        }}
      >
        <Icon className="nav-icon" aria-hidden="true" />
        <span className="nav-label">{item.label}</span>
      </button>
    )
  }

  return (
    <div
      className="app"
      {...(gateKind === 'booting' ? {} : { 'data-lcoder-state': gateKind })}
      data-running={busy ? 'true' : 'false'}
    >
      <WindowGutter maximized={windowState.maximized} titlebar={gateKind === 'ready'} />

      {gateKind !== 'ready' && (
        <GateChrome t={t} windowState={windowState} />
      )}

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
          <nav className="nav" data-testid="nav">
            <div className="nav-header">
              <span className="nav-avatar" aria-hidden="true" />
              <span className="nav-head-text">
                <span className="nav-brand">{project === null ? t('app.name') : project.title}</span>
                <span className="nav-sub">{t('app.name')}</span>
              </span>
            </div>
            <div className="nav-list window-no-drag">
              {nav.top.map(navButton)}
              <div className="nav-bottom">
                {nav.bottom.map(navButton)}
              </div>
            </div>
          </nav>

          <div className="shell-main">
            <Titlebar
              t={t}
              host={host}
              project={project}
              windowState={windowState}
              cloud={cloud.state}
              onPersonalCenter={openAccount}
              onCloudChanged={cloud.refresh}
            />

            <div className="shell-body">
              {page === 'chat' && (
                <ChatView
                  t={t}
                  sessions={visibleSessions}
                  titles={titles}
                  active={active}
                  chat={chat}
                  notice={notice}
                  sending={sending}
                  running={running}
                  limits={limits}
                  models={catalogView.options}
                  selection={selection}
                  availability={availability}
                  usage={usage}
                  composerRef={composerRef}
                  talentNames={talents.presetNames}
                  pending={pending}
                  onAnswer={answer}
                  onSelect={selectSession}
                  onCreate={createSession}
                  onSend={send}
                  onStop={() => { void stop() }}
                  onRename={rename}
                  ensureSession={ensureSession}
                  onSelectModel={selectModel}
                />
              )}

              {/* 需求页跨页保持挂载：后台操作的浮卡与轮询状态住在页内，卸载即丢；隐藏而非条件渲染。 */}
              {/* display:contents 让 .page 仍是壳层的有效 flex 子项（flex:1 撑满），隐藏时才 none。 */}
              <div style={page === 'requirements' ? { display: 'contents' } : { display: 'none' }} data-testid="requirements-host">
                <RequirementsPage
                  project={project}
                  projection={projection.projection}
                  sessions={sessions}
                  loading={projection.loading}
                  error={projection.error}
                  intakeResult={intakeResult}
                  onClearIntakeResult={() => { setIntakeResult(null) }}
                  onReload={projection.reload}
                  onStartIntake={startIntake}
                  onStartSession={startSession}
                  onConfirmIntake={confirmIntake}
                  presetNames={flowRoleNames}
                  awaitingAnswer={pending.length > 0}
                  pending={pending}
                  onAnswerPending={openAnswers}
                  onOpenSession={openSession}
                  onOpenTasks={(requirementId) => {
                    setTaskRequirement(requirementId)
                    setPage('tasks')
                  }}
                  onOpenPrototypeLibrary={() => { setPage('prototype-library') }}
                  onOpenPrototype={(requirementId) => {
                    setPrototypeContext(requirementId)
                    setPage('prototype')
                  }}
                  t={t}
                />
              </div>

              {page === 'prototype' && (
                <PrototypePage
                  t={t}
                  scopeSessionId={project?.scopeSessionId ?? null}
                  requirementIds={requirementIds}
                  initialRequirementId={prototypeContext ?? undefined}
                  onOpenRequirements={() => { setPage('requirements') }}
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
                  requirementFilter={taskRequirement}
                  onClearRequirementFilter={() => { setTaskRequirement(null) }}
                  t={t}
                />
              )}

              {page === 'projects' && (
                <ProjectsPage
                  items={workspaces.items}
                  current={project}
                  error={projectNotice ?? workspaces.error}
                  t={t}
                  onSelect={(workspace) => { void chooseWorkspace(workspace) }}
                  onOpened={(workspace) => { void chooseWorkspace(workspace) }}
                />
              )}

              {page === 'project-info' && (
                <ProjectInfoPage
                  t={t}
                  project={project}
                  projection={projection.projection}
                  loading={projection.loading}
                  error={projection.error}
                  onReload={projection.reload}
                  presetNames={flowRoleNames}
                />
              )}

              {page === 'settings' && (
                <SettingsPage
                  t={t}
                  prefs={prefs}
                />
              )}

              {page === 'account' && (
                <PersonalCenter
                  state={cloud.state}
                  t={t}
                  onBack={() => { setPage(returnPage) }}
                />
              )}

              {page === 'talents' && (
                <TalentsPage
                  t={t}
                  signedIn={cloud.state?.signedIn === true}
                  userId={cloud.state?.user?.id ?? null}
                  project={project}
                  sessions={sessions}
                  talents={talents}
                />
              )}

              {page === 'prototype-library' && (
                <PrototypeLibraryPage t={t} />
              )}
            </div>

            <PendingLayer
              visible={page !== 'chat'}
              t={t}
              items={pending}
              answerIds={answerIds}
              sessions={sessions}
              titles={titles}
              onAnswer={answer}
              onClose={() => { setAnswerIds(null) }}
            />

            {studioDock !== null && (
              <StudioDock
                t={t}
                requirementId={studioDock.requirementId}
                onRestore={() => { void studioDockApi()?.controlPrototypeStudioDock?.('restore') }}
                onClose={() => {
                  setStudioDock(null)
                  void studioDockApi()?.controlPrototypeStudioDock?.('close')
                }}
              />
            )}
          </div>
        </main>
      )}

      {closeRequest === null ? null : (
        <QuitConfirm
          t={t}
          running={closeRequest.running}
          onCancel={() => { setCloseRequest(null) }}
          onConfirm={() => { void window.lcoder.confirmClose() }}
        />
      )}
    </div>
  )
}
