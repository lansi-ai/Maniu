/** 需求页：列表、搜索、状态筛选；四类操作按流程配置逐岗推进，进度走操作浮卡；新建需求与改稿走提案对比确认。 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { Button, Card, Chip, SearchField, SearchFieldClearButton, SearchFieldGroup, SearchFieldInput, Separator, Table, Tabs } from '@heroui/react'
import { Plus, Sparkles, X } from 'lucide-react'
import { runCommand } from '../commands/run.ts'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { SessionSummary } from '../store.ts'
import type { ProposalRow, RequirementDocRow, RequirementReviewRow } from '../spec/rows.ts'
import { requirementStateLabel } from '../spec/board.ts'
import { hasIntakeWork } from '../intake/eligibility.ts'
import {
  buildArchitectPlanPrompt,
  buildIntakeFollowupPrompt,
  buildManagerSplitPrompt,
  buildRequirementAmendPrompt,
  buildRequirementCreatePrompt,
  buildRequirementDeltaPrompt,
  buildRequirementMilestonePrompt,
  buildRequirementPatchPrompt,
  buildReviewPrompt,
  buildRevisePrompt,
  BUILTIN_SPLIT_TRACKS,
  type ReviewDecisions,
} from '../intake/prompts.ts'
import { INTAKE_PRESET_ID, MANAGER_PRESET_ID, PM_PRESET_ID, REQUIREMENT_EDITOR_PRESET_ID } from '../talents/model.ts'
import { entryRoot, flowNodeOf, flowRoleLabel, flowRoleSource, presetOfRole, presetRoot } from '../flow/config.ts'
import { canModifyDraft, canReviewRequirement } from './requirement-gate.ts'
import { translate, type MessageKey, type Translate } from '../locale.ts'
import {
  pendingForSession, questionCountForSession, unmappedPending, type PendingInteraction,
} from '../chat/pending.ts'
import { OperationCards, type OperationCardView, type OperationStep, type OperationStepState } from '../shell/operation-cards.tsx'
import { useOpLiveFeeds, type OpLiveFeed } from '../shell/op-live-feed.ts'
import { RequirementDetail, type ModifyState, type RunningOpKind } from './requirement-detail.tsx'
import { TaskDetail } from './task-detail.tsx'
import { ReaderOverlay } from './reader.tsx'
import { IntakeWizard, type IntakeResult } from './intake-wizard.tsx'
import { ChangeTriageModal, type ChangeTriageConfirmPayload } from './change-triage-modal.tsx'
import { ProposalCompare } from './proposal-compare.tsx'
import { DetailDrawer } from './detail-drawer.tsx'
import { IntakeSummary } from './intake-summary.tsx'

/** 工作台页面尚未全面接入词典，未传取词函数时沿用中文；新客户端可传入自己的取词函数。 */
const zhText: Translate = (key, params) => translate('zh', key, params)

/** 后台操作的轮询间隔与等待上限。 */
const OP_POLL_MS = 4000
const OP_TIMEOUT_MS = 5 * 60 * 1000

/** 后台操作类型；立项调研、新建需求、草稿修改与 S/M/L 变更通道都走后台浮卡，不强制跳转对话。 */
type OpKind = 'intake' | 'create' | 'review' | 'revise' | 'patch' | 'amend' | 'delta' | 'milestone' | 'split'

const OP_RUNNING_KEY: Readonly<Record<OpKind, MessageKey>> = {
  intake: 'requirement.opRunning.intake',
  create: 'requirement.opRunning.create',
  review: 'requirement.opRunning.review',
  revise: 'requirement.opRunning.revise',
  patch: 'requirement.opRunning.patch',
  amend: 'requirement.opRunning.amend',
  delta: 'requirement.opRunning.delta',
  milestone: 'requirement.opRunning.milestone',
  split: 'requirement.opRunning.split',
}

const OP_DONE_KEY: Readonly<Record<OpKind, MessageKey>> = {
  intake: 'requirement.opDone.intake',
  create: 'requirement.opDone.create',
  review: 'requirement.opDone.review',
  revise: 'requirement.opDone.revise',
  patch: 'requirement.opDone.patch',
  amend: 'requirement.opDone.amend',
  delta: 'requirement.opDone.delta',
  milestone: 'requirement.opDone.milestone',
  split: 'requirement.opDone.split',
}

const OP_TITLE_KEY: Readonly<Record<OpKind, MessageKey>> = {
  intake: 'requirement.opTitle.intake',
  create: 'requirement.opTitle.create',
  review: 'requirement.opTitle.review',
  revise: 'requirement.opTitle.revise',
  patch: 'requirement.opTitle.patch',
  amend: 'requirement.opTitle.amend',
  delta: 'requirement.opTitle.delta',
  milestone: 'requirement.opTitle.milestone',
  split: 'requirement.opTitle.split',
}

/** 需求状态到 HeroUI Chip 语义色的映射；文案仍走 board 的词典标签。 */
function stateChipColor(value: string): 'default' | 'accent' | 'success' | 'warning' {
  if (value === 'draft') return 'warning'
  if (value === 'confirmed') return 'accent'
  if (value === 'released') return 'success'
  return 'default'
}

/** 岗位解析不了时的节点默认 preset；正常配置都能解析到岗位自己的 preset。 */
const OP_PRESET: Readonly<Record<OpKind, string>> = {
  intake: INTAKE_PRESET_ID,
  create: INTAKE_PRESET_ID,
  review: PM_PRESET_ID,
  revise: INTAKE_PRESET_ID,
  patch: REQUIREMENT_EDITOR_PRESET_ID,
  amend: INTAKE_PRESET_ID,
  delta: INTAKE_PRESET_ID,
  milestone: INTAKE_PRESET_ID,
  split: MANAGER_PRESET_ID,
}

/** 一次节点运行的身份：一节点一卡，卡内按岗位推进。 */
interface OpRun {
  readonly key: string
  readonly kind: OpKind
  /** 立项调研没有需求编号，用 null；完成看需求条数增量。 */
  readonly requirementId: string | null
  readonly roles: readonly string[]
  readonly auto: boolean
  /** 改稿节点携带的用户逐条裁决；其它节点不带。 */
  readonly decisions?: ReviewDecisions | undefined
}

/** 当前岗位的磁盘事实基线；完成判定只看投影相对基线的增量。 */
interface OpWatch extends OpRun {
  readonly roleIndex: number
  readonly sessionId: string | null
  readonly reviewRound: number
  readonly versions: number
  readonly related: number
  readonly planAt: string | null
  /** 发起 S 级轻量修补时已有的补丁计数；完成看它是否增加。 */
  readonly amendCount: number
  readonly requirements: number
  /** 发起时已有的提案编号；之后新出现的起草态需求变更提案算本次操作的产物。 */
  readonly proposalIds: readonly string[]
  /** 评审完成须匹配的条目内置根；null 表示不要求（无配置或非评审节点）。 */
  readonly roleSig: string | null
  readonly deadline: number
}

/** 人工衔接的节点运行：前一岗已落盘，等人点「下一岗位」。 */
interface PausedOp extends OpRun {
  /** 下一个要发起的岗位序号；之前的岗位都已落盘。 */
  readonly roleIndex: number
  readonly sessionId: string | null
}

/** 失败卡的具体原因：区分真实超时、模型输出超限、会话报错与回合结束未落盘。 */
type OpFailReason =
  | { readonly kind: 'timeout' }
  | { readonly kind: 'max-tokens' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ended' }

/** 已结束的操作卡：完成保持绿色、失败给警示色，直到用户关闭。 */
interface FinishedOp extends OpRun {
  readonly sessionId: string | null
  readonly status: 'done' | 'failed'
  /** 已落盘的岗位数；失败时指向出事的那一岗。 */
  readonly landed: number
  /** 提案被拒绝而收口的操作：按完成关卡，但状态文案说明是被拒绝。 */
  readonly cancelled?: boolean
  /** 失败原因；未设置时按等待超时处理。 */
  readonly failReason?: OpFailReason
  /** 失败瞬间保留的最后一段实时输出，方便用户在卡上直接看到停在哪里。 */
  readonly liveFeed?: OpLiveFeed
}

/** 页外状态筛选：`seq` 变化即重新应用，即使筛选值与上次相同。 */
export interface RequirementStateFilter {
  readonly seq: number
  readonly value: string
}

/** 从总览页带来的入口意图；`seq` 变化才重新执行一次。 */
export type RequirementsIntent =
  | { readonly seq: number; readonly kind: 'intake' }
  | { readonly seq: number; readonly kind: 'focus'; readonly id: string }

/** 需求页属性。 */
export interface RequirementsPageProps {
  readonly project: ProjectScope | null
  readonly projection: SpecProjection
  readonly sessions: readonly SessionSummary[]
  readonly loading: boolean
  readonly error: string | null
  readonly intakeResult: IntakeResult | null
  readonly onClearIntakeResult: () => void
  readonly onReload: () => void
  readonly onStartIntake: (prompt: string) => Promise<{ readonly ok: boolean; readonly message: string; readonly sessionId?: string }>
  /** 后台新建会话并发送指令，不跳转对话；`preset` 缺省沿用工作台角色，成功时带回会话号。 */
  readonly onStartSession: (
    prompt: string,
    preset?: string,
  ) => Promise<{ readonly ok: boolean; readonly message: string; readonly sessionId?: string }>
  /** 自愿打开一条会话并进入对话页；超时提示里的入口走它。 */
  readonly onOpenSession: (sessionId: string) => void
  /** 立项等待确认时向该会话发送「确认需求」指令；不跳转对话。 */
  readonly onConfirmIntake?: (sessionId: string) => Promise<{ readonly ok: boolean; readonly message: string }>
  /** 跳到任务页并只显示该需求关联的任务。 */
  readonly onOpenTasks: (requirementId: string) => void
  /** 跳到原型库页面预览或管理组件素材库。 */
  readonly onOpenPrototypeLibrary?: (() => void) | undefined
  /** 跳到原型页查看项目活原型；参数是当前需求上下文。 */
  readonly onOpenPrototype?: ((requirementId: string) => void) | undefined
  /** preset 名册显示名；浮卡子标题取它，读不到回退词典。 */
  readonly presetNames?: Readonly<Record<string, string>>
  /** 当前是否有等待人工回答或审批的交互；交互期间暂停浮卡超时倒计时。 */
  readonly awaitingAnswer?: boolean
  /** 待处理交互；按会话归属到对应任务卡，没有归属的走中性兜底入口。 */
  readonly pending?: readonly PendingInteraction[]
  /** 打开作答弹窗；参数是要在弹窗里展示的交互 id 集合。 */
  readonly onAnswerPending?: (ids: readonly string[]) => void
  /** 取词函数；缺省为中文词典。 */
  readonly t?: Translate
  /** 总览漏斗带来的状态筛选；变化时覆盖页内选择。 */
  readonly stateFilter?: RequirementStateFilter | undefined
  /** 总览页带来的入口意图：立项向导或指定需求详情。 */
  readonly intent?: RequirementsIntent | undefined
}

/**
 * 需求页。
 * @param props - 投影与项目。
 * @returns 页面。
 */
export function RequirementsPage(props: RequirementsPageProps): JSX.Element {
  const t = props.t ?? zhText
  const [text, setText] = useState('')
  const [state, setState] = useState('')
  // 总览漏斗是页外控制：筛选代际变化时覆盖页内的状态选择，页内切换仍照常生效。
  const appliedStateFilter = useRef(0)
  const stateFilter = props.stateFilter
  if (stateFilter !== undefined && stateFilter.seq !== appliedStateFilter.current) {
    appliedStateFilter.current = stateFilter.seq
    if (state !== stateFilter.value) setState(stateFilter.value)
  }
  const [selected, setSelected] = useState<string | null>(null)
  /** 版本号徽标直达详情时携带的历史抽屉入口；普通行点击不带这个标志。 */
  const [historyEntry, setHistoryEntry] = useState<{ readonly seq: number; readonly open: boolean }>({ seq: 0, open: false })
  const [taskId, setTaskId] = useState<string | null>(null)
  const [readerPath, setReaderPath] = useState<string | null>(null)
  const [wizard, setWizard] = useState(false)
  const [triageOpen, setTriageOpen] = useState(false)
  const [triageTargetId, setTriageTargetId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createText, setCreateText] = useState('')
  // 「修改需求」收敛到同一详情：只收集修改说明；提交非空说明才发起草稿修改会话，取消不写数据。
  const [modifyOpen, setModifyOpen] = useState(false)
  const [modifyText, setModifyText] = useState('')
  const [modifyRow, setModifyRow] = useState<RequirementDocRow | null>(null)
  const [patchError, setPatchError] = useState<string | null>(null)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [closeTarget, setCloseTarget] = useState<RequirementDocRow | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  /** 打开详情前的焦点入口；关闭详情后归位。 */
  const detailTriggerRef = useRef<HTMLElement | null>(null)
  // 正在就地预览概要的浮卡键；会话号从对应 watch 上取，避免把会话号塞进卡片外观。
  const [summaryKey, setSummaryKey] = useState<string | null>(null)
  const [opNotice, setOpNotice] = useState<string | null>(null)
  const [watches, setWatches] = useState<readonly OpWatch[]>([])
  const [paused, setPaused] = useState<readonly PausedOp[]>([])
  const [finished, setFinished] = useState<readonly FinishedOp[]>([])
  const [minimizedKeys, setMinimizedKeys] = useState<readonly string[]>([])
  // 已发确认指令的立项卡键：回合再次跑起来前不重复进入等待确认态，防止连发。
  const [confirmSent, setConfirmSent] = useState<readonly string[]>([])
  // 见过回合跑起来的操作卡键：刚发起尚未开跑的会话不算「回合结束」，不误判等待确认或异常结束。
  const [sawRunning, setSawRunning] = useState<readonly string[]>([])
  // 记录会话结束后等待落盘投影追平的宽限轮次；满 2 轮仍未见产物再立即报错收口。
  const endedGraceRef = useRef<Map<string, number>>(new Map())
  const watchSessionIds = useMemo(
    () => watches.flatMap(item => item.sessionId === null ? [] : [item.sessionId]),
    [watches],
  )
  const liveFeeds = useOpLiveFeeds(watchSessionIds)
  const loadingRef = useRef(props.loading)
  loadingRef.current = props.loading
  const flow = props.projection.flow
  const reviewConfigured = flow?.nodes.some(node => node.node === 'review') === true
  const busyOf = (kind: OpKind, requirementId: string | null) =>
    watches.some(item => item.kind === kind && item.requirementId === requirementId)
    || paused.some(item => item.kind === kind && item.requirementId === requirementId)

  /** 该需求是否有任意在途操作：浮卡在跑或人工衔接暂停都算，供列表行与详情做互斥锁定。 */
  // 草稿修改提案落盘待裁决时 watch 仍在，因此 patch 也返回非空；查看差异不在此锁内。
  const runningOpOf = (requirementId: string): RunningOpKind | null => {
    const inFlight = watches.find(item => item.requirementId === requirementId)
      ?? paused.find(item => item.requirementId === requirementId)
    if (inFlight === undefined) return null
    const kind = inFlight.kind
    return kind === 'review' || kind === 'revise' || kind === 'patch' || kind === 'split' || kind === 'amend' || kind === 'delta' ? kind : null
  }

  const rows = useMemo(() => {
    const query = text.trim().toLowerCase()
    return props.projection.requirements.filter((row) => {
      if (state !== '' && row.state !== state) return false
      if (query === '') return true
      return `${row.id} ${row.title ?? ''} ${row.text}`.toLowerCase().includes(query)
    })
  }, [props.projection.requirements, state, text])

  // 状态胶囊的数量角标从全量投影统计，不受搜索词影响；这只改呈现，不参与过滤。
  const stateTabs = useMemo(() => {
    const all = props.projection.requirements
    return [
      { id: 'all', label: '全部', count: all.length },
      { id: 'draft', label: '草稿', count: all.filter(row => row.state === 'draft').length },
      { id: 'confirmed', label: '已确认', count: all.filter(row => row.state === 'confirmed').length },
      { id: 'released', label: '已上线', count: all.filter(row => row.state === 'released').length },
      { id: 'closed', label: '已关闭', count: all.filter(row => row.state === 'closed').length },
    ]
  }, [props.projection.requirements])

  const selectState = (key: unknown): void => {
    setState(key === 'all' ? '' : typeof key === 'string' ? key : '')
  }

  const active = rows.find(row => row.id === selected) ?? null
  const detailTask = taskId === null ? undefined : props.projection.tasks.find(task => task.id === taskId)

  const relatedOf = (requirementId: string) => props.projection.tasks.filter(
    task => task.requirement === requirementId || task.proposal === requirementId,
  )

  const splitPromptOf = (
    row: RequirementDocRow,
    preset: string,
    previousProposalIds?: readonly string[],
  ): string => {
    if (presetRoot(preset) === 'architect') {
      return buildArchitectPlanPrompt(
        { id: row.id, title: row.title ?? row.id },
        row.text,
        props.projection.proposals.map(item => ({
          id: item.id,
          title: item.title,
          recommendation: item.recommendation,
        })),
      )
    }
    const extra = (props.projection.project?.tracks ?? []).map(track => `${track.id}（${track.name}）`)
    const technicalPlan = (
      previousProposalIds === undefined
        ? undefined
        : [...props.projection.proposals].reverse().find(item => !previousProposalIds.includes(item.id))
    ) ?? [...props.projection.proposals].reverse().find(item => item.title.includes(`[${row.id}]`))
    return buildManagerSplitPrompt(
      { id: row.id, title: row.title ?? row.id },
      row.text,
      [...BUILTIN_SPLIT_TRACKS, ...extra],
      technicalPlan === undefined
        ? undefined
        : {
          id: technicalPlan.id,
          title: technicalPlan.title,
          recommendation: technicalPlan.recommendation,
        },
    )
  }

  const promptOf = (
    kind: OpKind,
    row: RequirementDocRow | null,
    decisions?: ReviewDecisions,
    preset?: string,
    previousProposalIds?: readonly string[],
  ): string => {
    if (row === null) {
      return buildIntakeFollowupPrompt({ name: props.project?.title ?? '', path: props.project?.path ?? '' })
    }
    const requirement = { id: row.id, title: row.title ?? row.id }
    if (kind === 'review') {
      const sorted = [...row.reviews].sort((left, right) => left.round - right.round)
      return buildReviewPrompt(requirement, row.text, {
        completedRounds: row.reviews.length,
        previousReport: sorted[sorted.length - 1]?.report,
        dismissedIssues: row.dismissedIssues,
      })
    }
    if (kind === 'revise') {
      const sorted = [...row.reviews].sort((left, right) => left.round - right.round)
      const baseVersion = row.versions.reduce((max, version) => Math.max(max, version.n), 0) || 1
      return buildRevisePrompt(requirement, row.text, sorted[sorted.length - 1]?.report, baseVersion, decisions)
    }
    return splitPromptOf(row, preset ?? OP_PRESET.split, previousProposalIds)
  }

  /** 当前投影里该需求的磁盘事实基线；下一岗发起时按它记增量起点。 */
  const baselineOf = (requirementId: string | null) => {
    const row = requirementId === null ? undefined : props.projection.requirements.find(item => item.id === requirementId)
    return {
      reviewRound: row?.reviews.reduce((max, entry) => Math.max(max, entry.round), 0) ?? 0,
      versions: row?.versions.length ?? 0,
      related: requirementId === null ? 0 : relatedOf(requirementId).length,
      planAt: row?.splitPlan?.at ?? null,
      amendCount: row?.amendCount ?? row?.amendments?.length ?? 0,
      requirements: props.projection.requirements.length,
      proposalIds: props.projection.proposals.map(item => item.id),
    }
  }

  /** 拆分回合明确结束：会话在册且不在跑；仅凭任务增量不足以判定拆分完成。 */
  const splitTurnEndedOf = (watch: OpWatch): boolean => {
    if (watch.sessionId === null) return false
    const session = props.sessions.find(item => item.sessionId === watch.sessionId)
    return session !== undefined && !session.running && !session.blank
  }

  /** 发起节点里的某一岗；成功登记基线，失败首岗只给提示、后续岗转失败卡。 */
  const launchRole = async (
    run: OpRun,
    roleIndex: number,
    previousProposalIds?: readonly string[],
  ): Promise<{ readonly ok: boolean; readonly message: string }> => {
    const roleId = run.roles[roleIndex]
    if (roleId === undefined) return { ok: false, message: '流程配置里没有这一岗' }
    const row = run.requirementId === null
      ? null
      : props.projection.requirements.find(item => item.id === run.requirementId) ?? null
    const preset = presetOfRole(roleId, props.projection.roles) ?? OP_PRESET[run.kind]
    setOpNotice(null)
    let answer: { readonly ok: boolean; readonly message: string; readonly sessionId?: string }
    try {
      answer = await props.onStartSession(promptOf(run.kind, row, run.decisions, preset, previousProposalIds), preset)
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setOpNotice(message)
      if (roleIndex > 0) {
        setFinished(current => [...current, { ...run, sessionId: null, status: 'failed', landed: roleIndex }])
      }
      return { ok: false, message }
    }
    if (!answer.ok) {
      setOpNotice(answer.message)
      if (roleIndex > 0) {
        setFinished(current => [...current, { ...run, sessionId: null, status: 'failed', landed: roleIndex }])
      }
      return answer
    }
    // 忙碌保持到磁盘事实出现增量或超时；发起成功只登记基线，不清忙碌。
    setWatches(current => [...current, {
      ...run,
      roleIndex,
      sessionId: answer.sessionId ?? null,
      ...baselineOf(run.requirementId),
      roleSig: run.kind === 'review' && reviewConfigured ? entryRoot(roleId, props.projection.roles) ?? null : null,
      deadline: Date.now() + OP_TIMEOUT_MS,
    }])
    return answer
  }

  const startNode = (
    kind: 'review' | 'revise' | 'split',
    row: RequirementDocRow,
    decisions?: ReviewDecisions,
  ): Promise<{ readonly ok: boolean; readonly message: string }> => {
    const node = flowNodeOf(flow, kind)
    return launchRole(
      { key: `${kind}-${row.id}-${String(Date.now())}`, kind, requirementId: row.id, roles: node.roles, auto: node.auto, decisions },
      0,
    )
  }

  // 立项调研后台发起：向导收起，浮卡接管进度；七问提问卡走非对话页浮层。
  const intakeStart = async (prompt: string): Promise<{ readonly ok: boolean; readonly message: string }> => {
    setOpNotice(null)
    const answer = await props.onStartIntake(prompt)
    if (!answer.ok) {
      setOpNotice(answer.message)
      return answer
    }
    const node = flowNodeOf(flow, 'intake')
    setWatches(current => [...current, {
      key: `intake-${String(Date.now())}`,
      kind: 'intake',
      requirementId: null,
      roles: node.roles,
      roleIndex: 0,
      auto: node.auto,
      sessionId: answer.sessionId ?? null,
      reviewRound: 0,
      versions: 0,
      related: 0,
      planAt: null,
      amendCount: 0,
      requirements: props.projection.requirements.length,
      proposalIds: props.projection.proposals.map(item => item.id),
      roleSig: null,
      deadline: Date.now() + OP_TIMEOUT_MS,
    }])
    setWizard(false)
    return answer
  }

  // 新建需求后台发起：描述随首条消息发给需求分析师，不跳转对话；完成看需求条数增量，提案期间浮卡等待对比。
  // 基于已确认需求新建也走这里：提示词带 target 与 base_version，完成判定与浮卡通道不变。
  const launchCreate = async (prompt: string): Promise<{ readonly ok: boolean; readonly message: string }> => {
    setOpNotice(null)
    let answer: { readonly ok: boolean; readonly message: string; readonly sessionId?: string }
    try {
      answer = await props.onStartSession(prompt, INTAKE_PRESET_ID)
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setOpNotice(message)
      return { ok: false, message }
    }
    if (!answer.ok) {
      setOpNotice(answer.message)
      return answer
    }
    setWatches(current => [...current, {
      key: `create-${String(Date.now())}`,
      kind: 'create',
      requirementId: null,
      roles: [INTAKE_PRESET_ID],
      roleIndex: 0,
      auto: false,
      sessionId: answer.sessionId ?? null,
      reviewRound: 0,
      versions: 0,
      related: 0,
      planAt: null,
      amendCount: 0,
      requirements: props.projection.requirements.length,
      proposalIds: props.projection.proposals.map(item => item.id),
      roleSig: null,
      deadline: Date.now() + OP_TIMEOUT_MS,
    }])
    return answer
  }

  const openChangeTriage = (targetId: string | null): void => {
    setTriageTargetId(targetId)
    setTriageOpen(true)
  }

  const launchTriageSession = async (
    kind: 'amend' | 'delta' | 'milestone',
    requirementId: string | null,
    prompt: string,
  ): Promise<{ readonly ok: boolean; readonly message: string }> => {
    setOpNotice(null)
    let answer: { readonly ok: boolean; readonly message: string; readonly sessionId?: string }
    try {
      answer = await props.onStartSession(prompt, INTAKE_PRESET_ID)
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setOpNotice(message)
      return { ok: false, message }
    }
    if (!answer.ok) {
      setOpNotice(answer.message)
      return answer
    }
    setWatches(current => [...current, {
      key: `${kind}-${requirementId ?? 'new'}-${String(Date.now())}`,
      kind,
      requirementId,
      roles: [INTAKE_PRESET_ID],
      roleIndex: 0,
      auto: false,
      sessionId: answer.sessionId ?? null,
      ...baselineOf(requirementId),
      roleSig: null,
      deadline: Date.now() + OP_TIMEOUT_MS,
    }])
    return answer
  }

  const confirmChangeTriage = async (
    payload: ChangeTriageConfirmPayload,
  ): Promise<{ readonly ok: boolean; readonly message: string }> => {
    const targetRow = payload.targetId === null
      ? undefined
      : props.projection.requirements.find(item => item.id === payload.targetId)
    const extraTracks = (props.projection.project?.tracks ?? []).map(track => `${track.id}（${track.name}）`)
    const allTracks = [...BUILTIN_SPLIT_TRACKS, ...extraTracks]

    if (payload.actionKind === 'draft_patch') {
      if (targetRow === undefined || targetRow.state !== 'draft') {
        return { ok: false, message: t('triage.reason.draftTarget') }
      }
      const modifyGate = canModifyDraft({
        reviews: targetRow.reviews,
        versions: targetRow.versions,
        flow: props.projection.flow,
        roster: props.projection.roles,
      })
      if (!modifyGate.ok) {
        return { ok: false, message: t('triage.draftLockedReason') }
      }
      openDetail(targetRow)
      setModifyRow(targetRow)
      setModifyText(payload.description)
      setPatchError(null)
      setCompareId(null)
      setModifyOpen(true)
      const answer = await launchPatch(payload.description, targetRow)
      if (!answer.ok) setPatchError(answer.message)
      else setTriageOpen(false)
      return answer
    }

    if (payload.actionKind === 'amend') {
      if (targetRow === undefined || targetRow.state !== 'confirmed') {
        return { ok: false, message: t('triage.sDisabledReason') }
      }
      const activeTasks = relatedOf(targetRow.id)
        .filter(task => task.state !== 'closed')
        .map(task => ({ id: task.id, title: task.title, state: task.state }))
      const prompt = buildRequirementAmendPrompt(
        { id: targetRow.id, title: targetRow.title ?? targetRow.id },
        targetRow.text,
        payload.description,
        {
          activeTasks,
          tracks: allTracks,
          amendCount: targetRow.amendCount ?? targetRow.amendments?.length ?? 0,
        },
      )
      const answer = await launchTriageSession('amend', targetRow.id, prompt)
      if (answer.ok) setTriageOpen(false)
      return answer
    }

    if (payload.actionKind === 'delta') {
      if (targetRow === undefined) {
        return { ok: false, message: t('triage.mDisabledReason') }
      }
      const baseVersion = targetRow.versions.reduce((max, version) => Math.max(max, version.n), 0) || 1
      const prompt = buildRequirementDeltaPrompt(
        { id: targetRow.id, title: targetRow.title ?? targetRow.id, version: baseVersion },
        targetRow.text,
        payload.description,
      )
      const answer = await launchTriageSession('delta', targetRow.id, prompt)
      if (answer.ok) setTriageOpen(false)
      return answer
    }

    const maxReq = props.projection.requirements.reduce((best, item) => {
      const digits = /^REQ-(\d+)$/.exec(item.id)?.[1]
      return digits === undefined ? best : Math.max(best, Number.parseInt(digits, 10))
    }, 0)
    const nextRequirementId = `REQ-${String(maxReq + 1).padStart(2, '0')}`
    const base = targetRow === undefined
      ? undefined
      : {
        id: targetRow.id,
        title: targetRow.title ?? targetRow.id,
        version: targetRow.versions.reduce((max, version) => Math.max(max, version.n), 0) || 1,
      }
    const prompt = buildRequirementMilestonePrompt(payload.description, {
      ...(base === undefined ? {} : { base }),
      tracks: allTracks,
      nextRequirementId,
    })
    const answer = await launchTriageSession('milestone', null, prompt)
    if (answer.ok) setTriageOpen(false)
    return answer
  }

  const createStart = async (description: string): Promise<void> => {
    const answer = await launchCreate(buildRequirementCreatePrompt(description))
    if (answer.ok) {
      setCreateOpen(false)
      setCreateText('')
    }
  }

  /** 基于此版本新建：确认态与终态需求的改动通道，取最新版本号作基线，后台发起不跳转。 */
  const createBased = (row: RequirementDocRow): Promise<{ readonly ok: boolean; readonly message: string }> => {
    const baseVersion = row.versions.reduce((max, version) => Math.max(max, version.n), 0) || 1
    return launchCreate(buildRequirementCreatePrompt('', { id: row.id, title: row.title ?? row.id, version: baseVersion }))
  }

  /** 打开详情并记住触发入口；历史入口额外记一次抽屉标志，关闭或切换需求即重置。 */
  const openDetail = (row: RequirementDocRow, historyOpen = false): void => {
    const active = document.activeElement
    detailTriggerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
    setHistoryEntry(current => ({ seq: current.seq + 1, open: historyOpen }))
    setSelected(row.id)
  }

  /** 关闭详情：收起说明栏与差异、清空输入，不启动会话、不写数据，焦点归位。 */
  const closeDetail = (): void => {
    const id = selected
    setSelected(null)
    setHistoryEntry(current => ({ seq: current.seq, open: false }))
    setModifyOpen(false)
    setModifyRow(null)
    setModifyText('')
    setPatchError(null)
    setCompareId(null)
    const trigger = detailTriggerRef.current
    detailTriggerRef.current = null
    if (trigger !== null && trigger.isConnected) trigger.focus()
    else if (id !== null) {
      document.querySelector<HTMLElement>(`[data-testid="requirement-row"][data-requirement-id="${id}"]`)?.focus()
    }
  }

  /** 同窗展开修改说明栏：先打开同一详情，再清空说明输入，不启动会话、不写数据。 */
  const openModify = (row: RequirementDocRow): void => {
    openDetail(row)
    setModifyRow(row)
    setModifyText('')
    setPatchError(null)
    setCompareId(null)
    setModifyOpen(true)
  }

  /** 草稿修改后台会话：按用户说明生成「修改当前草稿」提案；完成看提案批准或拒绝，不看版本增量。 */
  const launchPatch = async (note: string, row: RequirementDocRow): Promise<{ readonly ok: boolean; readonly message: string }> => {
    setOpNotice(null)
    let answer: { readonly ok: boolean; readonly message: string; readonly sessionId?: string }
    try {
      answer = await props.onStartSession(
        buildRequirementPatchPrompt({ id: row.id, title: row.title ?? row.id }, row.text, note),
        REQUIREMENT_EDITOR_PRESET_ID,
      )
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setOpNotice(message)
      return { ok: false, message }
    }
    if (!answer.ok) {
      setOpNotice(answer.message)
      return answer
    }
    setWatches(current => [...current, {
      key: `patch-${row.id}-${String(Date.now())}`,
      kind: 'patch',
      requirementId: row.id,
      roles: [REQUIREMENT_EDITOR_PRESET_ID],
      roleIndex: 0,
      auto: false,
      sessionId: answer.sessionId ?? null,
      ...baselineOf(row.id),
      roleSig: null,
      deadline: Date.now() + OP_TIMEOUT_MS,
    }])
    return answer
  }

  /** 提交修改说明：去空白后非空才发起；留在详情等待提案，失败保留说明供重试。 */
  const modifyStart = async (): Promise<void> => {
    const note = modifyText.trim()
    if (note === '' || modifyRow === null) return
    setPatchError(null)
    const answer = await launchPatch(note, modifyRow)
    if (!answer.ok) setPatchError(answer.message)
  }

  /** 应用成功后收起说明栏与差异；正文由投影刷新后重新渲染。 */
  const patchApplied = (): void => {
    setModifyOpen(false)
    setModifyText('')
    setModifyRow(null)
    setPatchError(null)
    setCompareId(null)
  }

  const review = (row: RequirementDocRow) => startNode('review', row)
  const revise = (row: RequirementDocRow, decisions?: ReviewDecisions) => startNode('revise', row, decisions)
  const split = (row: RequirementDocRow) => startNode('split', row)

  // 完成判定以投影里的磁盘事实为准：评审见增轮（有配置时最新一轮署名根须等于当前条目根）、
  // 改稿见增版、拆分见岗位建议落盘或会话回合结束后关联任务增加、立项与新建需求见需求条数增量。
  // 落盘后按 auto 决定自动发起下一岗还是停下等人；提案被拒绝时立即收口成取消卡，不空转到超时。
  useEffect(() => {
    if (watches.length === 0) return
    const cancelledWatches = watches.filter(watch => rejectedProposalOf(watch) !== undefined)
    const doneWatches = watches.filter((watch) => {
      if (cancelledWatches.includes(watch)) return false
      if (watch.kind === 'intake' || watch.kind === 'create' || watch.kind === 'delta' || watch.kind === 'milestone') {
        return props.projection.requirements.length > watch.requirements
      }
      const row = props.projection.requirements.find(item => item.id === watch.requirementId)
      if (row === undefined) return false
      if (watch.kind === 'amend') {
        return (row.amendCount ?? row.amendments?.length ?? 0) > watch.amendCount
      }
      if (watch.kind === 'patch') {
        // 修改当前草稿不增版本、不改需求条数：提案被应用（approved）才算这次操作完成。
        return props.projection.proposals.some(proposal =>
          proposal.decision === 'approved'
          && proposal.requirementChange?.mode === 'patch'
          && proposal.requirementChange.target === watch.requirementId
          && !watch.proposalIds.includes(proposal.id))
      }
      if (watch.kind === 'review') {
        const fresh = row.reviews.filter(entry => entry.round > watch.reviewRound)
        if (fresh.length === 0) return false
        if (watch.roleSig === null) return true
        const latest = row.reviews.reduce<RequirementReviewRow | null>(
          (best, entry) => best === null || entry.round > best.round ? entry : best,
          null,
        )
        return latest?.role !== undefined && presetRoot(latest.role) === watch.roleSig
      }
      if (watch.kind === 'revise') return row.versions.length > watch.versions
      const currentRole = watch.roles[watch.roleIndex] ?? ''
      const currentPreset = presetOfRole(currentRole, props.projection.roles) ?? OP_PRESET.split
      if (presetRoot(currentPreset) === 'architect') {
        const hasPendingQuestion = watch.sessionId !== null && pendingForSession(props.pending ?? [], watch.sessionId).length > 0
        if (hasPendingQuestion || props.awaitingAnswer) return false
        const proposalLanded = props.projection.proposals.some(proposal => !watch.proposalIds.includes(proposal.id))
        return splitTurnEndedOf(watch) && (proposalLanded || watch.roleIndex + 1 < watch.roles.length)
      }
      const related = props.projection.tasks.filter(
        task => task.requirement === row.id || task.proposal === row.id,
      ).length
      const planLanded = row.splitPlan !== undefined && row.splitPlan.at !== watch.planAt
      return planLanded || (related > watch.related && splitTurnEndedOf(watch))
    })
    if (doneWatches.length === 0 && cancelledWatches.length === 0) return
    setWatches(current => current.filter(item => !doneWatches.includes(item) && !cancelledWatches.includes(item)))
    const finishedNow: FinishedOp[] = cancelledWatches.map(watch => ({
      key: watch.key,
      kind: watch.kind,
      requirementId: watch.requirementId,
      roles: watch.roles,
      auto: watch.auto,
      sessionId: watch.sessionId,
      status: 'done',
      landed: watch.roleIndex,
      cancelled: true,
    }))
    for (const watch of doneWatches) {
      const next = watch.roleIndex + 1
      if (next >= watch.roles.length) {
        finishedNow.push({
          key: watch.key,
          kind: watch.kind,
          requirementId: watch.requirementId,
          roles: watch.roles,
          auto: watch.auto,
          sessionId: watch.sessionId,
          status: 'done',
          landed: next,
        })
        if (watch.requirementId !== null) setSelected(watch.requirementId)
      } else if (watch.auto) {
        void launchRole(watch, next, watch.proposalIds)
      } else {
        setPaused(current => [...current, {
          key: watch.key,
          kind: watch.kind,
          requirementId: watch.requirementId,
          roles: watch.roles,
          auto: watch.auto,
          roleIndex: next,
          sessionId: watch.sessionId,
        }])
      }
    }
    if (finishedNow.length > 0) setFinished(current => [...current, ...finishedNow])
    props.onReload()
  }, [watches, props.projection, props.onReload, props.sessions, props.pending, props.awaitingAnswer])

  /** 人工衔接：点「下一岗位」才发起下一岗。 */
  const nextRole = (key: string): void => {
    const run = paused.find(item => item.key === key)
    if (run === undefined) return
    setPaused(current => current.filter(item => item.key !== key))
    void launchRole(run, run.roleIndex)
  }

  // 立项等待确认：会话回合结束（跑过且不在跑）而需求条数未增；发过确认的卡等回合再次跑起前不重复判定。
  const awaitingConfirmOf = (watch: OpWatch): boolean => {
    if (watch.kind !== 'intake' || watch.sessionId === null) return false
    if (props.projection.requirements.length > watch.requirements) return false
    if (confirmSent.includes(watch.key) || !sawRunning.includes(watch.key)) return false
    const session = props.sessions.find(item => item.sessionId === watch.sessionId)
    return session !== undefined && !session.running && !session.blank
  }

  /** 一次提案型操作产出的变更载荷是否对得上：新建与独立立项看 new，增量修订看基于目标需求的 new，改稿看 revise，草稿修改看 patch。 */
  const changeMatchesWatch = (watch: OpWatch, change: NonNullable<ProposalRow['requirementChange']>): boolean => {
    if (watch.kind === 'create' || watch.kind === 'milestone') return change.mode === 'new'
    if (watch.kind === 'delta') return change.mode === 'new' && (change.target === undefined || change.target === watch.requirementId)
    if (watch.kind === 'revise') return change.mode === 'revise' && change.target === watch.requirementId
    if (watch.kind === 'patch') return change.mode === 'patch' && change.target === watch.requirementId
    return false
  }

  // 提案等待对比：发起后新出现的起草态需求变更提案算本次操作的产物。
  const pendingProposalOf = (watch: OpWatch): ProposalRow | undefined => {
    if (watch.kind !== 'create' && watch.kind !== 'delta' && watch.kind !== 'milestone' && watch.kind !== 'revise' && watch.kind !== 'patch') {
      return undefined
    }
    return props.projection.proposals.find((proposal) => {
      const change = proposal.requirementChange
      if (proposal.decision !== 'draft' || change === undefined) return false
      if (watch.proposalIds.includes(proposal.id)) return false
      return changeMatchesWatch(watch, change)
    })
  }

  const pollRef = useRef({
    watches,
    onReload: props.onReload,
    sessions: props.sessions,
    awaitingAnswer: props.awaitingAnswer,
    sawRunning,
    liveFeeds,
    awaitingConfirmOf,
    pendingProposalOf,
  })
  pollRef.current = {
    watches,
    onReload: props.onReload,
    sessions: props.sessions,
    awaitingAnswer: props.awaitingAnswer,
    sawRunning,
    liveFeeds,
    awaitingConfirmOf,
    pendingProposalOf,
  }
  const hasWatches = watches.length > 0

  // 固定间隔轮询投影；读取中不叠加请求，卸载或无操作时清理；仅依赖 hasWatches 避免流式输出高频刷新重置定时器。
  useEffect(() => {
    if (!hasWatches) {
      endedGraceRef.current.clear()
      return
    }
    const timer = setInterval(() => {
      const currentState = pollRef.current
      if (currentState.watches.length === 0) return
      const now = Date.now()
      const sessionOf = (item: OpWatch): SessionSummary | undefined =>
        item.sessionId === null ? undefined : currentState.sessions.find(entry => entry.sessionId === item.sessionId)
      const feedOf = (item: OpWatch): OpLiveFeed | undefined =>
        item.sessionId === null ? undefined : currentState.liveFeeds[item.sessionId]
      const interactive = (item: OpWatch): boolean =>
        currentState.awaitingConfirmOf(item)
        || currentState.awaitingAnswer === true
        || currentState.pendingProposalOf(item) !== undefined
      const activeWork = (item: OpWatch): boolean => {
        const session = sessionOf(item)
        if (session?.running === true) return true
        const feed = feedOf(item)
        if (feed === undefined) return false
        return feed.phase !== 'connecting' && feed.phase !== 'idle' && (now - feed.lastActivityAt) < OP_TIMEOUT_MS
      }
      const keepAlive = (item: OpWatch): boolean => interactive(item) || activeWork(item)

      const earlyFailed: { readonly watch: OpWatch; readonly reason: OpFailReason }[] = []
      let needGraceReload = false
      for (const item of currentState.watches) {
        if (interactive(item) || activeWork(item)) {
          endedGraceRef.current.delete(item.key)
          continue
        }
        const feed = feedOf(item)
        const session = sessionOf(item)
        const turnEnd = feed?.turnEnd
        let terminal: OpFailReason | undefined
        if (turnEnd?.kind === 'max-tokens') {
          terminal = { kind: 'max-tokens' }
        } else if (turnEnd?.kind === 'error') {
          terminal = { kind: 'error', message: turnEnd.message }
        } else if (currentState.sawRunning.includes(item.key) && session !== undefined && !session.running && !session.blank) {
          terminal = { kind: 'ended' }
        }
        if (terminal === undefined) {
          endedGraceRef.current.delete(item.key)
          continue
        }
        const seen = (endedGraceRef.current.get(item.key) ?? 0) + 1
        endedGraceRef.current.set(item.key, seen)
        if (seen >= 2) {
          endedGraceRef.current.delete(item.key)
          earlyFailed.push({ watch: item, reason: terminal })
        } else {
          needGraceReload = true
        }
      }

      const earlyKeys = new Set(earlyFailed.map(entry => entry.watch.key))
      const expired = currentState.watches.filter(item => !earlyKeys.has(item.key) && now >= item.deadline && !keepAlive(item))
      const frozen = currentState.watches.filter(item => !earlyKeys.has(item.key) && now >= item.deadline && keepAlive(item))
      if (frozen.length > 0) {
        setWatches(current => current.map(item =>
          frozen.some(entry => entry.key === item.key)
            ? { ...item, deadline: now + OP_TIMEOUT_MS }
            : item))
      }
      if (earlyFailed.length > 0 || expired.length > 0) {
        const dropKeys = new Set([...earlyKeys, ...expired.map(item => item.key)])
        setWatches(current => current.filter(item => !dropKeys.has(item.key)))
        setFinished(current => [
          ...current,
          ...earlyFailed.map(({ watch, reason }) => {
            const feed = feedOf(watch)
            return {
              key: watch.key,
              kind: watch.kind,
              requirementId: watch.requirementId,
              roles: watch.roles,
              auto: watch.auto,
              sessionId: watch.sessionId,
              status: 'failed' as const,
              landed: watch.roleIndex,
              failReason: reason,
              ...(feed === undefined ? {} : { liveFeed: feed }),
            }
          }),
          ...expired.map((watch) => {
            const feed = feedOf(watch)
            return {
              key: watch.key,
              kind: watch.kind,
              requirementId: watch.requirementId,
              roles: watch.roles,
              auto: watch.auto,
              sessionId: watch.sessionId,
              status: 'failed' as const,
              landed: watch.roleIndex,
              failReason: { kind: 'timeout' } as const,
              ...(feed === undefined ? {} : { liveFeed: feed }),
            }
          }),
        ])
        if (expired.length > 0 && !loadingRef.current) currentState.onReload()
        return
      }
      if (needGraceReload || !loadingRef.current) currentState.onReload()
    }, OP_POLL_MS)
    return () => { clearInterval(timer) }
  }, [hasWatches])

  // 提案被拒绝：本次操作的产物不再可能落盘，浮卡立即收口，不等需求条数/版本增量或超时。
  const rejectedProposalOf = (watch: OpWatch): ProposalRow | undefined => {
    if (watch.kind !== 'create' && watch.kind !== 'delta' && watch.kind !== 'milestone' && watch.kind !== 'revise' && watch.kind !== 'patch') {
      return undefined
    }
    return props.projection.proposals.find((proposal) => {
      const change = proposal.requirementChange
      if (proposal.decision !== 'rejected' || change === undefined) return false
      if (watch.proposalIds.includes(proposal.id)) return false
      return changeMatchesWatch(watch, change)
    })
  }

  // 记录每张操作卡是否见过回合在跑；卡结束后清掉标记。
  useEffect(() => {
    const keys = new Set(watches.map(item => item.key))
    const kept = sawRunning.filter(key => keys.has(key))
    const fresh = watches
      .filter(watch => watch.sessionId !== null && !kept.includes(watch.key)
        && props.sessions.find(item => item.sessionId === watch.sessionId)?.running === true)
      .map(watch => watch.key)
    if (kept.length !== sawRunning.length || fresh.length > 0) setSawRunning([...kept, ...fresh])
  }, [watches, props.sessions, sawRunning])

  // 确认指令已发：回合重新跑起来或卡已结束时清掉标记，之后回合再结束仍会回到等待确认态。
  useEffect(() => {
    if (confirmSent.length === 0) return
    const kept = confirmSent.filter((key) => {
      const watch = watches.find(item => item.key === key)
      if (watch === undefined) return false
      return props.sessions.find(item => item.sessionId === watch.sessionId)?.running !== true
    })
    if (kept.length !== confirmSent.length) setConfirmSent(kept)
  }, [confirmSent, watches, props.sessions])

  // 总览页的入口意图：同一个意图只执行一次，由 seq 区分重复点击。
  const appliedIntent = useRef(0)
  useEffect(() => {
    const intent = props.intent
    if (intent === undefined || intent.seq === appliedIntent.current) return
    appliedIntent.current = intent.seq
    if (props.project === null) return
    if (intent.kind === 'intake') {
      setWizard(true)
      return
    }
    if (props.projection.requirements.some(row => row.id === intent.id)) setSelected(intent.id)
  }, [props.intent, props.project, props.projection.requirements])

  // Esc 关闭列表行的关闭确认弹窗；关闭请求进行中不响应。
  useEffect(() => {
    if (closeTarget === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || closing) return
      event.stopPropagation()
      setCloseTarget(null)
      setCloseError(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [closeTarget, closing])

  const confirmClose = async (): Promise<void> => {
    if (closeTarget === null || props.project === null || closing) return
    setClosing(true)
    setCloseError(null)
    try {
      const outcome = await runCommand(props.project.scopeSessionId, `/requirement_close ${closeTarget.id}`)
      if (outcome.ok) {
        setCloseTarget(null)
        props.onReload()
      } else {
        setCloseError(t('requirement.closeFailed', { detail: outcome.text }))
      }
    } catch (cause: unknown) {
      setCloseError(t('requirement.closeFailed', { detail: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setClosing(false)
    }
  }

  /** 立项卡点「确认需求」：经宿主向该会话发确认指令，成功后保持轮询等落盘。 */
  const confirmIntake = async (key: string): Promise<void> => {
    const watch = watches.find(item => item.key === key)
    if (watch === undefined || watch.sessionId === null || props.onConfirmIntake === undefined) return
    if (confirmSent.includes(key)) return
    setOpNotice(null)
    setConfirmSent(current => [...current, key])
    let answer: { readonly ok: boolean; readonly message: string }
    try {
      answer = await props.onConfirmIntake(watch.sessionId)
    } catch (cause: unknown) {
      answer = { ok: false, message: cause instanceof Error ? cause.message : String(cause) }
    }
    if (!answer.ok) {
      setConfirmSent(current => current.filter(item => item !== key))
      setOpNotice(answer.message)
    }
  }

  // 立项分析只对空项目开放；已有结果时仍允许打开结果页回看，但不允许开新立项。
  const blockedIntake = hasIntakeWork(props.projection) && props.intakeResult === null

  // 待确认的需求变更：起草态且带载荷的提案；对比视图只对这些提案开放。
  const pendingChanges = props.projection.proposals.flatMap(proposal =>
    proposal.decision === 'draft' && proposal.requirementChange !== undefined
      ? [{ proposal, change: proposal.requirementChange }]
      : [])
  const compare = compareId === null ? undefined : pendingChanges.find(entry => entry.proposal.id === compareId)

  // 同窗说明栏状态：待对比 patch 提案就绪 → 可查看差异；会话在跑 → 生成中；发起失败 → 可重试。
  const activePatchWatch = active === null
    ? undefined
    : [...watches].reverse().find(watch => watch.kind === 'patch' && watch.requirementId === active.id)
  const activePatchChange = active === null
    ? undefined
    : pendingChanges.find(entry => entry.change.mode === 'patch' && entry.change.target === active.id)
  const modifyState: ModifyState = {
    open: modifyOpen && modifyRow !== null && active !== null && modifyRow.id === active.id,
    text: modifyText,
    status: activePatchChange !== undefined
      ? 'ready'
      : activePatchWatch !== undefined
        ? 'running'
        : patchError !== null
          ? 'failed'
          : 'idle',
    error: patchError ?? undefined,
  }
  // 概要预览的会话号从浮卡运行记录上取；卡被完成判定清掉后抽屉自然关闭。
  const summarySessionId = summaryKey === null
    ? null
    : watches.find(item => item.key === summaryKey)?.sessionId ?? null
  // 会话在跑但本地没有对应浮卡：刷新或切项目后给出恢复入口，已在浮卡里的会话不重复提示。
  const recoverySessions = props.sessions.filter(
    session => session.running && !watches.some(watch => watch.sessionId === session.sessionId),
  )

  const cards = useMemo<readonly OperationCardView[]>(() => {
    const labelCtx = {
      ...(props.presetNames === undefined ? {} : { presetNames: props.presetNames }),
      roster: props.projection.roles,
      t,
    }
    const labelOf = (id: string): string => flowRoleLabel(id, labelCtx)
    const idOf = (run: OpRun, index: number): string => run.roles[index] ?? run.roles[run.roles.length - 1] ?? ''
    // 一任务一张卡：提问按 agentId（与会话标识同值）字符串相等归到对应卡。
    const pendingItems = props.pending ?? []
    const withPending = (view: OperationCardView, sessionId: string | null): OperationCardView => {
      if (sessionId === null) return view
      const count = questionCountForSession(pendingItems, sessionId)
      return count > 0 ? { ...view, pendingCount: count, pendingKey: sessionId } : view
    }
    // 单岗节点沿用四步清单；多岗节点按岗位列步骤，末尾一步是整节点完成。
    // 等待确认时当前岗的工作已结束：单岗清单「岗位工作中」置完成，多岗清单当前岗置完成。
    // 提案已落盘等待对比时「产物落盘」也置完成：提案就是本次操作的产物，落需求本体等人确认。
    const stepsOf = (run: OpRun, landed: number, status: OperationCardView['status'], active: boolean, awaiting = false, proposalLanded = false): readonly OperationStep[] => {
      if (run.roles.length <= 1) {
        const states: readonly OperationStepState[] = status === 'running'
          ? proposalLanded
            ? ['done', 'done', 'done', 'pending']
            : awaiting ? ['done', 'done', 'pending', 'pending'] : ['done', 'active', 'pending', 'pending']
          : status === 'done'
            ? ['done', 'done', 'done', 'done']
            : ['done', 'failed', 'pending', 'pending']
        return [
          { label: t('op.step.launched'), state: states[0] ?? 'pending' },
          { label: t('op.step.working'), state: states[1] ?? 'pending' },
          { label: t('op.step.landed'), state: states[2] ?? 'pending' },
          { label: t('op.step.done'), state: states[3] ?? 'pending' },
        ]
      }
      const steps: OperationStep[] = run.roles.map((role, index) => {
        const state: OperationStepState = status === 'failed' && index === landed
          ? 'failed'
          : index < landed || ((awaiting || proposalLanded) && index === landed)
            ? 'done'
            : active && status === 'running' && index === landed
              ? 'active'
              : 'pending'
        return { label: labelOf(role), state }
      })
      steps.push({ label: t('op.step.done'), state: status === 'done' ? 'done' : 'pending' })
      return steps
    }
    const viewOf = (
      run: OpRun,
      current: number,
      sessionId: string | null,
      status: OperationCardView['status'],
      statusText: string,
      active: boolean,
      nextRoleLabel?: string,
      awaiting = false,
      compareProposalId?: string,
      liveFeed?: OpLiveFeed,
    ): OperationCardView => {
      const roleId = idOf(run, current)
      return {
        key: run.key,
        title: t(OP_TITLE_KEY[run.kind]),
        roleLabel: labelOf(roleId),
        sourceLabel: flowRoleSource(roleId, t),
        status,
        statusText,
        steps: stepsOf(run, current, status, active, awaiting, compareProposalId !== undefined),
        sessionId,
        minimized: minimizedKeys.includes(run.key),
        ...(nextRoleLabel === undefined ? {} : { nextRoleLabel }),
        ...(awaiting ? { awaitingConfirm: true } : {}),
        ...(compareProposalId === undefined ? {} : { compareProposalId }),
        ...(liveFeed === undefined ? {} : { liveFeed }),
      }
    }
    const failStatusOf = (item: FinishedOp, idText: string): string => {
      const reason = item.failReason
      if (reason?.kind === 'max-tokens') return t('requirement.opFailedMaxTokens', { id: idText })
      if (reason?.kind === 'error') {
        const detail = reason.message !== '' ? reason.message : t('requirement.opTimeout', { id: idText })
        return t('requirement.opFailedError', { id: idText, detail })
      }
      if (reason?.kind === 'ended') return t('requirement.opFailedEnded', { id: idText })
      return t('requirement.opTimeout', { id: idText })
    }
    const idTextOf = (run: OpRun): string =>
      run.requirementId ?? t(
        run.kind === 'create'
          ? 'requirement.opTitle.create'
          : run.kind === 'milestone'
            ? 'requirement.opTitle.milestone'
            : 'requirement.opTitle.intake',
      )
    return [
      ...watches.map((watch) => {
        const awaiting = awaitingConfirmOf(watch)
        const pendingProposal = pendingProposalOf(watch)
        const feed = watch.sessionId === null ? undefined : liveFeeds[watch.sessionId]
        return withPending(viewOf(
          watch, watch.roleIndex, watch.sessionId, 'running',
          awaiting
            ? t('op.awaitConfirm')
            : pendingProposal !== undefined
              ? t('op.awaitProposal')
              : confirmSent.includes(watch.key)
                ? t('op.confirmSent')
                : watch.kind === 'intake'
                  ? t(OP_RUNNING_KEY[watch.kind])
                  : t(OP_RUNNING_KEY[watch.kind], { id: idTextOf(watch) }),
          !awaiting && pendingProposal === undefined, undefined, awaiting, pendingProposal?.id,
          !awaiting && pendingProposal === undefined ? feed : undefined,
        ), watch.sessionId)
      }),
      ...paused.map(run => withPending(viewOf(
        run, run.roleIndex, run.sessionId, 'running',
        t('op.awaitNext', { done: labelOf(idOf(run, run.roleIndex - 1)), next: labelOf(idOf(run, run.roleIndex)) }),
        false, labelOf(idOf(run, run.roleIndex)),
      ), run.sessionId)),
      ...finished.map(item => withPending(viewOf(
        item, Math.min(item.landed, item.roles.length - 1), item.sessionId, item.status,
        item.status === 'done'
          ? item.cancelled === true
            ? t('requirement.proposalRejected')
            : item.kind === 'intake'
              ? t(OP_DONE_KEY[item.kind])
              : t(OP_DONE_KEY[item.kind], { id: idTextOf(item) })
          : failStatusOf(item, idTextOf(item)),
        false, undefined, false, undefined, item.status === 'failed' ? item.liveFeed : undefined,
      ), item.sessionId)),
    ]
  }, [
    watches, paused, finished, minimizedKeys, confirmSent, sawRunning, liveFeeds,
    props.pending, props.presetNames, props.projection, props.sessions, t,
  ])

  // 没有挂到可见任务卡的交互走中性兜底入口，提问不丢；最小化卡里的提问也由这里承载。
  const unmapped = unmappedPending(
    props.pending ?? [],
    cards.filter(card => !card.minimized).map(card => card.sessionId),
  )
  const answerPending = (sessionId: string): void => {
    props.onAnswerPending?.(pendingForSession(props.pending ?? [], sessionId).map(item => item.id))
  }
  const answerUnmapped = (): void => {
    props.onAnswerPending?.(unmapped.map(item => item.id))
  }

  const toggleMinimize = (key: string) => {
    setMinimizedKeys(current => current.includes(key)
      ? current.filter(item => item !== key)
      : [...current, key])
  }

  const closeCard = (key: string) => {
    const card = finished.find(item => item.key === key)
    setFinished(current => current.filter(item => item.key !== key))
    setMinimizedKeys(current => current.filter(item => item !== key))
    if (card?.status === 'failed') props.onReload()
  }

  // 进入页面时若上次读取为空或出错，补读一次；读取中不叠加第二个请求。
  // 只在挂载这一刻判定，后续变化由加载态回报。
  useEffect(() => {
    if (props.project === null || props.loading) return
    if (props.projection.requirements.length === 0 || props.error !== null) props.onReload()
  }, [])

  return (
    <section className="page" data-testid="page-requirements">
      <header className="page-head requirements-head">
        <div>
          <h2>需求</h2>
        </div>
        <div className="page-actions requirements-toolbar">
          <SearchField
            className="req-search"
            data-testid="requirement-search"
            value={text}
            onChange={setText}
            aria-label="搜索需求"
            variant="secondary"
          >
            <SearchFieldGroup>
              <SearchFieldInput placeholder="搜索需求" />
              <SearchFieldClearButton />
            </SearchFieldGroup>
          </SearchField>
          <Tabs
            className="req-state-tabs"
            data-testid="requirement-state"
            selectedKey={state === '' ? 'all' : state}
            onSelectionChange={selectState}
            aria-label="状态筛选"
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="状态筛选">
                {stateTabs.map(item => (
                  <Tabs.Tab key={item.id} id={item.id} className="relative z-10 whitespace-nowrap shrink-0">
                    <Tabs.Indicator />
                    {item.label}<span className="tab-count">{item.count}</span>
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
          <span title={blockedIntake ? t('requirement.intakeBlocked') : undefined}>
            <Button
              variant="primary"
              data-testid="intake-open"
              isDisabled={props.project === null || blockedIntake || busyOf('intake', null)}
              onPress={() => { setWizard(true) }}
            >
              {props.intakeResult === null ? t('intake.entryStart') : t('intake.entryResult')}
            </Button>
          </span>
          <Button
            variant="secondary"
            data-testid="change-triage-open"
            isDisabled={props.project === null}
            onPress={() => { openChangeTriage(null) }}
          >
            <Sparkles size={14} aria-hidden="true" />
            {t('triage.openButton')}
          </Button>
          <Button
            variant="primary"
            data-testid="requirement-new-open"
            isDisabled={props.project === null || busyOf('create', null)}
            onPress={() => { setCreateOpen(true) }}
          >
            <Plus size={14} />
            {t('requirement.new')}
          </Button>
        </div>
      </header>

      {props.project === null && <p className="empty" data-testid="requirement-no-project">先在「切换项目」里打开一个仓库。</p>}

      {props.project !== null && props.error !== null && (
        <p className="read-error" data-testid="requirement-read-error">
          <span>读取失败：{props.error.split('\n')[0]}</span>
          <Button size="sm" variant="secondary" data-testid="requirement-retry" isDisabled={props.loading} onPress={props.onReload}>
            {props.loading ? '读取中…' : '重试'}
          </Button>
        </p>
      )}

      {opNotice !== null && (
        <p className="problem" data-testid="requirement-op-result">{t('requirement.opFailed', { detail: opNotice })}</p>
      )}

      {recoverySessions.length > 0 && (
        <p className="requirement-recovery" data-testid="requirement-background-recovery">
          <span>{t('requirement.backgroundRunning', { count: recoverySessions.length })}</span>
          {recoverySessions.map(session => (
            <Button
              key={session.sessionId}
              size="sm"
              variant="ghost"
              data-testid="requirement-background-recovery-open"
              data-session-id={session.sessionId}
              onPress={() => { props.onOpenSession(session.sessionId) }}
            >
              {t('requirement.viewConversation')}
            </Button>
          ))}
        </p>
      )}

      {props.project !== null && pendingChanges.length > 0 && (
        <Card className="pending-proposals" data-testid="requirement-pending-proposals">
          <Card.Header className="pending-proposals-head">
            <Card.Title>{t('requirement.pendingTitle')}</Card.Title>
            <Chip size="sm" variant="soft" color="warning">{pendingChanges.length}</Chip>
          </Card.Header>
          <Separator />
          <Card.Content>
            <ul className="plain-list compact">
              {pendingChanges.map(({ proposal, change }) => (
                <li key={proposal.id} data-testid="requirement-pending-proposal" data-proposal-id={proposal.id}>
                  <div className="pending-proposal-body">
                    <strong>{proposal.title}</strong>
                    <Chip size="sm" variant="secondary">
                      {change.mode === 'new'
                        ? t('requirement.pendingNew')
                        : change.mode === 'patch'
                          ? t('requirement.pendingPatch', { target: change.target ?? '' })
                          : t('requirement.pendingTarget', { target: change.target ?? '' })}
                    </Chip>
                    <p className="detail-note">
                      {change.analysis.length > 120 ? `${change.analysis.slice(0, 120)}…` : change.analysis}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="requirement-pending-open"
                    data-proposal-id={proposal.id}
                    onPress={() => { setCompareId(proposal.id) }}
                  >
                    {t('requirement.pendingOpen')}
                  </Button>
                </li>
              ))}
            </ul>
          </Card.Content>
        </Card>
      )}

      {props.project !== null && (
        <div className="requirements-workspace">
          <div className="table-wrap requirements-table">
            <Table aria-label="需求列表" className="requirements-table-root">
              <Table.Content>
                <Table.Header>
                  <Table.Column isRowHeader>编号</Table.Column>
                  <Table.Column>标题</Table.Column>
                  <Table.Column>状态</Table.Column>
                  <Table.Column>{t('requirement.colOpened')}</Table.Column>
                  <Table.Column>{t('requirement.colActions')}</Table.Column>
                </Table.Header>
                <Table.Body>
                  {rows.map((row) => {
                    const related = relatedOf(row.id)
                    const reviewGate = canReviewRequirement({
                      reviews: row.reviews,
                      versions: row.versions,
                      flow,
                      roster: props.projection.roles,
                      document: row.text,
                    })
                    const reviewBlockReason = reviewGate.ok
                      ? undefined
                      : reviewGate.block.reason === 'pending'
                        ? t('requirement.reviewBlockedPending', { round: reviewGate.block.round })
                        : t('requirement.reviewBlockedRepeat', { round: reviewGate.block.round })
                    const modifyGate = canModifyDraft({
                      reviews: row.reviews,
                      versions: row.versions,
                      flow,
                      roster: props.projection.roles,
                      document: row.text,
                    })
                    const modifyBlockReason = modifyGate.ok
                      ? undefined
                      : modifyGate.reason === 'pending'
                        ? t('requirement.modifyBlockedPending')
                        : modifyGate.reason === 'rejected'
                          ? t('requirement.modifyBlockedRejected')
                          : t('requirement.modifyBlockedNoNewVersion')
                    return (
                      <Table.Row
                        key={row.id}
                        data-testid="requirement-row"
                        data-requirement-id={row.id}
                        className={row.id === selected ? 'selected' : ''}
                        onAction={() => { openDetail(row) }}
                      >
                        <Table.Cell className="mono">
                          {row.id}
                          <button
                            type="button"
                            className="requirement-row-version"
                            data-testid="requirement-row-version"
                            data-requirement-id={row.id}
                            aria-label={t('requirement.rowVersionTitle')}
                            title={t('requirement.rowVersionTitle')}
                            onClick={(event) => { event.stopPropagation(); openDetail(row, true) }}
                          >
                            {`v${row.versions.reduce((max, version) => Math.max(max, version.n), 1)}`}
                          </button>
                        </Table.Cell>
                        <Table.Cell>{row.title ?? row.id}</Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" variant="soft" color={stateChipColor(row.state ?? '')}>
                            {requirementStateLabel(row.state)}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="mono">{row.openedAt?.slice(0, 10) ?? '—'}</Table.Cell>
                        <Table.Cell>
                          <div className="row-actions requirement-row-actions">
                            {row.state === 'draft' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  data-testid="requirement-op-review"
                                  isDisabled={runningOpOf(row.id) !== null || !reviewGate.ok}
                                  ref={(node) => { if (node !== null) node.title = reviewBlockReason ?? '' }}
                                  onPress={() => { void review(row) }}
                                >
                                  {t('requirement.opReview')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  data-testid="requirement-op-revise"
                                  isDisabled={runningOpOf(row.id) !== null || !modifyGate.ok}
                                  ref={(node) => { if (node !== null) node.title = modifyBlockReason ?? '' }}
                                  onPress={() => { if (modifyGate.ok) openModify(row) }}
                                >
                                  {t('requirement.opRevise')}
                                </Button>
                              </>
                            )}
                            {row.state === 'confirmed' && related.length === 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid="requirement-op-split"
                                isDisabled={runningOpOf(row.id) !== null}
                                onPress={() => { void split(row) }}
                              >
                                {t('requirement.opSplit')}
                              </Button>
                            )}
                            {related.length > 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid="requirement-op-tasks"
                                onPress={() => { props.onOpenTasks(row.id) }}
                              >
                                {t('requirement.opTasks')}
                              </Button>
                            )}
                            {row.state !== 'closed' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="requirement-row-close"
                                data-testid="requirement-op-close"
                                isDisabled={runningOpOf(row.id) !== null}
                                ref={(node) => { if (node !== null) node.title = t('requirement.opCloseTitle') }}
                                onPress={() => { setCloseError(null); setCloseTarget(row) }}
                              >
                                {t('requirement.opClose')}
                              </Button>
                            )}
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    )
                  })}
                </Table.Body>
              </Table.Content>
            </Table>
            {rows.length === 0 && <p className="empty" data-testid="requirement-empty">{props.loading ? '读取中…' : '没有匹配的需求。'}</p>}
          </div>

          {active !== null && (
            <>
              <div className="requirement-detail-scrim" aria-hidden="true" onClick={closeDetail} />
              <div className="requirement-detail-layer">
                <RequirementDetail
                  key={`${active.id}:${historyEntry.open ? `h${historyEntry.seq}` : 'detail'}`}
                  row={active}
                  initialHistoryOpen={historyEntry.open}
                  project={props.project}
                  projection={props.projection}
                  sessions={props.sessions}
                  onClose={closeDetail}
                  onOpenTask={setTaskId}
                  onOpenReader={setReaderPath}
                  onReload={props.onReload}
                  onSplit={() => split(active)}
                  onReview={() => review(active)}
                  onRevise={decisions => revise(active, decisions)}
                  onModifyRequest={() => { openModify(active) }}
                  onCreateBased={() => createBased(active)}
                  onOpenTasks={() => { props.onOpenTasks(active.id) }}
                  modify={modifyState}
                  onModifyTextChange={setModifyText}
                  onModifySubmit={() => { void modifyStart() }}
                  onModifyCancel={() => { setModifyOpen(false); setModifyText(''); setModifyRow(null); setPatchError(null) }}
                  patchProposal={compare ?? activePatchChange}
                  diffOpen={compare !== undefined}
                  onViewDiff={() => { setCompareId(activePatchChange?.proposal.id ?? compare?.proposal.id ?? null) }}
                  onCloseDiff={() => { setCompareId(null) }}
                  onApplied={patchApplied}
                  readerOpen={readerPath !== null}
                  triageOpen={triageOpen}
                  runningOp={runningOpOf(active.id)}
                  onChangeTriage={() => { openChangeTriage(active.id) }}
                  t={t}
                />
              </div>
            </>
          )}
        </div>
      )}

      {detailTask !== undefined && props.project !== null && (
        <TaskDetail
          task={detailTask}
          projection={props.projection}
          project={props.project}
          sessions={props.sessions}
          onClose={() => { setTaskId(null) }}
          onOpenDoc={setReaderPath}
          onReload={props.onReload}
        />
      )}

      {props.project !== null && (
        <IntakeWizard
          isOpen={wizard}
          project={props.project}
          projection={props.projection}
          result={props.intakeResult}
          onClearResult={props.onClearIntakeResult}
          onClose={() => { setWizard(false) }}
          onStart={intakeStart}
          onOpenRequirement={(id) => { setWizard(false); setSelected(id) }}
          onReload={props.onReload}
          t={t}
        />
      )}

      {props.project !== null && (
        <ChangeTriageModal
          isOpen={triageOpen}
          requirements={props.projection.requirements}
          tasks={props.projection.tasks}
          tracks={props.projection.project?.tracks ?? []}
          projectKind={props.projection.project?.kind}
          initialTargetId={triageTargetId}
          onClose={() => { setTriageOpen(false) }}
          onConfirm={confirmChangeTriage}
          t={t}
        />
      )}

      {createOpen && props.project !== null && (
        <DetailDrawer
          testId="requirement-new-drawer"
          closeTestId="requirement-new-close"
          onClose={() => { setCreateOpen(false) }}
          head={<h3>{t('requirement.newDrawerTitle')}</h3>}
          t={t}
        >
          <p className="detail-note">{t('requirement.newHint')}</p>
          <textarea
            className="new-requirement-input"
            data-testid="requirement-new-description"
            value={createText}
            placeholder={t('requirement.newPlaceholder')}
            rows={6}
            onChange={(event) => { setCreateText(event.target.value) }}
          />
          <div className="action-row">
            <Button
              variant="primary"
              data-testid="requirement-new-start"
              onPress={() => { void createStart(createText) }}
            >
              <Sparkles size={14} />
              {t('requirement.newStart')}
            </Button>
          </div>
        </DetailDrawer>
      )}

      {compare !== undefined && selected === null && props.project !== null && (
        <ProposalCompare
          proposal={compare.proposal}
          change={compare.change}
          requirements={props.projection.requirements}
          scopeSessionId={props.project.scopeSessionId}
          onClose={() => { setCompareId(null) }}
          onReload={props.onReload}
          t={t}
        />
      )}

      {readerPath !== null && props.project !== null && (
        <ReaderOverlay
          scopeSessionId={props.project.scopeSessionId}
          path={readerPath}
          onClose={() => { setReaderPath(null) }}
        />
      )}

      {summarySessionId !== null && props.project !== null && (
        <IntakeSummary
          sessionId={summarySessionId}
          onConfirm={() => { if (summaryKey !== null) void confirmIntake(summaryKey); setSummaryKey(null) }}
          onOpenSession={() => { props.onOpenSession(summarySessionId); setSummaryKey(null) }}
          onClose={() => { setSummaryKey(null) }}
          t={t}
        />
      )}

      {unmapped.length > 0 && props.onAnswerPending !== undefined && (
        <button
          type="button"
          className="pending-fallback"
          data-testid="pending-fallback"
          aria-label={t('pending.fallbackCount', { count: unmapped.length })}
          onClick={answerUnmapped}
        >
          {t('pending.fallbackCount', { count: unmapped.length })}
        </button>
      )}

      <OperationCards
        cards={cards}
        onToggleMinimize={toggleMinimize}
        onOpenSession={props.onOpenSession}
        onClose={closeCard}
        onNextRole={nextRole}
        onCompare={(proposalId) => { setCompareId(proposalId) }}
        onViewSummary={(key) => { setSummaryKey(key) }}
        {...(props.onConfirmIntake === undefined ? {} : { onConfirmIntake: (key: string) => { void confirmIntake(key) } })}
        {...(props.onAnswerPending === undefined ? {} : { onAnswerRequest: answerPending })}
        t={t}
      />

      {closeTarget !== null && createPortal(
        <div
          className="pending-dialog-backdrop"
          data-testid="requirement-close-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !closing) {
              setCloseTarget(null)
              setCloseError(null)
            }
          }}
        >
          <div
            className="pending-dialog"
            style={{ width: 'min(440px, calc(100vw - 32px))' }}
            role="dialog"
            aria-modal="true"
            aria-label={t('requirement.closeConfirmTitle')}
            data-testid="requirement-close-confirm-dialog"
          >
            <header className="pending-dialog-head">
              <h2>{t('requirement.closeConfirmTitle')}</h2>
              <button
                type="button"
                className="pending-dialog-close"
                data-testid="requirement-close-dismiss"
                aria-label={t('requirement.closeConfirmCancel')}
                disabled={closing}
                onClick={() => { setCloseTarget(null); setCloseError(null) }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <p>{t('requirement.closeConfirmBody', { id: closeTarget.id, title: closeTarget.title ?? closeTarget.id })}</p>
            {closeError !== null && <p className="problem" data-testid="requirement-close-error">{closeError}</p>}
            <div className="pending-actions">
              <Button
                size="sm"
                variant="secondary"
                data-testid="requirement-close-cancel"
                isDisabled={closing}
                onPress={() => { setCloseTarget(null); setCloseError(null) }}
              >
                {t('requirement.closeConfirmCancel')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                data-testid="requirement-close-confirm"
                isDisabled={closing}
                onPress={() => { void confirmClose() }}
              >
                {t('requirement.closeConfirmSubmit')}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}
