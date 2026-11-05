/**
 * LCoder 专属外壳：主面板内的项目切换 + 任务看板 + 悬浮对话。
 *
 * 数据来自当前会话工作区的 `.spec`：任务/规则走 `loadWorkspaceProjection`，
 * 项目信息走 `.spec/project.yaml`，敏感值按 `passwordRef` 从 `.spec/local.yaml`
 * 解析后只留在浏览器内存里。没有工作区或会话时显示空态，不编造数据。
 *
 * 外壳占用 `main` 的 `lcoder-home` 键；DSH 原生侧栏在桌面 profile 里禁用，
 * 启动时折叠空轨道，主面板占满窗口。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { loadLocalSecrets, loadProjectInfo, loadWorkspaceProjection } from '../projection.ts'
import type { ContractRow, ProjectionFilesRemote, TaskRow } from '../projection.ts'
import { describeOpenFailure } from '../open-failure.ts'
import type { ModelStatus, ShellSessionNotice } from '../model-status.ts'
import type { LcoderWorkspaceKey } from '../locales.ts'
import { claimTaskSession, taskCardStatus } from '../task-session.ts'
import type { TaskCardStatus, TaskSessionRow } from '../task-session.ts'
import { buildIntakePrompt, buildOnboardingPrompt, buildShellPrompt, SHELL_STATES } from './shell-data.ts'
import { ChatTranscript, PendingInteractionCard } from './ChatPanel.tsx'
import { ModelSettings } from './ModelSettings.tsx'
import type { ModelSettingsFace } from './model-settings.ts'
import type { ShellMessage, ShellProjectInfo, ShellRole, ShellSignResult, ShellTask, ShellTaskState } from './shell-data.ts'
import css from './Shell.module.css'

/** `main` 键控面板的组合 props：运行时标准 seat + 本包词典 + 文件投影面。 */
export type ShellProps =
  & PropsRuntime<'main', 'lcoder-home'>
  & PropsLocale<'lcoderWorkspace'>
  & {
    /** 文件投影面；没有时外壳保持空态。 */
    readonly files?: ProjectionFilesRemote
    /** 把仓库路径注册成工作区并建一个会话；返回可用于读取 `.spec` 的会话。 */
    readonly openRepository?: (path: string) => Promise<{ workspaceId: string; sessionId: SessionId }>
    /** 向真实会话发送一条文本提示。 */
    readonly sendPrompt?: (sessionId: SessionId, text: string) => Promise<void>
    /**
     * 读会话快照里卡片要的两个状态位。
     * 只有本客户端物化过的会话读得到，读不到返回 null——卡片因此不拿「不知道」画成「失败」。
     */
    readonly readSessionFlags?: (sessionId: SessionId) => { readonly awaitingFirstTurn: boolean; readonly failed: boolean } | null
    /** 派 `/contract_sign <编号>` 让人签署契约；签名由宿主写盘。 */
    readonly signContract?: (sessionId: SessionId, taskId: string) => Promise<ShellSignResult>
    /** 人确认契约已签后，把任务从起草推到已签约；只推这一条边。 */
    readonly advanceContract?: (sessionId: SessionId, taskId: string) => Promise<ShellSignResult>
    /** 派 `/task_bind <编号>` 把任务认给这条会话；认领关系由宿主写盘。 */
    readonly bindTask?: (sessionId: SessionId, taskId: string) => Promise<ShellSignResult>
    /** 在同一仓库里新开会话，可按角色（Agent preset）指名；角色只在首回合前可选。 */
    readonly createSession?: (path: string, agentPreset?: string) => Promise<SessionId>
    /** 装配层声明的角色名册；读不到时外壳只走宿主默认角色。 */
    readonly listRoles?: () => Promise<readonly ShellRole[]>
    /** 查宿主侧还有没有能跑的模型；没有对话就不会有回音。 */
    readonly checkModels?: () => Promise<ModelStatus>
    /** 模型目录或凭据一变就重查；返回解除订阅。 */
    readonly subscribeModels?: (listener: () => void) => () => void
    /** 设置页的模型服务数据面；缺省时设置弹窗不显示模型服务区。 */
    readonly modelSettings?: ModelSettingsFace
    /** 读会话快照里的失败：准入被拒，或这一轮没跑起来。 */
    readonly readSessionNotice?: (sessionId: SessionId) => ShellSessionNotice | null
    /** 读真实会话的消息窗口。 */
    readonly readMessages?: (sessionId: SessionId) => readonly ShellMessage[]
    /** 订阅会话事件窗口变化。 */
    readonly subscribeSession?: (sessionId: SessionId, listener: () => void) => () => void
    /** 浮层期间持有会话引用；没人 retain 的会话读不到消息。返回释放函数。 */
    readonly holdSession?: (sessionId: SessionId) => () => void
    /** 普通档对话窗尺寸（像素）；最大化档始终占满应用。配置缺省时用内置默认值。 */
    readonly chatSize?: { readonly width: number; readonly height: number }
  }

/** 配置没给尺寸时的普通档默认值；最大化档不读配置。 */
export const DEFAULT_CHAT_SIZE = { width: 760, height: 640 } as const

/** 状态到词典键的映射，避免把状态字符串当展示文案。 */
const STATE_LABEL = {
  drafting: 'shell.drafting',
  contracted: 'shell.contracted',
  implementing: 'shell.implementing',
  verifying: 'shell.verifying',
  closed: 'shell.closed',
} as const

/** 状态到色点的映射（CSS Modules 的类名在模块加载时确定）。 */
const STATE_DOT: Record<ShellTaskState, string | undefined> = {
  drafting: css.stateDrafting,
  contracted: css.stateContracted,
  implementing: css.stateImplementing,
  verifying: css.stateVerifying,
  closed: css.stateClosed,
}

/** 状态到工具面的展示文案；与 kernel 的 SURFACE 同义。 */
const SURFACE: Record<ShellTaskState, string> = {
  drafting: '读 / 契约',
  contracted: '读 / 契约 / 编辑',
  implementing: '全量',
  verifying: '全量 + 收口',
  closed: '只读',
}

/**
 * 卡片状态到词典键与配色的映射。
 *
 * 「在跑」沿用浮层那颗药丸的文案，不再另立一份说法。未开始与空闲都是中性色：
 * 前者还没建会话，后者建过且跑过——区别在颜色上说不出什么，就把颜色留给需要人动作的态。
 */
const TASK_STATUS: Record<TaskCardStatus, { readonly labelKey: LcoderWorkspaceKey; readonly className?: string | undefined }> = {
  unstarted: { labelKey: 'shell.taskUnstarted' },
  idle: { labelKey: 'shell.taskIdle' },
  running: { labelKey: 'shell.running', className: css.tagOk },
  awaitingInteraction: { labelKey: 'shell.taskAwaiting', className: css.tagWarn },
  awaitingFirstTurn: { labelKey: 'shell.taskFirstTurn', className: css.tagWarn },
  failed: { labelKey: 'shell.taskFailed', className: css.tagDanger },
}

const KNOWN_STATES: ReadonlySet<string> = new Set(SHELL_STATES.map(state => state.id))

function shellState(value: string): ShellTaskState {
  return KNOWN_STATES.has(value) ? value as ShellTaskState : 'drafting'
}

function toShellTask(row: TaskRow): ShellTask {
  const state = shellState(row.state)
  return {
    id: row.id,
    title: row.title,
    state,
    grade: row.grade,
    rules: row.rules,
    evidence: row.evidence,
    surface: SURFACE[state],
    ...(row.session === undefined ? {} : { session: row.session }),
  }
}

function resolveSecrets(info: ShellProjectInfo, secrets: Readonly<Record<string, string>>): ShellProjectInfo {
  return {
    ...info,
    environments: info.environments.map((env) => {
      const database = env.database
      if (database === undefined) return env
      const value = secrets[database.passwordRef]
      return value === undefined ? env : { ...env, database: { ...database, passwordValue: value } }
    }),
  }
}

/**
 * 外壳主组件。
 * @param props - 槽位组合进来的 props。
 * @returns 顶栏 + 任务板 + 项目信息抽屉 + 浮层。
 */
export function Shell({
  t, files, openRepository, sendPrompt, signContract, advanceContract, bindTask, createSession, listRoles,
  readMessages, subscribeSession, holdSession, checkModels, subscribeModels, readSessionNotice, readSessionFlags, modelSettings,
  useSessions, useSessionStatus, useWorkspaces, chatSize,
}: ShellProps): ReactNode {
  const workspaces = useWorkspaces(state => state.items)
  const sessionRows = useSessions(state => state.byId)
  /** 宿主推流的每会话状态；覆盖每个列出的会话，不需要 bind 也不需要开历史。 */
  const sessionStatus = useSessionStatus(state => state)

  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [dark, setDark] = useState(false)
  const [projectPicker, setProjectPicker] = useState(false)
  /** 新会话的角色选择浮层。 */
  const [rolePicker, setRolePicker] = useState(false)
  const [detail, setDetail] = useState<ShellTask | null>(null)
  const [prompt, setPrompt] = useState('')
  const [chat, setChat] = useState<ShellTask | null>(null)
  /** 普通档与最大化两档；关闭对话时回到普通档。 */
  const [chatMax, setChatMax] = useState(false)
  const [settings, setSettings] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)
  const [tasks, setTasks] = useState<readonly ShellTask[]>([])
  const [contracts, setContracts] = useState<readonly ContractRow[]>([])
  /** 签完一次就把投影重读一遍：`contracts` 里的签名状态是文件的事实，不是界面的记忆。 */
  const [reload, setReload] = useState(0)
  const [signing, setSigning] = useState(false)
  const [signResult, setSignResult] = useState<ShellSignResult | null>(null)
  /** 推进到已签约：与签署分开两步，各自可重试、失败也分得清。 */
  const [advancing, setAdvancing] = useState(false)
  const [advanceResult, setAdvanceResult] = useState<ShellSignResult | null>(null)
  const [rulesCount, setRulesCount] = useState(0)
  const [info, setInfo] = useState<ShellProjectInfo | null>(null)
  const [problems, setProblems] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionOverride, setSessionOverride] = useState<SessionId | null>(null)
  const [repoPath, setRepoPath] = useState('')
  const [opening, setOpening] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [messages, setMessages] = useState<readonly ShellMessage[]>([])
  const [notice, setNotice] = useState<ShellSessionNotice | null>(null)
  /** null 表示还没查过；`empty` 才是「没有能跑的模型」，`unknown` 是查询本身失败。 */
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null)
  /** 设置页存完 key 后立刻重查一次；订阅的那路是兜底。 */
  const modelRefresh = useRef<() => void>(() => {})
  const [chatError, setChatError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** 装配层声明的角色名册；读不到就是空表，新会话走宿主默认角色。 */
  const [roles, setRoles] = useState<readonly ShellRole[]>([])
  /** 下一次新开会话要用的角色；null 表示交给宿主默认。 */
  const [roleChoice, setRoleChoice] = useState<string | null>(null)
  /** 建会话与认领进行中：禁用入口，避免连点开出两条会话。 */
  const [claiming, setClaiming] = useState(false)
  /** 只有本客户端物化过的会话才读得到这两位；null 表示读不到，卡片就不画这两个态。 */
  const [taskFlags, setTaskFlags] = useState<{ readonly awaitingFirstTurn: boolean; readonly failed: boolean } | null>(null)

  const workspace = workspaces.find(item => String(item.workspaceId) === workspaceId) ?? workspaces[0]
  const activeWorkspaceId = workspace === undefined ? null : String(workspace.workspaceId)
  const sessionId = sessionOverride ?? workspace?.sessionIds[0]
  const session = sessionId === undefined ? undefined : sessionRows[sessionId]
  const projectPath = session?.cwd ?? workspace?.path ?? ''
  const projectName = workspace?.title ?? 'LCoder'
  const projectBranch = info?.branch ?? '—'
  const specRoot = projectPath === '' ? '' : `${projectPath}/.spec`
  const hasWorkspace = workspace !== undefined
  const hasSession = sessionId !== undefined
  /** 本工作区登记在册的会话，按上游顺序；顶栏的会话条就按这条列表排。 */
  const workspaceSessions = workspace?.sessionIds ?? []
  /** 同一批会话折成归属与状态需要的形状（带 running 与 blank）。 */
  const taskSessionRows = useMemo<readonly TaskSessionRow[]>(() => {
    if (workspace === undefined) return []
    return workspace.sessionIds.flatMap((id): readonly TaskSessionRow[] => {
      const row = sessionRows[id]
      return row === undefined ? [] : [{ sessionId: id, running: row.running, blank: row.blank }]
    })
  }, [workspace, sessionRows])
  /**
   * 这条任务当前由哪条还在的会话负责。绑定失效（换机器、删会话）按未绑定处理：
   * 认领关系只是入口，任务状态本身没变，重新点一次就把新的会话号写回去。
   */
  const liveSessionOf = (task: ShellTask): SessionId | undefined =>
    claimTaskSession(task.session, taskSessionRows)?.sessionId
  /**
   * 浮层落在哪条会话：该任务已认领的那条；立项对话或还没认领时退回工作区当前会话。
   * 这里只做选择——建会话与认领归顶栏会话条，本壳自己建就会留下第二套手势。
   */
  const chatSessionId = chat === null || chat.session === undefined
    ? sessionId
    : claimTaskSession(chat.session, taskSessionRows)?.sessionId ?? sessionId
  const chatRunning = chatSessionId === undefined
    ? false
    : sessionStatus.get(chatSessionId)?.running ?? sessionRows[chatSessionId]?.running ?? false
  /** 这条会话当前等人处理的那一条审批或提问；上游插件发布，外壳只负责画与转交答案。 */
  const chatPending = chatSessionId === undefined ? undefined : sessionStatus.get(chatSessionId)?.pendingInteraction
  const resolvedChatSize = chatSize ?? DEFAULT_CHAT_SIZE
  /** 普通档尺寸走配置；最大化档由 CSS 的 data-max 接管。 */
  const chatStyle = {
    '--lc-chat-w': `${String(resolvedChatSize.width)}px`,
    '--lc-chat-h': `${String(resolvedChatSize.height)}px`,
  } as CSSProperties
  /**
   * 没有能跑的模型时不发送。缺凭据的提示不是被拒：消息会先进队，回合才失败，
   * 事件流里连 `user/message` 都没有，用户只看得到「发了，什么都没发生」。
   */
  const modelBlocked = modelStatus !== null && modelStatus.state === 'empty'

  useEffect(() => {
    if (files === undefined || workspace === undefined || sessionId === undefined) {
      setTasks([])
      setContracts([])
      setRulesCount(0)
      setInfo(null)
      setProblems([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    Promise.all([
      loadWorkspaceProjection(files, sessionId, controller.signal),
      loadProjectInfo(files, sessionId, controller.signal),
      loadLocalSecrets(files, sessionId, controller.signal),
    ]).then(([projection, projectInfo, secrets]) => {
      if (controller.signal.aborted) return
      setTasks(projection.tasks.map(toShellTask))
      setContracts(projection.contracts)
      setRulesCount(projection.rules.length)
      setProblems([...projection.problems, ...projectInfo.problems])
      setInfo(projectInfo.info === null ? null : resolveSecrets(projectInfo.info, secrets))
      setLoading(false)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setTasks([])
      setContracts([])
      setRulesCount(0)
      setInfo(null)
      setProblems([String(error)])
      setLoading(false)
    })
    return () => { controller.abort() }
  }, [files, activeWorkspaceId, sessionId, reload])

  /**
   * 角色名册来自装配层的 Agent preset 声明，外壳活一次读一次就够：
   * preset 定义不会在一次会话里变，读不到就当没有，新会话走宿主默认角色。
   */
  useEffect(() => {
    if (listRoles === undefined || !hasWorkspace) return
    let alive = true
    void listRoles().then((rows) => {
      if (!alive) return
      setRoles(rows)
      setRoleChoice(current => (current !== null && rows.some(row => row.id === current)) ? current : null)
    })
    return () => { alive = false }
  }, [listRoles, hasWorkspace])

  /**
   * 进项目就查一次模型可用性，并在目录或凭据变化时重查。缺凭据时提示不是被拒——
   * 消息会先进队，回合才失败，所以必须提前把「没有能跑的模型」说出来。
   */
  useEffect(() => {
    if (checkModels === undefined) return
    let alive = true
    const refresh = (): void => {
      void checkModels().then((status) => { if (alive) setModelStatus(status) })
    }
    refresh()
    modelRefresh.current = refresh
    const unsubscribe = subscribeModels?.(refresh) ?? (() => {})
    return () => {
      alive = false
      unsubscribe()
    }
  }, [checkModels, subscribeModels])

  useEffect(() => {
    if (chat === null || chatSessionId === undefined || readMessages === undefined || subscribeSession === undefined) {
      setMessages([])
      setNotice(null)
      return
    }
    // 先持有再订阅：刚建的会话没有本地引用时，读消息与事件都拿不到东西。
    const release = holdSession?.(chatSessionId)
    const refresh = (): void => {
      setMessages(readMessages(chatSessionId))
      setNotice(readSessionNotice?.(chatSessionId) ?? null)
    }
    refresh()
    const unsubscribe = subscribeSession(chatSessionId, refresh)
    return () => {
      unsubscribe()
      release?.()
    }
  }, [chat, chatSessionId, readMessages, subscribeSession, readSessionNotice, holdSession])

  /**
   * 卡片上「等首个回合」与失败两位的来源。
   *
   * 它们只在会话快照里，而快照只有本客户端物化过的会话才有——所以这一路只跟着浮层所在的
   * 那条会话读，读不到就明说读不到，卡片退回只显示宿主推流得到的那几个态。
   */
  useEffect(() => {
    if (chatSessionId === undefined || readSessionFlags === undefined || subscribeSession === undefined) {
      setTaskFlags(null)
      return
    }
    const refresh = (): void => { setTaskFlags(readSessionFlags(chatSessionId)) }
    refresh()
    return subscribeSession(chatSessionId, refresh)
  }, [chatSessionId, readSessionFlags, subscribeSession])

  /** 一张卡片的状态：先按规格库的 session 字段认归属会话，再叠宿主推流与快照两位。 */
  const statusOfTask = (task: ShellTask): TaskCardStatus => {
    const session = claimTaskSession(task.session, taskSessionRows)
    const pushed = session === null ? undefined : sessionStatus.get(session.sessionId)
    const flags = session !== null && session.sessionId === chatSessionId ? taskFlags : null
    return taskCardStatus({
      session,
      hostRunning: pushed?.running,
      awaitingInteraction: pushed?.pendingInteraction !== undefined,
      awaitingFirstTurn: flags?.awaitingFirstTurn,
      failed: flags?.failed,
    })
  }

  const openTask = (task: ShellTask): void => {
    setDetail(task)
    setPrompt(buildShellPrompt({ name: projectName, path: projectPath, branch: projectBranch }, task))
    setCopied(false)
    setSignResult(null)
    // 上一个任务的「没会话」提示不属于这个任务。
    setChatError(null)
  }

  /** 选中任务的那份契约；没有就是还没起草。 */
  const detailContract = detail === null
    ? undefined
    : contracts.find(row => row.id === detail.id)

  /**
   * 签署选中任务的契约。浏览器不写盘：这一句派给人机命令，签名由 kernel 写进
   * `.spec/contracts/`，回来再重读投影——界面显示的是文件的事实，不是点击的记忆。
   */
  const signSelected = async (): Promise<void> => {
    if (detail === null || sessionId === undefined || signContract === undefined) return
    setSigning(true)
    setSignResult(null)
    try {
      setSignResult(await signContract(sessionId, detail.id))
      setReload(value => value + 1)
    } catch (error: unknown) {
      // 远程调用本身失败（连接断了、会话没绑定）；命令的失败回执不走这里。
      setSignResult({ ok: false, text: String(error) })
    } finally {
      setSigning(false)
    }
  }

  /** 把选中任务推到「已签约」。签名与状态分写，这一步失败不会动签名。 */
  const advanceSelected = async (): Promise<void> => {
    if (detail === null || sessionId === undefined || advanceContract === undefined) return
    setAdvancing(true)
    setAdvanceResult(null)
    try {
      setAdvanceResult(await advanceContract(sessionId, detail.id))
      setReload(value => value + 1)
    } catch (error: unknown) {
      // 远程调用本身失败；命令的失败回执照旧走 advanceResult。
      setAdvanceResult({ ok: false, text: String(error) })
    } finally {
      setAdvancing(false)
    }
  }

  const copyPrompt = (): void => {
    void navigator.clipboard.writeText(prompt).then(
      () => {
        setCopied(true)
        setTimeout(() => { setCopied(false) }, 1200)
      },
      () => { setCopied(false) },
    )
  }

  /**
   * 打开这条任务的对话。已经绑着一条还在的会话就切过去接着说；没绑就在同一个仓库里
   * 新开一条会话、按选定角色把它认给这条任务，再发启动咒语。
   *
   * 启动咒语在这里就地生成，不读 `prompt` 状态：那份状态要等渲染后的 effect 才跟上任务，
   * 直接发出去的是上一任务的文本。
   */
  const startConversation = (task: ShellTask): void => {
    const bound = liveSessionOf(task)
    if (bound !== undefined) {
      setSessionOverride(bound)
      setChat(task)
      setDetail(null)
      setChatError(null)
      return
    }
    const text = buildShellPrompt({ name: projectName, path: projectPath, branch: projectBranch }, task)
    setPrompt(text)
    setChat(task)
    setDetail(null)
    setChatError(null)
    if (modelBlocked) {
      setChatError(t('shell.noModels'))
      return
    }
    if (createSession === undefined || bindTask === undefined || sendPrompt === undefined || projectPath === '') {
      setChatError(t('shell.noSession'))
      return
    }
    setClaiming(true)
    void (async () => {
      const created = await createSession(projectPath, roleChoice ?? undefined)
      const claimed = await bindTask(created, task.id)
      if (!claimed.ok) throw new Error(claimed.text)
      setSessionOverride(created)
      // 认领写进了文件，投影要重读：卡片上「谁在跑这条任务」显示的是文件的事实。
      setReload(value => value + 1)
      await sendPrompt(created, text)
    })().catch((error: unknown) => {
      setChatError(String(error))
    }).finally(() => {
      setClaiming(false)
    })
  }

  /**
   * 开一条不绑任务的会话：只为了看一眼这个角色的工具面，或接着上一轮自由讨论。
   * 认领关系仍由任务卡那一步写，这里不碰 `.spec`。
   */
  const newPlainSession = (): void => {
    if (createSession === undefined || projectPath === '') return
    setClaiming(true)
    void (async () => {
      const created = await createSession(projectPath, roleChoice ?? undefined)
      setSessionOverride(created)
      setRolePicker(false)
      setChat(null)
      setReload(value => value + 1)
    })().catch((error: unknown) => {
      setChatError(String(error))
    }).finally(() => {
      setClaiming(false)
    })
  }

  /**
   * 零任务仓库的立项入口：读不到 `.spec/project.yaml` 时发 7 问引导咒语，先问项目
   * 身份与文档位置再落盘；已登记项目信息时发立项分析咒语，把交付文档交给模型。
   * 外壳只读文件、不判断状态机。
   */
  const startOnboarding = (): void => {
    const project = { name: projectName, path: projectPath, branch: projectBranch }
    const text = info === null ? buildIntakePrompt(project) : buildOnboardingPrompt(project, info.docs)
    setDetail(null)
    setChatError(null)
    setPrompt(text)
    setCopied(false)
    setChat({ id: '', title: t('shell.onboardingChat'), state: 'drafting', grade: '-', rules: [], evidence: [], surface: '' })
    if (modelBlocked) {
      setChatError(t('shell.noModels'))
      return
    }
    if (sessionId === undefined || sendPrompt === undefined) {
      setChatError(t('shell.noSession'))
      return
    }
    void sendPrompt(sessionId, text).catch((error: unknown) => { setChatError(String(error)) })
  }

  const sendDraft = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || modelBlocked || chatSessionId === undefined || sendPrompt === undefined) return
    setDraft('')
    setChatError(null)
    try {
      await sendPrompt(chatSessionId, text)
    } catch (error: unknown) {
      setChatError(String(error))
    }
  }

  const submitRepo = async (): Promise<void> => {
    if (openRepository === undefined) return
    const path = repoPath.trim()
    if (path === '') return
    setOpening(true)
    setRepoError(null)
    try {
      const opened = await openRepository(path)
      setWorkspaceId(opened.workspaceId)
      setSessionOverride(opened.sessionId)
      setProjectPicker(false)
    } catch (error: unknown) {
      const failure = describeOpenFailure(error)
      setRepoError(`${t(failure.key)}（${failure.detail}）`)
    } finally {
      setOpening(false)
    }
  }

  const renderColumn = (state: (typeof SHELL_STATES)[number], compact = false): ReactNode => {
    const columnTasks = tasks.filter(task => task.state === state.id)
    return (
      <div key={state.id} className={css.column}>
        <div className={css.columnHead}>
          <span className={css.columnName}>
            <span className={`${css.stateDot ?? ''} ${STATE_DOT[state.id] ?? ''}`} />
            {t(state.labelKey)}
          </span>
          <span className={css.count}>{columnTasks.length}</span>
        </div>
        {columnTasks.length === 0
          ? <div className={css.empty}>{t('shell.empty')}</div>
          : columnTasks.map((task) => {
            const status = statusOfTask(task)
            return (
              <button type="button" key={task.id} className={css.taskCard} onClick={() => { openTask(task) }}>
                <div className={css.taskId}><span>{task.id}</span><span>{task.grade}</span></div>
                <div className={css.taskTitle}>{task.title}</div>
                <div className={css.tags}>
                  <span className={`${css.tag} ${TASK_STATUS[status].className ?? ''}`}>{t(TASK_STATUS[status].labelKey)}</span>
                  {compact ? null : task.rules.map(rule => <span key={rule} className={css.tag}>{rule}</span>)}
                  {compact ? null : <span className={`${css.tag} ${task.state === 'closed' ? css.tagOk : ''}`}>{task.surface}</span>}
                  {compact || !contracts.some(row => row.id === task.id && row.signedBy === 'human')
                    ? null
                    : <span className={`${css.tag} ${css.tagOk}`}>{t('shell.contractSigned')}</span>}
                </div>
              </button>
            )
          })}
      </div>
    )
  }

  /**
   * 角色候选（装配层声明的 Agent preset）。名册读不到就不给这一行：新会话照宿主默认
   * 角色开，外壳不编造角色。
   */
  const roleChoices = roles.length === 0 ? null : (
    <div className={css.field}>
      <label>
        {t('shell.role')}
        {' '}
        <span className={css.labelHint}>{t('shell.roleHint')}</span>
      </label>
      <div className={css.roleRow}>
        {roles.map(row => (
          <button
            type="button"
            key={row.id}
            className={`${css.roleChip} ${roleChoice === row.id ? css.roleChipActive : ''}`}
            onClick={() => { setRoleChoice(row.id) }}
          >
            {row.name ?? row.id}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className={css.shell} data-theme={dark ? 'dark' : 'light'}>
      <header className={css.topbar}>
        <div className={css.topBrand}>
          <div className={css.topLogo}>L</div>
          <span className={css.topTitle}>LCoder</span>
        </div>
        <button type="button" className={css.topProject} title={t('shell.switchProject')} onClick={() => { setProjectPicker(true) }}>
          <span className={css.psLogo}>{(projectName || 'L').slice(0, 1).toUpperCase()}</span>
          <span className={css.psText}>
            <span className={css.psName}>{projectName}</span>
            <span className={css.psPath}>{projectPath || '—'}</span>
          </span>
          <span className={css.psChevron}>⌄</span>
        </button>
        {!hasWorkspace ? null : (
          <div className={css.sessionBar}>
            {workspaceSessions.map((id, index) => {
              const bound = tasks.find(task => task.session !== undefined && task.session === String(id))
              return (
                <button
                  type="button"
                  key={String(id)}
                  className={`${css.sessionChip} ${String(sessionId) === String(id) ? css.sessionChipActive : ''}`}
                  title={String(id)}
                  onClick={() => { setSessionOverride(id) }}
                >
                  {bound?.id ?? `${t('shell.sessions')} ${String(index + 1)}`}
                </button>
              )
            })}
            <button
              type="button"
              className={css.sessionAdd}
              title={t('shell.newSession')}
              disabled={createSession === undefined || claiming}
              onClick={() => { setRolePicker(true) }}
            >
              ＋
            </button>
          </div>
        )}
        <div className={css.spacer} />
        <button type="button" className={css.secondaryBtn} onClick={() => { setDrawer(true) }}>ⓘ {t('shell.projectInfo')}</button>
        <button type="button" className={css.iconBtn} title={t('shell.theme')} onClick={() => { setDark(value => !value) }}>◐</button>
        <button type="button" className={css.iconBtn} title={t('shell.settings')} onClick={() => { setSettings(true) }}>⚙</button>
      </header>

      <main className={css.main}>
        <div className={css.boardWrap}>
          <div className={css.boardHead}>
            <h3>{t('shell.board')}</h3>
            <span className={css.boardHint}>{t('shell.boardHint')}</span>
          </div>
          {!hasWorkspace
            ? <p className={css.empty}>{t('shell.noWorkspace')}</p>
            : loading
              ? <p className={css.empty}>{t('shell.loading')}</p>
              : !hasSession
                ? <p className={css.empty}>{t('shell.noSession')}</p>
                : (
                  <>
                    {modelStatus === null || modelStatus.state === 'ready' ? null : (
                      <div className={css.problems}>
                        <p className={css.problemsTitle}>
                          {t(modelStatus.state === 'empty' ? 'shell.noModels' : 'shell.unknownModels')}
                        </p>
                        {modelStatus.detail === '' ? null : <p className={css.problem}>{modelStatus.detail}</p>}
                        {modelStatus.state === 'empty' ? <p className={css.secretRef}>{t('shell.howToConfigure')}</p> : null}
                      </div>
                    )}
                    <div className={css.board}>
                      {SHELL_STATES.map(state => renderColumn(state))}
                    </div>
                    {tasks.length === 0 ? (
                      <div className={css.onboardingBar}>
                        <p className={css.onboardingText}>
                          {t('shell.onboardingEmpty')} {t(info === null ? 'shell.onboardingIntakeHint' : 'shell.onboardingHint')}
                        </p>
                        <button
                          type="button"
                          className={css.primaryBtn}
                          disabled={modelBlocked}
                          title={modelBlocked ? t('shell.noModels') : undefined}
                          onClick={startOnboarding}
                        >
                          {t('shell.onboardingCta')}
                        </button>
                      </div>
                    ) : null}
                    {problems.length > 0 ? (
                      <div className={css.problems}>
                        <p className={css.problemsTitle}>{t('shell.problems')}</p>
                        {problems.map(problem => <p key={problem} className={css.problem}>{problem}</p>)}
                      </div>
                    ) : null}
                  </>
                )}
        </div>
      </main>

      {drawer ? (
        <div className={css.drawerBackdrop} onClick={(event) => { if (event.target === event.currentTarget) setDrawer(false) }}>
          <aside className={css.drawer}>
            <div className={css.drawerHead}>
              <div className={css.grow}>
                <h3>{t('shell.projectInfo')}</h3>
                <p>{t('shell.projectInfoHint')}</p>
              </div>
              <button type="button" className={css.iconBtn} onClick={() => { setDrawer(false) }}>✕</button>
            </div>
            <div className={css.drawerBody}>
              <section className={css.drawerSection}>
                <h4>{t('shell.basic')}</h4>
                <div className={css.infoGrid}>
                  <div className={css.infoRow}><span>{t('shell.kind')}</span><b>{info?.kind ?? '—'}</b></div>
                  <div className={css.infoRow}>
                    <span>{t('shell.repoUrl')}</span>
                    {info?.repoUrl === undefined || info.repoUrl === ''
                      ? <b>—</b>
                      : <a href={info.repoUrl} target="_blank" rel="noreferrer">{info.repoUrl}</a>}
                  </div>
                  <div className={css.infoRow}><span>{t('shell.branch')}</span><b>{info?.branch ?? '—'}</b></div>
                  <div className={css.infoRow}><span>{t('shell.specRoot')}</span><code>{specRoot || '—'}</code></div>
                  <div className={css.infoRow}><span>{t('shell.tasks')}</span><b>{tasks.length}</b></div>
                  <div className={css.infoRow}><span>{t('shell.rules')}</span><b>{rulesCount}</b></div>
                </div>
              </section>

              <section className={css.drawerSection}>
                <h4>{t('shell.docs')}</h4>
                <div className={css.docRow}><span>{t('shell.productDoc')}</span><code>{info?.docs.product || '—'}</code></div>
                <div className={css.docRow}><span>{t('shell.architectureDoc')}</span><code>{info?.docs.architecture || '—'}</code></div>
                <div className={css.docRow}><span>{t('shell.tests')}</span><code>{info?.docs.tests || '—'}</code></div>
              </section>

              <section className={css.drawerSection}>
                <h4>{t('shell.environments')}</h4>
                {info === null
                  ? <p className={css.empty}>{t('shell.projectInfoMissing')}</p>
                  : info.kind !== 'web' || info.environments.length === 0
                    ? <p className={css.empty}>{t('shell.webOnly')}</p>
                    : info.environments.map((env) => {
                      const database = env.database
                      const passwordKey = `${env.id}.password`
                      const shown = revealed[passwordKey] === true
                      return (
                        <div key={env.id} className={css.envCard}>
                          <div className={css.envHead}>
                            <b>{env.label}</b>
                            <span className={css.pill}>{env.note ?? ''}</span>
                          </div>
                          <div className={css.infoRow}><span>{t('shell.server')}</span><code>{env.server ?? '—'}</code></div>
                          {database === undefined ? null : (
                            <>
                              <div className={css.infoRow}><span>{t('shell.dbHost')}</span><code>{database.host}:{database.port ?? '—'}</code></div>
                              <div className={css.infoRow}><span>{t('shell.dbName')}</span><code>{database.name}</code></div>
                              <div className={css.infoRow}><span>{t('shell.dbUser')}</span><code>{database.user}</code></div>
                              <div className={css.infoRow}>
                                <span>{t('shell.password')}</span>
                                <code>{shown ? (database.passwordValue ?? t('shell.unconfigured')) : '••••••'}</code>
                                <button
                                  type="button"
                                  className={css.eyeBtn}
                                  title={shown ? t('shell.hide') : t('shell.reveal')}
                                  onClick={() => { setRevealed(prev => ({ ...prev, [passwordKey]: !prev[passwordKey] })) }}
                                >
                                  {shown ? '🙈' : '👁'}
                                </button>
                              </div>
                              <div className={css.secretRef}>{database.passwordRef} · {t('shell.secretNote')}</div>
                            </>
                          )}
                        </div>
                      )
                    })}
              </section>
            </div>
          </aside>
        </div>
      ) : null}

      {projectPicker ? (
        <div className={css.modalBackdrop} onClick={(event) => { if (event.target === event.currentTarget) setProjectPicker(false) }}>
          <div className={`${css.modal} ${css.modalSmall}`}>
            <div className={css.modalHead}>
              <div className={css.grow}><h3>{t('shell.switchProject')}</h3><p>{t('shell.projectPickerHint')}</p></div>
              <button type="button" className={css.iconBtn} onClick={() => { setProjectPicker(false) }}>✕</button>
            </div>
            <div className={css.modalBody}>
              {workspaces.length === 0
                ? <p className={css.empty}>{t('shell.noWorkspace')}</p>
                : (
                  <div className={css.projectPicker}>
                    {workspaces.map((item) => {
                      const id = String(item.workspaceId)
                      return (
                        <button
                          type="button"
                          key={id}
                          className={`${css.projectOption} ${id === activeWorkspaceId ? css.projectOptionActive : ''}`}
                          onClick={() => { setWorkspaceId(id); setSessionOverride(null); setProjectPicker(false) }}
                        >
                          <span className={css.psLogo}>{(item.title || 'L').slice(0, 1).toUpperCase()}</span>
                          <span className={css.poText}>
                            <span className={css.poName}>{item.title}</span>
                            <span className={css.poPath}>{item.path}</span>
                          </span>
                          <span className={css.poCount}>{item.sessionIds.length} {t('shell.sessions')}</span>
                          {id === activeWorkspaceId ? <span className={css.poCheck}>✓</span> : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              <div className={css.repoOpen}>
                <input
                  className={css.repoInput}
                  value={repoPath}
                  placeholder={t('shell.repoPathHint')}
                  onChange={(event) => { setRepoPath(event.target.value) }}
                />
                <button
                  type="button"
                  className={css.primaryBtn}
                  disabled={opening || openRepository === undefined || repoPath.trim() === ''}
                  onClick={() => { void submitRepo() }}
                >
                  {opening ? t('shell.opening') : t('shell.openRepo')}
                </button>
              </div>
              {repoError === null ? null : <p className={css.problem}>{repoError}</p>}
            </div>
            <div className={css.modalFoot}>
              <span className={css.boardHint}>{t('shell.projectSource')}</span>
            </div>
          </div>
        </div>
      ) : null}

      {rolePicker ? (
        <div className={css.modalBackdrop} onClick={(event) => { if (event.target === event.currentTarget) setRolePicker(false) }}>
          <div className={`${css.modal} ${css.modalSmall}`}>
            <div className={css.modalHead}>
              <div className={css.grow}>
                <h3>{t('shell.newSession')}</h3>
                <p>{t('shell.newSessionHint')}</p>
              </div>
              <button type="button" className={css.iconBtn} onClick={() => { setRolePicker(false) }}>✕</button>
            </div>
            <div className={css.modalBody}>
              {roleChoices === null ? <p className={css.empty}>{t('shell.noRoles')}</p> : roleChoices}
            </div>
            <div className={css.modalFoot}>
              <button type="button" className={css.secondaryBtn} onClick={() => { setRolePicker(false) }}>{t('shell.cancel')}</button>
              <div className={css.spacer} />
              <button
                type="button"
                className={css.primaryBtn}
                disabled={createSession === undefined || claiming || projectPath === ''}
                onClick={() => { newPlainSession() }}
              >
                {claiming ? t('shell.claiming') : t('shell.newSessionGo')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detail !== null ? (
        <div className={css.modalBackdrop} onClick={(event) => { if (event.target === event.currentTarget) setDetail(null) }}>
          <div className={css.modal}>
            <div className={css.modalHead}>
              <div className={css.grow}>
                <h3>{detail.id} · {detail.title}</h3>
                <p>{projectName} / {projectPath} · {t('shell.specRoot')} {specRoot || '—'}</p>
              </div>
              <span className={css.pill}>{t(STATE_LABEL[detail.state])}</span>
              <button type="button" className={css.iconBtn} onClick={() => { setDetail(null) }}>✕</button>
            </div>
            <div className={css.modalBody}>
              <div className={css.metaGrid}>
                <div className={css.meta}><div className={css.metaK}>{t('shell.grade')}</div><div className={css.metaV}>{detail.grade}</div></div>
                <div className={css.meta}><div className={css.metaK}>{t('shell.rules')}</div><div className={css.metaV}>{detail.rules.join(', ') || '—'}</div></div>
                <div className={css.meta}><div className={css.metaK}>{t('shell.evidence')}</div><div className={css.metaV}>{detail.evidence.join(', ') || '—'}</div></div>
                <div className={css.meta}><div className={css.metaK}>{t('shell.surface')}</div><div className={css.metaV}>{detail.surface}</div></div>
              </div>
              <div className={css.field}>
                <label>{t('shell.contract')} <span className={css.labelHint}>{t('shell.contractHint')}</span></label>
                {detailContract === undefined ? (
                  <p className={css.empty}>{t('shell.contractMissing')}</p>
                ) : (
                  <>
                    <div className={css.metaGrid}>
                      <div className={css.meta}>
                        <div className={css.metaK}>{t('shell.contractChange')}</div>
                        <div className={css.metaV}>{detailContract.change.join('；')}</div>
                      </div>
                      <div className={css.meta}>
                        <div className={css.metaK}>{t('shell.contractNotChange')}</div>
                        <div className={css.metaV}>{detailContract.notChange.join('；') || '—'}</div>
                      </div>
                      <div className={css.meta}>
                        <div className={css.metaK}>{t('shell.contractAcceptance')}</div>
                        <div className={css.metaV}>{detailContract.acceptance.join('；')}</div>
                      </div>
                      <div className={css.meta}>
                        <div className={css.metaK}>{t('shell.contractFailIf')}</div>
                        <div className={css.metaV}>{detailContract.failIf.join('；') || '—'}</div>
                      </div>
                    </div>
                    <p className={css.secretRef}>
                      {detailContract.signedBy === 'human'
                        ? `${t('shell.signedAt')} ${detailContract.signedAt ?? '—'}`
                        : detailContract.signedBy === 'agent'
                          ? t('shell.signedByAgent')
                          : t('shell.unsigned')}
                    </p>
                    {detailContract.signedBy !== 'human' || detail.state !== 'drafting' ? null : (
                      <button
                        type="button"
                        className={css.primaryBtn}
                        disabled={advancing || advanceContract === undefined || !hasSession}
                        onClick={() => { void advanceSelected() }}
                      >
                        {advancing ? t('shell.advancing') : t('shell.advanceContracted')}
                      </button>
                    )}
                    {advanceResult === null ? null : (
                      <p className={advanceResult.ok ? css.secretRef : css.problem}>{advanceResult.text}</p>
                    )}
                    {detailContract.signedBy === 'human' ? null : (
                      <button
                        type="button"
                        className={css.primaryBtn}
                        disabled={signing || signContract === undefined || !hasSession}
                        onClick={() => { void signSelected() }}
                      >
                        {signing ? t('shell.signing') : t('shell.sign')}
                      </button>
                    )}
                    {signResult === null ? null : (
                      <p className={signResult.ok ? css.secretRef : css.problem}>{signResult.text}</p>
                    )}
                  </>
                )}
              </div>
              {liveSessionOf(detail) !== undefined ? null : roleChoices}
              <div className={css.field}>
                <label>{t('shell.startPrompt')} <span className={css.labelHint}>{t('shell.promptHint')}</span></label>
                <textarea className={css.promptBox} value={prompt} onChange={(event) => { setPrompt(event.target.value) }} />
              </div>
              {/* 「打开对话」没打开浮层时，原因就地显示在这里——浮层本身还没被切出来。 */}
              {chatError === null ? null : <p className={css.problem}>{chatError}</p>}
            </div>
            <div className={css.modalFoot}>
              <button type="button" className={css.secondaryBtn} onClick={copyPrompt}>{copied ? t('shell.copied') : t('shell.copyPrompt')}</button>
              <div className={css.spacer} />
              <button type="button" className={css.secondaryBtn} onClick={() => { setDetail(null) }}>{t('shell.cancel')}</button>
              <button
                type="button"
                className={css.primaryBtn}
                disabled={modelBlocked || claiming}
                title={modelBlocked ? t('shell.noModels') : undefined}
                onClick={() => { startConversation(detail) }}
              >
                {claiming
                  ? t('shell.claiming')
                  : liveSessionOf(detail) !== undefined ? t('shell.resumeChat') : t('shell.startChat')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {chat !== null ? (
        <div className={css.floating} data-max={chatMax ? 'true' : undefined}>
          <div className={css.floatingBackdrop} onClick={() => { setChatMax(false); setChat(null) }} />
          <div className={css.floatingInner} style={chatStyle}>
            <div className={css.boardWindow}>
              <div className={css.miniHead}>
                <div className={css.grow}>
                  <h4>{projectName} · {t('shell.board')}</h4>
                  <p>{t('shell.chatHint')} · {t('shell.specRoot')} {specRoot || '—'}</p>
                </div>
                <span className={`${css.pill} ${css.pillBrand}`}>{t('shell.tasks')}</span>
              </div>
              <div className={css.miniBoard}>
                {SHELL_STATES.map(state => renderColumn(state, true))}
              </div>
            </div>

            <div className={css.chatWindow} data-max={chatMax ? 'true' : undefined}>
              <div className={css.chatHead}>
                <div className={css.grow}>
                  <h4>{chat.id === '' ? chat.title : `${chat.id} · ${chat.title}`}</h4>
                  <p>LCoder · {t(STATE_LABEL[chat.state])} · {t('shell.chatHint')}</p>
                </div>
                <span className={css.pill}>{chatRunning ? t('shell.running') : t('shell.chatReady')}</span>
                <button
                  type="button"
                  className={css.iconBtn}
                  title={chatMax ? t('shell.restore') : t('shell.maximize')}
                  onClick={() => { setChatMax(value => !value) }}
                >
                  {chatMax ? '⤡' : '⛶'}
                </button>
                <button
                  type="button"
                  className={css.iconBtn}
                  title={t('shell.closeChat')}
                  onClick={() => { setChatMax(false); setChat(null) }}
                >
                  ✕
                </button>
              </div>
              <div className={css.chatBody}>
                <ChatTranscript messages={messages} running={chatRunning} t={t} />
                {chatError === null ? null : <p className={css.problem}>{chatError}</p>}
                {notice === null ? null : <p className={css.problem}>{`${t(notice.key)} ${notice.detail}`}</p>}
                {modelStatus === null || modelStatus.state === 'ready' ? null : (
                  <p className={css.problem}>
                    {modelStatus.detail === ''
                      ? t(modelStatus.state === 'empty' ? 'shell.noModels' : 'shell.unknownModels')
                      : `${t(modelStatus.state === 'empty' ? 'shell.noModels' : 'shell.unknownModels')}（${modelStatus.detail}）`}
                  </p>
                )}
                {modelBlocked ? <p className={css.secretRef}>{t('shell.howToConfigure')}</p> : null}
              </div>
              {chatPending === undefined ? null : <PendingInteractionCard pending={chatPending} t={t} />}
              <div className={css.chatInput}>
                <input
                  value={draft}
                  placeholder={t('shell.placeholder')}
                  onChange={(event) => { setDraft(event.target.value) }}
                />
                <button
                  type="button"
                  className={css.primaryBtn}
                  disabled={draft.trim() === '' || modelBlocked || chatSessionId === undefined || sendPrompt === undefined}
                  onClick={() => { void sendDraft() }}
                >
                  {t('shell.send')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {settings ? (
        <div className={css.modalBackdrop} onClick={(event) => { if (event.target === event.currentTarget) setSettings(false) }}>
          <div className={`${css.modal} ${css.settingsModal}`}>
            <div className={css.modalHead}>
              <div className={css.grow}><h3>{t('shell.settings')}</h3><p>{t('shell.settingsHint')}</p></div>
              <button type="button" className={css.iconBtn} onClick={() => { setSettings(false) }}>✕</button>
            </div>
            <div className={css.modalBody}>
              {modelSettings === undefined
                ? null
                : (
                  <ModelSettings
                    face={modelSettings}
                    sessionId={sessionId}
                    t={t}
                    onChanged={() => { modelRefresh.current() }}
                  />
                )}
              <div className={css.settingsGrid}>
                <div className={css.settingRow}><div className={css.settingLabel}><span className={css.settingLabelB}>{t('shell.specRoot')}</span><span className={css.settingLabelSpan}>{specRoot || '—'}</span></div><span className={css.pill}>{t('shell.sessionBound')}</span></div>
                <div className={css.settingRow}><div className={css.settingLabel}><span className={css.settingLabelB}>{t('shell.floating')}</span><span className={css.settingLabelSpan}>{t('shell.floatingHint')}</span></div><button type="button" className={`${css.switch} ${css.switchOn}`} /></div>
                <div className={css.settingRow}><div className={css.settingLabel}><span className={css.settingLabelB}>{t('shell.theme')}</span><span className={css.settingLabelSpan}>Light / Dark</span></div><button type="button" className={`${css.switch} ${dark ? css.switchOn : ''}`} onClick={() => { setDark(value => !value) }} /></div>
                <div className={css.settingRow}><div className={css.settingLabel}><span className={css.settingLabelB}>{t('shell.plugins')}</span><span className={css.settingLabelSpan}>{t('shell.onlySettings')}</span></div><span className={css.pill}>{t('shell.hidden')}</span></div>
              </div>
            </div>
            <div className={css.modalFoot}><div className={css.spacer} /><button type="button" className={css.primaryBtn} onClick={() => { setSettings(false) }}>{t('shell.done')}</button></div>
          </div>
        </div>
      ) : null}

      <div className={css.demoBadge}>LCoder · {t('shell.realData')}</div>
    </div>
  )
}
