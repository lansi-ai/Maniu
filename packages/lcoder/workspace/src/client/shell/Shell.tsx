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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PromptContentPart } from '@deepseek-ai/dsh-api-session-controller/types'
// Type-only: pulls the `agentPreset` Session projection value into this program.
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import {
  loadAgentsRegistry, loadLocalSecrets, loadProjectInfo, loadRolesRegistry, loadWorkspaceProjection,
} from '../projection.ts'
import type {
  AgentsRow, ContractRow, JobRoleRow, ProjectionFilesRemote, ProposalRow, RequirementDocRow, RuleRow,
  SchedulingGroupRow, TaskRow,
} from '../projection.ts'
import { parseFlowStatus } from '../flow-status.ts'
import type {
  FlowActionView, FlowBlockerKindView, FlowDecisionView, FlowStatusView,
} from '../flow-status.ts'
import { loadActionLog } from '../flow-history.ts'
import type { ActionLogEntry } from '../flow-history.ts'
import { dashboardStatusOf, loadDashboardEvents, summarizeDashboard } from '../dashboard.ts'
import type { DashboardSessionRow } from '../dashboard.ts'
import { AgentDashboardPage } from './AgentDashboardPage.tsx'
import type { DashboardGraphInput } from './dashboard-graph.ts'
import {
  AGENT_ROLES, liveAgentSession, resolveAgentSession, titleNeedsFix,
} from '../singleton.ts'
import type { AgentRole, AgentSessionCandidate } from '../singleton.ts'
import { decideScheduling, effectiveSessionRole } from '../scheduling.ts'
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
import { intakeArtifactsOf, intakeTierOfMessages, PROPOSAL_DECISION, runIntakeRestart, latestProposal } from './intake.ts'
import type { IntakeTier } from './intake.ts'
import {
  defaultIntakeModel, INTAKE_CONFIRM_COMMAND, INTAKE_MORE_DISCUSSION, INTAKE_RETRY_COMMAND, intakeConfirmed,
  intakeModelOptions, intakePromptStarted, intakeResultView, intakeWizardOutput, intakeWizardPhase,
} from './intake-wizard.ts'
import type { IntakeModelOption } from './intake-wizard.ts'
import { useIntakeRunActive } from './intake-run.ts'
import { IntakeWizard } from './IntakeWizard.tsx'
import type { IntakeModelState } from './IntakeWizard.tsx'
import { IntakeResultPage, IntakeRestartDialog } from './IntakeResultPage.tsx'
import { CloudAccountButton, CloudDialog, CloudLoginScreen } from '../cloud/CloudAccount.tsx'
import { PersonalCenter } from '../cloud/PersonalCenter.tsx'
import { gateEntry } from '../cloud/gate.ts'
import { cloudErrorKey, cloudNextKey } from '../cloud/errors.ts'
import type { CloudGateEntry } from '../cloud/gate.ts'
import type { CloudFace } from '../cloud/face.ts'
import { useCloudSession } from '../cloud/use-cloud.ts'
import { CLOUD_LEGACY_GUEST_ROUTE } from '../cloud/routes.ts'
import { buildIntakePrompt, buildOnboardingPrompt, buildShellPrompt, SHELL_STATES } from './shell-data.ts'
import { browserSkinStorage, readSkin, SKINS, writeSkin } from './skin.ts'
import type { Skin } from './skin.ts'
import { recommendedRoleId } from './role-hint.ts'
import { ChatTranscript, PendingInteractionCard } from './ChatPanel.tsx'
import { intakeAnswersOf, intakeSummaryOf, isRequirementTask } from './requirement.ts'
import type { RequirementAnswer } from './requirement.ts'
import {
  existingSplitTasks, runRequirementSplit,
} from './requirement-split.ts'
import type {
  RequirementSplitFailure, RequirementSplitFailureReason, RequirementSplitSummary,
} from './requirement-split.ts'
import { RequirementCard } from './RequirementCard.tsx'
import type { RequirementSplitFlowView } from './RequirementCard.tsx'
import { questionOf } from './pending.ts'
import { ChatAttachButton, ChatAttachmentList, ChatModelChip } from './ChatExtras.tsx'
import { TaskAttachments } from './TaskAttachments.tsx'
import type { TaskAttachmentReader } from './TaskAttachments.tsx'
import {
  attachmentsReady, buildPromptContent, checkImageCandidate, currentChatModel, formatBytes,
  promptFailureOf, promptIsEmpty, resolveImageLimits, uploadedFile,
} from './chat-composer.ts'
import type {
  ChatImageRejection, ChatModelChoice, ChatPendingAttachment, ChatPendingImage, ChatPendingFile,
  ChatUploadResult,
} from './chat-composer.ts'
import { ModelSettings } from './ModelSettings.tsx'
import type { ModelSettingsFace, ModelSettingsSnapshot } from './model-settings.ts'
import { desktopWindowBridge } from './window-chrome.ts'
import type { DesktopWindowCommand, DesktopWindowState } from './window-chrome.ts'
import { useBoardRefresh } from './board-refresh.ts'
import { useWindowDrag } from './window-drag.ts'
import { runningCardClass } from './task-card-visual.ts'
import { projectDirectoryPicker } from './project-directory.ts'
import type {
  ShellContextPressure, ShellMessage, ShellProjectInfo, ShellRole, ShellSignResult, ShellTask, ShellTaskState,
} from './shell-data.ts'
import { BUILTIN_ROLE_IDS } from './shell-data.ts'
import bullMark from '../assets/bull-mark.png'
import css from './Shell.module.css'

/** `main` 键控面板的组合 props：运行时标准 seat + 本包词典 + 文件投影面。 */
export type ShellProps =
  & PropsRuntime<'main', 'lcoder-home'>
  & PropsLocale<'lcoderWorkspace'>
  & {
    /** 文件投影面；没有时外壳保持空态。 */
    readonly files?: ProjectionFilesRemote
    /** 按 `.spec` 相对路径读图片附件；读不到由返回值表达，外壳画占位。 */
    readonly readAttachment?: TaskAttachmentReader
    /** 把仓库路径注册成工作区并建一个会话；返回可用于读取 `.spec` 的会话。 */
    readonly openRepository?: (path: string) => Promise<{ workspaceId: string; sessionId: SessionId }>
    /** 向真实会话发送文本或带附件的提示；失败抛出带 code 与 reason 的错误。 */
    readonly sendPrompt?: (sessionId: SessionId, content: string | readonly PromptContentPart[]) => Promise<void>
    /** 上传一支文件并拿回执；失败保留宿主原话。 */
    readonly uploadAttachment?: (sessionId: SessionId, data: string, name: string) => Promise<ChatUploadResult>
    /** 读宿主目录的默认模型；读不到时 chip 只显示占位。 */
    readonly readDefaultModel?: () => Promise<ChatModelChoice | null>
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
    /** 派 `/task_assign <编号> <岗位>` 把任务分配给岗位；分配是调度硬约束，只有人机命令写。 */
    readonly assignTask?: (sessionId: SessionId, taskId: string, roleId: string) => Promise<ShellSignResult>
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
    /** 云端登录面；缺省时登录页显示「云端未装配」。 */
    readonly cloud?: CloudFace
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

/** 详情里的会话动作按任务阶段取名；行为仍是打开该任务会话。 */
const STATE_ACTION_LABEL: Record<ShellTaskState, LcoderWorkspaceKey> = {
  drafting: 'shell.confirmRequirement',
  contracted: 'shell.startDevelopment',
  implementing: 'shell.submitAcceptance',
  verifying: 'shell.completeAcceptance',
  closed: 'shell.viewRecord',
}

/** 领域分类到词典键；schema 之外的取值按原样显示。 */
const CATEGORY_LABEL: Readonly<Record<string, LcoderWorkspaceKey>> = {
  page: 'shell.categoryPage',
  api: 'shell.categoryApi',
  data: 'shell.categoryData',
  other: 'shell.categoryOther',
}

/** 变更类型到词典键；schema 之外的取值按原样显示。 */
const CHANGE_TYPE_LABEL: Readonly<Record<string, LcoderWorkspaceKey>> = {
  bug: 'shell.changeBug',
  feature: 'shell.changeFeature',
  improvement: 'shell.changeImprovement',
  style: 'shell.changeStyle',
}

/** 分级 A/B/C 到难度展示名；其它取值原样显示。 */
const DIFFICULTY_LABEL: Readonly<Record<string, LcoderWorkspaceKey>> = {
  A: 'shell.difficultyHigh',
  B: 'shell.difficultyMedium',
  C: 'shell.difficultyLow',
}

/**
 * 取一个受控取值的展示名。
 * @param labels - 取值到词典键的映射。
 * @param value - 任务上的原始取值。
 * @param t - 词典函数。
 * @returns 映射后的文案；映射里没有时原样返回。
 */
function mappedLabel(
  labels: Readonly<Record<string, LcoderWorkspaceKey>>,
  value: string,
  t: (key: LcoderWorkspaceKey) => string,
): string {
  const key = labels[value]
  return key === undefined ? value : t(key)
}

/** 门禁入口到既有按钮文案的映射；登录提示里用同一句话。 */
const CLOUD_ENTRY_LABEL: Record<CloudGateEntry, LcoderWorkspaceKey> = {
  onboarding: 'shell.onboardingExistingDocs',
  onboardingFollowup: 'shell.chatHint',
  newSession: 'shell.newSession',
  agentSession: 'shell.openScheduler',
  taskConversation: 'shell.startChat',
  contractSign: 'shell.sign',
  proposalApprove: 'shell.approveProposal',
  flowBatch: 'shell.startWork',
  modelSettings: 'shell.modelServices',
}

/** 状态到色点的映射（CSS Modules 的类名在模块加载时确定）。 */
const STATE_DOT: Record<ShellTaskState, string | undefined> = {
  drafting: css.stateDrafting,
  contracted: css.stateContracted,
  implementing: css.stateImplementing,
  verifying: css.stateVerifying,
  closed: css.stateClosed,
}

/** 皮肤到词典键；设置页与顶栏按钮共用这一份。 */
const SKIN_LABEL: Record<Skin, LcoderWorkspaceKey> = {
  neon: 'shell.skinNeon',
  silver: 'shell.skinSilver',
  frost: 'shell.skinFrost',
  rose: 'shell.skinRose',
}

/** 皮肤到下一套的映射；顶栏色球按这个顺序循环。 */
const NEXT_SKIN: Record<Skin, Skin> = {
  neon: 'silver',
  silver: 'frost',
  frost: 'rose',
  rose: 'neon',
}

/** 皮肤到顶栏色球的配色。 */
const SKIN_ORB: Record<Skin, string | undefined> = {
  neon: css.skinOrbNeon,
  silver: css.skinOrbSilver,
  frost: css.skinOrbFrost,
  rose: css.skinOrbRose,
}

/** 皮肤到设置页色块的配色。 */
const SKIN_SWATCH: Record<Skin, string | undefined> = {
  neon: css.skinSwatchNeon,
  silver: css.skinSwatchSilver,
  frost: css.skinSwatchFrost,
  rose: css.skinSwatchRose,
}

/** 状态到工具面的展示文案；与 kernel 的 SURFACE 同义。 */
const SURFACE: Record<ShellTaskState, string> = {
  drafting: '读 / 契约',
  contracted: '读 / 契约 / 编辑',
  implementing: '全量',
  verifying: '全量 + 收口',
  closed: '只读',
}

/** 工具面展示文案的词典键；启动咒语仍用 `SURFACE` 的中文原文。 */
const SURFACE_LABEL: Record<ShellTaskState, LcoderWorkspaceKey> = {
  drafting: 'shell.surfaceReadContract',
  contracted: 'shell.surfaceReadContractEdit',
  implementing: 'shell.surfaceFull',
  verifying: 'shell.surfaceFullClose',
  closed: 'shell.surfaceReadonly',
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

/** 拆分失败原因到词典键；具体阶段与宿主原文由 `{stage}` / `{detail}` 填。 */
const SPLIT_FAILURE_KEY: Record<RequirementSplitFailureReason, LcoderWorkspaceKey> = {
  'no-document': 'shell.splitFailNoDocument',
  create: 'shell.splitFailCreate',
  send: 'shell.splitFailSend',
  timeout: 'shell.splitFailTimeout',
  empty: 'shell.splitFailEmpty',
  'session-failed': 'shell.splitFailSession',
  'missing-mapping': 'shell.splitFailMappingMissing',
  'bad-mapping': 'shell.splitFailMappingBad',
  'no-valid-assignment': 'shell.splitFailNoValid',
}

/** 失败停在谁身上；两段共用一个展示名。 */
const SPLIT_STAGE_KEY = {
  pm: 'shell.splitStagePm',
  manager: 'shell.splitStageManager',
} as const

/** 失败原文：按原因查词典，再填阶段、宿主原文与需求文档路径。 */
function splitFailureText(t: ShellProps['t'], outcome: RequirementSplitFailure, path: string): string {
  return fill(t(SPLIT_FAILURE_KEY[outcome.reason]), {
    stage: t(SPLIT_STAGE_KEY[outcome.stage]),
    detail: outcome.detail ?? '',
    path,
  })
}

/** 完成后的逐条明细：被拒的映射、分配失败与最终未分配都各自成行。 */
function splitSummaryLines(t: ShellProps['t'], summary: RequirementSplitSummary): string[] {
  const lines: string[] = []
  for (const rejected of summary.rejected) {
    if (rejected.reason === 'unknown-task') {
      lines.push(fill(t('shell.splitRejectedUnknownTask'), { task: rejected.task, role: rejected.role }))
    } else if (rejected.reason === 'empty-role') {
      lines.push(fill(t('shell.splitRejectedEmptyRole'), { task: rejected.task }))
    } else {
      lines.push(fill(t('shell.splitRejectedDuplicate'), { task: rejected.task }))
    }
  }
  for (const attempt of summary.assignments) {
    if (attempt.ok) continue
    lines.push(fill(t('shell.splitAssignFailed'), {
      task: attempt.taskId, role: attempt.roleId, detail: attempt.detail,
    }))
  }
  for (const taskId of summary.unassigned) {
    lines.push(fill(t('shell.splitUnassigned'), { task: taskId }))
  }
  return lines
}

/** 可取消的等待：取消信号到达时立即结算，轮询据此退出。 */
function cancellableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      window.clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 读一支文件成规范 base64；data URL 前缀去掉，宿主只要字节本身。 */
async function readFileBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { resolve(typeof reader.result === 'string' ? reader.result : '') }
    reader.onerror = () => { reject(reader.error ?? new Error('file read failed')) }
    reader.readAsDataURL(file)
  })
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('file read returned no data')
  return dataUrl.slice(comma + 1)
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

const SESSION_FILTER_CHOICES: readonly SessionFilter[] = ['any', 'claimed', 'active']

const SESSION_FILTER_LABELS: Record<SessionFilter, LcoderWorkspaceKey> = {
  any: 'shell.sessionAny',
  claimed: 'shell.sessionClaimed',
  active: 'shell.sessionActive',
}

function shellState(value: string): ShellTaskState {
  return KNOWN_STATES.has(value) ? value as ShellTaskState : 'drafting'
}

/**
 * 文件投影的一行 → 外壳任务：展示字段原样透传，状态收敛到五态。
 * @param row - 投影读到的任务行。
 * @returns 看板与详情使用的外壳任务。
 */
export function toShellTask(row: TaskRow): ShellTask {
  const state = shellState(row.state)
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    ...(row.category === undefined ? {} : { category: row.category }),
    ...(row.changeType === undefined ? {} : { changeType: row.changeType }),
    attachments: row.attachments,
    state,
    grade: row.grade,
    rules: row.rules,
    evidence: row.evidence,
    surface: SURFACE[state],
    ...(row.session === undefined ? {} : { session: row.session }),
    ...(row.proposal === undefined ? {} : { proposal: row.proposal }),
    ...(row.role === undefined ? {} : { role: row.role }),
    ...(row.dependsOn.length === 0 ? {} : { dependsOn: row.dependsOn }),
    paths: row.paths,
    irreversible: row.irreversible,
    ...(row.openedAt === undefined ? {} : { openedAt: row.openedAt }),
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
 * 从模型选择投影里读出 provider。
 *
 * 旧会话摘要直接给 `{ provider, model }`；当前投影给 `{ lastUsed, next }`。
 * @param projected - 未校验的投影值。
 * @returns provider 标识；读不到时 undefined。
 */
function providerOfSelection(projected: unknown): string | undefined {
  const providerOf = (value: unknown): string | undefined =>
    typeof value === 'object' && value !== null && 'provider' in value && typeof value.provider === 'string'
      ? value.provider
      : undefined
  if (typeof projected !== 'object' || projected === null) return undefined
  const direct = providerOf(projected)
  if (direct !== undefined) return direct
  if ('next' in projected) {
    const next = providerOf(projected.next)
    if (next !== undefined) return next
  }
  return 'lastUsed' in projected ? providerOf(projected.lastUsed) : undefined
}

/**
 * 外壳主组件。
 * @param props - 槽位组合进来的 props。
 * @returns 顶栏 + 任务板 + 项目信息抽屉 + 浮层。
 */
export function Shell({
  t, files, readAttachment, openRepository, sendPrompt, uploadAttachment, readDefaultModel, signContract, advanceContract,
  approveProposal, bindTask, assignTask, logSchedule,
  readFlowStatus, logFlow, bindAgentSession, renameSession, readContextPressure,
  createSession, listRoles, listExperts, readExpert,
  readMessages, subscribeSession, holdSession, checkModels, subscribeModels, readSessionNotice, readSessionFlags, modelSettings,
  useSessions, useSessionStatus, useWorkspaces, chatSize, cloud,
}: ShellProps): ReactNode {
  const workspaces = useWorkspaces(state => state.items)
  const sessionRows = useSessions(state => state.byId)
  /** 每条会话的投影值；队列长度来自 agent-loop 的 `inbox` 折叠，打开过的会话才有。 */
  const sessionProjections = useSessions(state => state.projectionsBySession)
  /** 宿主推流的每会话状态；覆盖每个列出的会话，不需要 bind 也不需要开历史。 */
  const sessionStatus = useSessionStatus(state => state)
  /** 云端登录状态；登录弹窗、顶栏与门禁共用这一份。 */
  const cloudSession = useCloudSession(cloud)
  const [accountOpen, setAccountOpen] = useState(false)

  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [skin, setSkin] = useState<Skin>(() => readSkin(browserSkinStorage()))
  /** 字体预设：A 系统、B 现代；默认 B，用户看完两档再定。 */
  const [fontPreset, setFontPreset] = useState<'system' | 'modern'>('modern')
  /** Windows 桌面自绘标题栏；Web 与 macOS 没有这个桥，不画窗口按钮。 */
  const windowBridge = useMemo(() => desktopWindowBridge(), [])
  const [windowMaximized, setWindowMaximized] = useState(false)
  /** 新会话的角色选择浮层。 */
  const [rolePicker, setRolePicker] = useState(false)
  const [detail, setDetail] = useState<ShellTask | null>(null)
  /** 需求拆分的就地错误与逐任务流程状态；流程状态按需求任务编号留档，关卡片不清。 */
  const [splitError, setSplitError] = useState<string | null>(null)
  const [splitFlows, setSplitFlows] = useState<Readonly<Record<string, RequirementSplitFlowView>>>({})
  /** 同一需求的流程只允许一条在途；连点第二下直接忽略。 */
  const splitRuns = useRef<Set<string>>(new Set())
  /** 每条在途流程的取消口：只在卸载时整体取消，关卡片不中断后台流程。 */
  const splitAborts = useRef<Map<string, AbortController>>(new Map())
  /** 需求卡片正文：该任务会话里分析师当时输出的《项目需求概要》。 */
  const [requirementDocument, setRequirementDocument] = useState<string | null>(null)
  const [chat, setChat] = useState<ShellTask | null>(null)
  /** 普通档与最大化两档；关闭对话时回到普通档。 */
  const [chatMax, setChatMax] = useState(false)
  const [settings, setSettings] = useState(false)
  /** 立项结果页：独立整页，打开时看板让位，不复用弹窗。 */
  const [resultPage, setResultPage] = useState(false)
  /** 「全新项目」需求分析师向导：阶段由会话事实算出，这里只记开没开。 */
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardMessages, setWizardMessages] = useState<readonly ShellMessage[]>([])
  const [wizardFlags, setWizardFlags] = useState<{ readonly awaitingFirstTurn: boolean; readonly failed: boolean } | null>(null)
  /** 向导会话最近一次失败；确认轮失败时用来显示原因并给重试。 */
  const [wizardNotice, setWizardNotice] = useState<ShellSessionNotice | null>(null)
  const [wizardError, setWizardError] = useState<string | null>(null)
  const [wizardSending, setWizardSending] = useState(false)
  /** 高级配置里选中的模型；null 表示用目录默认。建会话后才在发送前落一次。 */
  const [wizardModelChoice, setWizardModelChoice] = useState<IntakeModelOption | null>(null)
  const [intakeModelSnapshot, setIntakeModelSnapshot] = useState<ModelSettingsSnapshot | null>(null)
  const [intakeModelState, setIntakeModelState] = useState<IntakeModelState>('idle')
  /** 模型目录请求是否在途；挡住同一 tick 里的重复读取。 */
  const intakeModelLoading = useRef(false)
  /** 结果卡里的「确认需求」发送在途；在途时按钮禁用并显示正在发送。 */
  const [wizardConfirming, setWizardConfirming] = useState(false)
  /** 结果卡里的「更多讨论」发送在途；在途时菜单项禁用，阶段当场回到思考。 */
  const [wizardDiscussing, setWizardDiscussing] = useState(false)
  /** 结果卡里的采纳：成功才关向导，失败原文就地显示。 */
  const [wizardApproving, setWizardApproving] = useState(false)
  const [wizardApproveResult, setWizardApproveResult] = useState<ShellSignResult | null>(null)
  /** 个人中心：独立整页，与结果页同级；打开时看板让位。 */
  const [personalPage, setPersonalPage] = useState(false)
  /** Agent 状态大盘：独立整页，顶栏一级入口；打开时看板让位。 */
  const [dashboardPage, setDashboardPage] = useState(false)
  /** 重开确认框与它在途状态；浮层头与结果页共用同一套。 */
  const [restartOpen, setRestartOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)
  /**
   * 开过浮层的立项会话档位。关闭浮层后消息窗口不再被持有，读不到消息；
   * 这里只记住已经读到过的事实，换会话或换项目都不复用。
   */
  const [intakeTierHint, setIntakeTierHint] = useState<{ readonly sessionId: string; readonly tier: IntakeTier } | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  /** 看板筛选：低频控件，默认收起，只在判据生效时让入口带上标记。 */
  const [filterOpen, setFilterOpen] = useState(false)
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_TASK_FILTER)
  /** 设置里的专家面板：名册与提示词都在展开时才读，不跟启动抢一次远程调用。 */
  const [expertsOpen, setExpertsOpen] = useState(false)
  const [experts, setExperts] = useState<readonly ExpertRow[]>([])
  const [expertPrompts, setExpertPrompts] = useState<Record<string, ExpertPrompt | null>>({})
  const [shownExpert, setShownExpert] = useState<string | null>(null)
  const [tasks, setTasks] = useState<readonly ShellTask[]>([])
  /** 拆分轮询读的是最新推流与投影，不受流程启动那一刻的渲染快照限制。 */
  const liveSessionStatus = useRef(sessionStatus)
  liveSessionStatus.current = sessionStatus
  const liveSessionRows = useRef(sessionRows)
  liveSessionRows.current = sessionRows
  const liveTasks = useRef(tasks)
  liveTasks.current = tasks
  const [rules, setRules] = useState<readonly RuleRow[]>([])
  const [groups, setGroups] = useState<readonly SchedulingGroupRow[]>([])
  const [contracts, setContracts] = useState<readonly ContractRow[]>([])
  /** 签完一次就把投影重读一遍：`contracts` 里的签名状态是文件的事实，不是界面的记忆。 */
  const [reload, setReload] = useState(0)
  /** 上一次读投影的目标（项目 + 会话）；只有换目标才挡板，定时重读不闪「加载中」。 */
  const projectionTarget = useRef<string | null>(null)
  const [signing, setSigning] = useState(false)
  const [signResult, setSignResult] = useState<ShellSignResult | null>(null)
  /** 推进到已签约：与签署分开两步，各自可重试、失败也分得清。 */
  const [advancing, setAdvancing] = useState(false)
  const [advanceResult, setAdvanceResult] = useState<ShellSignResult | null>(null)
  const [proposals, setProposals] = useState<readonly ProposalRow[]>([])
  /** `.spec/requirements/` 的完整需求文档；需求卡片优先用它作正文。 */
  const [requirements, setRequirements] = useState<readonly RequirementDocRow[]>([])
  /** 需求卡片下的立项问答；打开卡片时从任务会话读出，关闭即清空。 */
  const [requirementAnswers, setRequirementAnswers] = useState<readonly RequirementAnswer[]>([])
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
  /** 对话滚动容器：输出在长，跟随到底部要用它。 */
  const chatBodyRef = useRef<HTMLDivElement | null>(null)
  const [notice, setNotice] = useState<ShellSessionNotice | null>(null)
  /** null 表示还没查过；`empty` 才是「没有能跑的模型」，`unknown` 是查询本身失败。 */
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null)
  /** 设置页存完 key 后立刻重查一次；订阅的那路是兜底。 */
  const modelRefresh = useRef<() => void>(() => {})
  /** 立项咒语正在发：只挡连点的第二下，跨刷新的去重读会话事实。 */
  const onboardingSending = useRef(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** 待发附件：图片带 base64，文件带上传回执；发送成功才清空。 */
  const [attachments, setAttachments] = useState<readonly ChatPendingAttachment[]>([])
  /** 附件就地错误：格式不支持、超限、读文件失败。 */
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  /** 发送在途：挡住连点的第二下，失败时草稿与附件原样保留。 */
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  /** 宿主目录默认模型；会话投影还没记选择时用它，并标明是默认。 */
  const [defaultModel, setDefaultModel] = useState<ChatModelChoice | null>(null)
  /** 附件稳定标识与重试要用的原始文件；只保留在本次窗口内存里。 */
  const attachmentSeq = useRef(0)
  const attachmentFiles = useRef(new Map<string, File>())
  /** 装配层声明的角色名册；读不到就是空表，新会话走宿主默认角色。 */
  const [roles, setRoles] = useState<readonly ShellRole[]>([])
  /** `.spec/roles.yaml` 的岗位名册；缺文件是空表，任务上的未知 id 仍照实显示。 */
  const [jobRoles, setJobRoles] = useState<readonly JobRoleRow[]>([])
  /** 岗位弹窗里选中的岗位；打开弹窗时取当前分配，未分配就留空。 */
  const [roleAssignChoice, setRoleAssignChoice] = useState<string>('')
  const [assigning, setAssigning] = useState(false)
  const [assignResult, setAssignResult] = useState<ShellSignResult | null>(null)
  /** 岗位编辑弹窗；开关只动界面，不写盘。 */
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)
  /** 下一次新开会话要用的角色；null 表示交给宿主默认。 */
  const [roleChoice, setRoleChoice] = useState<string | null>(null)
  /** 建会话与认领进行中：禁用入口，避免连点开出两条会话。 */
  const [claiming, setClaiming] = useState(false)
  /** 只有本客户端物化过的会话才读得到这两位；null 表示读不到，卡片就不画这两个态。 */
  const [taskFlags, setTaskFlags] = useState<{ readonly awaitingFirstTurn: boolean; readonly failed: boolean } | null>(null)
  /** 本窗口建会话时选的角色（preset，或以后的岗位 id）；会话有效岗位在读取时按认领任务优先算出。 */
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
  /** 状态大盘的合并事件流与逐任务读取问题；关页签后清空。 */
  const [dashboardEvents, setDashboardEvents] = useState<readonly ActionLogEntry[]>([])
  const [dashboardEventProblems, setDashboardEventProblems] = useState<Readonly<Record<string, string>>>({})
  const [dashboardEventError, setDashboardEventError] = useState<string | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const dashboardAbort = useRef<AbortController | null>(null)
  const dashboardTaskIds = useMemo(() => tasks.map(task => task.id), [tasks])
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
  const signedIn = cloudSession.state?.signedIn === true
  /** 登录页标题栏的自绘拖拽；原生 drag 区会让标题栏上的悬停事件失效。 */
  const loginDrag = useWindowDrag(windowBridge, !signedIn)
  const cloudUnavailable = cloud === undefined || !cloud.available
    || cloudSession.error?.code === 'cloud_unavailable'
  /** 登录状态读不出来（云端没装配或读取失败）；这时只渲染登录页，不放行到工作台。 */
  const loginBlocked = cloudSession.state === null && cloudSession.error !== null
  /** 当前会话绑的 provider；兼容旧的扁平摘要与当前 `{ lastUsed, next }` 投影形状。 */
  const sessionCloudProvider = (id: SessionId | undefined): string | undefined => {
    if (id === undefined) return undefined
    const summary = sessionRows[id]?.projectionValues?.modelSelection
    return providerOfSelection(summary ?? sessionProjections[id]?.values.modelSelection)
  }
  const cloudFacts = {
    signedIn,
    loading: cloudSession.loading,
    cloudUnavailable,
  }
  /** 需要用户令牌的入口统一走这里；未登录时外壳只渲染登录页，这里兜住云端不可用。 */
  const requireUser = (entry: CloudGateEntry): boolean => {
    const decision = gateEntry(entry, cloudFacts)
    if (decision.kind === 'allow') return true
    if (decision.kind === 'login') {
      setChatError(fill(t('shell.cloudGateNotice'), { entry: t(CLOUD_ENTRY_LABEL[entry]) }))
      return false
    }
    setChatError(decision.reason === 'loading' ? t('shell.cloudGateLoading') : t('shell.cloudGateUnavailable'))
    return false
  }
  /** 把会话切回用户路由；失败就地提示，不偷偷换别的模型。 */
  const routeSession = async (id: SessionId): Promise<boolean> => {
    if (cloud === undefined) { setChatError(t('shell.cloudGateUnavailable')); return false }
    const routed = await cloud.selectRoute(id)
    if (routed.ok) return true
    setChatError(fill(t('shell.cloudSwitchFailed'), { detail: routed.error.code }))
    return false
  }
  /**
   * 旧版本匿名立项会话：打开时切回用户路由一次。
   *
   * 桌面端已去匿名，但历史会话可能还记着匿名路由；只在登录后切一次，
   * 失败留在浮层错误里，不重试也不偷偷换模型。
   */
  const reroutedLegacy = useRef<Set<string>>(new Set())
  const legacyGuestSession = sessionId !== undefined
    && sessionCloudProvider(sessionId) === CLOUD_LEGACY_GUEST_ROUTE
  useEffect(() => {
    if (!signedIn || sessionId === undefined || !legacyGuestSession) return
    const key = String(sessionId)
    if (reroutedLegacy.current.has(key)) return
    reroutedLegacy.current.add(key)
    void routeSession(sessionId)
    // 只在登录态或当前会话变化时检查一次；routeSession 是每次渲染的新闭包。
  }, [signedIn, sessionId, legacyGuestSession])
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
    // 本窗口记下的可能是岗位 id（未来的名册选择），只有 preset 形态才拿来当 preset。
    const named = sessionRoles[String(id)]
    return named !== undefined && (named === 'lcoder' || named.startsWith('lcoder-')) ? named : undefined
  }

  /**
   * 一条会话的有效岗位：已认领任务上的 role 优先，其次建会话时选的岗位，
   * 最后从 preset 反推内置角色。认领任务岗位不一致时返回下一档，不把会话归给任一条。
   */
  const sessionRoleOf = (id: SessionId): string | undefined =>
    effectiveSessionRole({
      claimed: tasks.filter(task => task.session === String(id)).map(task => task.role),
      chosen: sessionRoles[String(id)],
      preset: agentPresetOf(id),
    })

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
    ...(task.role === undefined ? {} : { role: task.role }),
  })

  /**
   * 任务上的岗位怎么说给人听：没分配、自定岗位、内置角色，或名册里查不到的未知 id。
   * 未知 id 不报故障——与会话号失效同口径，只把「不知道」如实画出来。
   */
  const roleLabelOf = (role: string | undefined): string => {
    if (role === undefined) return t('shell.roleUnassigned')
    const job = jobRoles.find(row => row.id === role)
    if (job !== undefined) return job.name
    return BUILTIN_ROLE_IDS.includes(role) ? role : t('shell.roleUnknown')
  }

  /** 本工作区的会话名册；岗位按「认领任务 → 建会话时的选择 → preset」在读取时算出。 */
  const schedulingSessions = (): readonly SchedulingSession[] =>
    workspaceSessions.map((id) => {
      const row = sessionRows[id]
      const pushed = sessionStatus.get(id)
      const role = sessionRoleOf(id)
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

  /**
   * 状态大盘的一行：状态读宿主推流，任务读投影，更新时刻只在宿主给出时显示。
   * 认领任务优先取未收口的那条；会话没认领任务时留空，由页面写「未认领」。
   */
  const dashboardSessions = (): readonly DashboardSessionRow[] =>
    workspaceSessions.map((id) => {
      const row = sessionRows[id]
      const pushed = sessionStatus.get(id)
      const claimed = tasks.find(task => task.session === String(id) && task.state !== 'closed')
        ?? tasks.find(task => task.session === String(id))
      return {
        sessionId: String(id),
        name: row?.title ?? sessionLabel(String(id)),
        role: roleLabelOf(sessionRoleOf(id)),
        status: dashboardStatusOf({
          pendingInteraction: pushed?.pendingInteraction,
          running: pushed?.running ?? row?.running ?? false,
        }),
        ...(claimed === undefined ? {} : { taskId: claimed.id, taskTitle: claimed.title }),
        queue: queueDepth(String(id)),
        ...(row?.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
        workspace: row?.cwd ?? projectPath,
      }
    })
  const dashboardRows = dashboardSessions()
  const dashboardSummary = summarizeDashboard(dashboardRows, tasks)

  /**
   * 关系图的输入：全量任务（不按看板筛选裁剪）与会话的认领/联调组。
   * 会话名与看板一致——认领任务用任务标题，否则按次序列号。
   */
  const dashboardGraph = (): DashboardGraphInput => ({
    tasks: tasks.map(task => ({
      id: task.id,
      title: task.title,
      state: task.state,
      dependsOn: task.dependsOn ?? [],
      ...(task.session === undefined ? {} : { session: task.session }),
      ...(task.role === undefined ? {} : { role: task.role }),
    })),
    sessions: schedulingSessions().map((session) => {
      const label = sessionLabel(session.sessionId)
      return {
        id: session.sessionId,
        label,
        ...(session.role === undefined ? {} : { role: session.role }),
        running: session.running,
        awaitingInteraction: session.awaitingInteraction,
        pending: session.pending,
        claims: session.claims.map(claim => claim.id),
        groupTasks: session.groupTasks.map(task => task.id),
      }
    }),
  })

  /** 大盘刷新：重读投影，事件流 effect 随 reload 重新读日志。 */
  const refreshDashboard = useCallback((): void => {
    setReload(value => value + 1)
  }, [])

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
  /** 浮层这条会话是不是立项会话、是哪一档；消息窗口读不到就不猜。 */
  const chatIntakeTier = chat === null ? null : intakeTierOfMessages(messages)
  /** 读到过就记住：关闭浮层后结果页仍能按同一档重开。 */
  useEffect(() => {
    if (chatSessionId === undefined || chatIntakeTier === null) return
    setIntakeTierHint({ sessionId: String(chatSessionId), tier: chatIntakeTier })
  }, [chatSessionId, chatIntakeTier])
  /** 向导持有会话时也记住档位：关掉再打开仍能走「重新开始」。 */
  const wizardIntakeTier = wizardOpen ? intakeTierOfMessages(wizardMessages) : null
  useEffect(() => {
    if (sessionId === undefined || wizardIntakeTier === null) return
    setIntakeTierHint({ sessionId: String(sessionId), tier: wizardIntakeTier })
  }, [sessionId, wizardIntakeTier])
  /** 结果页与确认框读当前会话的档位；消息窗口读不到时用开过浮层的那次事实。 */
  const currentIntakeTier = useMemo(() => {
    if (wizardIntakeTier !== null) return wizardIntakeTier
    const fromWindow = sessionId === undefined || readMessages === undefined
      ? null
      : intakeTierOfMessages(readMessages(sessionId))
    if (fromWindow !== null) return fromWindow
    return sessionId !== undefined && intakeTierHint?.sessionId === String(sessionId)
      ? intakeTierHint.tier
      : null
  }, [sessionId, readMessages, messages, reload, intakeTierHint, wizardIntakeTier])
  /** 重开确认框列的已有产物；零也照实显示。 */
  const restartArtifacts = useMemo(
    () => intakeArtifactsOf({ info, rules: rulesCount, tasks, proposals: proposals.length }),
    [info, rulesCount, tasks, proposals],
  )
  /** 这条会话当前等人处理的那一条审批或提问；上游插件发布，外壳只负责画与转交答案。 */
  const chatPending = chatSessionId === undefined ? undefined : sessionStatus.get(chatSessionId)?.pendingInteraction
  /** 向导所在的会话就是当前会话；提问只认待答请求，审批不算提问。 */
  const wizardQuestion = sessionId === undefined
    ? null
    : questionOf(sessionStatus.get(sessionId)?.pendingInteraction)
  const wizardRunning = sessionId === undefined
    ? false
    : sessionStatus.get(sessionId)?.running ?? sessionRows[sessionId]?.running ?? false
  /** 把「首条提示已收下、还在等首个回合」也算作在跑，避免思考提示一上来就显示结束。 */
  const wizardTurnActive = wizardRunning || wizardFlags?.awaitingFirstTurn === true
  const wizardOutput = useMemo(() => intakeWizardOutput(wizardMessages), [wizardMessages])
  const wizardUserMessages = wizardMessages.reduce((count, message) => count + (message.role === 'user' ? 1 : 0), 0)
  /**
   * 立项咒语发过没有只看会话事实；关掉向导再打开、刷新页面后都读同一份记录，
   * 所以确认按钮不会把同一份咒语发第二遍。
   */
  const wizardStarted = intakePromptStarted({
    blank: session?.blank,
    userMessages: wizardUserMessages,
    awaitingFirstTurn: wizardFlags?.awaitingFirstTurn,
  })
  /** 会话里是否已经有用户确认过需求；确认按钮与结果卡都按这条日志事实判，不另记状态。 */
  const wizardConfirmed = useMemo(() => intakeConfirmed(wizardMessages), [wizardMessages])
  /** 项目或任务已落盘：确认后的结果卡据此决定说「已确认」还是如实报失败。 */
  const wizardLanded = info !== null || tasks.length > 0
  /**
   * 状态行与阶段共用沉降后的运行事实：回合之间 `running` 会短暂为 false，
   * 沉降窗口把这两秒仍当作思考中；确定停止后才换结论，结果卡不会在两轮之间闪。
   * 待答问题仍算在跑；向导没开始或停在首页时立即交回未运行。
   */
  const wizardStatusRunning = useIntakeRunActive({
    enabled: wizardOpen && wizardStarted && (wizardQuestion?.questions.length ?? 0) === 0,
    running: wizardTurnActive,
    questionCount: wizardQuestion?.questions.length ?? 0,
    activity: wizardMessages.length,
  })
  /** 自己发出的确认或更多讨论也算在跑：发送在途时不再按上一轮结论画结果卡。 */
  const wizardRunFact = wizardStatusRunning || wizardConfirming || wizardDiscussing
  const wizardPhase = intakeWizardPhase({
    open: wizardOpen,
    started: wizardStarted,
    questionCount: wizardQuestion?.questions.length ?? 0,
    running: wizardRunFact,
    hasOutput: wizardOutput.hasOutput,
    proposalCount: proposals.length,
    summary: wizardOutput.summary,
    confirmed: wizardConfirmed,
    landed: wizardLanded,
  })
  /** 结果卡的内容种类：方案优先，其次本轮聊天概要，再其次已确认落盘。 */
  const wizardResultView = intakeResultView({
    proposalCount: proposals.length,
    summary: wizardOutput.summary,
    confirmed: wizardConfirmed,
    landed: wizardLanded,
  })
  const wizardProposal = latestProposal(proposals)
  const intakeModels = intakeModelOptions(intakeModelSnapshot)
  const intakeModelSelected = wizardModelChoice ?? defaultIntakeModel(intakeModels)
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
  /** 当前模型：会话记过就用会话的，没记过用目录默认并注明。 */
  const chatModelSelection = currentChatModel(
    chatSessionId === undefined ? undefined : sessionProjections[chatSessionId]?.values.modelSelection?.next,
    defaultModel ?? undefined,
  )
  /** 图片上限以宿主广播为准；读不到时用保守值。 */
  const chatImageLimits = resolveImageLimits(
    chatSessionId === undefined ? undefined : sessionProjections[chatSessionId]?.values.imageLimits,
  )
  const chatAttachmentsReady = attachmentsReady(attachments)
  /**
   * 能不能发：有内容、附件都传完、模型可用、会话与发送面都在，且没有在途发送。
   * 上传失败的文件也算没传完——不能悄悄跳过它。
   */
  const chatCanSend = !promptIsEmpty(draft, attachments) && chatAttachmentsReady && !modelBlocked
    && chatSessionId !== undefined && sendPrompt !== undefined && !sending

  useEffect(() => {
    if (files === undefined || workspace === undefined || sessionId === undefined) {
      projectionTarget.current = null
      setTasks([])
      setRules([])
      setGroups([])
      setContracts([])
      setProposals([])
      setRequirements([])
      setRulesCount(0)
      setInfo(null)
      setAgents(null)
      setJobRoles([])
      setFlow(null)
      setFlowError(null)
      setProblems([])
      setLoading(false)
      return
    }
    const target = `${activeWorkspaceId ?? ''}|${String(sessionId)}`
    const firstRead = projectionTarget.current !== target
    projectionTarget.current = target
    const controller = new AbortController()
    if (firstRead) setLoading(true)
    Promise.all([
      loadWorkspaceProjection(files, sessionId, controller.signal),
      loadProjectInfo(files, sessionId, controller.signal),
      loadLocalSecrets(files, sessionId, controller.signal),
      loadAgentsRegistry(files, sessionId, controller.signal),
      loadRolesRegistry(files, sessionId, controller.signal),
    ]).then(([projection, projectInfo, secrets, agentRegistry, roleRegistry]) => {
      if (controller.signal.aborted) return
      setTasks(projection.tasks.map(toShellTask))
      setRules(projection.rules)
      setGroups(projection.groups)
      setContracts(projection.contracts)
      setProposals(projection.proposals)
      setRequirements(projection.requirements)
      setRulesCount(projection.rules.length)
      setProblems([...projection.problems, ...projectInfo.problems, ...agentRegistry.problems, ...roleRegistry.problems])
      setInfo(projectInfo.info === null ? null : resolveSecrets(projectInfo.info, secrets))
      setAgents(agentRegistry.agents)
      setJobRoles(roleRegistry.roles)
      setLoading(false)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setTasks([])
      setRules([])
      setGroups([])
      setContracts([])
      setProposals([])
      setRequirements([])
      setRulesCount(0)
      setInfo(null)
      setAgents(null)
      setJobRoles([])
      setProblems([String(error)])
      setLoading(false)
    })
    return () => { controller.abort() }
  }, [files, activeWorkspaceId, sessionId, reload])

  /**
   * 看板跟外部改动：`.spec` 被别处改过后不等下一次操作，有工作区且页面可见时
   * 每十秒重读一次；回前台或重新获得焦点时立即补一次。
   */
  useBoardRefresh(hasWorkspace, refreshDashboard)

  /**
   * 投影重读后把已打开的详情换成同一任务的新快照：分配岗位、状态推进都在弹窗里
   * 立即生效，不用关掉重开。任务被删时保留当前快照，不擅自关窗。
   */
  useEffect(() => {
    setDetail((current) => {
      if (current === null) return current
      return tasks.find(task => task.id === current.id) ?? current
    })
  }, [tasks])

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
   * 状态大盘打开时重读事件流；关页签立刻中止在途读取并清空旧项目的事件，
   * 自动刷新只由页面内的定时器触发，离开页签就随卸载停止。
   */
  useEffect(() => {
    if (!dashboardPage) {
      dashboardAbort.current?.abort()
      dashboardAbort.current = null
      setDashboardEvents([])
      setDashboardEventProblems({})
      setDashboardEventError(null)
      setDashboardLoading(false)
      return
    }
    if (files === undefined || sessionId === undefined) {
      setDashboardEvents([])
      setDashboardEventProblems({})
      setDashboardEventError(null)
      setDashboardLoading(false)
      return
    }
    const controller = new AbortController()
    dashboardAbort.current?.abort()
    dashboardAbort.current = controller
    setDashboardLoading(true)
    setDashboardEventError(null)
    void loadDashboardEvents(files, sessionId, dashboardTaskIds, controller.signal).then((load) => {
      if (controller.signal.aborted) return
      setDashboardEvents(load.entries)
      setDashboardEventProblems(load.problems)
      setDashboardLoading(false)
    }, (error: unknown) => {
      if (controller.signal.aborted) return
      setDashboardEvents([])
      setDashboardEventProblems({})
      setDashboardEventError(`${t('shell.problems')} ${String(error)}`)
      setDashboardLoading(false)
    })
    return () => { controller.abort() }
  }, [dashboardPage, reload, files, sessionId, dashboardTaskIds, t])

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

  /** 皮肤写到 html 供页面底色使用，同时保存选择；刷新后按保存值恢复。 */
  useEffect(() => {
    const root = document.documentElement
    root.dataset.lcoderSkin = skin
    writeSkin(browserSkinStorage(), skin)
    return () => { delete root.dataset.lcoderSkin }
  }, [skin])

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
   * 向导同样先持有再订阅：立项会话可能是刚建的，没有本地引用时读不到消息与首回合标记。
   * 关闭向导就释放引用；会话本身继续在宿主侧跑。
   */
  useEffect(() => {
    if (!wizardOpen || sessionId === undefined || readMessages === undefined || subscribeSession === undefined) {
      setWizardMessages([])
      setWizardFlags(null)
      setWizardNotice(null)
      return
    }
    const release = holdSession?.(sessionId)
    const refresh = (): void => {
      setWizardMessages(readMessages(sessionId))
      setWizardFlags(readSessionFlags?.(sessionId) ?? null)
      setWizardNotice(readSessionNotice?.(sessionId) ?? null)
    }
    refresh()
    const unsubscribe = subscribeSession(sessionId, refresh)
    return () => {
      unsubscribe()
      release?.()
    }
  }, [wizardOpen, sessionId, readMessages, subscribeSession, readSessionFlags, readSessionNotice, holdSession])

  /**
   * 需求卡片的立项问答：按任务会话（没有就当前会话）读消息，卡片打开期间跟着刷新。
   * 关闭就清空——问答不是缓存，下次打开重读会话事实。
   */
  const requirementSessionId = detail !== null && isRequirementTask(detail)
    ? claimTaskSession(detail.session, taskSessionRows)?.sessionId ?? sessionId
    : undefined
  useEffect(() => {
    if (requirementSessionId === undefined || readMessages === undefined) {
      setRequirementAnswers([])
      setRequirementDocument(null)
      return
    }
    const release = holdSession?.(requirementSessionId)
    const refresh = (): void => {
      const window = readMessages(requirementSessionId)
      setRequirementAnswers(intakeAnswersOf(window))
      setRequirementDocument(intakeSummaryOf(window))
    }
    refresh()
    const unsubscribe = subscribeSession?.(requirementSessionId, refresh)
    return () => {
      unsubscribe?.()
      release?.()
    }
  }, [requirementSessionId, readMessages, subscribeSession, holdSession])

  /** 关闭卡片不中止后台拆分；只有外壳卸载才取消在途轮询。 */
  useEffect(() => () => {
    for (const controller of splitAborts.current.values()) controller.abort()
    splitAborts.current.clear()
  }, [])

  /** 一轮跑完就重读投影：结果卡要读的是刚落盘的方案，不等下一次定时刷新。 */
  const wizardRunWasRunning = useRef(false)
  useEffect(() => {
    if (wizardOpen && wizardRunWasRunning.current && !wizardRunning) setReload(value => value + 1)
    wizardRunWasRunning.current = wizardRunning
  }, [wizardOpen, wizardRunning])

  /** 从设置页回来后重读模型目录：刚配好的路线不必关掉向导再打开。 */
  const settingsWasOpen = useRef(false)
  useEffect(() => {
    if (settingsWasOpen.current && !settings && wizardOpen) setIntakeModelState('idle')
    settingsWasOpen.current = settings
  }, [settings, wizardOpen])

  /**
   * 输出跟随：只在你本来就贴着底部时自动滚，向上翻历史时不要抢。
   * 阈值 80px 留一点余量——严格等于 0 时，一像素的布局误差就会让跟随失效。
   */
  useEffect(() => {
    const node = chatBodyRef.current
    if (node === null) return
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80
    if (nearBottom) node.scrollTop = node.scrollHeight
  }, [messages, chatRunning, chat])

  /** 本会话还没记选择时，chip 用目录默认值并注明；目录读不到就退回占位。 */
  useEffect(() => {
    if (chat === null || readDefaultModel === undefined) return
    let alive = true
    void readDefaultModel().then((model) => {
      if (alive) setDefaultModel(model)
    }).catch(() => {
      if (alive) setDefaultModel(null)
    })
    return () => { alive = false }
  }, [chat, readDefaultModel])

  /** 换会话就丢掉上一条会话的附件：文件回执按会话绑定，不能跨会话复用。 */
  const attachmentSession = useRef<SessionId | undefined>(undefined)
  useEffect(() => {
    if (attachmentSession.current !== undefined && attachmentSession.current !== chatSessionId) {
      setAttachments([])
      attachmentFiles.current.clear()
      setAttachError(null)
    }
    attachmentSession.current = chatSessionId
  }, [chatSessionId])

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
    setSignResult(null)
    setAssignResult(null)
    setRoleAssignChoice(task.role ?? '')
    setRoleDialogOpen(false)
    setSplitError(null)
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
      description: '',
      attachments: [],
      state: 'drafting',
      grade: '-',
      rules: [],
      evidence: [],
      surface: '',
      paths: [],
      irreversible: [],
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

  /** 选中任务回指的完整需求文档；没有落盘文件时 undefined，卡片退回会话概要。 */
  const detailRequirement = detail?.proposal === undefined
    ? undefined
    : requirements.find(row => row.id === detail.proposal)

  /** 选中需求的拆分流程；关卡片不清，重开仍看到同一次流程。 */
  const detailSplitFlow = detail === null ? null : splitFlows[detail.id] ?? null

  /** 选中任务最近一次调度留档；点过「开始对话」才有。 */
  const detailSchedule = detail === null ? undefined : schedule[detail.id]
  /** 选中任务所在的联调组；投影里有就是持久的，刷新后仍在。 */
  const detailJoint = detail === null ? undefined : jointOf(detail)
  /** 弹窗里要标建议徽标的岗位；只消费推荐 id，理由不进入界面。 */
  const recommendedRole = useMemo(
    () => (detail === null ? null : recommendedRoleId(detail, jobRoles, detailContract?.acceptance ?? [])),
    [detail, jobRoles, detailContract],
  )
  /** 打开弹窗只准备选择，不写盘；取消与点外部都从这里退出。 */
  const openRoleDialog = (): void => {
    if (detail === null) return
    setRoleAssignChoice(detail.role ?? '')
    setAssignResult(null)
    setRoleDialogOpen(true)
  }
  const closeRoleDialog = (): void => {
    setRoleDialogOpen(false)
    setAssignResult(null)
  }
  useEffect(() => {
    if (detail === null) setRoleDialogOpen(false)
  }, [detail])
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
    if (!requireUser('contractSign')) {
      setSignResult({ ok: false, text: fill(t('shell.cloudGateNotice'), { entry: t(CLOUD_ENTRY_LABEL.contractSign) }) })
      return
    }
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

  /**
   * 把选中任务分配给岗位。分配是调度硬约束，所以只走人机命令：
   * 浏览器不写 `.spec`，命令回执原样显示；只有回执成功才重读投影，
   * 失败时界面保持原样，不把一次拒绝画成已分配。
   */
  const assignSelected = async (): Promise<void> => {
    if (detail === null || sessionId === undefined || assignTask === undefined) return
    if (roleAssignChoice === '') {
      setAssignResult({ ok: false, text: t('shell.roleUnknown') })
      return
    }
    setAssigning(true)
    setAssignResult(null)
    try {
      const result = await assignTask(sessionId, detail.id, roleAssignChoice)
      setAssignResult(result)
      if (result.ok) setReload(value => value + 1)
    } catch (error: unknown) {
      setAssignResult({ ok: false, text: String(error) })
    } finally {
      setAssigning(false)
    }
  }

  /** 把选中任务推到「已签约」。签名与状态分写，这一步失败不会动签名。 */
  const advanceSelected = async (): Promise<void> => {
    if (detail === null || sessionId === undefined || advanceContract === undefined) return
    if (!requireUser('contractSign')) {
      setAdvanceResult({ ok: false, text: fill(t('shell.cloudGateNotice'), { entry: t(CLOUD_ENTRY_LABEL.contractSign) }) })
      return
    }
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
    if (!requireUser('proposalApprove')) {
      setApproveResult({ ok: false, text: fill(t('shell.cloudGateNotice'), { entry: t(CLOUD_ENTRY_LABEL.proposalApprove) }) })
      return
    }
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

  /**
   * 重读拆分要用的两份事实：任务与岗位名册。
   *
   * 轮询期间不依赖 React 重渲染，直接把 `.spec` 读成外壳任务；读失败时退回
   * 当前渲染里的那一份，让流程还能按最近一次已知状态继续判断。
   */
  const loadSplitSnapshot = async (): Promise<{
    readonly tasks: readonly ShellTask[]
    readonly roles: readonly JobRoleRow[]
  }> => {
    if (files === undefined || sessionId === undefined) {
      return { tasks: liveTasks.current, roles: jobRoles }
    }
    const controller = new AbortController()
    try {
      const [projection, registry] = await Promise.all([
        loadWorkspaceProjection(files, sessionId, controller.signal),
        loadRolesRegistry(files, sessionId, controller.signal),
      ])
      return { tasks: projection.tasks.map(toShellTask), roles: registry.roles }
    } catch (error: unknown) {
      // 读盘失败只让这一次轮询退回旧快照；流程与卡片自己会报结果。
      void error
      return { tasks: liveTasks.current, roles: jobRoles }
    } finally {
      controller.abort()
    }
  }

  /**
   * 一键拆分：项目经理拆任务，研发经理定岗位，外壳逐条执行 `/task_assign`。
   *
   * 以卡片读到的完整需求文档为唯一依据；没有文档就不开任何会话。已经拆过
   * （`.spec` 里有同方案 drafting 任务）时不再建项目经理会话，只补未分配的岗位，
   * 所以关卡片重开、刷新页面后重试都不会重复拆。关卡片不中止后台流程；
   * 只有外壳卸载才统一取消。
   */
  const splitRequirement = async (task: ShellTask, requirementDocument?: RequirementDocRow): Promise<void> => {
    if (task.proposal === undefined) {
      setSplitError(fill(t('shell.splitFailNoDocument'), { path: '.spec/requirements/' }))
      return
    }
    const flow = splitFlows[task.id]
    if (flow?.status === 'running' || splitRuns.current.has(task.id)) return
    if (flow?.status === 'done') {
      setSplitError(null)
      return
    }
    if (modelStatus?.state === 'empty') {
      setSplitError(t('shell.splitNoModel'))
      return
    }
    if (createSession === undefined || sendPrompt === undefined || assignTask === undefined) {
      setSplitError(t('shell.splitNeedSessions'))
      return
    }
    if (projectPath === '') {
      setSplitError(t('shell.splitNeedWorkspace'))
      return
    }
    const document = requirementDocument?.text ?? ''
    const path = `.spec/requirements/${task.proposal}.md`
    if (document.trim() === '') {
      setSplitError(fill(t('shell.splitFailNoDocument'), { path }))
      return
    }
    if (!requireUser('newSession')) {
      setSplitError(t('shell.cloudGateUnavailable'))
      return
    }

    splitRuns.current.add(task.id)
    setSplitError(null)
    const controller = new AbortController()
    splitAborts.current.set(task.id, controller)
    setSplitFlows(current => ({
      ...current,
      [task.id]: { status: 'running', stage: 'pm', newTasks: [] },
    }))

    const viewTasks = (rows: readonly ShellTask[]): readonly { id: string; title: string }[] =>
      rows.map(row => ({ id: row.id, title: row.title }))

    try {
      const snapshot = await loadSplitSnapshot()
      const existing = existingSplitTasks(snapshot.tasks, task)
      const pending = existing.filter(row => row.role === undefined)
      if (existing.length > 0 && pending.length === 0) {
        setSplitFlows(current => ({
          ...current,
          [task.id]: {
            status: 'done',
            newTasks: viewTasks(existing),
            summary: { taskCount: existing.length, assignedCount: existing.length, lines: [] },
          },
        }))
        setReload(value => value + 1)
        return
      }

      // 拆分会话跟随设置里的默认模型：用户在设置页改完默认后，项目经理与研发经理
      // 立刻用新默认，不再被需求会话里的旧模型选择盖住。读不到快照就交给宿主默认。
      const splitModel = modelSettings === undefined
        ? undefined
        : (await modelSettings.load()).defaultSelection
      const outcome = await runRequirementSplit({
        task,
        source: { document },
        roster: snapshot.roles,
        ...(pending.length === 0 ? {} : { existingTasks: pending }),
        beforeTaskIds: snapshot.tasks.map(row => row.id),
      }, {
        createSession: async (preset) => {
          const created = await createSession(projectPath, preset)
          if (splitModel !== undefined && modelSettings !== undefined) {
            const failure = await modelSettings.setDefault(created, splitModel.provider, splitModel.model)
            if (failure !== undefined) throw new Error(failure)
          }
          setSessionRoles(current => ({ ...current, [String(created)]: preset }))
          if (signedIn) await routeSession(created)
          return String(created)
        },
        sendPrompt: async (id, text) => sendPrompt(id as SessionId, text),
        holdSession: id => holdSession?.(id as SessionId) ?? (() => {}),
        readMessages: id => readMessages?.(id as SessionId) ?? [],
        readNotice: id => readSessionNotice?.(id as SessionId) ?? null,
        isRunning: id => liveSessionStatus.current.get(id as SessionId)?.running
          ?? liveSessionRows.current[id as SessionId]?.running,
        assignTask: (id, taskId, roleId) => assignTask(id as SessionId, taskId, roleId),
        loadTasks: async () => (await loadSplitSnapshot()).tasks,
        loadRoster: async () => (await loadSplitSnapshot()).roles,
        now: () => Date.now(),
        sleep: ms => cancellableSleep(ms, controller.signal),
      }, {
        signal: controller.signal,
        onProgress: (progress) => {
          setSplitFlows(current => ({
            ...current,
            [task.id]: {
              status: 'running',
              stage: progress.stage,
              newTasks: viewTasks(progress.newTasks ?? []),
            },
          }))
        },
      })
      if (outcome.kind === 'cancelled') return

      if (outcome.kind === 'failed') {
        const detail = splitFailureText(t, outcome, path)
        const known = existing.length > 0 ? existing : outcome.newTasks
        setSplitFlows(current => ({
          ...current,
          [task.id]: {
            status: 'failed',
            newTasks: viewTasks(known),
            errorText: detail,
            ...(known.length === 0
              ? {}
              : {
                summary: {
                  taskCount: known.length,
                  assignedCount: known.filter(row => row.role !== undefined).length,
                  lines: [],
                },
              }),
          },
        }))
        setSplitError(detail)
        if (known.length > 0) setReload(value => value + 1)
        return
      }

      const known = existing.length > 0 ? existing : outcome.newTasks
      const preAssigned = known.filter(row => row.role !== undefined).length
      const lines = splitSummaryLines(t, outcome.summary)
      setSplitFlows(current => ({
        ...current,
        [task.id]: {
          status: 'done',
          newTasks: viewTasks(known),
          summary: {
            taskCount: known.length,
            assignedCount: preAssigned + outcome.summary.assignedCount,
            lines,
          },
        },
      }))
      setReload(value => value + 1)
    } catch (error: unknown) {
      const detail = fill(t('shell.requirementSplitFailed'), { detail: String(error) })
      setSplitFlows(current => ({
        ...current,
        [task.id]: { status: 'failed', newTasks: [], errorText: detail },
      }))
      setSplitError(detail)
    } finally {
      splitRuns.current.delete(task.id)
      splitAborts.current.delete(task.id)
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
   * 启动咒语在这里就地生成，保证发出去的是本条任务的文本。
   */
  const openTaskConversation = async (task: ShellTask): Promise<FlowRunResult> => {
    if (!requireUser('taskConversation')) {
      return { taskId: task.id, ok: false, held: false, text: t('shell.cloudSessionGate') }
    }
    const decision = decideScheduling(schedulingTaskOf(task), schedulingSessions(), knownStates, jobRoles)
    const at = new Date().toISOString()
    const text = promptOf(task, decision)
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
        const targetProvider = sessionCloudProvider(target)
        if (signedIn && (targetProvider === undefined || targetProvider === CLOUD_LEGACY_GUEST_ROUTE)) {
          if (!await routeSession(target)) {
            return { taskId: task.id, ok: false, held: false, text: t('shell.cloudSessionGate') }
          }
        }
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
      // 任务对话总是按宿主默认角色开会话：角色选择只服务顶栏「＋」弹窗，
      // 这里读 roleChoice 会把上一次弹窗里的选择带进任务。
      const created = await createSession(projectPath)
      if (signedIn) await routeSession(created)
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
    if (!requireUser('flowBatch')) {
      setFlowError(t('shell.cloudSessionGate'))
      return
    }
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
    if (!requireUser('flowBatch')) {
      setFlowError(t('shell.cloudSessionGate'))
      return
    }
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
    id: '', title, description: '', attachments: [], state: 'drafting', grade: '-', rules: [], evidence: [], surface: '', paths: [], irreversible: [],
  })

  /**
   * 打开常驻角色会话：配置号还在就用它，否则找同 preset 的那条，最后才新建。
   * 打开时校正标题并（需要时）把会话号写回 `.spec/agents.yaml`；重复点只聚焦。
   */
  const openSingleton = async (role: AgentRole): Promise<void> => {
    if (singletonBusy.current) return
    if (!requireUser('agentSession')) return
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
      if (signedIn) await routeSession(created)
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

  /** 详情弹窗头/底的会话动作文案；随任务阶段变化，行为仍是打开该任务会话。 */
  const conversationLabel = (task: ShellTask): string =>
    claiming ? t('shell.claiming') : t(STATE_ACTION_LABEL[task.state])

  /**
   * 开一条不绑任务的会话：只为了看一眼这个角色的工具面，或接着上一轮自由讨论。
   * 认领关系仍由任务卡那一步写，这里不碰 `.spec`。
   */
  const newPlainSession = (): void => {
    if (!requireUser('newSession')) return
    if (createSession === undefined || projectPath === '') return
    setClaiming(true)
    void (async () => {
      const created = await createSession(projectPath, roleChoice ?? undefined)
      if (signedIn) await routeSession(created)
      // 人选的角色要留在本窗口：之后的调度判定按它算这条会话的有效岗位。
      if (roleChoice !== null) setSessionRoles(current => ({ ...current, [String(created)]: roleChoice }))
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
   * 打开需求分析师向导。阶段不在这里决定：会话受理过咒语就按消息与待答问题落位，
   * 没受理过就停在首页；关闭再打开也只重算，不重发。
   */
  const openIntakeWizard = (): void => {
    setDetail(null)
    setResultPage(false)
    setChat(null)
    setChatError(null)
    setWizardError(null)
    setWizardApproveResult(null)
    setIntakeModelState('idle')
    setIntakeModelSnapshot(null)
    setWizardOpen(true)
  }

  /** 关闭向导只收起界面；宿主那边的回合继续跑。 */
  const closeIntakeWizard = (): void => {
    setWizardOpen(false)
    setWizardError(null)
    setWizardApproveResult(null)
  }

  /**
   * 读模型目录：向导打开时就调用，展开高级配置只做补读或重试。
   * 重复调用由在途标记与 `loading`/`ready` 状态挡掉；关闭再打开会把状态清回 idle 并重读。
   */
  const loadIntakeModels = (): void => {
    if (intakeModelLoading.current) return
    if (intakeModelState === 'loading' || intakeModelState === 'ready') return
    if (modelSettings === undefined) {
      setIntakeModelState('error')
      return
    }
    intakeModelLoading.current = true
    setIntakeModelState('loading')
    void modelSettings.load().then((snapshot) => {
      setIntakeModelSnapshot(snapshot)
      setIntakeModelState(snapshot.status === 'error' ? 'error' : 'ready')
    }, () => {
      setIntakeModelState('error')
    }).finally(() => {
      intakeModelLoading.current = false
    })
  }

  /** 向导一打开就把模型目录读好：折叠摘要要直接显示真实模型，不能等展开高级配置。 */
  useEffect(() => {
    if (wizardOpen && intakeModelState === 'idle') loadIntakeModels()
  }, [wizardOpen, intakeModelState])

  /**
   * 把一档立项咒语发到指定会话。
   *
   * 调用面在宿主侧；模型选择只在真正选过时、建会话之后发送之前落一次。
   * 返回就地错误原文；路由失败已经把原因写进 `chatError`，这里返回 null。
   */
  const dispatchIntakePrompt = async (
    kind: 'new' | 'docs',
    target: SessionId,
    modelChoice: IntakeModelOption | null,
  ): Promise<string | null> => {
    if (sendPrompt === undefined) return t('shell.noSession')
    if (!await routeSession(target)) return null
    if (modelChoice !== null && modelSettings !== undefined) {
      const failure = await modelSettings.setDefault(target, modelChoice.provider, modelChoice.model)
      if (failure !== undefined) return failure
    }
    const project = { name: projectName, path: projectPath, branch: projectBranch }
    const text = kind === 'new'
      ? buildIntakePrompt(project)
      : buildOnboardingPrompt(project, info?.docs ?? { product: '', architecture: '', tests: '' })
    await sendPrompt(target, text)
    void cloudSession.refresh()
    return null
  }

  /**
   * 零任务仓库的立项入口：
   * - `new` 是「全新项目」，先开需求分析师向导，确认后才发 7 问咒语；
   * - `docs` 是「已有资料」，发立项分析咒语，让 agent 先 file_list / file_read 看仓库
   *   与已声明文档再立任务；没声明文档时咒语会要求它先问。
   *
   * 两档共用同一条会话事实判定：受理过提示词（`blank` 已落、窗口里已有消息，
   * 或提示正等首个回合）就只打开界面，所以关掉、刷新、重开窗口之后再点都不会再发。
   */
  const startOnboarding = (kind: 'new' | 'docs'): void => {
    if (kind === 'new') {
      openIntakeWizard()
      return
    }
    const gate = gateEntry('onboarding', cloudFacts)
    if (gate.kind !== 'allow') {
      setChatError(gate.kind === 'blocked' && gate.reason === 'loading'
        ? t('shell.cloudGateLoading')
        : t('shell.cloudGateUnavailable'))
      return
    }
    setDetail(null)
    setChatError(null)
    setChat({ id: '', title: t('shell.onboardingChat'), description: '', attachments: [], state: 'drafting', grade: '-', rules: [], evidence: [], surface: '', paths: [], irreversible: [] })
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
    void (async () => {
      try {
        const failure = await dispatchIntakePrompt(kind, sessionId, null)
        if (failure !== null) setChatError(failure)
      } catch (error: unknown) {
        setChatError(fill(t('shell.onboardingSendFailed'), { detail: String(error) }))
      } finally {
        onboardingSending.current = false
      }
    })()
  }

  /**
   * 向导的「确认」：没会话就先建一条，再按同一套会话事实判定发不发咒语。
   *
   * 已经发过（`blank` 已落、消息窗口里有用户消息、或首条提示正等首个回合）就只进阶段，
   * 不重发；选过模型则在发送前落一次 `selectModel`，失败就停住并就地显示原文。
   */
  const confirmIntakeWizard = (): void => {
    if (wizardSending || onboardingSending.current) return
    const gate = gateEntry('onboarding', cloudFacts)
    if (gate.kind !== 'allow') {
      setWizardError(gate.kind === 'blocked' && gate.reason === 'loading'
        ? t('shell.cloudGateLoading')
        : t('shell.cloudGateUnavailable'))
      return
    }
    setWizardError(null)
    setWizardOpen(true)
    const historyMessages = sessionId === undefined ? 0
      : readMessages?.(sessionId).filter(message => message.role === 'user').length ?? 0
    const action = onboardingAction({
      hasSession: (sessionId !== undefined || createSession !== undefined) && sendPrompt !== undefined,
      hasModel: !modelBlocked,
      sending: onboardingSending.current,
      blank: session?.blank,
      userMessages: Math.max(wizardUserMessages, historyMessages),
      awaitingFirstTurn: wizardFlags?.awaitingFirstTurn
        ?? (sessionId === undefined ? undefined : readSessionFlags?.(sessionId)?.awaitingFirstTurn),
    })
    if (action.kind === 'block') {
      setWizardError(t(action.reason === 'no-session' ? 'shell.noSession' : 'shell.noModels'))
      return
    }
    if (action.kind === 'open' || sendPrompt === undefined) return
    onboardingSending.current = true
    setWizardSending(true)
    void (async () => {
      try {
        let target = sessionId
        if (target === undefined) {
          if (createSession === undefined || projectPath === '') throw new Error(t('shell.noSession'))
          target = await createSession(projectPath)
          setSessionOverride(target)
          setReload(value => value + 1)
        }
        const failure = await dispatchIntakePrompt('new', target, wizardModelChoice)
        if (failure !== null) setWizardError(failure)
      } catch (error: unknown) {
        setWizardError(fill(t('shell.onboardingSendFailed'), { detail: String(error) }))
      } finally {
        onboardingSending.current = false
        setWizardSending(false)
      }
    })()
  }

  /**
   * 概要路径的「确认需求」：向同一会话发一条确认消息，让分析师按立项咒语落盘。
   *
   * 不新建会话；会话里已经有这条用户消息就不再发送，刷新、关掉重开、重复点击都只回到结果卡。
   * 发送在途即算在跑，阶段当场回到思考中，不等下一条事件。
   */
  const confirmIntakeRequirement = (): void => {
    if (wizardConfirming || wizardConfirmed) return
    if (sessionId === undefined || sendPrompt === undefined) {
      setWizardError(t('shell.noSession'))
      return
    }
    setWizardError(null)
    setWizardConfirming(true)
    void (async () => {
      try {
        if (!await routeSession(sessionId)) return
        await sendPrompt(sessionId, INTAKE_CONFIRM_COMMAND)
        void cloudSession.refresh()
      } catch (error: unknown) {
        setWizardError(fill(t('shell.onboardingSendFailed'), { detail: String(error) }))
      } finally {
        setWizardConfirming(false)
      }
    })()
  }

  /**
   * 确认轮失败后的「重试落盘」：显式再发一条重试指令，不受已确认去重限制。
   *
   * 只在用户点了重试时发送；发送在途禁用按钮，失败原文留在向导里。
   */
  const retryIntakeRequirement = (): void => {
    if (wizardConfirming) return
    if (sessionId === undefined || sendPrompt === undefined) {
      setWizardError(t('shell.noSession'))
      return
    }
    setWizardError(null)
    setWizardConfirming(true)
    void (async () => {
      try {
        if (!await routeSession(sessionId)) return
        await sendPrompt(sessionId, INTAKE_RETRY_COMMAND)
        void cloudSession.refresh()
      } catch (error: unknown) {
        setWizardError(fill(t('shell.onboardingSendFailed'), { detail: String(error) }))
      } finally {
        setWizardConfirming(false)
      }
    })()
  }

  /**
   * 结果卡的「更多讨论」：向同一会话再发一条第二轮讨论指令。
   *
   * 不新建会话、不重发立项咒语、不登记 .spec；发送在途即算在跑，阶段当场回到思考中。
   * 这一轮的提问仍走既有提问卡，结束后的新概要仍由 T-131 的结果卡呈现。
   */
  const discussIntakeMore = (): void => {
    if (wizardDiscussing) return
    if (sessionId === undefined || sendPrompt === undefined) {
      setWizardError(t('shell.noSession'))
      return
    }
    setWizardError(null)
    setWizardDiscussing(true)
    void (async () => {
      try {
        if (!await routeSession(sessionId)) return
        await sendPrompt(sessionId, INTAKE_MORE_DISCUSSION)
        void cloudSession.refresh()
      } catch (error: unknown) {
        setWizardError(fill(t('shell.onboardingSendFailed'), { detail: String(error) }))
      } finally {
        setWizardDiscussing(false)
      }
    })()
  }

  /** 已确认并落盘后直接回看板：关掉向导并重读投影，聊天会话留在原地。 */
  const openBoardFromWizard = (): void => {
    setWizardOpen(false)
    setResultPage(false)
    setReload(value => value + 1)
  }

  /** 结果卡采纳方案：成功才关向导并重读投影；失败原文留在卡上，不关。 */
  const approveWizardProposal = (): void => {
    if (wizardProposal === undefined || sessionId === undefined || approveProposal === undefined) return
    if (!requireUser('proposalApprove')) {
      setWizardApproveResult({ ok: false, text: fill(t('shell.cloudGateNotice'), { entry: t(CLOUD_ENTRY_LABEL.proposalApprove) }) })
      return
    }
    setWizardApproving(true)
    setWizardApproveResult(null)
    void approveProposal(sessionId, wizardProposal.id).then((outcome) => {
      setWizardApproveResult(outcome)
      if (!outcome.ok) return
      setWizardOpen(false)
      setResultPage(false)
      setReload(value => value + 1)
    }, (error: unknown) => {
      setWizardApproveResult({ ok: false, text: String(error) })
    }).finally(() => {
      setWizardApproving(false)
    })
  }

  /** 重开前的确认：计数是当前投影的事实，零也照实列出来。 */
  const requestIntakeRestart = (): void => {
    if (restarting || onboardingSending.current) return
    setRestartOpen(true)
  }

  /**
   * 确认后按原档位新建会话并重发咒语。
   *
   * 旧会话与已落盘内容一概不动；建会话失败只报原文，发送失败则新会话已经存在，
   * 照实切过去。向导开着时继续留在向导里等新一轮的提问或结果，不再叠开浮层。
   */
  const confirmIntakeRestart = (): void => {
    const tier = currentIntakeTier
    const fromWizard = wizardOpen
    setRestartOpen(false)
    if (tier === null) {
      if (fromWizard) setWizardError(t('shell.restartIntakeUnknown'))
      else setChatError(t('shell.restartIntakeUnknown'))
      return
    }
    if (projectPath === '' || createSession === undefined || sendPrompt === undefined) {
      if (fromWizard) setWizardError(t('shell.noSession'))
      else setChatError(t('shell.noSession'))
      return
    }
    if (onboardingSending.current) return
    onboardingSending.current = true
    setRestarting(true)
    setChatError(null)
    setWizardError(null)
    void runIntakeRestart({
      tier,
      project: { name: projectName, path: projectPath, branch: projectBranch },
      docs: info?.docs ?? { product: '', architecture: '', tests: '' },
      path: projectPath,
      createSession: path => createSession(path),
      sendPrompt,
    }).then((outcome) => {
      if (outcome.kind === 'create-failed') {
        if (fromWizard) setWizardError(outcome.error)
        else setChatError(outcome.error)
        return
      }
      setSessionOverride(outcome.sessionId)
      setReload(value => value + 1)
      if (fromWizard) {
        setWizardApproveResult(null)
        setWizardOpen(true)
        if (outcome.kind === 'send-failed') setWizardError(outcome.error)
        return
      }
      setResultPage(false)
      setChat(pseudoChat(t('shell.onboardingChat')))
      if (outcome.kind === 'send-failed') setChatError(outcome.error)
    }, (error: unknown) => {
      if (fromWizard) setWizardError(String(error))
      else setChatError(String(error))
    }).finally(() => {
      onboardingSending.current = false
      setRestarting(false)
    })
  }

  /** 图片被拒绝时就地说清是哪条上限；不把三种原因混成一句。 */
  const imageRejectionText = (rejection: ChatImageRejection): string => {
    switch (rejection.kind) {
      case 'unsupported-type': return t('shell.attachmentImageType')
      case 'too-large': return fill(t('shell.attachmentImageLarge'), { limit: formatBytes(rejection.limit) })
      case 'too-many': return fill(t('shell.attachmentImageCount'), { count: rejection.limit })
      case 'total-too-large': return fill(t('shell.attachmentImageTotal'), { limit: formatBytes(rejection.limit) })
    }
  }

  const nextAttachmentId = (): string => {
    attachmentSeq.current += 1
    return `attachment-${String(attachmentSeq.current)}`
  }

  /**
   * 读入用户选的附件。图片校验类型与体积后读成 base64；其余文件先上传拿回执。
   * 单条失败只影响这一条，其余继续加入。
   */
  const addFiles = async (selected: readonly File[]): Promise<void> => {
    if (chatSessionId === undefined) {
      setAttachError(t('shell.chatModelNoSession'))
      return
    }
    setAttachError(null)
    let current = attachments
    for (const file of selected) {
      if (file.type.startsWith('image/')) {
        const rejection = checkImageCandidate(
          file.type,
          file.size,
          current.filter((item): item is ChatPendingImage => item.kind === 'image'),
          chatImageLimits,
        )
        if (rejection !== null) {
          setAttachError(imageRejectionText(rejection))
          continue
        }
        try {
          const image: ChatPendingImage = {
            id: nextAttachmentId(),
            kind: 'image',
            name: file.name,
            bytes: file.size,
            mediaType: file.type as ChatPendingImage['mediaType'],
            data: await readFileBase64(file),
          }
          current = [...current, image]
          setAttachments(current)
        } catch (error: unknown) {
          setAttachError(fill(t('shell.attachmentReadFailed'), { detail: String(error) }))
        }
        continue
      }
      const id = nextAttachmentId()
      const pending: ChatPendingFile = { id, kind: 'file', name: file.name, bytes: file.size, status: 'uploading' }
      current = [...current, pending]
      setAttachments(current)
      attachmentFiles.current.set(id, file)
      if (uploadAttachment === undefined) {
        const failed = uploadedFile(id, file.name, file.size, {
          ok: false, code: 'unavailable', message: t('shell.chatModelNoSession'),
        })
        current = current.map(item => item.id === id ? failed : item)
        setAttachments(current)
        continue
      }
      try {
        const result = await uploadAttachment(chatSessionId, await readFileBase64(file), file.name)
        const done = uploadedFile(id, file.name, file.size, result)
        current = current.map(item => item.id === id ? done : item)
        setAttachments(current)
        if (done.status === 'ready') attachmentFiles.current.delete(id)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        const failed = uploadedFile(id, file.name, file.size, { ok: false, code: 'transport', message })
        current = current.map(item => item.id === id ? failed : item)
        setAttachments(current)
      }
    }
  }

  const removeAttachment = (id: string): void => {
    attachmentFiles.current.delete(id)
    setAttachments(current => current.filter(item => item.id !== id))
  }

  /** 重传失败的文件；原文件还在内存里，不用再选一次。 */
  const retryFile = async (id: string): Promise<void> => {
    const file = attachmentFiles.current.get(id)
    if (file === undefined || chatSessionId === undefined || uploadAttachment === undefined) return
    setAttachments(current => current.map(item => item.id === id && item.kind === 'file'
      ? { id: item.id, kind: 'file', name: item.name, bytes: item.bytes, status: 'uploading' as const }
      : item))
    try {
      const result = await uploadAttachment(chatSessionId, await readFileBase64(file), file.name)
      const done = uploadedFile(id, file.name, file.size, result)
      setAttachments(current => current.map(item => item.id === id ? done : item))
      if (done.status === 'ready') attachmentFiles.current.delete(id)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const failed = uploadedFile(id, file.name, file.size, { ok: false, code: 'transport', message })
      setAttachments(current => current.map(item => item.id === id ? failed : item))
    }
  }

  const sendDraft = async (): Promise<void> => {
    if (sendingRef.current || chatSessionId === undefined || sendPrompt === undefined
      || promptIsEmpty(draft, attachments) || !chatAttachmentsReady || modelBlocked) return
    const sendGate = gateEntry('onboardingFollowup', cloudFacts)
    if (sendGate.kind !== 'allow') {
      setChatError(sendGate.kind === 'blocked' && sendGate.reason === 'loading'
        ? t('shell.cloudGateLoading')
        : t('shell.cloudGateUnavailable'))
      return
    }
    const provider = sessionCloudProvider(chatSessionId)
    if ((provider === undefined || provider === CLOUD_LEGACY_GUEST_ROUTE)
      && !await routeSession(chatSessionId)) return
    const text = draft.trim()
    setChatError(null)
    setAttachError(null)
    sendingRef.current = true
    setSending(true)
    try {
      await sendPrompt(chatSessionId, buildPromptContent(text, attachments))
      setDraft('')
      setAttachments([])
      attachmentFiles.current.clear()
      void cloudSession.refresh()
    } catch (error: unknown) {
      // 失败保留草稿与附件：宿主拒绝图片附件时尤其要让人能换模型后重发。
      const failure = promptFailureOf(error)
      const detail = `${failure.code}: ${failure.message}`
      if (failure.reason === 'MODEL_DOES_NOT_SUPPORT_IMAGES') setChatError(t('shell.attachmentModelNoImage'))
      else if (failure.reason !== '') setChatError(fill(t('shell.attachmentRejected'), { detail }))
      else if (attachments.length > 0) setChatError(fill(t('shell.attachmentSendFailed'), { detail }))
      else setChatError(`${t('shell.sendRefused')}（${detail}）`)
    } finally {
      sendingRef.current = false
      setSending(false)
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
      setDrawer(false)
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
                  <span className={css.tag}>{t('shell.jobRole')} {roleLabelOf(task.role)}</span>
                  {waitingOn.length === 0
                    ? null
                    : <span className={`${css.tag} ${css.tagWarn}`}>{t('shell.dependsOn')} {waitingOn.join('、')}</span>}
                  {queueMark === undefined
                    ? null
                    : <span className={`${css.tag} ${css.tagQueued}`}>{fill(t('shell.queuePosition'), { n: queueMark.position })}</span>}
                  {task.rules.map(rule => <span key={rule} className={css.tag}>{rule}</span>)}
                  <span className={`${css.tag} ${task.state === 'closed' ? css.tagOk : ''}`}>{t(SURFACE_LABEL[task.state])}</span>
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

  /** 窗口按钮只在 Windows 桌面壳里出现；登录页只保留关闭，工作台用整组。 */
  const closeWindowButton = windowBridge === undefined ? null : (
    <button
      type="button"
      className={`${css.windowBtn} ${css.windowClose}`}
      title={t('shell.closeWindow')}
      aria-label={t('shell.closeWindow')}
      onClick={() => { runWindowCommand('close') }}
    >
      ✕
    </button>
  )
  const windowControls = windowBridge === undefined ? null : (
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
      {closeWindowButton}
    </div>
  )
  const loginWindowControls = windowBridge === undefined
    ? null
    : <div className={css.windowControls}>{closeWindowButton}</div>

  /** 顶栏只给逐套快速切换；设置弹窗里按名字明确选择。 */
  const skinLabel = t(SKIN_LABEL[skin])
  const cycleSkin = (): void => {
    setSkin(current => NEXT_SKIN[current])
  }

  /** 未登录（或登录状态读不出来）时只渲染全屏登录页；工作台不进入 DOM。 */
  if (!signedIn) {
    return (
      <div className={css.shell} data-skin={skin} data-chrome={windowBridge === undefined ? undefined : 'custom'}>
        <header
          className={css.loginChrome}
          data-lc-login-chrome=""
          onPointerDown={loginDrag.onPointerDown}
          onPointerMove={loginDrag.onPointerMove}
          onPointerUp={loginDrag.onPointerUp}
          onPointerCancel={loginDrag.onPointerCancel}
          onDoubleClick={windowBridge === undefined ? undefined : onTopbarDoubleClick}
        >
          <div className={css.spacer} />
          <button
            type="button"
            className={css.iconBtn}
            title={`${t('shell.skin')} · ${skinLabel}`}
            aria-label={`${t('shell.skin')} · ${skinLabel}`}
            onClick={cycleSkin}
          >
            <span className={`${css.skinOrb} ${SKIN_ORB[skin] ?? ''}`} aria-hidden="true" />
          </button>
          {loginWindowControls}
        </header>
        <CloudLoginScreen
          face={cloud}
          loading={cloudSession.loading}
          error={loginBlocked ? cloudSession.error : null}
          t={t}
          onRetry={() => { void cloudSession.refresh() }}
          onAuthenticated={() => cloudSession.refresh()}
        />
      </div>
    )
  }

  return (
    <div className={css.shell} data-skin={skin} data-chrome={windowBridge === undefined ? undefined : 'custom'}>
      <header className={css.topbar} onDoubleClick={windowBridge === undefined ? undefined : onTopbarDoubleClick}>
        <div className={css.topBrand}>
          <img className={css.topLogo} src={bullMark} alt="" />
          <span className={css.topTitle}>{t('shell.brand')}</span>
        </div>
        {/* 项目名只是一枚低调的入口：无底色，悬停才显，点击打开项目信息抽屉。 */}
        <button
          type="button"
          className={css.projectTrigger}
          title={t('shell.projectInfo')}
          onClick={() => { setDrawer(true) }}
        >
          <span className={css.psName}>{hasWorkspace ? projectName : t('shell.chooseProject')}</span>
          <span className={css.psChevron} aria-hidden="true">⌄</span>
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
              onClick={() => {
                if (!requireUser('newSession')) return
                setRolePicker(true)
              }}
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
            <button
              type="button"
              className={`${css.agentChip} ${dashboardPage ? css.agentChipActive : ''}`}
              onClick={() => {
                setDashboardPage(true)
                setResultPage(false)
                setPersonalPage(false)
              }}
            >
              {t('shell.dashboard')}
            </button>
          </div>
        )}
        {!hasWorkspace ? null : (
          <button type="button" className={css.workBtn} onClick={() => { setFlowOpen(true) }}>
            {t('shell.startWork')}
          </button>
        )}
        <div className={css.spacer} />
        <CloudAccountButton
          state={cloudSession.state}
          t={t}
          onClick={() => { setAccountOpen(true) }}
        />
        <button
          type="button"
          className={css.iconBtn}
          title={`${t('shell.skin')} · ${skinLabel}`}
          aria-label={`${t('shell.skin')} · ${skinLabel}`}
          onClick={cycleSkin}
        >
          <span className={`${css.skinOrb} ${SKIN_ORB[skin] ?? ''}`} aria-hidden="true" />
        </button>
        <button type="button" className={css.iconBtn} title={t('shell.settings')} onClick={() => { setSettings(true) }}>⚙</button>
        {windowControls}
      </header>

      <main className={css.main}>
        {personalPage ? (
          <PersonalCenter
            face={cloud}
            state={cloudSession.state}
            t={t}
            onBack={() => { setPersonalPage(false) }}
          />
        ) : null}
        {dashboardPage && !personalPage ? (
          <AgentDashboardPage
            t={t}
            sessions={dashboardRows}
            summary={dashboardSummary}
            events={dashboardEvents}
            eventProblems={dashboardEventProblems}
            loading={dashboardLoading}
            error={dashboardEventError}
            graph={dashboardGraph()}
            onOpenTask={(taskId) => {
              const task = tasks.find(row => row.id === taskId)
              if (task !== undefined) openTask(task)
            }}
            onBack={() => { setDashboardPage(false) }}
            onRefresh={refreshDashboard}
          />
        ) : null}
        {resultPage && !personalPage && !dashboardPage ? (
          <IntakeResultPage
            t={t}
            proposals={proposals}
            tasks={tasks}
            info={info}
            problems={problems}
            modelBlocked={modelBlocked}
            canRestart={currentIntakeTier !== null}
            onBack={() => { setResultPage(false) }}
            onRestart={requestIntakeRestart}
            onStartOnboarding={(kind) => { setResultPage(false); startOnboarding(kind) }}
          />
        ) : null}
        {resultPage || personalPage || dashboardPage ? null : <div className={css.boardWrap}>
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
            <div className={css.boardActions}>
              {!hasWorkspace || !hasSession ? null : (
                <button type="button" className={css.pillBtn} onClick={() => { setResultPage(true) }}>
                  {t('shell.intakeResult')}
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
                  {mappedLabel(DIFFICULTY_LABEL, grade, t)}
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
        </div>}
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
              <details className={css.drawerSection}>
                <summary className={css.drawerSectionSummary}>
                  <span className={css.drawerSectionTitle}>{t('shell.switchProject')}</span>
                  <span className={css.drawerSectionCurrent}>{hasWorkspace ? projectName : t('shell.chooseProject')}</span>
                </summary>
                <p className={css.drawerHint}>{t('shell.projectPickerHint')}</p>
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
                            onClick={() => { setWorkspaceId(id); setSessionOverride(null); setDrawer(false); setResultPage(false) }}
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
              </details>

              <details className={css.drawerSection}>
                <summary className={css.drawerSectionSummary}>
                  <span className={css.drawerSectionTitle}>{t('shell.basic')}</span>
                </summary>
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
              </details>

              <details className={css.drawerSection}>
                <summary className={css.drawerSectionSummary}>
                  <span className={css.drawerSectionTitle}>{t('shell.docs')}</span>
                </summary>
                <div className={css.docRow}><span>{t('shell.productDoc')}</span><code>{info?.docs.product || '—'}</code></div>
                <div className={css.docRow}><span>{t('shell.architectureDoc')}</span><code>{info?.docs.architecture || '—'}</code></div>
                <div className={css.docRow}><span>{t('shell.tests')}</span><code>{info?.docs.tests || '—'}</code></div>
              </details>

              <details className={css.drawerSection}>
                <summary className={css.drawerSectionSummary}>
                  <span className={css.drawerSectionTitle}>{t('shell.environments')}</span>
                </summary>
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
              </details>
            </div>
          </aside>
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
          {isRequirementTask(detail) ? (
            <div className={`${css.modal} ${css.requirementModal}`} role="dialog" aria-modal="true" aria-label={`${detail.id} ${detail.title}`}>
              <RequirementCard
                t={t}
                task={detail}
                requirementDocument={detailRequirement}
                document={requirementDocument}
                proposal={detailProposal}
                answers={requirementAnswers}
                splitting={detailSplitFlow?.status === 'running'}
                error={detailSplitFlow?.errorText ?? splitError}
                flow={detailSplitFlow}
                onClose={() => { setDetail(null) }}
                onSplit={(document) => { void splitRequirement(detail, document) }}
                onViewBoard={() => { setDetail(null) }}
              />
            </div>
          ) : (
            <div className={css.modal} role="dialog" aria-modal="true" aria-label={`${detail.id} ${detail.title}`}>
              <div className={css.modalHead}>
                <div className={css.grow}>
                  <h3>{detail.id} · {detail.title}</h3>
                  <p className={css.detailDescription}>{detail.description.trim() || t('shell.noDescription')}</p>
                  {detail.category === undefined && detail.changeType === undefined ? null : (
                    <div className={css.detailTags}>
                      {detail.category === undefined
                        ? null
                        : <span className={css.detailTag}>{mappedLabel(CATEGORY_LABEL, detail.category, t)}</span>}
                      {detail.changeType === undefined
                        ? null
                        : <span className={css.detailTag}>{mappedLabel(CHANGE_TYPE_LABEL, detail.changeType, t)}</span>}
                    </div>
                  )}
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
                {detail.attachments.length === 0 ? null : (
                  <TaskAttachments t={t} sessionId={sessionId} paths={detail.attachments} read={readAttachment} />
                )}
                <dl className={css.metaStrip}>
                  <div className={css.metaItem}>
                    <dt className={css.metaK}>{t('shell.difficulty')}</dt>
                    <dd className={css.metaV}>{mappedLabel(DIFFICULTY_LABEL, detail.grade, t)}</dd>
                  </div>
                  <div className={css.metaItem}>
                    <dt className={css.metaK}>{t('shell.jobRole')}</dt>
                    <dd className={css.metaV}>
                      {roleLabelOf(detail.role)}
                      <button
                        type="button"
                        className={css.metaHelp}
                        aria-label={t('shell.roleDialogTitle')}
                        onClick={openRoleDialog}>
                        ?
                      </button>
                    </dd>
                  </div>
                  {detail.dependsOn === undefined
                    ? null
                    : (
                      <div className={css.metaItem}>
                        <dt className={css.metaK}>{t('shell.dependsOn')}</dt>
                        <dd className={css.metaV}>{detail.dependsOn.join('、')}</dd>
                      </div>
                    )}
                  {detailSchedule?.queue === undefined
                    ? null
                    : (
                      <div className={css.metaItem}>
                        <dt className={css.metaK}>{t('shell.queuedIn')}</dt>
                        <dd className={css.metaV}>
                          {sessionLabel(detailSchedule.queue.sessionId)}
                          {' · '}
                          {fill(t('shell.queuePosition'), { n: detailSchedule.queue.position })}
                        </dd>
                      </div>
                    )}
                  {detailJoint === undefined
                    ? null
                    : (
                      <div className={css.metaItem}>
                        <dt className={css.metaK}>{t('shell.jointGroup')}</dt>
                        <dd className={css.metaV}>
                          {t('shell.jointMembers')}：{detailJoint.members.join('、')}
                          {' · '}
                          {t('shell.jointAcceptance')}
                          {detailJoint.createdAt === undefined
                            ? ''
                            : ` · ${fill(t('shell.jointCreatedAt'), { at: detailJoint.createdAt })}`}
                        </dd>
                      </div>
                    )}
                </dl>
                <details className={css.metaMore}>
                  <summary className={css.metaMoreSummary}>{t('shell.more')}</summary>
                  <dl className={css.metaMoreList}>
                    <div className={css.metaMoreItem}>
                      <dt><span className={css.metaMoreLabel}>{t('shell.rules')}</span><span className={css.metaHint}>{t('shell.rulesHint')}</span></dt>
                      <dd>{detail.rules.join('、') || '—'}</dd>
                    </div>
                    <div className={css.metaMoreItem}>
                      <dt><span className={css.metaMoreLabel}>{t('shell.evidence')}</span><span className={css.metaHint}>{t('shell.evidenceHint')}</span></dt>
                      <dd>{detail.evidence.join('、') || '—'}</dd>
                    </div>
                    <div className={css.metaMoreItem}>
                      <dt><span className={css.metaMoreLabel}>{t('shell.surface')}</span><span className={css.metaHint}>{t('shell.surfaceHint')}</span></dt>
                      <dd>{t(SURFACE_LABEL[detail.state])}</dd>
                    </div>
                  </dl>
                </details>
                {detailSchedule === undefined || scheduleErrors[detail.id] === undefined
                  ? null
                  : <p className={css.problem}>{fill(t('shell.scheduleLogFailed'), { detail: scheduleErrors[detail.id] ?? '' })}</p>}
                <div className={css.field}>
                  <label>
                    {t('shell.contract')}
                    {detailContract === undefined ? null : <span className={css.labelHint}> {t('shell.contractHint')}</span>}
                  </label>
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
                {/* 「打开对话」没打开浮层时，原因就地显示在这里——浮层本身还没被切出来。 */}
                {chatError === null ? null : <p className={css.problem}>{chatError}</p>}
              </div>
              <div className={css.modalFoot}>
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
          )}
        </div>
      ) : null}

      {detail !== null && roleDialogOpen ? (
        <div
          className={`${css.modalBackdrop} ${css.modalNested}`}
          onClick={(event) => { if (event.target === event.currentTarget) closeRoleDialog() }}
        >
          <div
            className={`${css.modal} ${css.modalSmall}`}
            role="dialog"
            aria-modal="true"
            aria-label={t('shell.roleDialogTitle')}
          >
            <div className={css.modalHead}>
              <div className={css.grow}>
                <h3>{t('shell.roleDialogTitle')}</h3>
                <p>{fill(t('shell.roleDialogCurrent'), { role: roleLabelOf(detail.role) })}</p>
              </div>
              <button type="button" className={css.iconBtn} onClick={closeRoleDialog}>✕</button>
            </div>
            <div className={css.modalBody}>
              {jobRoles.length === 0
                ? <p className={css.empty}>{t('shell.roleRosterEmpty')}</p>
                : (
                  <div className={css.roleRow}>
                    {jobRoles.map((row) => {
                      const suggested = recommendedRole === row.id
                      return (
                        <button
                          type="button"
                          key={row.id}
                          aria-pressed={roleAssignChoice === row.id}
                          className={`${css.roleChip} ${roleAssignChoice === row.id ? css.roleChipActive : ''}${suggested ? ` ${css.roleChipSuggested}` : ''}`}
                          onClick={() => { setRoleAssignChoice(row.id) }}
                        >
                          {row.name}
                          {suggested ? <span className={css.roleChipBadge}>{t('shell.roleHintBadge')}</span> : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              {assignResult === null ? null : (
                <p className={assignResult.ok ? css.secretRef : css.problem}>{assignResult.text}</p>
              )}
            </div>
            <div className={css.modalFoot}>
              <div className={css.spacer} />
              <button type="button" className={css.secondaryBtn} onClick={closeRoleDialog}>{t('shell.cancel')}</button>
              <button
                type="button"
                className={css.primaryBtn}
                disabled={assigning || assignTask === undefined || !hasSession || roleAssignChoice === ''}
                onClick={() => { void assignSelected() }}
              >
                {assigning ? t('shell.assigning') : t('shell.roleDialogConfirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {chat !== null ? (
        <div className={css.floating} data-max={chatMax ? 'true' : undefined}>
          <div className={css.floatingBackdrop} onClick={() => { setChatMax(false); setChat(null) }} />
          <div className={css.floatingInner} style={chatStyle}>
            <div
              className={css.chatWindow}
              data-max={chatMax ? 'true' : undefined}
              onDragOver={(event) => { event.preventDefault() }}
              onDrop={(event) => { event.preventDefault() }}
            >
              <div className={css.chatHead}>
                <div className={css.grow}>
                  <h4>{chat.id === '' ? chat.title : `${chat.id} · ${chat.title}`}</h4>
                  <p>{t('shell.brand')} · {t(STATE_LABEL[chat.state])} · {t('shell.chatHint')}</p>
                  <p className={css.chatContext}>{contextUsageText(chatPressure)}</p>
                </div>
                <ChatModelChip
                  t={t}
                  face={modelSettings}
                  sessionId={chatSessionId}
                  selection={chatModelSelection}
                  onChanged={() => { modelRefresh.current() }}
                />
                {chatIntakeTier === null ? null : (
                  <button
                    type="button"
                    className={css.pillBtn}
                    disabled={chatRunning || sending || restarting}
                    title={chatRunning ? t('shell.restartIntakeRunning') : undefined}
                    onClick={requestIntakeRestart}
                  >
                    {t('shell.restartIntake')}
                  </button>
                )}
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
              <div className={css.chatBody} ref={chatBodyRef}>
                <ChatTranscript messages={messages} running={chatRunning} t={t} />
                {chatError === null ? null : <p className={css.problem}>{chatError}</p>}
                {notice === null ? null : notice.code === undefined
                  ? <p className={css.problem}>{`${t(notice.key)} ${notice.detail}`}</p>
                  : (
                    <div className={css.problem}>
                      <p className={css.problem}>{t(cloudErrorKey(notice.code))}</p>
                      {notice.requestId === undefined
                        ? null
                        : <p className={css.secretRef}>{t('shell.cloudRequestId')}: {notice.requestId}</p>}
                      {cloudNextKey(notice.code) === undefined
                        ? null
                        : <p className={css.secretRef}>{t(cloudNextKey(notice.code) as LcoderWorkspaceKey)}</p>}
                    </div>
                  )}
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
              <div
                className={css.composer}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  void addFiles([...event.dataTransfer.files])
                }}
              >
                {dragging ? <div className={css.attachDrop}>{t('shell.attachmentDrop')}</div> : null}
                <ChatAttachmentList
                  t={t}
                  attachments={attachments}
                  limits={chatImageLimits}
                  onRemove={removeAttachment}
                  onRetry={(id) => { void retryFile(id) }}
                />
                {attachError === null ? null : <p className={css.attachErrorLine}>{attachError}</p>}
                <div className={css.chatInput}>
                  <ChatAttachButton
                    t={t}
                    disabled={chatSessionId === undefined}
                    onFiles={(files) => { void addFiles(files) }}
                  />
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
                    disabled={!chatCanSend}
                    onClick={() => { void sendDraft() }}
                  >
                    {sending ? t('shell.sending') : t('shell.send')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {wizardOpen ? (
        <IntakeWizard
          t={t}
          phase={wizardPhase}
          error={wizardError ?? chatError}
          question={wizardQuestion}
          processItems={wizardOutput.items}
          modelState={intakeModelState}
          models={intakeModels}
          selectedModel={intakeModelSelected}
          modelBlocked={modelBlocked}
          sending={wizardSending}
          proposal={wizardProposal ?? null}
          result={wizardResultView}
          summary={wizardOutput.summary}
          confirmed={wizardConfirmed}
          confirming={wizardConfirming}
          landed={wizardLanded}
          notice={wizardNotice}
          tasks={tasks}
          running={wizardRunFact}
          approving={wizardApproving}
          approveResult={wizardApproveResult}
          canApprove={approveProposal !== undefined && sessionId !== undefined}
          restartBusy={restarting}
          discussing={wizardDiscussing}
          onCancel={closeIntakeWizard}
          onConfirm={confirmIntakeWizard}
          onSelectModel={setWizardModelChoice}
          onLoadModels={loadIntakeModels}
          onOpenSettings={() => { setSettings(true) }}
          onApprove={approveWizardProposal}
          onConfirmNeed={confirmIntakeRequirement}
          onRetry={retryIntakeRequirement}
          onOpenBoard={openBoardFromWizard}
          onDiscuss={discussIntakeMore}
          onRestart={requestIntakeRestart}
        />
      ) : null}

      {restartOpen ? (
        <IntakeRestartDialog
          t={t}
          artifacts={restartArtifacts}
          busy={restarting}
          onCancel={() => { if (!restarting) setRestartOpen(false) }}
          onConfirm={confirmIntakeRestart}
        />
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
                <div className={css.settingRow}>
                  <div className={css.settingLabel}>
                    <span className={css.settingLabelB}>{t('shell.skin')}</span>
                    <span className={css.settingLabelSpan}>{t('shell.skinHint')}</span>
                  </div>
                  <div className={css.skinPresets} role="group" aria-label={t('shell.skin')}>
                    {SKINS.map((value) => {
                      const label = t(SKIN_LABEL[value])
                      return (
                        <button
                          type="button"
                          key={value}
                          className={`${css.skinOption} ${skin === value ? css.skinOptionOn : ''}`}
                          aria-pressed={skin === value}
                          onClick={() => { setSkin(value) }}
                        >
                          <span
                            className={`${css.skinSwatch} ${SKIN_SWATCH[value] ?? ''}`}
                            aria-hidden="true"
                          />
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
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

      {accountOpen ? (
        <CloudDialog
          face={cloud}
          state={cloudSession.state}
          t={t}
          onClose={() => { setAccountOpen(false) }}
          onChanged={() => { void cloudSession.refresh() }}
          onOpenPersonalCenter={() => {
            setAccountOpen(false)
            setDashboardPage(false)
            setPersonalPage(true)
            void cloudSession.refresh()
          }}
        />
      ) : null}
    </div>
  )
}
