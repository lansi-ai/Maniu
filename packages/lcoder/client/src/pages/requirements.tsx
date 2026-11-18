/** 需求页：列表、搜索、状态筛选；四类操作按流程配置逐岗推进，进度走操作浮卡；新建需求与改稿走提案对比确认。 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { SessionSummary } from '../store.ts'
import type { ProposalRow, RequirementDocRow, RequirementReviewRow } from '../spec/rows.ts'
import { requirementStateLabel } from '../spec/board.ts'
import { hasIntakeWork } from '../intake/eligibility.ts'
import { buildIntakeFollowupPrompt, buildManagerSplitPrompt, buildRequirementCreatePrompt, buildReviewPrompt, buildRevisePrompt, BUILTIN_SPLIT_TRACKS } from '../intake/prompts.ts'
import { INTAKE_PRESET_ID, MANAGER_PRESET_ID, PM_PRESET_ID } from '../talents/model.ts'
import { entryRoot, flowNodeOf, flowRoleLabel, flowRoleSource, presetOfRole, presetRoot } from '../flow/config.ts'
import { translate, type MessageKey, type Translate } from '../locale.ts'
import { OperationCards, type OperationCardView, type OperationStep, type OperationStepState } from '../shell/operation-cards.tsx'
import { RequirementDetail } from './requirement-detail.tsx'
import { TaskDetail } from './task-detail.tsx'
import { ReaderOverlay } from './reader.tsx'
import { IntakeWizard, type IntakeResult } from './intake-wizard.tsx'
import { ProposalCompare } from './proposal-compare.tsx'
import { DetailDrawer } from './detail-drawer.tsx'

/** 工作台页面尚未全面接入词典，未传取词函数时沿用中文；新客户端可传入自己的取词函数。 */
const zhText: Translate = (key, params) => translate('zh', key, params)

/** 后台操作的轮询间隔与等待上限。 */
const OP_POLL_MS = 4000
const OP_TIMEOUT_MS = 5 * 60 * 1000

/** 五类后台操作；立项调研与新建需求都走后台浮卡，不强制跳转对话。 */
type OpKind = 'intake' | 'create' | 'review' | 'revise' | 'split'

const OP_RUNNING_KEY: Readonly<Record<OpKind, MessageKey>> = {
  intake: 'requirement.opRunning.intake',
  create: 'requirement.opRunning.create',
  review: 'requirement.opRunning.review',
  revise: 'requirement.opRunning.revise',
  split: 'requirement.opRunning.split',
}

const OP_DONE_KEY: Readonly<Record<OpKind, MessageKey>> = {
  intake: 'requirement.opDone.intake',
  create: 'requirement.opDone.create',
  review: 'requirement.opDone.review',
  revise: 'requirement.opDone.revise',
  split: 'requirement.opDone.split',
}

const OP_TITLE_KEY: Readonly<Record<OpKind, MessageKey>> = {
  intake: 'requirement.opTitle.intake',
  create: 'requirement.opTitle.create',
  review: 'requirement.opTitle.review',
  revise: 'requirement.opTitle.revise',
  split: 'requirement.opTitle.split',
}

/** 岗位解析不了时的节点默认 preset；正常配置都能解析到岗位自己的 preset。 */
const OP_PRESET: Readonly<Record<OpKind, string>> = {
  intake: INTAKE_PRESET_ID,
  create: INTAKE_PRESET_ID,
  review: PM_PRESET_ID,
  revise: INTAKE_PRESET_ID,
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
}

/** 当前岗位的磁盘事实基线；完成判定只看投影相对基线的增量。 */
interface OpWatch extends OpRun {
  readonly roleIndex: number
  readonly sessionId: string | null
  readonly reviewRound: number
  readonly versions: number
  readonly related: number
  readonly planAt: string | null
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

/** 已结束的操作卡：完成保持绿色、失败给警示色，直到用户关闭。 */
interface FinishedOp extends OpRun {
  readonly sessionId: string | null
  readonly status: 'done' | 'failed'
  /** 已落盘的岗位数；失败时指向出事的那一岗。 */
  readonly landed: number
}

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
  /** preset 名册显示名；浮卡子标题取它，读不到回退词典。 */
  readonly presetNames?: Readonly<Record<string, string>>
  /** 取词函数；缺省为中文词典。 */
  readonly t?: Translate
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
  const [selected, setSelected] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [readerPath, setReaderPath] = useState<string | null>(null)
  const [wizard, setWizard] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createText, setCreateText] = useState('')
  const [compareId, setCompareId] = useState<string | null>(null)
  const [opNotice, setOpNotice] = useState<string | null>(null)
  const [watches, setWatches] = useState<readonly OpWatch[]>([])
  const [paused, setPaused] = useState<readonly PausedOp[]>([])
  const [finished, setFinished] = useState<readonly FinishedOp[]>([])
  const [minimizedKeys, setMinimizedKeys] = useState<readonly string[]>([])
  // 已发确认指令的立项卡键：回合再次跑起来前不重复进入等待确认态，防止连发。
  const [confirmSent, setConfirmSent] = useState<readonly string[]>([])
  // 见过回合跑起来的立项卡键：刚发起尚未开跑的会话不算「回合结束」，不进入等待确认态。
  const [sawRunning, setSawRunning] = useState<readonly string[]>([])
  const loadingRef = useRef(props.loading)
  loadingRef.current = props.loading
  const flow = props.projection.flow
  const reviewConfigured = flow?.nodes.some(node => node.node === 'review') === true
  const busyOf = (kind: OpKind, requirementId: string | null) =>
    watches.some(item => item.kind === kind && item.requirementId === requirementId)
    || paused.some(item => item.kind === kind && item.requirementId === requirementId)

  const rows = useMemo(() => {
    const query = text.trim().toLowerCase()
    return props.projection.requirements.filter((row) => {
      if (state !== '' && row.state !== state) return false
      if (query === '') return true
      return `${row.id} ${row.title ?? ''} ${row.text}`.toLowerCase().includes(query)
    })
  }, [props.projection.requirements, state, text])

  const active = rows.find(row => row.id === selected) ?? null
  const detailTask = taskId === null ? undefined : props.projection.tasks.find(task => task.id === taskId)

  const relatedOf = (requirementId: string) => props.projection.tasks.filter(
    task => task.requirement === requirementId || task.proposal === requirementId,
  )

  const splitPromptOf = (row: RequirementDocRow): string => {
    const extra = (props.projection.project?.tracks ?? []).map(track => `${track.id}（${track.name}）`)
    return buildManagerSplitPrompt(
      { id: row.id, title: row.title ?? row.id },
      row.text,
      [...BUILTIN_SPLIT_TRACKS, ...extra],
    )
  }

  const promptOf = (kind: OpKind, row: RequirementDocRow | null): string => {
    if (row === null) {
      return buildIntakeFollowupPrompt({ name: props.project?.title ?? '', path: props.project?.path ?? '' })
    }
    const requirement = { id: row.id, title: row.title ?? row.id }
    if (kind === 'review') return buildReviewPrompt(requirement, row.text)
    if (kind === 'revise') {
      const sorted = [...row.reviews].sort((left, right) => left.round - right.round)
      const baseVersion = row.versions.reduce((max, version) => Math.max(max, version.n), 0) || 1
      return buildRevisePrompt(requirement, row.text, sorted[sorted.length - 1]?.report, baseVersion)
    }
    return splitPromptOf(row)
  }

  /** 当前投影里该需求的磁盘事实基线；下一岗发起时按它记增量起点。 */
  const baselineOf = (requirementId: string | null) => {
    const row = requirementId === null ? undefined : props.projection.requirements.find(item => item.id === requirementId)
    return {
      reviewRound: row?.reviews.reduce((max, entry) => Math.max(max, entry.round), 0) ?? 0,
      versions: row?.versions.length ?? 0,
      related: requirementId === null ? 0 : relatedOf(requirementId).length,
      planAt: row?.splitPlan?.at ?? null,
      requirements: props.projection.requirements.length,
      proposalIds: props.projection.proposals.map(item => item.id),
    }
  }

  /** 发起节点里的某一岗；成功登记基线，失败首岗只给提示、后续岗转失败卡。 */
  const launchRole = async (run: OpRun, roleIndex: number): Promise<{ readonly ok: boolean; readonly message: string }> => {
    const roleId = run.roles[roleIndex]
    if (roleId === undefined) return { ok: false, message: '流程配置里没有这一岗' }
    const row = run.requirementId === null
      ? null
      : props.projection.requirements.find(item => item.id === run.requirementId) ?? null
    const preset = presetOfRole(roleId, props.projection.roles) ?? OP_PRESET[run.kind]
    setOpNotice(null)
    let answer: { readonly ok: boolean; readonly message: string; readonly sessionId?: string }
    try {
      answer = await props.onStartSession(promptOf(run.kind, row), preset)
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

  const startNode = (kind: 'review' | 'revise' | 'split', row: RequirementDocRow): Promise<{ readonly ok: boolean; readonly message: string }> => {
    const node = flowNodeOf(flow, kind)
    return launchRole(
      { key: `${kind}-${row.id}-${String(Date.now())}`, kind, requirementId: row.id, roles: node.roles, auto: node.auto },
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
      requirements: props.projection.requirements.length,
      proposalIds: props.projection.proposals.map(item => item.id),
      roleSig: null,
      deadline: Date.now() + OP_TIMEOUT_MS,
    }])
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

  const review = (row: RequirementDocRow) => startNode('review', row)
  const revise = (row: RequirementDocRow) => startNode('revise', row)
  const split = (row: RequirementDocRow) => startNode('split', row)

  // 完成判定以投影里的磁盘事实为准：评审见增轮（有配置时最新一轮署名根须等于当前条目根）、
  // 改稿见增版、拆分见关联任务或计划出现/更新、立项与新建需求见需求条数增量。落盘后按 auto 决定自动发起下一岗还是停下等人。
  useEffect(() => {
    if (watches.length === 0) return
    const doneWatches = watches.filter((watch) => {
      if (watch.kind === 'intake' || watch.kind === 'create') return props.projection.requirements.length > watch.requirements
      const row = props.projection.requirements.find(item => item.id === watch.requirementId)
      if (row === undefined) return false
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
      const related = props.projection.tasks.filter(
        task => task.requirement === row.id || task.proposal === row.id,
      ).length
      return related > watch.related || (row.splitPlan !== undefined && row.splitPlan.at !== watch.planAt)
    })
    if (doneWatches.length === 0) return
    setWatches(current => current.filter(item => !doneWatches.includes(item)))
    const finishedNow: FinishedOp[] = []
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
        void launchRole(watch, next)
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
  }, [watches, props.projection, props.onReload])

  // 固定间隔轮询投影；读取中不叠加请求，卸载或无操作时清理；超时转失败卡。
  useEffect(() => {
    if (watches.length === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      const expired = watches.filter(item => now >= item.deadline)
      if (expired.length > 0) {
        setWatches(current => current.filter(item => !expired.includes(item)))
        setFinished(current => [...current, ...expired.map(watch => ({
          key: watch.key,
          kind: watch.kind,
          requirementId: watch.requirementId,
          roles: watch.roles,
          auto: watch.auto,
          sessionId: watch.sessionId,
          status: 'failed' as const,
          landed: watch.roleIndex,
        }))])
        return
      }
      if (!loadingRef.current) props.onReload()
    }, OP_POLL_MS)
    return () => { clearInterval(timer) }
  }, [watches, props.onReload])

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

  // 提案等待对比：发起后新出现的起草态需求变更提案算本次操作的产物；新建看 new，改稿看目标的 revise。
  const pendingProposalOf = (watch: OpWatch): ProposalRow | undefined => {
    if (watch.kind !== 'create' && watch.kind !== 'revise') return undefined
    return props.projection.proposals.find((proposal) => {
      const change = proposal.requirementChange
      if (proposal.decision !== 'draft' || change === undefined) return false
      if (watch.proposalIds.includes(proposal.id)) return false
      return watch.kind === 'create'
        ? change.mode === 'new'
        : change.mode === 'revise' && change.target === watch.requirementId
    })
  }

  // 记录每张立项卡是否见过回合在跑；卡结束后清掉标记。
  useEffect(() => {
    const keys = new Set(watches.map(item => item.key))
    const kept = sawRunning.filter(key => keys.has(key))
    const fresh = watches
      .filter(watch => watch.kind === 'intake' && watch.sessionId !== null && !kept.includes(watch.key)
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
  const firstRequirement = props.projection.requirements[0]

  // 待确认的需求变更：起草态且带载荷的提案；对比视图只对这些提案开放。
  const pendingChanges = props.projection.proposals.flatMap(proposal =>
    proposal.decision === 'draft' && proposal.requirementChange !== undefined
      ? [{ proposal, change: proposal.requirementChange }]
      : [])
  const compare = compareId === null ? undefined : pendingChanges.find(entry => entry.proposal.id === compareId)

  const cards = useMemo<readonly OperationCardView[]>(() => {
    const labelCtx = {
      ...(props.presetNames === undefined ? {} : { presetNames: props.presetNames }),
      roster: props.projection.roles,
      t,
    }
    const labelOf = (id: string): string => flowRoleLabel(id, labelCtx)
    const idOf = (run: OpRun, index: number): string => run.roles[index] ?? run.roles[run.roles.length - 1] ?? ''
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
      }
    }
    const idTextOf = (run: OpRun): string =>
      run.requirementId ?? t(run.kind === 'create' ? 'requirement.opTitle.create' : 'requirement.opTitle.intake')
    return [
      ...watches.map((watch) => {
        const awaiting = awaitingConfirmOf(watch)
        const pendingProposal = pendingProposalOf(watch)
        return viewOf(
          watch, watch.roleIndex, watch.sessionId, 'running',
          awaiting
            ? t('op.awaitConfirm')
            : pendingProposal !== undefined
              ? t('op.awaitProposal')
              : confirmSent.includes(watch.key)
                ? t('op.confirmSent')
                : t(OP_RUNNING_KEY[watch.kind], { id: idTextOf(watch) }),
          !awaiting && pendingProposal === undefined, undefined, awaiting, pendingProposal?.id,
        )
      }),
      ...paused.map(run => viewOf(
        run, run.roleIndex, run.sessionId, 'running',
        t('op.awaitNext', { done: labelOf(idOf(run, run.roleIndex - 1)), next: labelOf(idOf(run, run.roleIndex)) }),
        false, labelOf(idOf(run, run.roleIndex)),
      )),
      ...finished.map(item => viewOf(
        item, Math.min(item.landed, item.roles.length - 1), item.sessionId, item.status,
        item.status === 'done'
          ? t(OP_DONE_KEY[item.kind], { id: idTextOf(item) })
          : t('requirement.opTimeout', { id: idTextOf(item) }),
        false,
      )),
    ]
  }, [watches, paused, finished, minimizedKeys, confirmSent, sawRunning, props.presetNames, props.projection, props.sessions, t])

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
      <header className="page-head">
        <div>
          <h2>需求</h2>
        </div>
        <div className="page-actions">
          <input
            className="search"
            data-testid="requirement-search"
            value={text}
            placeholder="搜索需求"
            onChange={(event) => { setText(event.target.value) }}
          />
          <select
            className="select"
            data-testid="requirement-state"
            value={state}
            onChange={(event) => { setState(event.target.value) }}
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="confirmed">已确认</option>
            <option value="released">已上线</option>
            <option value="closed">已关闭</option>
          </select>
          <button type="button" className="pill" data-testid="requirement-reload" onClick={props.onReload}>
            {props.loading ? '读取中…' : '刷新'}
          </button>
          <button
            type="button"
            className="pill pill-accent"
            data-testid="intake-open"
            disabled={props.project === null || blockedIntake || busyOf('intake', null)}
            title={blockedIntake ? t('requirement.intakeBlocked') : undefined}
            onClick={() => { setWizard(true) }}
          >
            {props.intakeResult === null ? '立项向导' : '立项结果'}
          </button>
          <button
            type="button"
            className="pill pill-accent"
            data-testid="requirement-new-open"
            disabled={props.project === null || busyOf('create', null)}
            onClick={() => { setCreateOpen(true) }}
          >
            {t('requirement.new')}
          </button>
        </div>
      </header>

      {props.project !== null && blockedIntake && (
        <p className="detail-note" data-testid="requirement-intake-blocked">
          <span>{t('requirement.intakeBlocked')}</span>
          {firstRequirement === undefined ? null : (
            <button
              type="button"
              className="link-button"
              data-testid="requirement-intake-blocked-open"
              onClick={() => { setSelected(firstRequirement.id) }}
            >
              {t('requirement.intakeBlockedOpen', { id: firstRequirement.id })}
            </button>
          )}
        </p>
      )}

      {props.project === null && <p className="empty" data-testid="requirement-no-project">先在「切换项目」里打开一个仓库。</p>}

      {props.project !== null && props.error !== null && (
        <p className="read-error" data-testid="requirement-read-error">
          <span>读取失败：{props.error.split('\n')[0]}</span>
          <button type="button" className="pill" data-testid="requirement-retry" disabled={props.loading} onClick={props.onReload}>
            {props.loading ? '读取中…' : '重试'}
          </button>
        </p>
      )}

      {opNotice !== null && (
        <p className="problem" data-testid="requirement-op-result">{t('requirement.opFailed', { detail: opNotice })}</p>
      )}

      {props.project !== null && pendingChanges.length > 0 && (
        <section className="pending-proposals lg-glass-card" data-testid="requirement-pending-proposals">
          <h3>{t('requirement.pendingTitle')}</h3>
          <ul className="plain-list compact">
            {pendingChanges.map(({ proposal, change }) => (
              <li key={proposal.id} data-testid="requirement-pending-proposal" data-proposal-id={proposal.id}>
                <div className="pending-proposal-body">
                  <strong>{proposal.title}</strong>
                  <span className="tag">
                    {change.mode === 'new' ? t('requirement.pendingNew') : t('requirement.pendingTarget', { target: change.target ?? '' })}
                  </span>
                  <p className="detail-note">
                    {change.analysis.length > 120 ? `${change.analysis.slice(0, 120)}…` : change.analysis}
                  </p>
                </div>
                <button
                  type="button"
                  className="pill pill-accent"
                  data-testid="requirement-pending-open"
                  data-proposal-id={proposal.id}
                  onClick={() => { setCompareId(proposal.id) }}
                >
                  {t('requirement.pendingOpen')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {props.project !== null && (
        <div className="split">
          <div className="table-wrap lg-glass-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">编号</th>
                  <th scope="col">标题</th>
                  <th scope="col">状态</th>
                  <th scope="col">{t('requirement.colOpened')}</th>
                  <th scope="col">{t('requirement.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const related = relatedOf(row.id)
                  return (
                    <tr
                      key={row.id}
                      data-testid="requirement-row"
                      data-requirement-id={row.id}
                      className={row.id === selected ? 'selected' : undefined}
                      tabIndex={0}
                      onClick={() => { setSelected(row.id) }}
                      onKeyDown={(event) => { if (event.key === 'Enter') setSelected(row.id) }}
                    >
                      <td className="mono">{row.id}</td>
                      <td>{row.title ?? row.id}</td>
                      <td><span className="tag">{requirementStateLabel(row.state)}</span></td>
                      <td className="mono">{row.openedAt?.slice(0, 10) ?? '—'}</td>
                      <td>
                        <div className="row-actions">
                          {row.state === 'draft' && (
                            <>
                              <button
                                type="button"
                                className="pill"
                                data-testid="requirement-op-review"
                                disabled={busyOf('review', row.id)}
                                onClick={(event) => { event.stopPropagation(); void review(row) }}
                              >
                                {t('requirement.opReview')}
                              </button>
                              <button
                                type="button"
                                className="pill"
                                data-testid="requirement-op-revise"
                                disabled={busyOf('revise', row.id)}
                                onClick={(event) => { event.stopPropagation(); void revise(row) }}
                              >
                                {t('requirement.opRevise')}
                              </button>
                            </>
                          )}
                          {row.state === 'confirmed' && related.length === 0 && (
                            <button
                              type="button"
                              className="pill"
                              data-testid="requirement-op-split"
                              disabled={busyOf('split', row.id)}
                              onClick={(event) => { event.stopPropagation(); void split(row) }}
                            >
                              {t('requirement.opSplit')}
                            </button>
                          )}
                          {related.length > 0 && (
                            <button
                              type="button"
                              className="pill"
                              data-testid="requirement-op-tasks"
                              onClick={(event) => { event.stopPropagation(); props.onOpenTasks(row.id) }}
                            >
                              {t('requirement.opTasks')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="empty" data-testid="requirement-empty">{props.loading ? '读取中…' : '没有匹配的需求。'}</p>}
          </div>

          {active !== null && (
            <RequirementDetail
              key={active.id}
              row={active}
              project={props.project}
              projection={props.projection}
              sessions={props.sessions}
              onClose={() => { setSelected(null) }}
              onOpenTask={setTaskId}
              onOpenReader={setReaderPath}
              onReload={props.onReload}
              onSplit={() => split(active)}
              onReview={() => review(active)}
              onRevise={() => revise(active)}
              onCreateBased={() => createBased(active)}
              onOpenTasks={() => { props.onOpenTasks(active.id) }}
              t={t}
            />
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

      {wizard && props.project !== null && (
        <IntakeWizard
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
            <button
              type="button"
              className="pill pill-accent"
              data-testid="requirement-new-start"
              onClick={() => { void createStart(createText) }}
            >
              {t('requirement.newStart')}
            </button>
          </div>
        </DetailDrawer>
      )}

      {compare !== undefined && props.project !== null && (
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

      <OperationCards
        cards={cards}
        onToggleMinimize={toggleMinimize}
        onOpenSession={props.onOpenSession}
        onClose={closeCard}
        onNextRole={nextRole}
        onCompare={(proposalId) => { setCompareId(proposalId) }}
        {...(props.onConfirmIntake === undefined ? {} : { onConfirmIntake: (key: string) => { void confirmIntake(key) } })}
        t={t}
      />
    </section>
  )
}
