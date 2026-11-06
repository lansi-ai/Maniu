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
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the `agentPreset` Session projection value into this program.
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import {
  loadAgentsRegistry, loadLocalSecrets, loadProjectInfo, loadWorkspaceProjection,
} from '../projection.ts'
import type {
  AgentsRow, ContractRow, ProjectionFilesRemote, ProposalRow, RuleRow, SchedulingGroupRow, TaskRow,
} from '../projection.ts'
import { parseFlowStatus } from '../flow-status.ts'
import type {
  FlowActionView, FlowBlockerKindView, FlowDecisionView, FlowStatusView,
} from '../flow-status.ts'
import { loadActionLog } from '../flow-history.ts'
import type { ActionLogEntry } from '../flow-history.ts'
import {
  AGENT_ROLES, liveAgentSession, resolveAgentSession, titleNeedsFix,
} from '../singleton.ts'
import type { AgentRole, AgentSessionCandidate } from '../singleton.ts'
import { decideScheduling } from '../scheduling.ts'
import type { SchedulingDecision, SchedulingSession, SchedulingTask } from '../scheduling.ts'
import type { ExpertPrompt, ExpertRow } from '../experts.ts'
import { describeOpenFailure } from '../open-failure.ts'
import type { ModelStatus, ShellSessionNotice } from '../model-status.ts'
import type { LcoderWorkspaceKey } from '../locales.ts'
import { claimTaskSession, taskCardStatus } from '../task-session.ts'
import type { TaskCardStatus, TaskQueueMark, TaskSessionRow } from '../task-session.ts'
import { EMPTY_TASK_FILTER, filterTasks, isFilterActive, TASK_GRADE_CHOICES } from '../task-filter.ts'
import type { SessionFilter, TaskFilter } from '../task-filter.ts'
import { onboardingAction } from '../onboarding.ts'
import { buildIntakePrompt, buildOnboardingPrompt, buildShellPrompt, SHELL_STATES, TASK_FLOW_MENTION_PREFIX } from './shell-data.ts'
import { ChatTranscript, PendingInteractionCard } from './ChatPanel.tsx'
import { ModelSettings } from './ModelSettings.tsx'
import type { ModelSettingsFace } from './model-settings.ts'
import { desktopWindowBridge } from './window-chrome.ts'
import type { DesktopWindowCommand, DesktopWindowState } from './window-chrome.ts'
import { runningCardClass } from './task-card-visual.ts'
import { projectDirectoryPicker } from './project-directory.ts'
import type {
  ShellContextPressure, ShellMessage, ShellProjectInfo, ShellRole, ShellSignResult, ShellTask, ShellTaskState,
} from './shell-data.ts'
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
    /** 派 `/proposal_approve <编号>` 让人采纳方案；出方案是模型的工具，批准不是。 */
    readonly approveProposal?: (sessionId: SessionId, proposalId: string) => Promise<ShellSignResult>
    /** 派 `/task_bind <编号>` 把任务认给这条会话；认领关系由宿主写盘。 */
    readonly bindTask?: (sessionId: SessionId, taskId: string) => Promise<ShellSignResult>
    /** 派 `/task_schedule <编号> <JSON>` 把这次判定追加到任务证据目录，供事后审计。 */
    readonly logSchedule?: (sessionId: SessionId, taskId: string, json: string) => Promise<ShellSignResult>
    /** 派 `/flow_status` 求流程判定；返回一行 JSON，由外壳解析展示。 */
    readonly readFlowStatus?: (sessionId: SessionId, taskIds: readonly string[]) => Promise<ShellSignResult>
    /** 派 `/flow_log <编号> <JSON>` 把一次开工结果追加到任务证据目录。 */
    readonly logFlow?: (sessionId: SessionId, taskId: string, json: string) => Promise<ShellSignResult>
    /** 派 `/agent_bind <角色> <会话号>` 把常驻会话号写回 `.spec/agents.yaml`。 */
    readonly bindAgentSession?: (sessionId: SessionId, role: AgentRole, agentSession: SessionId) => Promise<ShellSignResult>
    /** 把会话标题写成角色名；拒绝时返回失败回执，外壳照实显示。 */
    readonly renameSession?: (sessionId: SessionId, title: string) => Promise<ShellSignResult>
    /** 读当前会话的上下文占用与容量；读不到返回 null。 */
    readonly readContextPressure?: (sessionId: SessionId) => ShellContextPressure | null
    /** 在同一仓库里新开会话，可按角色（Agent preset）指名；角色只在首回合前可选。 */
    readonly createSession?: (path: string, agentPreset?: string) => Promise<SessionId>
    /** 装配层声明的角色名册；读不到时外壳只走宿主默认角色。 */
    readonly listRoles?: () => Promise<readonly ShellRole[]>
    /** 专家名册（宿主真实注册的全部 preset）与单个专家的提示词、声明原文。 */
    readonly listExperts?: () => Promise<readonly ExpertRow[]>
    readonly readExpert?: (id: string) => Promise<ExpertPrompt | null>
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
export const DEFAULT_CHAT_SIZE = { width: 720, height: 640 } as const

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
  waiting: { labelKey: 'shell.taskWaiting', className: css.tagWarn },
  queued: { labelKey: 'shell.taskQueued', className: css.tagQueued },
}

/** 合并投影里的联调组与本次判定刚记下的组，交给卡片与详情共用。 */
interface JointView {
  readonly id?: string
  readonly sessionId: string
  readonly members: readonly string[]
  readonly createdAt?: string
}

/** 一次调度在界面上的留档：判定本身、时刻、入队位置与联调组成员。 */
interface ShellSchedule {
  readonly decision: SchedulingDecision
  readonly at: string
  readonly queue?: TaskQueueMark
  readonly joint?: { readonly sessionId: string; readonly members: readonly string[] }
}

/** 开工批量里一条任务的结果；`held` 表示流程判定按住，不算失败。 */
interface FlowRunResult {
  readonly taskId: string
  readonly ok: boolean
  readonly held: boolean
  readonly text: string
}

/** 流程动作到词典键。 */
const FLOW_ACTION_LABEL: Record<FlowActionView, LcoderWorkspaceKey> = {
  draft: 'shell.flowActionDraft',
  contract: 'shell.flowActionContract',
  sign: 'shell.flowActionSign',
  implement: 'shell.flowActionImplement',
  verify: 'shell.flowActionVerify',
  close: 'shell.flowActionClose',
  commit: 'shell.flowActionCommit',
  external: 'shell.flowActionExternal',
  stop: 'shell.flowActionStop',
}

/** 挡住原因到词典键。 */
const FLOW_BLOCKER_LABEL: Record<FlowBlockerKindView, LcoderWorkspaceKey> = {
  signature: 'shell.flowBlockerSignature',
  dependency: 'shell.flowBlockerDependency',
  budget: 'shell.flowBlockerBudget',
  external: 'shell.flowBlockerExternal',
}

/** 动作模式到词典键。 */
const FLOW_MODE_LABEL = {
  auto: 'shell.flowModeAuto',
  manual: 'shell.flowModeManual',
  none: 'shell.flowModeNone',
} as const

/** 词典里的 `{name}` 占位符；只替换一遍，值里再出现花括号不再展开。 */
function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, String(value)), text)
}

/** 上下文计数的短写法：1.2k / 3.4M；只在展示层用，不参与任何判定。 */
function formatTokens(value: number): string {
  if (value < 1_000) return String(Math.round(value))
  if (value < 1_000_000) {
    const scaled = (value / 1_000).toFixed(1)
    return `${scaled.endsWith('.0') ? scaled.slice(0, -2) : scaled}k`
  }
  const scaled = (value / 1_000_000).toFixed(1)
  return `${scaled.endsWith('.0') ? scaled.slice(0, -2) : scaled}M`
}

/** 占用百分比；容量未知或为 0 时返回 null。 */
function percentOf(used: number, budget: number | undefined): number | null {
  if (budget === undefined || budget <= 0) return null
  return Math.min(999, Math.round((used / budget) * 100))
}

const KNOWN_STATES: ReadonlySet<string> = new Set(SHELL_STATES.map(state => state.id))

/** 方案决定态的文案键；`unknown` 表示文件里写着认识不了的值。 */
const PROPOSAL_DECISION: Record<ProposalRow['decision'], LcoderWorkspaceKey> = {
  draft: 'shell.proposalDraft',
  approved: 'shell.proposalApproved',
  rejected: 'shell.proposalRejected',
  unknown: 'shell.proposalDecisionUnknown',
}

const SESSION_FILTER_CHOICES: readonly SessionFilter[] = ['any', 'claimed', 'active']

const SESSION_FILTER_LABELS: Record<SessionFilter, LcoderWorkspaceKey> = {
  any: 'shell.sessionAny',
  claimed: 'shell.sessionClaimed',
  active: 'shell.sessionActive',
}

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
    ...(row.proposal === undefined ? {} : { proposal: row.proposal }),
    ...(row.dependsOn.length === 0 ? {} : { dependsOn: row.dependsOn }),
    paths: row.paths,
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
  t, files, openRepository, sendPrompt, signContract, advanceContract, approveProposal, bindTask, logSchedule,
  readFlowStatus, logFlow, bindAgentSession, renameSession, readContextPressure,
  createSession, listRoles, listExperts, readExpert,
  readMessages, subscribeSession, holdSession, checkModels, subscribeModels, readSessionNotice, readSessionFlags, modelSettings,
  useSessions, useSessionStatus, useWorkspaces, chatSize,
}: ShellProps): ReactNode {
  const workspaces = useWorkspaces(state => state.items)
  const sessionRows = useSessions(state => state.byId)
  /** 每条会话的投影值；队列长度来自 agent-loop 的 `inbox` 折叠，打开过的会话才有。 */
  const sessionProjections = useSessions(state => state.projectionsBySession)
  /** 宿主推流的每会话状态；覆盖每个列出的会话，不需要 bind 也不需要开历史。 */
  const sessionStatus = useSessionStatus(state => state)

  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [dark, setDark] = useState(false)
  /** 字体预设：A 系统、B 现代；默认 B，用户看完两档再定。 */
  const [fontPreset, setFontPreset] = useState<'system' | 'modern'>('modern')
  /** Windows 桌面自绘标题栏；Web 与 macOS 没有这个桥，不画窗口按钮。 */
  const windowBridge = useMemo(() => desktopWindowBridge(), [])
  const [windowMaximized, setWindowMaximized] = useState(false)
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
  /** 看板筛选：低频控件，默认收起，只在判据生效时让入口带上标记。 */
  const [filterOpen, setFilterOpen] = useState(false)
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_TASK_FILTER)
  /** 设置里的专家面板：名册与提示词都在展开时才读，不跟启动抢一次远程调用。 */
  const [expertsOpen, setExpertsOpen] = useState(false)
  const [experts, setExperts] = useState<readonly ExpertRow[]>([])
  const [expertPrompts, setExpertPrompts] = useState<Record<string, ExpertPrompt | null>>({})
  const [shownExpert, setShownExpert] = useState<string | null>(null)
  const [tasks, setTasks] = useState<readonly ShellTask[]>([])
  const [rules, setRules] = useState<readonly RuleRow[]>([])
  const [groups, setGroups] = useState<readonly SchedulingGroupRow[]>([])
  const [contracts, setContracts] = useState<readonly ContractRow[]>([])
  /** 签完一次就把投影重读一遍：`contracts` 里的签名状态是文件的事实，不是界面的记忆。 */
  const [reload, setReload] = useState(0)
  const [signing, setSigning] = useState(false)
  const [signResult, setSignResult] = useState<ShellSignResult | null>(null)
  /** 推进到已签约：与签署分开两步，各自可重试、失败也分得清。 */
  const [advancing, setAdvancing] = useState(false)
  const [advanceResult, setAdvanceResult] = useState<ShellSignResult | null>(null)
  const [proposals, setProposals] = useState<readonly ProposalRow[]>([])
  /** 采纳方案：出方案是模型的工具，这一步只由人点。 */
  const [approving, setApproving] = useState(false)
  const [approveResult, setApproveResult] = useState<ShellSignResult | null>(null)
  const [rulesCount, setRulesCount] = useState(0)
  const [info, setInfo] = useState<ShellProjectInfo | null>(null)
  const [problems, setProblems] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionOverride, setSessionOverride] = useState<SessionId | null>(null)
  const [repoPath, setRepoPath] = useState('')
  const [opening, setOpening] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const projectDirectory = useMemo(() => projectDirectoryPicker(), [])
  const [repoError, setRepoError] = useState<string | null>(null)
  const [messages, setMessages] = useState<readonly ShellMessage[]>([])
  const [notice, setNotice] = useState<ShellSessionNotice | null>(null)
  /** null 表示还没查过；`empty` 才是「没有能跑的模型」，`unknown` 是查询本身失败。 */
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null)
  /** 设置页存完 key 后立刻重查一次；订阅的那路是兜底。 */
  const modelRefresh = useRef<() => void>(() => {})
  /** 立项咒语正在发：只挡连点的第二下，跨刷新的去重读会话事实。 */
  const onboardingSending = useRef(false)
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
  /** 本窗口建会话时选的角色；会话行读不到 agentPreset，硬闸只在两侧都知道时生效。 */
  const [sessionRoles, setSessionRoles] = useState<Readonly<Record<string, string>>>({})
  /** 每条任务最近一次调度判定；只在本次窗口内留档，落盘由 `/task_schedule` 负责。 */
  const [schedule, setSchedule] = useState<Readonly<Record<string, ShellSchedule>>>({})
  /** 调度日志没写成的原因；按任务号记，界面上就地说明。 */
  const [scheduleErrors, setScheduleErrors] = useState<Readonly<Record<string, string>>>({})
  /** `.spec/agents.yaml` 登记的两个常驻会话号；缺文件时为 null。 */
  const [agents, setAgents] = useState<AgentsRow | null>(null)
  /** 开工/流程面板；判定只在打开或重读时求值，不在每次渲染上跑命令。 */
  const [flowOpen, setFlowOpen] = useState(false)
  const [flow, setFlow] = useState<FlowStatusView | null>(null)
  const [flowLoading, setFlowLoading] = useState(false)
  const [flowError, setFlowError] = useState<string | null>(null)
  /** 本次要开工的任务；默认所有可开始的任务，人可逐条取消。 */
  const [flowSelection, setFlowSelection] = useState<ReadonlySet<string>>(new Set())
  const [flowRunning, setFlowRunning] = useState(false)
  /** 上一次批量开工的逐条结果；失败项可单独重试。 */
  const [flowResults, setFlowResults] = useState<readonly FlowRunResult[]>([])
  const [flowHistory, setFlowHistory] = useState<readonly ActionLogEntry[]>([])
  const [flowHistoryProblems, setFlowHistoryProblems] = useState<readonly string[]>([])
  /** 动作流水没写成的原因；按任务号记。 */
  const [flowLogErrors, setFlowLogErrors] = useState<Readonly<Record<string, string>>>({})
  /** 浮层会话的上下文占用与容量；随事件刷新。 */
  const [chatPressure, setChatPressure] = useState<ShellContextPressure | null>(null)
  /** 常驻会话的创建/切换只允许一个在途；连点第二下不会开出第二条。 */
  const singletonBusy = useRef(false)
  /** 人是否动过开工范围；动过之后刷新判定不再覆盖他的选择。 */
  const flowSelectionTouched = useRef(false)
  /** 动作流水的在途读取；新请求先取消旧请求，避免旧结果盖住新结果。 */
  const historyAbort = useRef<AbortController | null>(null)

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
   * 一条会话的 preset。列表摘要优先，其次打开会话的完整投影，最后是本窗口
   * 建会话时记下的角色；三处都读不到就留空，单例解析按「读不到不否决」处理。
   */
  const agentPresetOf = (id: SessionId): string | undefined => {
    const summary = sessionRows[id]?.projectionValues?.agentPreset
    if (typeof summary === 'string' && summary !== '') return summary
    const projected = sessionProjections[id]?.values.agentPreset
    if (typeof projected === 'string' && projected !== '') return projected
    return sessionRoles[String(id)]
  }

  /** 常驻会话解析用的工作区会话名册。 */
  const agentCandidates = (): readonly AgentSessionCandidate[] =>
    workspaceSessions.map((id) => {
      const preset = agentPresetOf(id)
      return {
        sessionId: String(id),
        ...(preset === undefined ? {} : { agentPreset: preset }),
      }
    })

  /** 某个常驻角色当前落在哪条会话；只读，找不到返回 undefined。 */
  const singletonIdOf = (role: AgentRole): string | undefined =>
    liveAgentSession(role, agents?.[AGENT_ROLES[role].key], agentCandidates())

  /**
   * 重新求流程判定。命令在会话里执行，读的是同一份 `.spec`；传空数组表示全部任务，
   * 开工范围只影响「点开始时挑哪些」，不影响引擎给出的下一步。
   */
  const refreshFlow = async (): Promise<void> => {
    if (readFlowStatus === undefined || sessionId === undefined) {
      setFlowError(t('shell.flowNoSession'))
      return
    }
    setFlowLoading(true)
    try {
      const result = await readFlowStatus(sessionId, [])
      if (!result.ok) {
        setFlowError(result.text)
        return
      }
      const parsed = parseFlowStatus(result.text)
      if (parsed === null) {
        setFlowError(t('shell.flowBadOutput'))
        return
      }
      setFlow(parsed)
      setFlowError(null)
      setFlowSelection((current) => {
        const startable = parsed.tasks.filter(entry => entry.startable).map(entry => entry.id)
        if (!flowSelectionTouched.current) return new Set(startable)
        const known = new Set(parsed.tasks.map(entry => entry.id))
        return new Set([...current].filter(id => known.has(id)))
      })
    } catch (error: unknown) {
      setFlowError(String(error))
    } finally {
      setFlowLoading(false)
    }
  }

  /** 读最近动作流水；`flow.jsonl` 没有时只显示 `schedule.jsonl`。 */
  const refreshHistory = async (): Promise<void> => {
    if (files === undefined || sessionId === undefined) {
      setFlowHistory([])
      setFlowHistoryProblems([])
      return
    }
    historyAbort.current?.abort()
    const controller = new AbortController()
    historyAbort.current = controller
    try {
      const loaded = await loadActionLog(files, sessionId, tasks.map(task => task.id), controller.signal)
      if (controller.signal.aborted) return
      setFlowHistory(loaded.entries)
      setFlowHistoryProblems(loaded.problems)
    } catch (error: unknown) {
      if (controller.signal.aborted) return
      setFlowHistoryProblems([String(error)])
    }
  }

  /** 任务编号到状态的映射：调度据此判断前置是否收口。 */
  const knownStates = useMemo<Readonly<Record<string, string>>>(
    () => Object.fromEntries(tasks.map(task => [task.id, task.state])),
    [tasks],
  )

  /**
   * 一条会话的队列长度。只有打开过的会话才有 `inbox` 投影；读不到按 0 算，
   * 界面因此不会把「不知道」画成「有队列」。
   */
  const queueDepth = (id: string): number => {
    const inbox = sessionProjections[id as SessionId]?.values.inbox
    return inbox === undefined ? 0 : inbox['next-turn'].length
  }

  /** 任务触及的规格模块：由 rules 的 module 反查，空串不算模块。 */
  const modulesOf = (task: ShellTask): readonly string[] => {
    const found = new Set<string>()
    for (const id of task.rules) {
      const module = rules.find(rule => rule.id === id)?.module
      if (module !== undefined && module !== '') found.add(module)
    }
    return [...found]
  }

  /** 一条会话认领过的任务，供调度比较方案、模块与落点。 */
  const claimsOf = (id: SessionId): SchedulingSession['claims'] =>
    tasks
      .filter(task => task.session === String(id))
      .map(task => ({
        id: task.id,
        state: task.state,
        ...(task.proposal === undefined ? {} : { proposal: task.proposal }),
        modules: modulesOf(task),
        paths: task.paths,
        dependsOn: task.dependsOn ?? [],
      }))

  /** 一条会话联调组里的任务行；任务文件被删掉时跳过，不编造成员。 */
  const groupTaskRows = (sessionId: string): readonly ShellTask[] => {
    const ids = new Set(groups.filter(group => group.sessionId === sessionId).flatMap(group => group.members))
    return tasks.filter(task => ids.has(task.id))
  }

  const schedulingTaskOf = (task: ShellTask): SchedulingTask => ({
    id: task.id,
    state: task.state,
    dependsOn: task.dependsOn ?? [],
    ...(task.proposal === undefined ? {} : { proposal: task.proposal }),
    modules: modulesOf(task),
    paths: task.paths,
    repoPath: projectPath,
  })

  /** 本工作区的会话名册；角色只在本次窗口建会话时知道，其余留空让硬闸失效。 */
  const schedulingSessions = (): readonly SchedulingSession[] =>
    workspaceSessions.map((id) => {
      const row = sessionRows[id]
      const pushed = sessionStatus.get(id)
      const role = sessionRoles[String(id)]
      return {
        sessionId: String(id),
        ...(role === undefined ? {} : { role }),
        running: pushed?.running ?? row?.running ?? false,
        awaitingInteraction: pushed?.pendingInteraction !== undefined,
        pending: queueDepth(String(id)),
        workspacePath: row?.cwd ?? workspace?.path ?? '',
        claims: claimsOf(id),
        groupTasks: groupTaskRows(String(id)).map(task => ({
          id: task.id,
          state: task.state,
          dependsOn: task.dependsOn ?? [],
        })),
      }
    })

  /** 顶栏与详情里给会话一个短称呼：有认领任务用任务标题，否则按次序列号。 */
  const sessionLabel = (id: string): string => {
    const bound = tasks.find(task => task.session === id)
    if (bound !== undefined) return bound.title
    const index = workspaceSessions.findIndex(candidate => String(candidate) === id)
    return `${t('shell.sessions')} ${String(index + 1)}`
  }

  /** 调度段里用稳定称呼：会话序号 + 当前认领的任务标题，避免只看到一串会话号。 */
  const schedulingLabel = (id: string): string => {
    const index = workspaceSessions.findIndex(candidate => String(candidate) === id)
    const base = `${t('shell.sessions')} ${String(index + 1)}`
    const bound = tasks.find(task => task.session === id)
    return bound === undefined ? base : `${base} · ${bound.title}`
  }

  /** 把内核理由里的会话号换成界面上的短称呼；显示用，落盘仍是原始 id。 */
  const humanizeSessions = (text: string): string =>
    workspaceSessions.reduce(
      (result, id) => result.replaceAll(String(id), schedulingLabel(String(id))),
      text,
    )

  /**
   * 本任务所在的联调组：优先读投影里的组文件（刷新后仍在），
   * 投影还没跟上时退回本次判定刚记下的组。
   */
  const jointOf = (task: ShellTask): JointView | undefined => {
    const group = groups.find(row => row.members.includes(task.id))
    if (group !== undefined) {
      return { id: group.id, sessionId: group.sessionId, members: group.members, createdAt: group.createdAt }
    }
    const entry = schedule[task.id]
    if (entry?.joint === undefined) return undefined
    return {
      sessionId: entry.joint.sessionId,
      members: [task.id, ...entry.joint.members],
      createdAt: entry.at,
    }
  }

  /**
   * 这条任务还在排队的证据。队列清空（或会话闲下来）后就不再画「已入队」；
   * 判定那一刻的「第 N 位」留在详情里供回看。
   */
  const queueMarkOf = (task: ShellTask): TaskQueueMark | undefined => {
    const entry = schedule[task.id]
    if (entry?.queue === undefined) return undefined
    const running = sessionStatus.get(entry.queue.sessionId as SessionId)?.running
      ?? sessionRows[entry.queue.sessionId as SessionId]?.running
      ?? false
    return running || queueDepth(entry.queue.sessionId) >= entry.queue.position ? entry.queue : undefined
  }
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
      setRules([])
      setGroups([])
      setContracts([])
      setProposals([])
      setRulesCount(0)
      setInfo(null)
      setAgents(null)
      setFlow(null)
      setFlowError(null)
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
      loadAgentsRegistry(files, sessionId, controller.signal),
    ]).then(([projection, projectInfo, secrets, agentRegistry]) => {
      if (controller.signal.aborted) return
      setTasks(projection.tasks.map(toShellTask))
      setRules(projection.rules)
      setGroups(projection.groups)
      setContracts(projection.contracts)
      setProposals(projection.proposals)
      setRulesCount(projection.rules.length)
      setProblems([...projection.problems, ...projectInfo.problems, ...agentRegistry.problems])
      setInfo(projectInfo.info === null ? null : resolveSecrets(projectInfo.info, secrets))
      setAgents(agentRegistry.agents)
      setLoading(false)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setTasks([])
      setRules([])
      setGroups([])
      setContracts([])
      setProposals([])
      setRulesCount(0)
      setInfo(null)
      setAgents(null)
      setProblems([String(error)])
      setLoading(false)
    })
    return () => { controller.abort() }
  }, [files, activeWorkspaceId, sessionId, reload])

  /**
   * 进项目、换会话或重读投影后求一次流程判定。结果既供顶栏「开工」面板，
   * 也供看板上方那条常驻状态；判定失败只就地说明，不挡任务板。
   */
  useEffect(() => {
    if (!hasWorkspace || sessionId === undefined) return
    void refreshFlow()
  }, [activeWorkspaceId, sessionId, reload, readFlowStatus])

  /** 面板打开或投影变化时重读动作流水；关着面板不读，省掉每次刷新的一串文件调用。 */
  useEffect(() => {
    if (!flowOpen) return
    void refreshHistory()
  }, [flowOpen, reload, files, sessionId, tasks.length])

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

  /** 自绘窗口栏跟随最大化与全屏切换；重载后先读一次当前状态。 */
  useEffect(() => {
    if (windowBridge === undefined) return
    let alive = true
    const apply = (state: DesktopWindowState): void => { if (alive) setWindowMaximized(state.maximized) }
    windowBridge.state().then(apply, (error: unknown) => {
      console.error('LCoder window state unavailable', error)
    })
    const unsubscribe = windowBridge.subscribe(apply)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [windowBridge])

  /** 字体预设写到 html，body 与壳共用同一份 --lc-preset-font。 */
  useEffect(() => {
    const root = document.documentElement
    root.dataset.lcoderFont = fontPreset
    return () => { delete root.dataset.lcoderFont }
  }, [fontPreset])

  useEffect(() => {
    if (chat === null || chatSessionId === undefined || readMessages === undefined || subscribeSession === undefined) {
      setMessages([])
      setNotice(null)
      setChatPressure(null)
      return
    }
    // 先持有再订阅：刚建的会话没有本地引用时，读消息与事件都拿不到东西。
    const release = holdSession?.(chatSessionId)
    const refresh = (): void => {
      setMessages(readMessages(chatSessionId))
      setNotice(readSessionNotice?.(chatSessionId) ?? null)
      setChatPressure(readContextPressure?.(chatSessionId) ?? null)
    }
    refresh()
    const unsubscribe = subscribeSession(chatSessionId, refresh)
    return () => {
      unsubscribe()
      release?.()
    }
  }, [chat, chatSessionId, readMessages, subscribeSession, readSessionNotice, holdSession, readContextPressure])

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
    const blockedBy = task.state === 'closed'
      ? []
      : (task.dependsOn ?? []).filter(id => knownStates[id] !== 'closed')
    const joint = jointOf(task)
    const queue = queueMarkOf(task)
    return taskCardStatus({
      session,
      hostRunning: pushed?.running,
      awaitingInteraction: pushed?.pendingInteraction !== undefined,
      awaitingFirstTurn: flags?.awaitingFirstTurn,
      failed: flags?.failed,
      blockedBy,
      queued: queue ?? (joint === undefined ? undefined : { sessionId: joint.sessionId, position: 0 }),
    })
  }

  /** 判据下的可见任务；筛选入口上的计数就是它。 */
  const visibleTasks = filterTasks(tasks, filter, statusOfTask)

  /**
   * 本工作区里有几条会话在等人（审批或提问）。
   *
   * 只看宿主推流的全局 seat，不物化会话、不开历史——等待这件事恰恰发生在你不看那条会话的时候。
   */
  const awaitingCount = useMemo(() => {
    let count = 0
    for (const id of Object.keys(sessionRows) as SessionId[]) {
      if (sessionStatus.get(id)?.pendingInteraction !== undefined) count += 1
    }
    return count
  }, [sessionRows, sessionStatus])

  /** 等待计数一变就报给宿主；卸载时归零，免得留下一个不会停的闪烁。 */
  useEffect(() => {
    const bridge = windowBridge
    if (bridge === undefined || bridge.attention === undefined) return
    void bridge.attention(awaitingCount).catch(() => {})
    return () => { void bridge.attention?.(0).catch(() => {}) }
  }, [awaitingCount, windowBridge])


  /** 任务咒语；带上最近一次调度结论，让模型也看到前置与建议会话。 */
  const promptOf = (task: ShellTask, decision?: SchedulingDecision): string => {
    const entry = decision ?? schedule[task.id]?.decision
    const info = entry === undefined
      ? undefined
      : {
        blockedBy: entry.blockedBy.length > 0,
        ...(entry.chosen === undefined ? {} : { sessionId: entry.chosen }),
        signals: entry.candidates.find(candidate => candidate.sessionId === entry.chosen)?.signals ?? [],
      }
    return buildShellPrompt({ name: projectName, path: projectPath, branch: projectBranch }, task, info)
  }

  const openTask = (task: ShellTask): void => {
    setDetail(task)
    setPrompt(promptOf(task))
    setCopied(false)
    setSignResult(null)
    // 上一个任务的「没会话」提示不属于这个任务。
    setChatError(null)
  }

  /**
   * 顶栏会话条：切到该会话并直接打开浮层。
   * 绑定任务显示任务标题，未绑定用会话占位；建会话与认领仍归顶栏入口。
   */
  const openSession = (id: SessionId, index: number): void => {
    const bound = tasks.find(task => task.session !== undefined && task.session === String(id))
    setSessionOverride(id)
    setDetail(null)
    setChatError(null)
    setChat(bound ?? {
      id: '',
      title: `${t('shell.sessions')} ${String(index + 1)}`,
      state: 'drafting',
      grade: '-',
      rules: [],
      evidence: [],
      surface: '',
      paths: [],
    })
  }

  /** 选中任务的那份契约；没有就是还没起草。 */
  const detailContract = detail === null
    ? undefined
    : contracts.find(row => row.id === detail.id)

  /** 选中任务出自哪个方案；任务没回指就是 undefined，回指了但文件读不到时给 unknownProposal。 */
  const detailProposal = detail?.proposal === undefined
    ? undefined
    : proposals.find(row => row.id === detail.proposal)

  /** 选中任务最近一次调度留档；点过「开始对话」才有。 */
  const detailSchedule = detail === null ? undefined : schedule[detail.id]
  /** 选中任务所在的联调组；投影里有就是持久的，刷新后仍在。 */
  const detailJoint = detail === null ? undefined : jointOf(detail)
  /** 签署与外部动作不混进普通开工：单独列出来让人先处理。 */
  const attentionPlans = flow === null
    ? []
    : flow.tasks.filter(plan => plan.decision.action === 'sign' || plan.decision.action === 'external')
  /** 流水里的自签与外部动作也单独成组，不混进普通开工流水。 */
  const attentionHistory = flowHistory.filter(entry =>
    (entry.action === 'sign' && entry.mode === 'auto') || entry.action === 'external')
  const normalHistory = flowHistory.filter(entry =>
    !((entry.action === 'sign' && entry.mode === 'auto') || entry.action === 'external'))

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

  /** 采纳选中任务的方案：正文一个字都不动，只把决定态与结论时刻写下。 */
  const approveSelected = async (): Promise<void> => {
    if (detail?.proposal === undefined || sessionId === undefined || approveProposal === undefined) return
    setApproving(true)
    setApproveResult(null)
    try {
      setApproveResult(await approveProposal(sessionId, detail.proposal))
      setReload(value => value + 1)
    } catch (error: unknown) {
      // 远程调用本身失败；命令的失败回执照旧走 approveResult。
      setApproveResult({ ok: false, text: String(error) })
    } finally {
      setApproving(false)
    }
  }

  /** 展开专家面板时才读名册：设置页是低频入口，不该在启动路径上多一次远程调用。 */
  const toggleExperts = (): void => {
    const next = !expertsOpen
    setExpertsOpen(next)
    if (next && experts.length === 0 && listExperts !== undefined) {
      void listExperts().then(setExperts).catch(() => { setExperts([]) })
    }
  }

  /** 展开某位专家：提示词与声明原文来自 `agentPresets.read`，读一次就缓存。 */
  const toggleExpert = (id: string): void => {
    if (shownExpert === id) {
      setShownExpert(null)
      return
    }
    setShownExpert(id)
    if (expertPrompts[id] !== undefined || readExpert === undefined) return
    void readExpert(id).then((prompt) => {
      setExpertPrompts(current => ({ ...current, [id]: prompt }))
    }).catch(() => {
      setExpertPrompts(current => ({ ...current, [id]: null }))
    })
  }

  /** 复制到仓外开工才补技能引用；发进本会话的提示词保持编辑器里那份。 */
  const copyPrompt = (): void => {
    void navigator.clipboard.writeText(`${TASK_FLOW_MENTION_PREFIX}${prompt}`).then(
      () => {
        setCopied(true)
        setTimeout(() => { setCopied(false) }, 1200)
      },
      () => { setCopied(false) },
    )
  }

  /** 入队判定带的联调组；其它判定没有组。 */
  const jointOfDecision = (decision: SchedulingDecision): ShellSchedule['joint'] =>
    decision.joint === undefined || decision.chosen === undefined
      ? undefined
      : { sessionId: decision.chosen, members: decision.joint.members }

  /** 把一次判定记进本窗口的留档；入队位置随后才补，所以分开写。 */
  const rememberSchedule = (task: ShellTask, decision: SchedulingDecision, at: string, queue?: TaskQueueMark): void => {
    const joint = jointOfDecision(decision)
    setSchedule(current => ({
      ...current,
      [task.id]: { decision, at, ...(queue === undefined ? {} : { queue }), ...(joint === undefined ? {} : { joint }) },
    }))
  }

  /** 把判定追加到 `.spec/evidence/<任务>/schedule.jsonl`；写不进去只在这里说明，不挡执行。 */
  const logScheduleDecision = (
    via: SessionId | undefined,
    task: ShellTask,
    decision: SchedulingDecision,
    at: string,
    queue?: TaskQueueMark,
  ): void => {
    if (logSchedule === undefined) return
    if (via === undefined) {
      setScheduleErrors(current => ({ ...current, [task.id]: t('shell.noSession') }))
      return
    }
    const joint = jointOfDecision(decision)
    const payload = JSON.stringify({
      at,
      verdict: decision.verdict,
      ...(decision.chosen === undefined ? {} : { chosen: decision.chosen }),
      ...(queue === undefined ? {} : { queuePosition: queue.position }),
      ...(joint === undefined ? {} : { joint }),
      candidates: decision.candidates,
      reasons: decision.reasons,
      blockedBy: decision.blockedBy,
      needsChoice: decision.needsChoice,
    })
    void logSchedule(via, task.id, payload).then((result) => {
      setScheduleErrors((current) => {
        const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== task.id))
        return result.ok ? rest : { ...rest, [task.id]: result.text }
      })
      // 组文件刚落盘，重读投影让卡片与后续判定都看到这个成员。
      if (result.ok && joint !== undefined) setReload(value => value + 1)
    }, (error: unknown) => {
      setScheduleErrors(current => ({ ...current, [task.id]: String(error) }))
    })
  }

  /**
   * 打开这条任务的对话：先按依赖、worktree 与关联信号判定一次，再决定去向。
   *
   * - `wait`：前置没收口，按住不发；卡片与详情显示等哪几条，收口后再点一次重新判定。
   * - `reuse`：本任务已认领且空闲就只切过去；未认领但匹配时空闲会话要认领并发送。
   * - `enqueue`：把咒语写进匹配会话的队列，并记下会话与第几位。
   * - `new`：同仓库新开会话，按选中角色认领后发送。
   *
   * 启动咒语在这里就地生成，不读 `prompt` 状态：那份状态要等渲染后的 effect 才跟上任务，
   * 直接发出去的是上一任务的文本。
   */
  const openTaskConversation = async (task: ShellTask): Promise<FlowRunResult> => {
    const decision = decideScheduling(schedulingTaskOf(task), schedulingSessions(), knownStates)
    const at = new Date().toISOString()
    const text = promptOf(task, decision)
    setPrompt(text)
    setDetail(task)
    setChatError(null)
    setScheduleErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== task.id)))

    if (decision.verdict === 'wait') {
      rememberSchedule(task, decision, at)
      logScheduleDecision(sessionId, task, decision, at)
      const notice = fill(t('shell.scheduleWaitNotice'), { tasks: decision.blockedBy.join('、') })
      setChatError(notice)
      return { taskId: task.id, ok: false, held: true, text: notice }
    }

    if (modelBlocked) {
      rememberSchedule(task, decision, at)
      logScheduleDecision(sessionId, task, decision, at)
      setChat(task)
      setDetail(null)
      setChatError(t('shell.noModels'))
      return { taskId: task.id, ok: false, held: false, text: t('shell.noModels') }
    }

    if (decision.chosen !== undefined) {
      const target = decision.chosen as SessionId
      const alreadyBound = liveSessionOf(task) === target
      // 一条会话只能认领一条任务。空闲会话复用时改绑是有意交接；会话还在跑时
      // 改绑会把正在跑的那条释放、工具面也会被切走，所以入队只记会话与位置。
      const boundElsewhere = tasks.some(candidate =>
        candidate.session === decision.chosen && candidate.id !== task.id && candidate.state !== 'closed')
      const shouldBind = !alreadyBound && (decision.verdict !== 'enqueue' || !boundElsewhere)
      // 已在这条会话的联调组里，或已经排过队：只切过去，重复点击不再塞第二条。
      const grouped = jointOf(task)
      const existing = queueMarkOf(task)
      if ((grouped !== undefined && grouped.sessionId === decision.chosen)
        || (existing !== undefined && existing.sessionId === decision.chosen)) {
        setSessionOverride(target)
        setChat(task)
        setDetail(null)
        return { taskId: task.id, ok: true, held: false, text: t('shell.flowAlreadyRunning') }
      }
      // 本任务已认在这条会话上，而它正在跑或还有队列：重复点「开工」只切过去。
      // 没有这一条，批量开工连点两次会给同一条任务再塞一遍提示词。
      const targetRunning = sessionStatus.get(target)?.running ?? sessionRows[target]?.running ?? false
      if (alreadyBound && (targetRunning || queueDepth(String(target)) > 0)) {
        setSessionOverride(target)
        setChat(task)
        setDetail(null)
        return { taskId: task.id, ok: true, held: false, text: t('shell.flowAlreadyRunning') }
      }
      const queue = decision.verdict === 'enqueue'
        ? { sessionId: decision.chosen, position: queueDepth(decision.chosen) + 1 }
        : undefined
      rememberSchedule(task, decision, at, queue)
      logScheduleDecision(sessionId ?? target, task, decision, at, queue)
      setSessionOverride(target)
      setChat(task)
      setDetail(null)
      if (decision.verdict === 'reuse' && alreadyBound) {
        return { taskId: task.id, ok: true, held: false, text: t('shell.flowAlreadyRunning') }
      }
      if (bindTask === undefined || sendPrompt === undefined) {
        setChatError(t('shell.noSession'))
        return { taskId: task.id, ok: false, held: false, text: t('shell.noSession') }
      }
      setClaiming(true)
      try {
        if (shouldBind) {
          const claimed = await bindTask(target, task.id)
          if (!claimed.ok) throw new Error(claimed.text)
          // 认领写进了文件，投影要重读：卡片上「谁在跑这条任务」显示的是文件的事实。
          setReload(value => value + 1)
        }
        await sendPrompt(target, text)
        return { taskId: task.id, ok: true, held: false, text: fill(t('shell.flowStartedIn'), { session: sessionLabel(String(target)) }) }
      } catch (error: unknown) {
        setChatError(String(error))
        return { taskId: task.id, ok: false, held: false, text: String(error) }
      } finally {
        setClaiming(false)
      }
    }

    rememberSchedule(task, decision, at)
    setChat(task)
    setDetail(null)
    if (createSession === undefined || bindTask === undefined || sendPrompt === undefined || projectPath === '') {
      setChatError(t('shell.noSession'))
      return { taskId: task.id, ok: false, held: false, text: t('shell.noSession') }
    }
    setClaiming(true)
    try {
      const created = await createSession(projectPath, roleChoice ?? undefined)
      if (roleChoice !== null) setSessionRoles(current => ({ ...current, [String(created)]: roleChoice }))
      const claimed = await bindTask(created, task.id)
      if (!claimed.ok) throw new Error(claimed.text)
      setSessionOverride(created)
      setReload(value => value + 1)
      logScheduleDecision(created, task, decision, at)
      await sendPrompt(created, text)
      return { taskId: task.id, ok: true, held: false, text: t('shell.flowStartedNew') }
    } catch (error: unknown) {
      setChatError(String(error))
      return { taskId: task.id, ok: false, held: false, text: String(error) }
    } finally {
      setClaiming(false)
    }
  }

  /** 任务卡与详情上的入口沿用同一套判定；点击不等待结果，失败就地显示。 */
  const startConversation = (task: ShellTask): void => {
    void openTaskConversation(task)
  }

  /** 流程动作的展示名；不认识的字符串原样显示，不编造一个动作。 */
  const flowActionText = (action: string): string =>
    action in FLOW_ACTION_LABEL ? t(FLOW_ACTION_LABEL[action as FlowActionView]) : action

  /** 一条判定为什么没开始：优先逐条列出挡住原因，没有挡住的就写判定理由。 */
  const heldText = (decision: FlowDecisionView): string =>
    decision.blockers.length === 0
      ? decision.reason
      : decision.blockers.map(blocker => `${t(FLOW_BLOCKER_LABEL[blocker.kind])}：${blocker.detail}`).join('；')

  /** 上下文占用的人话；容量未知时只说已用，不拿猜测当分母。 */
  const contextUsageText = (pressure: ShellContextPressure | null): string => {
    if (pressure === null) return t('shell.contextUnknown')
    const used = pressure.projectedTokens ?? pressure.pressureTokens
    if (used === undefined) return t('shell.contextUnknown')
    if (pressure.contextWindow === undefined) {
      return fill(t('shell.contextUsed'), { used: formatTokens(used) })
    }
    return fill(t('shell.contextUsage'), {
      used: formatTokens(used),
      budget: formatTokens(pressure.contextWindow),
      percent: percentOf(used, pressure.contextWindow) ?? 0,
      left: formatTokens(Math.max(0, pressure.contextWindow - used)),
    })
  }

  /**
   * 把一次开工结果追加到任务证据目录。写失败只就地说明，不回滚这次开工——
   * 开工本身没有改任务状态，真正的后果只有「会话收到了哪条提示词」。
   */
  const writeFlowLog = (
    taskId: string,
    decision: FlowDecisionView,
    result: 'success' | 'failed' | 'held' | 'skipped',
    detail: string,
  ): void => {
    if (logFlow === undefined) return
    if (sessionId === undefined) {
      setFlowLogErrors(current => ({ ...current, [taskId]: t('shell.flowNoSession') }))
      return
    }
    const payload = JSON.stringify({
      action: decision.action,
      mode: decision.mode,
      reason: decision.reason,
      result,
      detail,
      blockers: decision.blockers,
    })
    void logFlow(sessionId, taskId, payload).then((outcome) => {
      setFlowLogErrors((current) => {
        const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== taskId))
        return outcome.ok ? rest : { ...rest, [taskId]: outcome.text }
      })
    }, (error: unknown) => {
      setFlowLogErrors(current => ({ ...current, [taskId]: String(error) }))
    })
  }

  /**
   * 批量开工：按流程计划的顺序逐条走现有的会话启动。
   * 一条任务失败只记在这一条上，后面的照常继续；被挡住的记成「未开始」而不是失败。
   */
  const runFlow = async (ids: readonly string[]): Promise<void> => {
    if (flow === null || flowRunning) return
    const selected = new Set(ids)
    const plans = flow.tasks.filter(plan => selected.has(plan.id))
    if (plans.length === 0) {
      setFlowError(t('shell.flowNoneSelected'))
      return
    }
    setFlowRunning(true)
    setFlowError(null)
    setFlowResults([])
    const collected: FlowRunResult[] = []

    for (const plan of plans) {
      const task = tasks.find(item => item.id === plan.id)
      if (task === undefined) {
        collected.push({ taskId: plan.id, ok: false, held: false, text: t('shell.flowTaskMissing') })
        setFlowResults([...collected])
        continue
      }
      if (!plan.startable) {
        const text = heldText(plan.decision)
        collected.push({ taskId: plan.id, ok: false, held: true, text })
        writeFlowLog(plan.id, plan.decision, 'held', text)
        setFlowResults([...collected])
        continue
      }
      const outcome = await openTaskConversation(task)
      collected.push(outcome)
      writeFlowLog(plan.id, plan.decision, outcome.ok ? 'success' : 'failed', outcome.text)
      setFlowResults([...collected])
    }

    setFlowRunning(false)
    setReload(value => value + 1)
    await refreshFlow()
    await refreshHistory()
  }

  /** 开始选中的任务；`retryOnly` 只重跑上次失败（被按住的不算失败）。 */
  const startFlow = (retryOnly = false): void => {
    if (flow === null || flowRunning) return
    const ids = retryOnly
      ? flowResults.filter(result => !result.ok && !result.held).map(result => result.taskId)
      : [...flowSelection]
    void runFlow(ids)
  }

  /** 逐条勾选开工范围；人动过之后，刷新判定不再覆盖他的选择。 */
  const toggleFlowTask = (id: string): void => {
    flowSelectionTouched.current = true
    setFlowSelection((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectStartable = (): void => {
    flowSelectionTouched.current = true
    setFlowSelection(new Set(flow?.tasks.filter(plan => plan.startable).map(plan => plan.id) ?? []))
  }

  const selectNone = (): void => {
    flowSelectionTouched.current = true
    setFlowSelection(new Set())
  }

  /** 常驻会话浮层用的空任务壳：标题就是角色名，不冒充某条任务。 */
  const pseudoChat = (title: string): ShellTask => ({
    id: '', title, state: 'drafting', grade: '-', rules: [], evidence: [], surface: '', paths: [],
  })

  /**
   * 打开常驻角色会话：配置号还在就用它，否则找同 preset 的那条，最后才新建。
   * 打开时校正标题并（需要时）把会话号写回 `.spec/agents.yaml`；重复点只聚焦。
   */
  const openSingleton = async (role: AgentRole): Promise<void> => {
    if (singletonBusy.current) return
    if (workspace === undefined || projectPath === '') {
      setChatError(t('shell.singletonNoWorkspace'))
      return
    }
    const title = t(AGENT_ROLES[role].titleKey)
    const configured = agents?.[AGENT_ROLES[role].key]
    const resolved = resolveAgentSession(role, configured, agentCandidates())

    if (resolved.kind === 'use') {
      const target = resolved.sessionId as SessionId
      if (String(sessionId) === String(target) && chat !== null && chat.title === title) return
      setSessionOverride(target)
      setDetail(null)
      setChat(pseudoChat(title))
      setChatError(null)
      if (renameSession !== undefined && titleNeedsFix(sessionRows[target]?.title, title)) {
        void renameSession(target, title).then((outcome) => {
          if (!outcome.ok) setChatError(fill(t('shell.singletonRenameFailed'), { detail: outcome.text }))
          else setReload(value => value + 1)
        }, (error: unknown) => { setChatError(String(error)) })
      }
      if (!resolved.configured && bindAgentSession !== undefined) {
        void bindAgentSession(target, role, target).then((outcome) => {
          if (outcome.ok) setReload(value => value + 1)
          else setChatError(fill(t('shell.singletonBindFailed'), { detail: outcome.text }))
        }, (error: unknown) => { setChatError(String(error)) })
      }
      return
    }

    singletonBusy.current = true
    setClaiming(true)
    setChatError(null)
    try {
      if (createSession === undefined) throw new Error(t('shell.noSession'))
      const created = await createSession(projectPath, AGENT_ROLES[role].preset)
      setSessionOverride(created)
      setDetail(null)
      setChat(pseudoChat(title))
      setSessionRoles(current => ({ ...current, [String(created)]: AGENT_ROLES[role].preset }))
      if (bindAgentSession !== undefined) {
        const bound = await bindAgentSession(created, role, created)
        if (!bound.ok) setChatError(fill(t('shell.singletonBindFailed'), { detail: bound.text }))
      }
      if (renameSession !== undefined) {
        const renamed = await renameSession(created, title)
        if (!renamed.ok) setChatError(fill(t('shell.singletonRenameFailed'), { detail: renamed.text }))
      }
      // 建会话期间列表可能重排；最后再落一次，保证第一次点开就停在角色浮层上。
      setSessionOverride(created)
      setChat(pseudoChat(title))
      setReload(value => value + 1)
    } catch (error: unknown) {
      setChatError(String(error))
    } finally {
      singletonBusy.current = false
      setClaiming(false)
    }
  }

  /** 详情弹窗头/底的会话动作文案；与 startConversation 的两种去向一致。 */
  const conversationLabel = (task: ShellTask): string =>
    claiming ? t('shell.claiming') : liveSessionOf(task) !== undefined ? t('shell.resumeChat') : t('shell.startChat')

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
   * 零任务仓库的立项入口，两档咒语走同一个会话：
   * - `new` 是「全新项目」，发 7 问引导咒语，先问项目身份与文档位置再落盘；
   * - `docs` 是「已有资料」，发立项分析咒语，让 agent 先 file_list / file_read 看仓库
   *   与已声明文档再立任务；没声明文档时咒语会要求它先问。
   * 外壳只读文件、不判断状态机。
   *
   * 两档共用一条判定：这条会话受理过提示词（会话行的 `blank` 已落、窗口里已有消息，
   * 或提示正等首个回合）就只开浮层。判据跟着会话事实走，所以关掉浮层、刷新页面、
   * 重开窗口之后再点任一按钮都不会再发一遍。
   */
  const startOnboarding = (kind: 'new' | 'docs'): void => {
    const project = { name: projectName, path: projectPath, branch: projectBranch }
    const text = kind === 'new'
      ? buildIntakePrompt(project)
      : buildOnboardingPrompt(project, info?.docs ?? { product: '', architecture: '', tests: '' })
    setDetail(null)
    setChatError(null)
    setPrompt(text)
    setCopied(false)
    setChat({ id: '', title: t('shell.onboardingChat'), state: 'drafting', grade: '-', rules: [], evidence: [], surface: '', paths: [] })
    const action = onboardingAction({
      hasSession: sessionId !== undefined && sendPrompt !== undefined,
      hasModel: !modelBlocked,
      sending: onboardingSending.current,
      blank: session?.blank,
      userMessages: sessionId === undefined
        ? 0
        : readMessages?.(sessionId).filter(message => message.role === 'user').length ?? 0,
      awaitingFirstTurn: sessionId === undefined ? undefined : readSessionFlags?.(sessionId)?.awaitingFirstTurn,
    })
    if (action.kind === 'block') {
      setChatError(t(action.reason === 'no-session' ? 'shell.noSession' : 'shell.noModels'))
      return
    }
    if (action.kind === 'open' || sessionId === undefined || sendPrompt === undefined) return
    onboardingSending.current = true
    void sendPrompt(sessionId, text).catch((error: unknown) => {
      setChatError(String(error))
    }).finally(() => {
      onboardingSending.current = false
    })
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

  /**
   * 浏览…：调桌面原生目录选择并填入输入框。
   * 桥缺失时按钮不出现；对话框失败只回退到手输，不把错误升级成阻断。
   */
  const browseRepo = async (): Promise<void> => {
    if (projectDirectory === undefined) return
    setBrowsing(true)
    setRepoError(null)
    try {
      const picked = await projectDirectory.pickProjectDirectory(repoPath.trim() || projectPath)
      if (picked !== null && picked !== '') setRepoPath(picked)
    } catch (error: unknown) {
      console.error('LCoder project directory picker failed', error)
    } finally {
      setBrowsing(false)
    }
  }

  const renderColumn = (state: (typeof SHELL_STATES)[number]): ReactNode => {
    const columnTasks = filterTasks(tasks.filter(task => task.state === state.id), filter, statusOfTask)
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
            const queueMark = status === 'queued' ? queueMarkOf(task) : undefined
            const joint = status === 'queued' ? jointOf(task) : undefined
            const peers = joint === undefined ? [] : joint.members.filter(id => id !== task.id)
            const statusLabel = status === 'queued' && joint !== undefined && peers.length > 0
              ? fill(t('shell.taskGrouped'), { session: sessionLabel(joint.sessionId), members: peers.join('、') })
              : t(TASK_STATUS[status].labelKey)
            const waitingOn = (task.dependsOn ?? []).filter(id => knownStates[id] !== 'closed')
            return (
              <button type="button" key={task.id} className={`${css.taskCard} ${runningCardClass(status) ?? ''}`} onClick={() => { openTask(task) }}>
                <div className={css.taskId}><span>{task.id}</span><span>{task.grade}</span></div>
                <div className={css.taskTitle}>{task.title}</div>
                <div className={css.tags}>
                  <span className={`${css.tag} ${TASK_STATUS[status].className ?? ''}`}>{statusLabel}</span>
                  {task.proposal === undefined ? null : <span className={css.tag}>{task.proposal}</span>}
                  {waitingOn.length === 0
                    ? null
                    : <span className={`${css.tag} ${css.tagWarn}`}>{t('shell.dependsOn')} {waitingOn.join('、')}</span>}
                  {queueMark === undefined
                    ? null
                    : <span className={`${css.tag} ${css.tagQueued}`}>{fill(t('shell.queuePosition'), { n: queueMark.position })}</span>}
                  {task.rules.map(rule => <span key={rule} className={css.tag}>{rule}</span>)}
                  <span className={`${css.tag} ${task.state === 'closed' ? css.tagOk : ''}`}>{task.surface}</span>
                  {!contracts.some(row => row.id === task.id && row.signedBy === 'human')
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

  /** 窗口按钮只在 Windows 桌面壳里出现；失败留在控制台，不改窗口状态。 */
  const runWindowCommand = (command: DesktopWindowCommand): void => {
    if (windowBridge === undefined) return
    void windowBridge.command(command).catch((error: unknown) => {
      console.error('LCoder window command failed', error)
    })
  }

  /** 顶栏空白处双击沿用系统标题栏手势；按钮与输入区不参与。 */
  const onTopbarDoubleClick = (event: MouseEvent<HTMLElement>): void => {
    if (event.target instanceof Element && event.target.closest('button, input, textarea, select, a, summary, [role="button"]') !== null) return
    runWindowCommand('toggle-maximize')
  }

  return (
    <div className={css.shell} data-theme={dark ? 'dark' : 'light'} data-chrome={windowBridge === undefined ? undefined : 'custom'}>
      <header className={css.topbar} onDoubleClick={windowBridge === undefined ? undefined : onTopbarDoubleClick}>
        <div className={css.topBrand}>
          <div className={css.topLogo}>{t('shell.brandInitial')}</div>
          <span className={css.topTitle}>{t('shell.brand')}</span>
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
              const placeholder = `${t('shell.sessions')} ${String(index + 1)}`
              const awaiting = sessionStatus.get(id)?.pendingInteraction !== undefined
              const queued = queueDepth(String(id))
              return (
                <button
                  type="button"
                  key={String(id)}
                  className={`${css.sessionChip} ${String(sessionId) === String(id) ? css.sessionChipActive : ''}`}
                  title={bound === undefined ? String(id) : `${bound.id} · ${bound.title}`}
                  onClick={() => { openSession(id, index) }}
                >
                  {awaiting ? <span className={css.sessionWaitDot} aria-hidden="true" /> : null}
                  {bound?.title ?? placeholder}
                  {queued === 0
                    ? null
                    : <span className={css.sessionQueue} title={fill(t('shell.sessionQueue'), { count: queued })}>{String(queued)}</span>}
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
        {!hasWorkspace ? null : (
          <div className={css.agentBar}>
            {(['scheduler', 'flow'] as const).map((role) => {
              const id = singletonIdOf(role)
              const running = id === undefined
                ? false
                : sessionStatus.get(id as SessionId)?.running ?? sessionRows[id as SessionId]?.running ?? false
              return (
                <button
                  type="button"
                  key={role}
                  className={`${css.agentChip} ${id !== undefined && String(sessionId) === id ? css.agentChipActive : ''}`}
                  title={t(role === 'scheduler' ? 'shell.openScheduler' : 'shell.openFlow')}
                  onClick={() => { void openSingleton(role) }}
                >
                  {running ? <span className={css.sessionWaitDot} aria-hidden="true" /> : null}
                  {t(AGENT_ROLES[role].titleKey)}
                </button>
              )
            })}
          </div>
        )}
        {!hasWorkspace ? null : (
          <button type="button" className={css.workBtn} onClick={() => { setFlowOpen(true) }}>
            {t('shell.startWork')}
          </button>
        )}
        <div className={css.spacer} />
        <button type="button" className={css.secondaryBtn} onClick={() => { setDrawer(true) }}>ⓘ {t('shell.projectInfo')}</button>
        <button type="button" className={css.iconBtn} title={t('shell.theme')} onClick={() => { setDark(value => !value) }}>◐</button>
        <button type="button" className={css.iconBtn} title={t('shell.settings')} onClick={() => { setSettings(true) }}>⚙</button>
        {windowBridge === undefined ? null : (
          <div className={css.windowControls}>
            <button
              type="button"
              className={css.windowBtn}
              title={t('shell.minimizeWindow')}
              aria-label={t('shell.minimizeWindow')}
              onClick={() => { runWindowCommand('minimize') }}
            >
              –
            </button>
            <button
              type="button"
              className={css.windowBtn}
              title={t(windowMaximized ? 'shell.restore' : 'shell.maximize')}
              aria-label={t(windowMaximized ? 'shell.restore' : 'shell.maximize')}
              onClick={() => { runWindowCommand('toggle-maximize') }}
            >
              {windowMaximized ? '❐' : '□'}
            </button>
            <button
              type="button"
              className={`${css.windowBtn} ${css.windowClose}`}
              title={t('shell.closeWindow')}
              aria-label={t('shell.closeWindow')}
              onClick={() => { runWindowCommand('close') }}
            >
              ✕
            </button>
          </div>
        )}
      </header>

      <main className={css.main}>
        <div className={css.boardWrap}>
          <div className={css.boardHead}>
            <h3>{t('shell.board')}</h3>
            <span className={css.boardHint}>{t('shell.boardHint')}</span>
            {flow === null ? null : (
              <button type="button" className={css.flowBar} onClick={() => { setFlowOpen(true) }}>
                <span className={css.flowBarLabel}>{t('shell.flowNext')}</span>
                <span className={css.flowBarAction}>
                  {flowActionText(flow.decision.action)}
                  {flow.decision.taskId === null ? '' : ` ${flow.decision.taskId}`}
                </span>
                <span className={css.flowBarReason}>{flow.decision.reason}</span>
                {flow.decision.blockers.length === 0
                  ? null
                  : <span className={css.flowBarBlocked}>{flow.decision.blockers.map(blocker => t(FLOW_BLOCKER_LABEL[blocker.kind])).join(' / ')}</span>}
              </button>
            )}
            {tasks.length === 0 ? null : (
              <button
                type="button"
                className={`${css.filterToggle} ${isFilterActive(filter) ? css.filterToggleOn : ''}`}
                onClick={() => { setFilterOpen(open => !open) }}
              >
                {t('shell.filter')}
                {isFilterActive(filter) ? <span className={css.filterCount}>{String(visibleTasks.length)}</span> : null}
              </button>
            )}
          </div>
          {filterOpen && tasks.length > 0 ? (
            <div className={css.filterPanel}>
              <span className={css.filterLabel}>{t('shell.filterGrade')}</span>
              {TASK_GRADE_CHOICES.map(grade => (
                <button
                  type="button"
                  key={grade}
                  className={`${css.filterChip} ${filter.grades.includes(grade) ? css.filterChipActive : ''}`}
                  onClick={() => {
                    setFilter(current => ({
                      ...current,
                      grades: current.grades.includes(grade)
                        ? current.grades.filter(item => item !== grade)
                        : [...current.grades, grade],
                    }))
                  }}
                >
                  {grade}
                </button>
              ))}
              <span className={css.filterLabel}>{t('shell.filterSession')}</span>
              {SESSION_FILTER_CHOICES.map(choice => (
                <button
                  type="button"
                  key={choice}
                  className={`${css.filterChip} ${filter.session === choice ? css.filterChipActive : ''}`}
                  onClick={() => { setFilter(current => ({ ...current, session: choice })) }}
                >
                  {t(SESSION_FILTER_LABELS[choice])}
                </button>
              ))}
              <input
                className={css.filterSearch}
                type="search"
                value={filter.text}
                placeholder={t('shell.filterSearch')}
                onChange={(event): void => { setFilter(current => ({ ...current, text: event.target.value })) }}
              />
              {isFilterActive(filter)
                ? <button type="button" className={css.filterClear} onClick={() => { setFilter(EMPTY_TASK_FILTER) }}>{t('shell.filterClear')}</button>
                : null}
            </div>
          ) : null}
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
                    {isFilterActive(filter) && visibleTasks.length === 0
                      ? <p className={css.filterEmpty}>{t('shell.filterEmpty')}</p>
                      : null}
                    {tasks.length === 0 ? (
                      <div className={css.onboardingBar}>
                        <button
                          type="button"
                          className={css.secondaryBtn}
                          disabled={modelBlocked}
                          title={modelBlocked ? t('shell.noModels') : undefined}
                          onClick={() => { startOnboarding('docs') }}
                        >
                          {t('shell.onboardingExistingDocs')}
                        </button>
                        <button
                          type="button"
                          className={css.primaryBtn}
                          disabled={modelBlocked}
                          title={modelBlocked ? t('shell.noModels') : undefined}
                          onClick={() => { startOnboarding('new') }}
                        >
                          {t('shell.onboardingNewProject')}
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
                {projectDirectory === undefined ? null : (
                  <button
                    type="button"
                    className={css.secondaryBtn}
                    disabled={opening || browsing}
                    onClick={() => { void browseRepo() }}
                  >
                    {t('shell.browse')}
                  </button>
                )}
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

      {flowOpen ? (
        <div className={css.modalBackdrop} onClick={(event) => { if (event.target === event.currentTarget) setFlowOpen(false) }}>
          <div className={`${css.modal} ${css.flowModal}`}>
            <div className={css.modalHead}>
              <div className={css.grow}>
                <h3>{t('shell.startWork')} · {t('shell.flowPanel')}</h3>
                <p>{t('shell.flowHint')}</p>
              </div>
              <button
                type="button"
                className={css.secondaryBtn}
                disabled={flowLoading || flowRunning}
                onClick={() => { void refreshFlow() }}
              >
                {flowLoading ? t('shell.loading') : t('shell.flowRefresh')}
              </button>
              <button type="button" className={css.iconBtn} onClick={() => { setFlowOpen(false) }}>✕</button>
            </div>
            <div className={css.modalBody}>
              {flowError === null ? null : <p className={css.problem}>{flowError}</p>}

              <section className={css.flowSection}>
                <h4>{t('shell.flowPolicy')}</h4>
                <p className={css.secretRef}>
                  {flow === null
                    ? '—'
                    : flow.policy.source === 'default'
                      ? t('shell.flowPolicyDefault')
                      : `${t('shell.flowPolicyFile')} · ${flow.policy.path}`}
                </p>
                {flow === null ? null : (
                  <>
                    <div className={css.flowChips}>
                      {Object.entries(flow.policy.actions).map(([name, mode]) => (
                        <span key={name} className={`${css.tag} ${mode === 'auto' ? css.tagWarn : ''}`}>
                          {flowActionText(name)} · {t(FLOW_MODE_LABEL[mode])}
                        </span>
                      ))}
                    </div>
                    <div className={css.flowChips}>
                      <span className={css.tag}>
                        {t('shell.flowPolicyTasks')}：{flow.policy.tasks.length === 0 ? t('shell.flowPolicyAllTasks') : flow.policy.tasks.join('、')}
                      </span>
                      {flow.policy.source === 'file' && flow.policy.hash !== null ? (
                        <span className={css.tag} title={flow.policy.hash}>{t('shell.flowPolicyHash')}：{flow.policy.hash.slice(0, 19)}…</span>
                      ) : null}
                      {flow.policy.at === null ? null : <span className={css.tag}>{t('shell.flowPolicyAt')}：{flow.policy.at}</span>}
                    </div>
                    <div className={css.flowChips}>
                      {[
                        { key: 'shell.flowLimitTokens', value: flow.policy.limits.tokenBudget },
                        { key: 'shell.flowLimitMinutes', value: flow.policy.limits.maxMinutes },
                        { key: 'shell.flowLimitFailures', value: flow.policy.limits.maxConsecutiveFailures },
                        { key: 'shell.flowLimitParallel', value: flow.policy.limits.maxParallel },
                      ].filter(entry => entry.value !== null).map(entry => (
                        <span key={entry.key} className={css.tag}>{t(entry.key as LcoderWorkspaceKey)}：{String(entry.value)}</span>
                      ))}
                      {flow.policy.limits.tokenBudget === null
                        && flow.policy.limits.maxMinutes === null
                        && flow.policy.limits.maxConsecutiveFailures === null
                        && flow.policy.limits.maxParallel === null
                        ? <span className={css.tag}>{t('shell.flowLimitNone')}</span>
                        : null}
                    </div>
                  </>
                )}
              </section>

              <section className={css.flowSection}>
                <h4>{t('shell.flowNext')}</h4>
                {flow === null ? <p className={css.empty}>—</p> : (
                  <>
                    <div className={css.flowDecision}>
                      <span className={css.flowAction}>{flowActionText(flow.decision.action)}</span>
                      {flow.decision.taskId === null ? <span className={css.secretRef}>{t('shell.flowNoTask')}</span> : <code>{flow.decision.taskId}</code>}
                      <span className={css.tag}>{t(FLOW_MODE_LABEL[flow.decision.mode])}</span>
                      {flow.decision.action === 'sign' && flow.decision.mode === 'auto'
                        ? <span className={`${css.tag} ${css.tagWarn}`}>{t('shell.flowAutoSign')}</span>
                        : null}
                      {flow.decision.action === 'external'
                        ? <span className={`${css.tag} ${css.tagDanger}`}>{t('shell.flowExternal')}</span>
                        : null}
                    </div>
                    <p className={css.flowReason}>{flow.decision.reason}</p>
                    {flow.decision.blockers.length === 0 ? null : (
                      <div className={css.flowBlockers}>
                        <span className={css.scheduleLabel}>{t('shell.flowBlockers')}</span>
                        {flow.decision.blockers.map(blocker => (
                          <div key={`${blocker.kind}-${blocker.detail}`} className={css.flowBlocker}>
                            <span className={`${css.tag} ${css.tagWarn}`}>{t(FLOW_BLOCKER_LABEL[blocker.kind])}</span>
                            <span>{blocker.detail}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>

              <section className={css.flowSection}>
                <h4>{t('shell.flowAttention')}</h4>
                {attentionPlans.length === 0 && attentionHistory.length === 0
                  ? <p className={css.empty}>{t('shell.flowAttentionEmpty')}</p>
                  : (
                    <div className={css.flowAttentionList}>
                      {attentionPlans.map(plan => (
                        <div key={plan.id} className={css.flowAttentionRow}>
                          <code>{plan.id}</code>
                          <span className={`${css.tag} ${css.tagWarn}`}>
                            {plan.decision.action === 'external' ? t('shell.flowExternal') : t('shell.flowAutoSign')}
                          </span>
                          <span>{plan.decision.reason}</span>
                        </div>
                      ))}
                      {attentionHistory.length === 0 ? null : (
                        <span className={css.scheduleLabel}>{t('shell.flowAttentionLog')}</span>
                      )}
                      {attentionHistory.map((entry, index) => (
                        <div key={`attention-${entry.taskId}-${String(index)}`} className={css.flowHistoryRow}>
                          <span className={css.flowHistoryTime}>{entry.at ?? '—'}</span>
                          <code>{entry.taskId}</code>
                          <span className={`${css.tag} ${entry.action === 'external' ? css.tagDanger : css.tagWarn}`}>
                            {entry.action === 'external' ? t('shell.flowExternal') : t('shell.flowAutoSign')}
                          </span>
                          {entry.result === undefined ? null : <span className={css.secretRef}>{entry.result}</span>}
                          {entry.reason === undefined ? null : <span className={css.flowTaskReason}>{entry.reason}</span>}
                        </div>
                      ))}
                    </div>
                  )}
              </section>

              <section className={css.flowSection}>
                <h4>{t('shell.flowTasks')}</h4>
                {flow === null || flow.tasks.length === 0 ? <p className={css.empty}>{t('shell.flowNoTasks')}</p> : (
                  <>
                    <div className={css.flowToolbar}>
                      <button type="button" className={css.filterChip} onClick={selectStartable}>{t('shell.flowSelectAll')}</button>
                      <button type="button" className={css.filterChip} onClick={selectNone}>{t('shell.flowSelectNone')}</button>
                      <span className={css.secretRef}>
                        {flowSelection.size === 0 ? t('shell.flowNoneSelected') : fill(t('shell.flowSelected'), { count: flowSelection.size })}
                      </span>
                    </div>
                    <div className={css.flowTaskList}>
                      {flow.tasks.map(plan => (
                        <label key={plan.id} className={`${css.flowTaskRow} ${plan.startable ? '' : css.flowTaskRowHeld}`}>
                          <input
                            type="checkbox"
                            checked={flowSelection.has(plan.id)}
                            disabled={flowRunning}
                            onChange={() => { toggleFlowTask(plan.id) }}
                          />
                          <code className={css.flowTaskId}>{plan.id}</code>
                          <span className={css.flowTaskAction}>{flowActionText(plan.decision.action)}</span>
                          <span className={`${css.tag} ${plan.startable ? css.tagOk : css.tagWarn}`}>
                            {plan.startable ? t('shell.flowTaskStartable') : t('shell.flowTaskHeld')}
                          </span>
                          <span className={css.flowTaskReason}>{plan.decision.reason}</span>
                          {plan.decision.blockers.length === 0 ? null : (
                            <span className={css.flowTaskReason}>{plan.decision.blockers.map(blocker => `${t(FLOW_BLOCKER_LABEL[blocker.kind])}：${blocker.detail}`).join('；')}</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </section>

              {flowResults.length === 0 ? null : (
                <section className={css.flowSection}>
                  <h4>{t('shell.flowResults')}</h4>
                  <div className={css.flowAttentionList}>
                    {flowResults.map(result => (
                      <div key={result.taskId} className={css.flowAttentionRow}>
                        <code>{result.taskId}</code>
                        <span className={`${css.tag} ${result.held ? css.tagWarn : result.ok ? css.tagOk : css.tagDanger}`}>
                          {result.held ? t('shell.flowResultHeld') : result.ok ? t('shell.flowResultOk') : t('shell.flowResultFailed')}
                        </span>
                        <span>{result.text}</span>
                        {flowLogErrors[result.taskId] === undefined
                          ? null
                          : <span className={css.problem}>{fill(t('shell.flowLogFailed'), { detail: flowLogErrors[result.taskId] ?? '' })}</span>}
                      </div>
                    ))}
                  </div>
                  {flowResults.some(result => !result.ok && !result.held) ? (
                    <button type="button" className={css.secondaryBtn} disabled={flowRunning} onClick={() => { startFlow(true) }}>
                      {t('shell.flowRetry')}
                    </button>
                  ) : null}
                </section>
              )}

              <section className={css.flowSection}>
                <h4>{t('shell.flowHistory')}</h4>
                {normalHistory.length === 0 ? <p className={css.empty}>{t('shell.flowHistoryEmpty')}</p> : (
                  <div className={css.flowHistory}>
                    {normalHistory.map((entry, index) => (
                      <div key={`${entry.taskId}-${entry.source}-${String(index)}`} className={css.flowHistoryRow}>
                        <span className={css.flowHistoryTime}>{entry.at ?? '—'}</span>
                        <span className={css.tag}>
                          {entry.source === 'flow' ? t('shell.flowHistorySourceFlow') : t('shell.flowHistorySourceSchedule')}
                        </span>
                        <code>{entry.taskId}</code>
                        <span>{entry.action !== undefined ? flowActionText(entry.action) : entry.verdict ?? ''}</span>
                        {entry.mode === 'auto' && entry.action === 'sign'
                          ? <span className={`${css.tag} ${css.tagWarn}`}>{t('shell.flowAutoSign')}</span>
                          : null}
                        {entry.action === 'external'
                          ? <span className={`${css.tag} ${css.tagDanger}`}>{t('shell.flowExternal')}</span>
                          : null}
                        {entry.result === undefined ? null : <span className={css.secretRef}>{entry.result}</span>}
                        {entry.reason === undefined ? null : <span className={css.flowTaskReason}>{entry.reason}</span>}
                        {entry.detail === undefined ? null : <span className={css.flowTaskReason}>{entry.detail}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {flowHistoryProblems.length === 0 ? null : (
                  <div className={css.problems}>
                    {flowHistoryProblems.map(problem => <p key={problem} className={css.problem}>{problem}</p>)}
                  </div>
                )}
              </section>
            </div>
            <div className={css.modalFoot}>
              <span className={css.boardHint}>{t('shell.flowStateHint')}</span>
              <div className={css.spacer} />
              <button type="button" className={css.secondaryBtn} onClick={() => { setFlowOpen(false) }}>{t('shell.done')}</button>
              <button
                type="button"
                className={css.primaryBtn}
                disabled={flowRunning || flow === null || flowSelection.size === 0}
                onClick={() => { startFlow() }}
              >
                {flowRunning ? t('shell.flowRunning') : t('shell.flowStart')}
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
              <button
                type="button"
                className={`${css.secondaryBtn} ${css.headAction}`}
                disabled={modelBlocked || claiming}
                title={modelBlocked ? t('shell.noModels') : undefined}
                onClick={() => { startConversation(detail) }}
              >
                {conversationLabel(detail)}
              </button>
              <button type="button" className={css.iconBtn} onClick={() => { setDetail(null) }}>✕</button>
            </div>
            <div className={css.modalBody}>
              <div className={css.metaGrid}>
                <div className={css.meta}><div className={css.metaK}>{t('shell.grade')}</div><div className={css.metaV}>{detail.grade}</div></div>
                <div className={css.meta}><div className={css.metaK}>{t('shell.rules')}</div><div className={css.metaV}>{detail.rules.join(', ') || '—'}</div></div>
                {detail.dependsOn === undefined
                  ? null
                  : <div className={css.meta}><div className={css.metaK}>{t('shell.dependsOn')}</div><div className={css.metaV}>{detail.dependsOn.join('、')}</div></div>}
                {detailSchedule?.queue === undefined
                  ? null
                  : (
                    <div className={css.meta}>
                      <div className={css.metaK}>{t('shell.queuedIn')}</div>
                      <div className={css.metaV}>
                        {sessionLabel(detailSchedule.queue.sessionId)}
                        {' · '}
                        {fill(t('shell.queuePosition'), { n: detailSchedule.queue.position })}
                      </div>
                    </div>
                  )}
                {detailJoint === undefined
                  ? null
                  : (
                    <div className={css.meta}>
                      <div className={css.metaK}>{t('shell.jointGroup')}</div>
                      <div className={css.metaV}>
                        {t('shell.jointMembers')}：{detailJoint.members.join('、')}
                        {' · '}
                        {t('shell.jointAcceptance')}
                        {detailJoint.createdAt === undefined
                          ? ''
                          : ` · ${fill(t('shell.jointCreatedAt'), { at: detailJoint.createdAt })}`}
                      </div>
                    </div>
                  )}
                <div className={css.meta}><div className={css.metaK}>{t('shell.evidence')}</div><div className={css.metaV}>{detail.evidence.join(', ') || '—'}</div></div>
                <div className={css.meta}><div className={css.metaK}>{t('shell.surface')}</div><div className={css.metaV}>{detail.surface}</div></div>
              </div>
              <details className={css.schedule}>
                <summary>{t('shell.schedule')}</summary>
                <p className={css.scheduleHint}>{t('shell.scheduleHint')}</p>
                {detailSchedule === undefined ? <p className={css.empty}>{t('shell.scheduleEmpty')}</p> : (
                  <>
                    <ol className={css.scheduleReasons}>
                      {detailSchedule.decision.reasons.map(reason => <li key={reason}>{humanizeSessions(reason)}</li>)}
                      {detailSchedule.decision.joint === undefined
                        ? null
                        : (
                          <li key="joint">
                            {fill(t('shell.scheduleJoint'), { members: detailSchedule.decision.joint.members.join('、') })}
                          </li>
                        )}
                    </ol>
                    <span className={css.scheduleLabel}>{t('shell.scheduleCandidates')}</span>
                    {detailSchedule.decision.candidates.length === 0
                      ? <p className={css.empty}>{t('shell.scheduleNone')}</p>
                      : (
                        <div className={css.scheduleList}>
                          {detailSchedule.decision.candidates.map(candidate => (
                            <div key={candidate.sessionId} className={css.scheduleCandidate} data-rejected={candidate.rejected === undefined ? undefined : 'true'}>
                              <div className={css.scheduleHead}>
                                <span className={css.scheduleSession}>{schedulingLabel(candidate.sessionId)}</span>
                                <span className={css.scheduleScore}>{fill(t('shell.scheduleScore'), { score: candidate.score })}</span>
                                {candidate.rejected === undefined
                                  ? null
                                  : <span className={`${css.tag} ${css.tagDanger}`}>{t('shell.scheduleRejected')}</span>}
                              </div>
                              {candidate.signals.length === 0
                                ? null
                                : <div className={css.scheduleSignals}>{t('shell.scheduleSignals')}：{candidate.signals.join('；')}</div>}
                              {candidate.rejected === undefined
                                ? null
                                : <div className={css.scheduleRejectedText}>{candidate.rejected}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                  </>
                )}
                {detailSchedule === undefined || scheduleErrors[detail.id] === undefined
                  ? null
                  : <p className={css.problem}>{fill(t('shell.scheduleLogFailed'), { detail: scheduleErrors[detail.id] ?? '' })}</p>}
              </details>
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
              {detail.proposal === undefined ? null : (
                <div className={css.field}>
                  <label>{t('shell.proposal')} <span className={css.labelHint}>{detail.proposal}</span></label>
                  {detailProposal === undefined ? (
                    <p className={css.problem}>{t('shell.proposalMissing')}</p>
                  ) : (
                    <>
                      <div className={css.meta}>
                        <div className={css.metaK}>{t('shell.proposalProblem')}</div>
                        <div className={css.metaV}>{detailProposal.problem}</div>
                        <div className={css.metaK}>{t('shell.proposalOptions')}</div>
                        <div className={css.metaV}>
                          {detailProposal.options.map(option => `${option.name}：${option.summary}（${option.cost}）`).join('；')}
                        </div>
                        <div className={css.metaK}>{t('shell.proposalRecommendation')}</div>
                        <div className={css.metaV}>{detailProposal.recommendation}</div>
                      </div>
                      <p className={css.secretRef}>
                        {t(PROPOSAL_DECISION[detailProposal.decision])}
                        {detailProposal.decidedAt === null ? '' : ` ${detailProposal.decidedAt}`}
                      </p>
                      {detailProposal.decision === 'draft' && approveProposal !== undefined && hasSession ? (
                        <button type="button" className={css.primaryBtn} disabled={approving} onClick={() => { void approveSelected() }}>
                          {approving ? t('shell.approving') : t('shell.approveProposal')}
                        </button>
                      ) : null}
                      {approveResult === null ? null : (
                        <p className={approveResult.ok ? css.secretRef : css.problem}>{approveResult.text}</p>
                      )}
                    </>
                  )}
                </div>
              )}
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
                {conversationLabel(detail)}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {chat !== null ? (
        <div className={css.floating} data-max={chatMax ? 'true' : undefined}>
          <div className={css.floatingBackdrop} onClick={() => { setChatMax(false); setChat(null) }} />
          <div className={css.floatingInner} style={chatStyle}>
            <div className={css.chatWindow} data-max={chatMax ? 'true' : undefined}>
              <div className={css.chatHead}>
                <div className={css.grow}>
                  <h4>{chat.id === '' ? chat.title : `${chat.id} · ${chat.title}`}</h4>
                  <p>{t('shell.brand')} · {t(STATE_LABEL[chat.state])} · {t('shell.chatHint')}</p>
                  <p className={css.chatContext}>{contextUsageText(chatPressure)}</p>
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
                  onKeyDown={(event) => {
                    // 中文输入法用 Enter 选词：合成期间的 Enter 属于输入法，不能当成发送。
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                    event.preventDefault()
                    void sendDraft()
                  }}
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
                <div className={css.settingRow}><div className={css.settingLabel}><span className={css.settingLabelB}>{t('shell.theme')}</span><span className={css.settingLabelSpan}>{t('shell.themeHint')}</span></div><button type="button" className={`${css.switch} ${dark ? css.switchOn : ''}`} onClick={() => { setDark(value => !value) }} /></div>
                <div className={css.settingRow}>
                  <div className={css.settingLabel}>
                    <span className={css.settingLabelB}>{t('shell.font')}</span>
                    <span className={css.settingLabelSpan}>{t('shell.fontHint')}</span>
                  </div>
                  <div className={css.fontPresets} role="group" aria-label={t('shell.font')}>
                    <button
                      type="button"
                      className={`${css.fontOption} ${fontPreset === 'system' ? css.fontOptionOn : ''}`}
                      aria-pressed={fontPreset === 'system'}
                      onClick={() => { setFontPreset('system') }}
                    >
                      {t('shell.fontSampleA')} {t('shell.fontSystem')}
                    </button>
                    <button
                      type="button"
                      className={`${css.fontOption} ${fontPreset === 'modern' ? css.fontOptionOn : ''}`}
                      aria-pressed={fontPreset === 'modern'}
                      onClick={() => { setFontPreset('modern') }}
                    >
                      {t('shell.fontSampleB')} {t('shell.fontModern')}
                    </button>
                  </div>
                </div>
                <div className={css.settingRow}>
                  <div className={css.settingLabel}>
                    <span className={css.settingLabelB}>{t('shell.experts')}</span>
                    <span className={css.settingLabelSpan}>{t('shell.expertsHint')}</span>
                  </div>
                  <button type="button" className={css.filterChip} onClick={toggleExperts}>
                    {expertsOpen ? t('shell.expertsCollapse') : t('shell.expertsOpen')}
                  </button>
                </div>
                {expertsOpen ? (
                  <div className={css.expertList}>
                    {experts.length === 0
                      ? <p className={css.secretRef}>{t('shell.expertsEmpty')}</p>
                      : experts.map((expert) => {
                        const prompt = expertPrompts[expert.id]
                        return (
                          <div key={expert.id} className={css.expertItem}>
                            <button type="button" className={css.expertHead} onClick={() => { toggleExpert(expert.id) }}>
                              <span className={css.expertName}>{expert.name}</span>
                              <span className={css.expertId}>{expert.id}</span>
                              {expert.broken === undefined ? null
                                : <span className={`${css.tag} ${css.tagDanger}`}>{t('shell.expertBroken')}</span>}
                            </button>
                            {expert.description === undefined ? null : <p className={css.expertDesc}>{expert.description}</p>}
                            {expert.broken === undefined ? null : <p className={css.problem}>{expert.broken}</p>}
                            {shownExpert !== expert.id ? null : prompt === undefined
                              ? <p className={css.secretRef}>{t('shell.expertLoading')}</p>
                              : prompt === null
                                ? <p className={css.problem}>{t('shell.expertReadFailed')}</p>
                                : (
                                  <>
                                    <p className={css.expertPrompt}>{prompt.prompt ?? t('shell.expertNoPersona')}</p>
                                    <details className={css.expertDoc}>
                                      <summary>{t('shell.expertDocument')}</summary>
                                      <pre className={css.expertDocBody}>{prompt.document}</pre>
                                    </details>
                                  </>
                                )}
                          </div>
                        )
                      })}
                  </div>
                ) : null}
                <div className={css.settingRow}><div className={css.settingLabel}><span className={css.settingLabelB}>{t('shell.plugins')}</span><span className={css.settingLabelSpan}>{t('shell.onlySettings')}</span></div><span className={css.pill}>{t('shell.hidden')}</span></div>
              </div>
            </div>
            <div className={css.modalFoot}><div className={css.spacer} /><button type="button" className={css.primaryBtn} onClick={() => { setSettings(false) }}>{t('shell.done')}</button></div>
          </div>
        </div>
      ) : null}

      <div className={css.demoBadge}>{t('shell.brand')} · {t('shell.realData')}</div>
    </div>
  )
}
