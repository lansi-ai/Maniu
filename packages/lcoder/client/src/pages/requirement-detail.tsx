/** 需求详情：单行头部 + 文档 Tab 栏 + 当前文档专属操作栏 + 正文阅读区；关联任务在阅读区之后，阶段 chips 只保留 DOM。 */

import { Fragment, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Button, Chip, Separator } from '@heroui/react'
import { ChevronDown, ChevronRight, ChevronUp, RotateCw, Sparkles, X } from 'lucide-react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { ProposalRow, RequirementChangeRow, RequirementDocRow, RequirementReviewRow, RequirementSplitPlanEntryRow } from '../spec/rows.ts'
import type { SessionSummary } from '../store.ts'
import { requirementStateLabel } from '../spec/board.ts'
import { diffLines, type DiffLine } from '../spec/diff.ts'
import { readWorkspaceText, WORKSPACE_READ_LINES } from '../spec/files.ts'
import { runCommand, type CommandOutcome } from '../commands/run.ts'
import { canApproveRequirement, canModifyDraft, canReviewRequirement, type ModifyBlockReason } from './requirement-gate.ts'
import { renderMarkdown } from '../markdown/markdown.tsx'
import { translate, type MessageKey, type Translate } from '../locale.ts'
import { formatTimestamp, parseReviewReport, type ReviewPriority, type ReviewTodo } from './requirement-report.ts'
import type { ReviewDecisions } from '../intake/prompts.ts'
import { DetailDrawer } from './detail-drawer.tsx'
import { ProposalDiff } from './proposal-compare.tsx'
import { PrototypePanel } from './prototype-panel.tsx'

const zhText: Translate = (key, params) => translate('zh', key, params)

/** 内联评审报告的单次行数上限；与阅读器一致。 */
const REPORT_LINES = WORKSPACE_READ_LINES

/** 详情页的操作口径按四态加未知态分流；未知态只留次级动作。 */
type DetailState = 'draft' | 'confirmed' | 'released' | 'closed' | 'unknown'

/** 一轮评审的人工处置；旧数据没有 decision 字段时按待处理看待。 */
type ReviewDecision = 'pending' | 'accepted' | 'rejected'

/** 起草态的三段交互：未评审、最新一轮待处置、最新一轮已处置。 */
type ReviewPhase = 'unreviewed' | ReviewDecision

/** 详情顶面的四块工作面；正文与评审共用文档加载逻辑，原型与任务各自独立成屏。 */
type Workface = 'body' | 'review' | 'prototype' | 'tasks'

function decisionOf(review: RequirementReviewRow): ReviewDecision {
  return review.decision === 'accepted' || review.decision === 'rejected' ? review.decision : 'pending'
}

/** 待改项逐条裁决：默认采纳，拒绝行弱化，有疑问需填写说明。 */
type TodoVerdict = 'accept' | 'reject' | 'question'

/** 优先级筛选胶囊的取值；`all` 不过滤。 */
type PriorityFilter = 'all' | ReviewPriority

/** 逐条裁决的界面状态，按待改项在报告里的下标索引。 */
interface TodoVerdictState {
  readonly verdicts: Readonly<Record<number, TodoVerdict>>
  readonly notes: Readonly<Record<number, string>>
  readonly expanded: number | null
}

const EMPTY_VERDICTS: TodoVerdictState = { verdicts: {}, notes: {}, expanded: null }

/** 优先级徽标的语义色；高为危险红、中为警告琥珀、低与未标注为中性色，与三态裁决色互不混淆。 */
const PRIORITY_COLOR: Readonly<Record<ReviewPriority | 'none', 'danger' | 'warning' | 'default'>> = {
  high: 'danger',
  medium: 'warning',
  low: 'default',
  none: 'default',
}

/** 优先级徽标文案的词典键；未标注也给出可读文本。 */
function priorityLabelKey(priority: ReviewPriority | undefined): MessageKey {
  return priority === 'high'
    ? 'requirement.todoPriorityHigh'
    : priority === 'medium'
      ? 'requirement.todoPriorityMedium'
      : priority === 'low'
        ? 'requirement.todoPriorityLow'
        : 'requirement.todoPriorityNone'
}

/** 优先级筛选胶囊的词典键。 */
const FILTER_KEY: Readonly<Record<Exclude<PriorityFilter, 'all'>, MessageKey>> = {
  high: 'requirement.reviewFilter.high',
  medium: 'requirement.reviewFilter.medium',
  low: 'requirement.reviewFilter.low',
}

/** 三态裁决按钮的词典键。 */
const VERDICT_KEY: Readonly<Record<TodoVerdict, MessageKey>> = {
  accept: 'requirement.reviewVerdict.accept',
  reject: 'requirement.reviewVerdict.reject',
  question: 'requirement.reviewVerdict.question',
}

const DECISION_CHIP_COLOR: Readonly<Record<ReviewDecision, 'warning' | 'success' | 'default'>> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'default',
}

/** 评审结论徽标文案：采纳且已关联版本时点出版本号。 */
function decisionLabel(t: Translate, review: RequirementReviewRow): string {
  const decision = decisionOf(review)
  if (decision === 'pending') return t('requirement.decision.pending')
  if (decision === 'rejected') return t('requirement.decision.rejected')
  return review.appliedVersion === undefined
    ? t('requirement.decision.accepted')
    : t('requirement.decision.acceptedVersion', { version: review.appliedVersion })
}

const GUIDE_KEY: Readonly<Record<DetailState, MessageKey>> = {
  draft: 'requirement.guide.draft',
  confirmed: 'requirement.guide.confirmed',
  released: 'requirement.guide.released',
  closed: 'requirement.guide.closed',
  unknown: 'requirement.guide.unknown',
}

/** 状态徽标的语义色；state-* 类名保留给现有选择器。 */
const STATE_CHIP_COLOR: Readonly<Record<DetailState, 'accent' | 'success' | 'warning' | 'default'>> = {
  draft: 'accent',
  confirmed: 'success',
  released: 'warning',
  closed: 'default',
  unknown: 'default',
}

/** 内联评审报告的读取状态；`path` 标明结果属于哪一份报告，切换轮次时不复用上一轮正文。 */
type ReportState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly path: string; readonly text: string }
  | { readonly status: 'failed'; readonly path: string; readonly message: string }

/** 版本快照只读对照的读取状态。 */
type VersionDiffState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly lines: readonly DiffLine[] }
  | { readonly status: 'failed'; readonly message: string }

/** 当前文档标签承载的内容：草稿、历史版本快照或某一轮评审报告。 */
type ActiveDocKind = 'draft' | 'version' | 'report'

/** 历史版本快照正文的读取状态；`version` 标明结果属于哪一版，切换标签时不复用上一版正文。 */
type VersionDocState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly version: number; readonly text: string }
  | { readonly status: 'failed'; readonly version: number; readonly message: string }

/** 文档标签键的首字符决定它属于哪类文档：`v<n>` 版本、`r<n>` 报告，其余为草稿。 */
function docKindOf(doc: string): ActiveDocKind {
  if (doc.startsWith('v')) return 'version'
  if (doc.startsWith('r')) return 'report'
  return 'draft'
}

/** 版本快照在仓库里的相对路径。 */
function versionPath(requirementId: string, version: number): string {
  return `.spec/requirements/${requirementId}/versions/v${String(version)}.md`
}

/** 评审报告与版本快照在阅读器里的仓库相对路径。 */
function specPath(relative: string): string {
  return `.spec/${relative.replace(/^\.?[\\/]/, '').replace(/^\.spec[\\/]/, '')}`
}

/** 版本对照的单栏：旧栏去掉新增行，新栏去掉删除行。 */
function compareColumn(lines: readonly DiffLine[], side: 'old' | 'new'): readonly DiffLine[] {
  return lines.filter(line => side === 'old' ? line.kind !== 'added' : line.kind !== 'removed')
}

/** 同窗说明栏的状态；由需求页按当前草稿修改会话与提案派生。 */
export interface ModifyState {
  readonly open: boolean
  readonly text: string
  readonly status: 'idle' | 'running' | 'failed' | 'ready'
  readonly error?: string | undefined
}

const CLOSED_MODIFY: ModifyState = { open: false, text: '', status: 'idle' }

/** 会让详情业务按钮互斥锁定的在途操作类型；来自需求页当前需求的后台浮卡。 */
export type RunningOpKind = 'review' | 'revise' | 'patch' | 'split' | 'prototype'

/** 在途操作对应的锁定提示文案。 */
const OP_LOCKED_KEY: Readonly<Record<RunningOpKind, MessageKey>> = {
  review: 'requirement.opLocked.review',
  revise: 'requirement.opLocked.revise',
  patch: 'requirement.opLocked.patch',
  split: 'requirement.opLocked.split',
  prototype: 'requirement.opLocked.prototype',
}

/** 原地改稿被送审锁定门禁拦下时的提示文案。 */
const MODIFY_BLOCK_KEY: Readonly<Record<ModifyBlockReason, MessageKey>> = {
  pending: 'requirement.modifyBlockedPending',
  rejected: 'requirement.modifyBlockedRejected',
  noNewVersion: 'requirement.modifyBlockedNoNewVersion',
}

/** 需求详情属性。 */
export interface RequirementDetailProps {
  readonly row: RequirementDocRow
  readonly project: ProjectScope
  readonly projection: SpecProjection
  readonly sessions: readonly SessionSummary[]
  readonly onClose: () => void
  readonly onOpenTask: (taskId: string) => void
  readonly onOpenReader: (path: string) => void
  readonly onReload: () => void
  /** 发送拆分指令；由需求页按当前投影拼提示词。 */
  readonly onSplit: () => Promise<{ readonly ok: boolean; readonly message: string }>
  /** 发起评审节点；由需求页按流程配置逐岗推进。 */
  readonly onReview: () => Promise<{ readonly ok: boolean; readonly message: string }>
  /** 发送采纳评审意见后的改稿指令；报告表主动作带上用户逐条裁决。 */
  readonly onRevise: (decisions?: ReviewDecisions) => Promise<{ readonly ok: boolean; readonly message: string }>
  /** 顶部「修改需求」只请求打开修改说明输入框，不启动会话、不写数据。 */
  readonly onModifyRequest: () => void
  /** 基于此版本新建需求提案；确认态与终态的改动通道，后台发起不跳转。 */
  readonly onCreateBased: () => Promise<{ readonly ok: boolean; readonly message: string }>
  /** 跳到任务页并只显示本需求关联的任务。 */
  readonly onOpenTasks: () => void
  /** 同窗修改说明栏；缺省为关闭，保持不带修改流程的调用方行为不变。 */
  readonly modify?: ModifyState | undefined
  readonly onModifyTextChange?: (text: string) => void
  readonly onModifySubmit?: () => void
  /** 取消只收起说明栏，不启动会话、不写数据。 */
  readonly onModifyCancel?: () => void
  /** 当前需求待对比的 patch 提案；就绪时给「查看差异」。 */
  readonly patchProposal?: ({ readonly proposal: ProposalRow; readonly change: RequirementChangeRow }) | undefined
  readonly diffOpen?: boolean | undefined
  readonly onViewDiff?: () => void
  readonly onCloseDiff?: () => void
  /** 应用成功后由需求页收起说明栏与差异、刷新正文。 */
  readonly onApplied?: () => void
  /** 阅读层打开时详情不抢 Esc。 */
  readonly readerOpen?: boolean | undefined
  /** 列表版本号徽标直达时置开历史抽屉；普通行点击保持关闭。 */
  readonly initialHistoryOpen?: boolean | undefined
  /** 当前需求的在途后台操作；非空时锁定业务按钮，patch 待裁决阶段仍可查看差异。 */
  readonly runningOp?: RunningOpKind | null | undefined
  /** 后台发起 maniu-prototype 会话生成原型；提示词由原型区拼好。 */
  readonly onGeneratePrototype?: ((prompt: string) => Promise<{ readonly ok: boolean; readonly message: string }>) | undefined
  /** 取词函数；缺省为中文词典。 */
  readonly t?: Translate
}

/**
 * 画出需求详情。
 *
 * 四层自上而下：需求全局头部（单行标题、状态徽标、编号与状态级全局动作，外加至多一条
 * 状态提示）、文档 Tab 栏、当前选中文档的专属操作栏、当前文档正文。草稿、版本快照与各轮
 * 评审报告各自只展示自己的一份正文，非当前标签用 `hidden` 留在 DOM 供既有查询。评审报告
 * 直接渲染全文 Markdown，不再另列摘要卡或待改项卡片墙；阶段 chips 保留 DOM 但不再展示。
 * @param props - 需求、项目、投影与会话列表。
 * @returns 详情面板。
 */
export function RequirementDetail(props: RequirementDetailProps): JSX.Element {
  const t = props.t ?? zhText
  const row = props.row
  const modify = props.modify ?? CLOSED_MODIFY
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const todoNoteRef = useRef<HTMLTextAreaElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<CommandOutcome | null>(null)
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set())
  const [assigns, setAssigns] = useState<Readonly<Record<string, CommandOutcome>>>({})
  /** 历史抽屉的打开态；列表版本徽标直达时置开。 */
  const [historyOpen, setHistoryOpen] = useState(props.initialHistoryOpen === true)
  /** 历史抽屉内展开的版本快照或评审报告标签。 */
  const [historyDoc, setHistoryDoc] = useState<string | null>(null)
  /** 历史评审报告的读取结果；与当前报告的读取状态分开，避免互相覆盖。 */
  const [historyReport, setHistoryReport] = useState<ReportState>({ status: 'loading' })
  /** 报告 Markdown 原文默认隐藏，只有结构化视图无法表达时才展开。 */
  const [showRawMarkdown, setShowRawMarkdown] = useState(false)
  /** 核心摘要默认折叠到两行，点击摘要条展开全文。 */
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  /** 当前聚焦的补充说明输入框；聚焦或已有内容时展开为多行。 */
  const [noteFocused, setNoteFocused] = useState<number | null>(null)
  /** 待改项逐条裁决与展开行；切换报告时重置。 */
  const [reviewUi, setReviewUi] = useState<TodoVerdictState>(EMPTY_VERDICTS)
  /** 优先级筛选；默认全部。 */
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  /** 批量裁决菜单的展开态；点击外部或按 Esc 关闭。 */
  const [batchMenuOpen, setBatchMenuOpen] = useState(false)
  const related = props.projection.tasks.filter(task => task.requirement === row.id || task.proposal === row.id)

  // 在途后台操作与本地发起共用同一把互斥锁；查看差异不在锁内，供 patch 待裁决阶段对比。
  const locked = busy !== null || (props.runningOp !== undefined && props.runningOp !== null)
  const lockedHint = props.runningOp === undefined || props.runningOp === null
    ? undefined
    : t(OP_LOCKED_KEY[props.runningOp])

  const state: DetailState = row.state === 'draft' || row.state === 'confirmed' || row.state === 'released' || row.state === 'closed'
    ? row.state
    : 'unknown'

  const latestReview = row.reviews.reduce<RequirementReviewRow | null>(
    (best, review) => best === null || review.round > best.round ? review : best,
    null,
  )
  const latestRound = latestReview?.round
  const phase: ReviewPhase = latestReview === null ? 'unreviewed' : decisionOf(latestReview)

  /** 当前工作面：待处置评审优先落到评审处理，其余状态落在正文。 */
  const [workface, setWorkface] = useState<Workface>(phase === 'pending' ? 'review' : 'body')
  /** 有评审才显示评审处理面；终态、有任务或有拆分方案才显示关联任务面，草稿期隐藏。 */
  const reviewFaceVisible = row.reviews.length > 0
  const prototypeFaceVisible = props.onGeneratePrototype !== undefined
  const tasksFaceVisible = state === 'confirmed' || state === 'released' || state === 'closed'
    || related.length > 0 || row.splitPlan !== undefined

  // 正文与评审面各自只展示一份当前文档；历史快照与历史报告移入历史抽屉。
  const activeDoc = workface === 'review' && latestRound !== undefined ? `r${String(latestRound)}` : 'draft'
  const activeDocKind = docKindOf(activeDoc)
  /** 评审面只承载最新一轮；历史轮次在抽屉里只读展开。 */
  const activeReview = workface === 'review' ? latestReview : null
  const reportPath = activeReview === null ? null : specPath(activeReview.report)
  const [report, setReport] = useState<ReportState>({ status: 'loading' })
  const [compareVersion, setCompareVersion] = useState<number | null>(null)
  const [versionDiff, setVersionDiff] = useState<VersionDiffState>({ status: 'idle' })
  const [versionDoc, setVersionDoc] = useState<VersionDocState>({ status: 'loading' })
  /** 历史抽屉当前展开的快照与报告：按标签前缀分流，上一项正文不复用到新项。 */
  const historyVersion = historyDoc?.startsWith('v') === true ? Number(historyDoc.slice(1)) : undefined
  const historyReview = historyDoc?.startsWith('r') === true
    ? row.reviews.find(review => review.round === Number(historyDoc.slice(1))) ?? null
    : null
  const historyReportPath = historyReview === null ? null : specPath(historyReview.report)
  const activeVersionDoc = versionDoc.status !== 'loading' && versionDoc.version === historyVersion ? versionDoc : undefined
  const activeHistoryReport = historyReportPath !== null && historyReport.status !== 'loading' && historyReport.path === historyReportPath
    ? historyReport
    : undefined

  // 内联报告与阅读器走同一条宿主文件通道；轮次或项目变化时重读，卸载后不再落状态。
  useEffect(() => {
    if (reportPath === null) return
    let disposed = false
    setReport({ status: 'loading' })
    void readWorkspaceText(props.project.scopeSessionId, reportPath, REPORT_LINES)
      .then((answer) => {
        if (disposed) return
        setReport(answer.ok
          ? { status: 'ready', path: reportPath, text: answer.text }
          : { status: 'failed', path: reportPath, message: `${answer.error.code}: ${answer.error.message}` })
      })
      .catch((cause: unknown) => {
        if (disposed) return
        setReport({ status: 'failed', path: reportPath, message: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => { disposed = true }
  }, [reportPath, props.project.scopeSessionId])

  // 切换报告轮次时清空逐条裁决、展开行与筛选，避免把上一轮的勾选带到新一轮。
  useEffect(() => {
    setReviewUi(EMPTY_VERDICTS)
    setShowRawMarkdown(false)
    setPriorityFilter('all')
    setBatchMenuOpen(false)
    setSummaryExpanded(false)
    setNoteFocused(null)
  }, [reportPath])

  // 版本快照正文与阅读器走同一条宿主文件通道；历史抽屉展开某版时才读取该版。
  useEffect(() => {
    if (historyVersion === undefined) return
    let disposed = false
    setVersionDoc({ status: 'loading' })
    void readWorkspaceText(props.project.scopeSessionId, versionPath(row.id, historyVersion), REPORT_LINES)
      .then((answer) => {
        if (disposed) return
        setVersionDoc(answer.ok
          ? { status: 'ready', version: historyVersion, text: answer.text }
          : { status: 'failed', version: historyVersion, message: `${answer.error.code}: ${answer.error.message}` })
      })
      .catch((cause: unknown) => {
        if (disposed) return
        setVersionDoc({ status: 'failed', version: historyVersion, message: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => { disposed = true }
  }, [historyVersion, row.id, props.project.scopeSessionId])

  // 历史评审报告复用同一条宿主文件通道；与当前报告分开保存，抽屉里只读展开。
  useEffect(() => {
    if (historyReportPath === null) return
    let disposed = false
    setHistoryReport({ status: 'loading' })
    void readWorkspaceText(props.project.scopeSessionId, historyReportPath, REPORT_LINES)
      .then((answer) => {
        if (disposed) return
        setHistoryReport(answer.ok
          ? { status: 'ready', path: historyReportPath, text: answer.text }
          : { status: 'failed', path: historyReportPath, message: `${answer.error.code}: ${answer.error.message}` })
      })
      .catch((cause: unknown) => {
        if (disposed) return
        setHistoryReport({ status: 'failed', path: historyReportPath, message: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => { disposed = true }
  }, [historyReportPath, props.project.scopeSessionId])

  // 版本对照只读：读 v(n-1) 与 v(n) 两份快照做逐行差异，不写回规格库。
  useEffect(() => {
    if (compareVersion === null) return
    let disposed = false
    setVersionDiff({ status: 'loading' })
    const prevPath = versionPath(row.id, compareVersion - 1)
    const nextPath = versionPath(row.id, compareVersion)
    void Promise.all([
      readWorkspaceText(props.project.scopeSessionId, prevPath, REPORT_LINES),
      readWorkspaceText(props.project.scopeSessionId, nextPath, REPORT_LINES),
    ]).then(([prev, next]) => {
      if (disposed) return
      if (!prev.ok) {
        setVersionDiff({ status: 'failed', message: `${prev.error.code}: ${prev.error.message}` })
        return
      }
      if (!next.ok) {
        setVersionDiff({ status: 'failed', message: `${next.error.code}: ${next.error.message}` })
        return
      }
      setVersionDiff({ status: 'ready', lines: diffLines(prev.text, next.text) })
    }).catch((cause: unknown) => {
      if (disposed) return
      setVersionDiff({ status: 'failed', message: cause instanceof Error ? cause.message : String(cause) })
    })
    return () => { disposed = true }
  }, [compareVersion, row.id, props.project.scopeSessionId])

  // 说明栏自动聚焦；收起后不残留焦点。
  useEffect(() => {
    if (modify.open) noteRef.current?.focus()
  }, [modify.open])

  // Esc 分层退出：批量菜单 → 版本对照 → 差异 → 说明栏 → 详情；阅读层打开时交给阅读层处理。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || props.readerOpen === true) return
      event.stopPropagation()
      if (batchMenuOpen) setBatchMenuOpen(false)
      else if (historyOpen) setHistoryOpen(false)
      else if (compareVersion !== null) setCompareVersion(null)
      else if (props.diffOpen === true) props.onCloseDiff?.()
      else if (modify.open) props.onModifyCancel?.()
      else props.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [
    batchMenuOpen, historyOpen, compareVersion, props.diffOpen, props.onClose,
    props.onCloseDiff, props.onModifyCancel, props.readerOpen, modify.open,
  ])

  const execute = async (kind: string, line: string): Promise<void> => {
    if (busy !== null) return
    setBusy(kind)
    setResult(null)
    try {
      const outcome = await runCommand(props.project.scopeSessionId, line)
      setResult(outcome)
      if (outcome.ok) props.onReload()
    } finally {
      setBusy(null)
    }
  }

  /**
   * 后台发起一类操作：结果落回执条，忙碌期间不叠加第二次发起。
   * @param kind - 操作标识，用于互斥锁。
   * @param run - 实际发起函数；可接收随操作透传的参数（改稿的逐条裁决）。
   * @param arg - 透传给 run 的参数；零参操作省略。
   */
  const startOp = async <T,>(
    kind: string,
    run: (arg?: T) => Promise<{ readonly ok: boolean; readonly message: string }>,
    arg?: T,
  ): Promise<void> => {
    if (busy !== null) return
    setBusy(kind)
    setResult(null)
    try {
      const answer = await run(arg)
      setResult({ ok: answer.ok, text: answer.message })
    } finally {
      setBusy(null)
    }
  }

  const assign = async (entry: RequirementSplitPlanEntryRow): Promise<void> => {
    if (busy !== null) return
    setBusy(`assign-${entry.task}`)
    try {
      const outcome = await runCommand(props.project.scopeSessionId, `/task_assign ${entry.task} ${entry.role}`)
      setAssigns(current => ({ ...current, [entry.task]: outcome }))
      if (outcome.ok) props.onReload()
    } finally {
      setBusy(null)
    }
  }

  const ignore = (task: string): void => {
    setIgnored((current) => {
      const next = new Set(current)
      next.add(task)
      return next
    })
  }

  const plan = row.splitPlan
  const planDone = plan !== undefined && plan.entries.every(entry =>
    ignored.has(entry.task)
    || assigns[entry.task]?.ok === true
    || props.projection.tasks.find(task => task.id === entry.task)?.role !== undefined)
  const roleLabel = (id: string): string => {
    const name = props.projection.roles.find(role => role.id === id)?.name
    return name === undefined ? id : `${name}（${id}）`
  }

  const acceptedVersion = latestReview === null || decisionOf(latestReview) !== 'accepted'
    ? undefined
    : latestReview.appliedVersion ?? row.versions.reduce<number | undefined>(
      (best, version) => version.n > latestReview.round && (best === undefined || version.n > best) ? version.n : best,
      undefined,
    )
  const pendingPatchProposal = props.projection.proposals.some(proposal =>
    proposal.decision === 'draft'
    && proposal.requirementChange?.mode === 'patch'
    && proposal.requirementChange.target === row.id)
  const reviewPendingReason = latestReview === null
    ? undefined
    : t('requirement.reviewPendingReason', { round: latestReview.round })
  const reviewLabel = phase === 'unreviewed'
    ? t('requirement.opReviewStart')
    : phase === 'pending'
      ? t('requirement.opReview')
      : t('requirement.opReviewAgain')
  const gateParams = { reviews: row.reviews, flow: props.projection.flow, roster: props.projection.roles, document: row.text }
  const reviewGate = canReviewRequirement({ ...gateParams, versions: row.versions })
  const approveGate = canApproveRequirement(gateParams)
  const canApprove = state === 'draft' && approveGate.ok
  const reviewBlockReason = reviewGate.ok
    ? undefined
    : reviewGate.block.reason === 'pending'
      ? t('requirement.reviewBlockedPending', { round: reviewGate.block.round })
      : t('requirement.reviewBlockedRepeat', { round: reviewGate.block.round })
  const approveReason = !approveGate.ok
    ? approveGate.block.reason === 'noReview'
      ? t('requirement.approveNeedsReview')
      : approveGate.block.reason === 'pending'
        ? t('requirement.approveBlockedPending', { rounds: (approveGate.block.rounds ?? []).map(round => `R${String(round)}`).join('、') })
        : t('requirement.approveNeedsFlow', { roles: (approveGate.block.roles ?? []).map(roleLabel).join('、') })
    : undefined
  const draftGuide = phase === 'unreviewed'
    ? t('requirement.guide.draft')
    : phase === 'pending' && latestReview !== null
      ? t('requirement.guide.reviewPending', { round: latestReview.round })
      : phase === 'accepted' && acceptedVersion !== undefined
        ? t('requirement.guide.reviewAccepted', { version: acceptedVersion })
        : phase === 'accepted'
          ? t('requirement.guide.reviewAcceptedPlain')
          : phase === 'rejected' && latestReview !== null
            ? t('requirement.guide.reviewRejected', { round: latestReview.round })
            : t('requirement.guide.draft')
  const guide = state === 'draft' ? draftGuide : t(GUIDE_KEY[state])
  /** 顶部只留一条状态提示：黄色横幅出现时不再复读灰色指引句。 */
  const bannerVisible = state === 'draft' && phase === 'pending' && reviewPendingReason !== undefined
  const proposalVisible = state === 'draft' && pendingPatchProposal
  const showGuide = !bannerVisible && !proposalVisible
  // 待处置态只用高对比横幅提示，不再叠加灰色的确认原因与阶段提示。
  const phaseHint = state !== 'draft' || phase === 'pending'
    ? undefined
    : phase === 'unreviewed'
      ? t('requirement.phaseHint.start')
      : t('requirement.phaseHint.reviewAgain')

  const modifyGate = canModifyDraft({ ...gateParams, versions: row.versions })
  const modifyBlockReason = modifyGate.ok ? undefined : t(MODIFY_BLOCK_KEY[modifyGate.reason])

  /** 评审结论徽标：阶段 chips 与历史轮次共用同一口径。 */
  const decisionChip = (review: RequirementReviewRow, testId: string): JSX.Element => {
    const decision = decisionOf(review)
    return (
      <Chip
        size="sm"
        variant="soft"
        color={DECISION_CHIP_COLOR[decision]}
        className="tag requirement-review-status"
        data-testid={testId}
        data-decision={decision}
      >
        {decisionLabel(t, review)}
      </Chip>
    )
  }

  /** 与当前报告标签匹配的读取结果；上一轮结果不复用到新一轮。 */
  const activeReport = reportPath !== null && report.status !== 'loading' && report.path === reportPath
    ? report
    : undefined
  const parsedReport = activeReport?.status === 'ready' ? parseReviewReport(activeReport.text) : undefined
  const todos: readonly ReviewTodo[] = parsedReport?.todos ?? []
  const hasTodos = todos.length > 0
  /** 整份报告都没有分类标题时，级别列退化为单列窄表头。 */
  const hasAnyCategory = todos.some(todo => todo.category !== undefined && todo.category !== '')

  const verdictOf = (index: number): TodoVerdict => reviewUi.verdicts[index] ?? 'accept'
  /** 默认单行；聚焦、已填内容或判为有疑问时展开为三行。 */
  const noteRows = (index: number): number =>
    noteFocused === index || (reviewUi.notes[index] ?? '') !== '' || verdictOf(index) === 'question' ? 3 : 1

  /** 按当前勾选汇总裁决；采纳项的补充改法直接拼进条目文本。 */
  const decisions: ReviewDecisions = {
    accepted: todos.flatMap((todo, index) => {
      if (verdictOf(index) !== 'accept') return []
      const note = (reviewUi.notes[index] ?? '').trim()
      return [`${todo.title}${note === '' ? '' : `（补充改法：${note}）`}`]
    }),
    questioned: todos.flatMap((todo, index) => verdictOf(index) === 'question'
      ? [{ item: todo.title, question: (reviewUi.notes[index] ?? '').trim() }]
      : []),
    rejected: todos.flatMap((todo, index) => verdictOf(index) === 'reject' ? [todo.title] : []),
  }
  const hasEmptyQuestion = decisions.questioned.some(entry => entry.question === '')
  const canAccept = decisions.accepted.length + decisions.questioned.length > 0 && !hasEmptyQuestion

  const countByPriority = (priority: ReviewPriority | 'all'): number => priority === 'all'
    ? todos.length
    : todos.filter(todo => todo.priority === priority).length
  const visibleTodos = todos
    .map((todo, index) => ({ todo, index }))
    .filter(({ todo }) => priorityFilter === 'all' || todo.priority === priorityFilter)

  const setVerdict = (index: number, verdict: TodoVerdict): void => {
    setReviewUi(current => ({ ...current, verdicts: { ...current.verdicts, [index]: verdict } }))
  }
  const setNote = (index: number, note: string): void => {
    setReviewUi(current => ({ ...current, notes: { ...current.notes, [index]: note } }))
  }
  const toggleExpanded = (index: number): void => {
    setReviewUi(current => ({ ...current, expanded: current.expanded === index ? null : index }))
  }
  const batchVerdict = (verdictFor: (todo: ReviewTodo) => TodoVerdict): void => {
    const verdicts: Record<number, TodoVerdict> = {}
    todos.forEach((todo, index) => { verdicts[index] = verdictFor(todo) })
    setReviewUi(current => ({ ...current, verdicts, expanded: null }))
  }

  // 切到「有疑问」时把焦点交给说明输入框，省去再点一次。
  useEffect(() => {
    const index = reviewUi.expanded
    if (index === null || verdictOf(index) !== 'question') return
    todoNoteRef.current?.focus()
  }, [reviewUi.expanded, reviewUi.verdicts])

  /** 历史入口标签：版本号取最新快照，无快照按 v1；有评审时并列最新轮次。 */
  const historyVersionLabel = row.versions.reduce((max, version) => Math.max(max, version.n), 1)
  const historyTriggerLabel = latestReview === null
    ? t('requirement.historyTriggerNoReview', { version: historyVersionLabel })
    : t('requirement.historyTrigger', { version: historyVersionLabel, round: latestReview.round })

  /** 历史抽屉的混排条目：版本快照与评审报告按落盘时间倒序。 */
  type HistoryEntry =
    | { readonly kind: 'version'; readonly key: string; readonly at: string; readonly n: number }
    | { readonly kind: 'review'; readonly key: string; readonly at: string; readonly review: RequirementReviewRow }
  const historyEntries: readonly HistoryEntry[] = [
    ...row.versions.map(version => ({ kind: 'version' as const, key: `v${String(version.n)}`, at: version.at, n: version.n })),
    ...row.reviews.map(review => ({ kind: 'review' as const, key: `r${String(review.round)}`, at: review.at, review })),
  ].sort((left, right) => right.at.localeCompare(left.at))

  return (
    <>
      <DetailDrawer
        testId="requirement-detail"
        closeTestId="requirement-detail-close"
        defaultExpanded
        onClose={props.onClose}
        attributes={{ 'data-requirement-id': row.id }}
        actions={(
          <div className="requirement-quick-tools" data-testid="requirement-quick-tools">
            <Button
              isIconOnly
              className="detail-drawer-icon"
              variant="ghost"
              size="sm"
              data-testid="requirement-detail-reload"
              aria-label={t('requirement.opReload')}
              ref={(node) => { if (node !== null) node.title = t('requirement.opReload') }}
              onPress={props.onReload}
            >
              <RotateCw aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="requirement-history-trigger"
              data-testid="requirement-history-trigger"
              aria-expanded={historyOpen}
              onPress={() => { setHistoryOpen(true) }}
            >
              {historyTriggerLabel}
            </Button>
          </div>
        )}
        head={(
          <div className="requirement-hero">
            <div className="requirement-title-row">
              <h2 className="requirement-title" data-testid="requirement-detail-title">{row.title ?? row.id}</h2>
              <Chip
                size="sm"
                variant="soft"
                color={STATE_CHIP_COLOR[state]}
                className={`tag state-badge state-${state}`}
                data-testid="requirement-state-badge"
              >
                {requirementStateLabel(row.state)}
              </Chip>
              <span className="mono requirement-id" data-testid="requirement-detail-id">{row.id}</span>
              <div className="action-row requirement-global-ops" data-testid="requirement-global-actions">
                {state === 'confirmed' && related.length === 0 && (
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="requirement-split"
                    isDisabled={locked}
                    onPress={() => { void startOp('split', props.onSplit) }}
                  >
                    {t('requirement.opSplit')}
                  </Button>
                )}
                {state === 'confirmed' && related.length > 0 && plan === undefined && (
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="requirement-split-again"
                    isDisabled={locked}
                    ref={(node) => { if (node !== null) node.title = lockedHint ?? t('requirement.opSplitAgainTitle') }}
                    onPress={() => { void startOp('split', props.onSplit) }}
                  >
                    {t('requirement.opSplitAgain')}
                  </Button>
                )}
                {(state === 'confirmed' || state === 'released' || state === 'closed') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="requirement-detail-create-based"
                    isDisabled={busy !== null}
                    onPress={() => { void startOp('createBased', props.onCreateBased) }}
                  >
                    {t('requirement.opCreateBased')}
                  </Button>
                )}
                {(state === 'confirmed' || state === 'released' || state === 'closed') && related.length > 0 && (
                  <Button variant="ghost" size="sm" data-testid="requirement-detail-tasks" onPress={props.onOpenTasks}>
                    {t('requirement.opTasks')}
                  </Button>
                )}
                {state === 'confirmed' && (
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="requirement-release"
                    isDisabled={locked}
                    onPress={() => { void execute('release', `/requirement_release ${row.id}`) }}
                  >
                    {t('requirement.opRelease')}
                  </Button>
                )}
                {(state === 'draft' || state === 'confirmed' || state === 'released') && (
                  <Button
                    variant="danger-soft"
                    size="sm"
                    className="requirement-close"
                    data-testid="requirement-close"
                    isDisabled={locked}
                    ref={(node) => { if (node !== null) node.title = lockedHint ?? t('requirement.opCloseTitle') }}
                    onPress={() => { void execute('close', `/requirement_close ${row.id}`) }}
                  >
                    {t('requirement.opClose')}
                  </Button>
                )}
              </div>
            </div>
            {showGuide && (
              <p className="requirement-guide" data-testid="requirement-guide">{guide}</p>
            )}
            {lockedHint !== undefined && (
              <p className="detail-note" data-testid="requirement-op-locked-hint">{lockedHint}</p>
            )}
            {bannerVisible && (
              <p className="detail-warning" data-testid="requirement-review-pending-reason">{reviewPendingReason}</p>
            )}
            {proposalVisible && (
              <p className="detail-warning" data-testid="requirement-review-proposal-hint">{t('requirement.reviewPendingProposal')}</p>
            )}
            {result !== null && (
              <p className={result.ok ? 'detail-line' : 'problem'} data-testid="requirement-action-result" data-ok={result.ok ? 'true' : 'false'}>
                {result.text}
              </p>
            )}
          </div>
        )}
      >
        <div
          className={modify.open ? 'requirement-detail-main with-note' : 'requirement-detail-main'}
          style={props.diffOpen === true ? { display: 'none' } : undefined}
        >
          <div className="detail-content-pane">
            <div className="requirement-workfaces" data-testid="requirement-doc-tabs" role="tablist" aria-label={t('requirement.workfaceTabsLabel')}>
              <button
                type="button"
                className="requirement-workface"
                data-testid="requirement-workface-body"
                data-active={workface === 'body' ? 'true' : 'false'}
                role="tab"
                aria-selected={workface === 'body'}
                onClick={() => { setWorkface('body') }}
              >
                {t('requirement.workface.body')}
              </button>
              {reviewFaceVisible && (
                <button
                  type="button"
                  className="requirement-workface"
                  data-testid="requirement-workface-review"
                  data-active={workface === 'review' ? 'true' : 'false'}
                  data-pending={phase === 'pending' ? 'true' : 'false'}
                  role="tab"
                  aria-selected={workface === 'review'}
                  onClick={() => { setWorkface('review') }}
                >
                  {t('requirement.workface.review')}
                  {phase === 'pending' && (
                    <span className="requirement-workface-badge" data-testid="requirement-workface-pending-badge">
                      {t('requirement.workface.pending')}
                    </span>
                  )}
                </button>
              )}
              {prototypeFaceVisible && (
                <button
                  type="button"
                  className="requirement-workface"
                  data-testid="requirement-workface-prototype"
                  data-active={workface === 'prototype' ? 'true' : 'false'}
                  role="tab"
                  aria-selected={workface === 'prototype'}
                  onClick={() => { setWorkface('prototype') }}
                >
                  {t('requirement.workface.prototype')}
                </button>
              )}
              {tasksFaceVisible && (
                <button
                  type="button"
                  className="requirement-workface"
                  data-testid="requirement-workface-tasks"
                  data-active={workface === 'tasks' ? 'true' : 'false'}
                  role="tab"
                  aria-selected={workface === 'tasks'}
                  onClick={() => { setWorkface('tasks') }}
                >
                  {t('requirement.workface.tasks')}
                </button>
              )}
            </div>
            {/* 第三层：当前选中文档的专属操作栏，紧贴标签栏下方。 */}
            <div
              className="action-row requirement-ops requirement-doc-actions"
              data-testid="requirement-actions"
              data-active-doc={activeDoc}
              data-active-doc-kind={activeDocKind}
              role="toolbar"
              aria-label={t('requirement.actionsLabel')}
            >
              <div
                className="requirement-op-group"
                data-testid="requirement-actions-draft"
                hidden={workface !== 'body'}
              >
                {state === 'draft' && (
                  <>
                    <Button
                      variant={phase === 'unreviewed' ? 'primary' : 'secondary'}
                      size="sm"
                      data-testid="requirement-detail-review"
                      data-variant={phase === 'unreviewed' ? 'primary' : 'secondary'}
                      data-phase={phase}
                      isDisabled={!reviewGate.ok || locked}
                      ref={(node) => {
                        if (node === null) return
                        node.title = lockedHint ?? reviewBlockReason ?? t(phase === 'unreviewed' ? 'requirement.opReviewTitleStart' : 'requirement.opReviewTitleAgain')
                      }}
                      onPress={() => { void startOp('review', props.onReview) }}
                    >
                      {reviewLabel}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid="requirement-detail-revise"
                      isDisabled={locked || !modifyGate.ok}
                      ref={(node) => { if (node !== null) node.title = lockedHint ?? modifyBlockReason ?? t('requirement.opReviseTitle') }}
                      onPress={() => { if (!locked && modifyGate.ok) props.onModifyRequest() }}
                    >
                      {t('requirement.opRevise')}
                    </Button>
                    <Button
                      variant={phase === 'pending' || !canApprove ? 'secondary' : 'primary'}
                      size="sm"
                      data-testid="requirement-approve"
                      data-variant={phase === 'pending' || !canApprove ? 'secondary' : 'primary'}
                      isDisabled={!canApprove || locked}
                      ref={(node) => { if (node !== null) node.title = lockedHint ?? approveReason ?? '' }}
                      onPress={() => { void execute('approve', `/requirement_approve ${row.id}`) }}
                    >
                      {t('requirement.opApprove')}
                    </Button>
                  </>
                )}
                {state === 'draft' && phase !== 'pending' && approveReason !== undefined && (
                  <p className="detail-note" data-testid="requirement-approve-hint">{approveReason}</p>
                )}
                {phaseHint !== undefined && (
                  <p className="detail-note" data-testid="requirement-phase-hint">{phaseHint}</p>
                )}
              </div>
              {activeDocKind === 'report' && activeReview !== null && (
                <div
                  className="requirement-op-group requirement-review-actions"
                  data-testid="requirement-actions-review"
                  data-round={activeReview.round}
                  data-decision={decisionOf(activeReview)}
                >
                  {decisionOf(activeReview) === 'pending'
                    ? (
                      <div className="requirement-review-decision" data-testid="requirement-review-decision">
                        <div className="review-primary-action">
                          <Button
                            variant="primary"
                            size="sm"
                            data-testid="requirement-review-accept"
                            data-accepted={decisions.accepted.length}
                            data-questioned={decisions.questioned.length}
                            data-rejected={decisions.rejected.length}
                            isDisabled={locked || !canAccept}
                            ref={(node) => {
                              if (node === null) return
                              node.title = lockedHint ?? (!canAccept
                                ? hasEmptyQuestion
                                  ? t('requirement.reviewAcceptQuestionRequired')
                                  : t('requirement.reviewAcceptDisabledTitle')
                                : t('requirement.reviewAcceptTitle'))
                            }}
                            onPress={() => { void startOp('reviewAccept', props.onRevise, decisions) }}
                          >
                            {t('requirement.reviewAcceptAction')}
                          </Button>
                          <span className="review-decision-counts">
                            <span className="review-decision-count" data-testid="requirement-review-count" data-kind="accepted">
                              {t('requirement.reviewCountAccepted', { count: decisions.accepted.length })}
                            </span>
                            <span className="review-decision-count" data-testid="requirement-review-count" data-kind="questioned">
                              {t('requirement.reviewCountQuestioned', { count: decisions.questioned.length })}
                            </span>
                            <span className="review-decision-count" data-testid="requirement-review-count" data-kind="rejected">
                              {t('requirement.reviewCountRejected', { count: decisions.rejected.length })}
                            </span>
                          </span>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid="requirement-review-reject"
                          isDisabled={locked}
                          ref={(node) => { if (node !== null) node.title = lockedHint ?? t('requirement.reviewRejectTitle') }}
                          onPress={() => { void execute('reviewReject', `/requirement_review_decide ${row.id} ${activeReview.round} rejected`) }}
                        >
                          {t('requirement.reviewRejectAction')}
                        </Button>
                      </div>
                    )
                    : (
                      <>
                        {decisionChip(activeReview, 'requirement-review-decided-status')}
                        <p className="detail-note requirement-doc-readonly" data-testid="requirement-review-decided">
                          {t('requirement.reviewDecided')}
                        </p>
                      </>
                    )}
                  <div className="requirement-review-meta">
                    {hasTodos && (
                      <button
                        type="button"
                        className="link-button review-markdown-toggle"
                        data-testid="requirement-report-markdown-toggle"
                        onClick={() => { setShowRawMarkdown(current => !current) }}
                      >
                        {showRawMarkdown
                          ? t('requirement.reviewMarkdownHide')
                          : t('requirement.reviewMarkdownShow')}
                      </button>
                    )}
                    <span className="time requirement-review-at" data-testid="requirement-review-at">
                      {formatTimestamp(activeReview.at)}
                    </span>
                  </div>
                </div>
              )}
            </div>
            {/* 第四层：正文与评审按工作面各渲染一屏，其余节点留在 DOM 供既有查询。 */}
            <div className="requirement-doc-pane" data-testid="requirement-doc-pane" data-active-doc={activeDoc}>
              <section
                className="detail-section requirement-document"
                data-testid="requirement-document"
                data-doc-active={workface === 'body' ? 'true' : 'false'}
                hidden={workface !== 'body'}
              >
                <h4>{t('requirement.bodyTitle')}</h4>
                <div className="markdown-body document-body" data-testid="requirement-document-body">
                  {row.text.trim() === ''
                    ? <p className="empty">{t('requirement.bodyEmpty')}</p>
                    : renderMarkdown(row.text)}
                </div>
              </section>

              <section
                className="detail-section"
                data-testid="requirement-review-report"
                data-doc-active={workface === 'review' ? 'true' : 'false'}
                data-pending-report={activeReview !== null && decisionOf(activeReview) === 'pending' ? 'true' : 'false'}
                hidden={workface !== 'review'}
                {...(activeReview === null ? {} : { 'data-round': activeReview.round })}
              >
                <Separator className="detail-divider" />
                {activeReview === null || reportPath === null
                  ? (
                    <>
                      <h4>{t('requirement.reportHeading')}</h4>
                      <p className="empty" data-testid="requirement-report-empty">{t('requirement.reportEmpty')}</p>
                    </>
                  )
                  : (
                    <>
                      {activeReport === undefined && (
                        <p className="empty" data-testid="requirement-report-loading">{t('requirement.reportLoading')}</p>
                      )}
                      {activeReport?.status === 'failed' && (
                        <p className="problem" data-testid="requirement-report-failed">
                          {t('requirement.reportFailed', { detail: activeReport.message })}
                        </p>
                      )}
                      {activeReport?.status === 'ready' && (
                        <>
                          {hasTodos && !showRawMarkdown
                            ? (
                              <>
                                <div
                                  className={`review-summary-bar${summaryExpanded ? ' is-summary-expanded' : ''}`}
                                  data-testid="requirement-review-summary-bar"
                                  data-expanded={summaryExpanded ? 'true' : 'false'}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => { setSummaryExpanded(current => !current) }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault()
                                      setSummaryExpanded(current => !current)
                                    }
                                  }}
                                >
                                  <span className="review-summary-label">{t('requirement.reviewSummaryLabel')}</span>
                                  <span className="review-summary-text">
                                    {parsedReport?.summary === '' ? t('requirement.reviewSummaryEmpty') : parsedReport?.summary}
                                  </span>
                                  <span className="review-summary-toggle" data-testid="requirement-review-summary-toggle" aria-hidden="true">
                                    {summaryExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                  </span>
                                </div>
                                <div className="review-todo-toolbar" data-testid="requirement-review-toolbar">
                                  <div className="review-segmented" role="group" aria-label={t('requirement.reviewFilterLabel')}>
                                    {(['all', 'high', 'medium', 'low'] as const).map(priority => (
                                      <button
                                        key={priority}
                                        type="button"
                                        className={`review-segment${priorityFilter === priority ? ' is-active' : ''}`}
                                        data-testid="requirement-review-filter"
                                        data-priority={priority}
                                        aria-pressed={priorityFilter === priority}
                                        onClick={() => { setPriorityFilter(priority) }}
                                      >
                                        {priority === 'all'
                                          ? t('requirement.reviewFilterAll', { count: countByPriority('all') })
                                          : t(FILTER_KEY[priority], { count: countByPriority(priority) })}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="review-batch-actions" role="group" aria-label={t('requirement.reviewBatchLabel')}>
                                    <button
                                      type="button"
                                      className="review-batch-trigger"
                                      data-testid="requirement-review-batch-trigger"
                                      aria-expanded={batchMenuOpen}
                                      aria-haspopup="menu"
                                      onClick={() => { setBatchMenuOpen(current => !current) }}
                                    >
                                      {t('requirement.reviewBatchLabel')}
                                      <ChevronDown size={14} aria-hidden="true" />
                                    </button>
                                    {batchMenuOpen && (
                                      <>
                                        <div className="review-batch-backdrop" data-testid="requirement-review-batch-backdrop" onClick={() => { setBatchMenuOpen(false) }} />
                                        <div className="review-batch-menu" role="menu">
                                          <button
                                            type="button"
                                            role="menuitem"
                                            className="review-batch-menu-item"
                                            data-testid="requirement-review-batch"
                                            data-action="allAccept"
                                            onClick={() => { batchVerdict(() => 'accept'); setBatchMenuOpen(false) }}
                                          >
                                            {t('requirement.reviewBatchAllAccept')}
                                          </button>
                                          <button
                                            type="button"
                                            role="menuitem"
                                            className="review-batch-menu-item"
                                            data-testid="requirement-review-batch"
                                            data-action="highOnly"
                                            onClick={() => { batchVerdict(todo => todo.priority === 'high' ? 'accept' : 'reject'); setBatchMenuOpen(false) }}
                                          >
                                            {t('requirement.reviewBatchHighOnly')}
                                          </button>
                                          <button
                                            type="button"
                                            role="menuitem"
                                            className="review-batch-menu-item"
                                            data-testid="requirement-review-batch"
                                            data-action="allReject"
                                            onClick={() => { batchVerdict(() => 'reject'); setBatchMenuOpen(false) }}
                                          >
                                            {t('requirement.reviewBatchAllReject')}
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="table-wrap review-todo-wrap" data-testid="requirement-review-todos">
                                  <table className="data-table review-todo-table" data-has-category={hasAnyCategory ? 'true' : 'false'}>
                                    <thead>
                                      <tr>
                                        <th scope="col">{t(hasAnyCategory ? 'requirement.reviewColLevel' : 'requirement.reviewColLevelOnly')}</th>
                                        <th scope="col">{t('requirement.reviewColIssue')}</th>
                                        <th scope="col">{t('requirement.reviewColVerdict')}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {visibleTodos.map(({ todo, index }) => {
                                        const verdict = verdictOf(index)
                                        const expanded = reviewUi.expanded === index
                                        return (
                                          <Fragment key={index}>
                                            <tr
                                              className={`review-todo-row${verdict === 'reject' ? ' is-rejected' : ''}${expanded ? ' is-expanded' : ''}`}
                                              data-testid="requirement-review-todo-row"
                                              data-index={index}
                                              data-verdict={verdict}
                                              onClick={() => { toggleExpanded(index) }}
                                            >
                                              <td className="review-todo-level">
                                                <Chip
                                                  size="sm"
                                                  variant="soft"
                                                  color={PRIORITY_COLOR[todo.priority ?? 'none']}
                                                  className="review-todo-priority"
                                                  data-priority={todo.priority ?? 'none'}
                                                >
                                                  {t(priorityLabelKey(todo.priority))}
                                                </Chip>
                                                {todo.category !== undefined && (
                                                  <span className="review-todo-category">{todo.category}</span>
                                                )}
                                              </td>
                                              <td className="review-todo-title">
                                                <span className="review-todo-title-inner">
                                                  <span className="review-todo-arrow" aria-hidden="true">
                                                    {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                                  </span>
                                                  <strong>{todo.title}</strong>
                                                </span>
                                              </td>
                                              <td className="review-todo-verdict" onClick={(event) => { event.stopPropagation() }}>
                                                <div className="verdict-group" role="group" aria-label={t('requirement.reviewVerdictLabel')}>
                                                  {(['accept', 'reject', 'question'] as const).map(option => (
                                                    <button
                                                      key={option}
                                                      type="button"
                                                      className={`verdict-button${verdict === option ? ` is-active is-active-${option}` : ''}`}
                                                      data-testid="requirement-review-todo-verdict"
                                                      data-index={index}
                                                      data-verdict={option}
                                                      aria-pressed={verdict === option}
                                                      onClick={() => {
                                                        setVerdict(index, option)
                                                        if (option === 'question') setReviewUi(current => ({ ...current, expanded: index }))
                                                      }}
                                                    >
                                                      {t(VERDICT_KEY[option])}
                                                    </button>
                                                  ))}
                                                </div>
                                              </td>
                                            </tr>
                                            {expanded && (
                                              <tr className="todo-detail-row" data-testid="requirement-review-todo-detail" data-index={index}>
                                                <td colSpan={3}>
                                                  <div className="todo-detail-card">
                                                    {todo.location !== '' && (
                                                      <p className="todo-detail-location-inline">
                                                        {t('requirement.reviewTodoLocation')} {todo.location}
                                                      </p>
                                                    )}
                                                    <div className="todo-detail-grid">
                                                      <section className="todo-detail-block todo-detail-problem">
                                                        <h6>{t('requirement.reviewTodoProblem')}</h6>
                                                        <p>{todo.problem || '—'}</p>
                                                      </section>
                                                      <section className="todo-detail-block todo-detail-suggestion">
                                                        <h6>{t('requirement.reviewTodoSuggestion')}</h6>
                                                        <p>{todo.suggestion || '—'}</p>
                                                      </section>
                                                      <section className="todo-detail-block todo-detail-note">
                                                        <h6>{t('requirement.reviewTodoNote')}</h6>
                                                        <textarea
                                                          ref={index === reviewUi.expanded ? todoNoteRef : undefined}
                                                          data-testid="requirement-review-todo-note"
                                                          data-index={index}
                                                          value={reviewUi.notes[index] ?? ''}
                                                          rows={noteRows(index)}
                                                          placeholder={verdict === 'question'
                                                            ? t('requirement.reviewTodoQuestionPlaceholder')
                                                            : t('requirement.reviewTodoNotePlaceholder')}
                                                          onFocus={() => { setNoteFocused(index) }}
                                                          onBlur={() => { setNoteFocused(current => current === index ? null : current) }}
                                                          onChange={(event) => { setNote(index, event.target.value) }}
                                                        />
                                                      </section>
                                                    </div>
                                                  </div>
                                                </td>
                                              </tr>
                                            )}
                                          </Fragment>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )
                            : (
                              <div className="markdown-body document-body" data-testid="requirement-report-body">
                                {renderMarkdown(activeReport.text)}
                              </div>
                            )}
                        </>
                      )}
                    </>
                  )}
              </section>
            </div>

            {plan !== undefined && (
              <section className="detail-section" data-testid="requirement-split-plan" hidden={workface !== 'tasks'}>
                <Separator className="detail-divider" />
                <h4>{t('requirement.splitPlanTitle')}</h4>
                <p className="detail-note">{t('requirement.splitPlanAt', { at: formatTimestamp(plan.at) })}</p>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('requirement.splitPlanTask')}</th>
                        <th scope="col">{t('requirement.splitPlanRole')}</th>
                        <th scope="col">{t('requirement.splitPlanReason')}</th>
                        <th scope="col">{t('requirement.splitPlanAction')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.entries.map((entry) => {
                        const task = props.projection.tasks.find(item => item.id === entry.task)
                        const outcome = assigns[entry.task]
                        const diskRole = task?.role
                        const done = diskRole !== undefined || ignored.has(entry.task) || outcome?.ok === true
                        return (
                          <tr key={entry.task} data-testid="requirement-split-plan-row" data-task-id={entry.task}>
                            <td><span className="mono">{entry.task}</span> {task?.title ?? ''}</td>
                            <td>{roleLabel(entry.role)}</td>
                            <td>{entry.reason ?? '—'}</td>
                            <td>
                              {diskRole !== undefined
                                ? (
                                  <Chip
                                    size="sm"
                                    variant="soft"
                                    color="success"
                                    className="tag"
                                    data-testid="requirement-split-plan-assigned"
                                    data-task-id={entry.task}
                                    data-role={diskRole}
                                  >
                                    {t('requirement.roleAssigned', { role: roleLabel(diskRole) })}
                                  </Chip>
                                )
                                : ignored.has(entry.task)
                                  ? <Chip size="sm" variant="soft" className="tag" data-testid="requirement-split-plan-status" data-ok="ignored">{t('requirement.roleIgnored')}</Chip>
                                  : outcome === undefined
                                    ? (
                                      <div className="row-actions">
                                        <Button
                                          variant="secondary"
                                          size="sm"
                                          data-testid="requirement-split-plan-confirm"
                                          data-task-id={entry.task}
                                          isDisabled={busy !== null}
                                          onPress={() => { void assign(entry) }}
                                        >
                                          {t('requirement.confirmRole')}
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          data-testid="requirement-split-plan-ignore"
                                          data-task-id={entry.task}
                                          isDisabled={busy !== null}
                                          onPress={() => { ignore(entry.task) }}
                                        >
                                          {t('requirement.ignoreRole')}
                                        </Button>
                                      </div>
                                    )
                                    : (
                                      <span
                                        className={outcome.ok ? 'detail-line' : 'problem'}
                                        data-testid="requirement-split-plan-status"
                                        data-ok={outcome.ok ? 'true' : 'false'}
                                      >
                                        {outcome.text}
                                      </span>
                                    )}
                              {diskRole === undefined && !done && outcome !== undefined && (
                                <div className="row-actions">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    data-testid="requirement-split-plan-retry"
                                    data-task-id={entry.task}
                                    isDisabled={busy !== null}
                                    onPress={() => { void assign(entry) }}
                                  >
                                    {t('requirement.confirmRole')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    data-testid="requirement-split-plan-ignore"
                                    data-task-id={entry.task}
                                    isDisabled={busy !== null}
                                    onPress={() => { ignore(entry.task) }}
                                  >
                                    {t('requirement.ignoreRole')}
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {planDone && (
                  <p className="detail-note" data-testid="requirement-split-plan-done">
                    <span>{t('requirement.splitPlanDone')}</span>
                    <Button variant="ghost" size="sm" data-testid="requirement-split-plan-tasks" onPress={props.onOpenTasks}>
                      {t('requirement.splitPlanGoTasks')}
                    </Button>
                  </p>
                )}
              </section>
            )}

            <section className="detail-section" data-testid="requirement-related" hidden={workface !== 'tasks'}>
              <Separator className="detail-divider" />
              <div className="detail-drawer-head">
                <h4>{t('requirement.workface.tasks')}</h4>
                {related.length > 0 && (
                  <Button variant="ghost" size="sm" data-testid="requirement-view-tasks" onPress={props.onOpenTasks}>
                    {t('requirement.opTasks')}
                  </Button>
                )}
              </div>
              {related.length === 0
                ? <p className="empty">{t('requirement.noSplit')}</p>
                : (
                  <ul className="plain-list compact">
                    {related.map(task => (
                      <li key={task.id}>
                        <Button variant="ghost" size="sm" data-testid="requirement-related-task" onPress={() => { props.onOpenTask(task.id) }}>
                          <span className="mono">{task.id}</span> {task.title}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
            </section>

            <div className="requirement-face" data-testid="requirement-face-prototype" hidden={workface !== 'prototype'}>
              {props.onGeneratePrototype !== undefined && (
                <PrototypePanel
                  row={row}
                  scopeSessionId={props.project.scopeSessionId}
                  running={props.runningOp === 'prototype'}
                  onGenerate={props.onGeneratePrototype}
                  onReload={props.onReload}
                  t={t}
                />
              )}
            </div>
          </div>
          {modify.open && (
            <aside className="modify-pane" data-testid="requirement-modify-pane">
              <h4>{t('requirement.modifyDrawerTitle')}</h4>
              <p className="detail-note">{t('requirement.modifyHint', { id: row.id })}</p>
              {modify.status === 'failed' && (
                <p className="problem" data-testid="requirement-modify-failed">
                  {t('requirement.modifyFailed', { detail: modify.error ?? '' })}
                </p>
              )}
              <textarea
                ref={noteRef}
                className="new-requirement-input"
                data-testid="requirement-modify-note"
                value={modify.text}
                placeholder={t('requirement.modifyPlaceholder')}
                rows={8}
                onChange={(event) => { props.onModifyTextChange?.(event.target.value) }}
              />
              <div className="action-row">
                <Button
                  variant="primary"
                  data-testid="requirement-modify-start"
                  isDisabled={modify.text.trim() === '' || modify.status === 'running'}
                  onPress={() => { props.onModifySubmit?.() }}
                >
                  <Sparkles size={14} />
                  {t('requirement.modifyStart')}
                </Button>
                <Button variant="secondary" data-testid="requirement-modify-cancel" onPress={() => { props.onModifyCancel?.() }}>
                  {t('requirement.modifyCancel')}
                </Button>
              </div>
              {modify.status === 'running' && (
                <p className="detail-note" data-testid="requirement-modify-generating">{t('requirement.modifyGenerating')}</p>
              )}
              {modify.status === 'ready' && props.patchProposal !== undefined && (
                <Button variant="secondary" data-testid="requirement-modify-view-diff" onPress={() => { props.onViewDiff?.() }}>
                  {t('requirement.modifyViewDiff')}
                </Button>
              )}
            </aside>
          )}
          {props.diffOpen === true && props.patchProposal !== undefined && (
            <div className="detail-diff-host" data-testid="requirement-inline-compare">
              <ProposalDiff
                proposal={props.patchProposal.proposal}
                change={props.patchProposal.change}
                requirements={props.projection.requirements}
                scopeSessionId={props.project.scopeSessionId}
                onClose={() => { props.onCloseDiff?.() }}
                onReload={props.onReload}
                onApplied={props.onApplied}
                closeLabel={t('compare.backToBody')}
                t={t}
              />
            </div>
          )}
        </div>
      </DetailDrawer>
      <div className="history-layer" data-testid="requirement-history-layer" hidden={!historyOpen}>
        <div className="history-scrim" data-testid="requirement-history-scrim" onClick={() => { setHistoryOpen(false) }} />
        <aside
          className="history-panel"
          data-testid="requirement-history-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={t('requirement.historyTitle')}
        >
          <div className="history-bar">
            <h3>{t('requirement.historyTitle')}</h3>
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              data-testid="requirement-history-close"
              aria-label={t('drawer.close')}
              onPress={() => { setHistoryOpen(false) }}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="history-scroll">
            {historyEntries.length === 0 && (
              <p className="empty" data-testid="requirement-history-empty">{t('requirement.historyEmpty')}</p>
            )}
            <section className="detail-section" data-testid="requirement-timeline">
              <h4>{t('requirement.timeline')}</h4>
              <ul className="timeline-chips history-list">
                <li data-testid="requirement-timeline-opened">
                  <Chip size="sm" variant="soft" className="tag">{t('requirement.timelineOpened')}</Chip>
                  <span className="time">{formatTimestamp(row.openedAt ?? '—')}</span>
                </li>
                {historyEntries.map(entry => entry.kind === 'version'
                  ? (
                    <li key={entry.key} className="history-entry" data-testid="requirement-timeline-version" data-version={entry.n}>
                      <span className="history-entry-head">
                        <Chip size="sm" variant="soft" className="tag">{t('requirement.timelineVersion', { n: entry.n })}</Chip>
                        <span className="time">{formatTimestamp(entry.at)}</span>
                      </span>
                      <span className="history-entry-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid="requirement-history-version-toggle"
                          data-version={entry.n}
                          aria-expanded={historyDoc === entry.key}
                          onPress={() => { setHistoryDoc(current => current === entry.key ? null : entry.key) }}
                        >
                          {historyDoc === entry.key ? t('requirement.historyVersionHide') : t('requirement.historyVersionShow')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid="requirement-open-version"
                          data-version={entry.n}
                          data-path={versionPath(row.id, entry.n)}
                          onPress={() => { props.onOpenReader(versionPath(row.id, entry.n)) }}
                        >
                          {t('requirement.openSnapshot')}
                        </Button>
                        {entry.n >= 2 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid="requirement-compare-version"
                            data-version={entry.n}
                            onPress={() => { setCompareVersion(entry.n) }}
                          >
                            {t('requirement.comparePreviousVersion')}
                          </Button>
                        )}
                      </span>
                      {historyDoc === entry.key && (
                        <div className="history-snapshot" data-testid="requirement-version-document" data-version={entry.n}>
                          <p className="detail-note requirement-doc-readonly">{t('requirement.versionDocReadonly')}</p>
                          {activeVersionDoc === undefined && (
                            <p className="empty" data-testid="requirement-version-document-loading">{t('requirement.versionDocLoading')}</p>
                          )}
                          {activeVersionDoc?.status === 'failed' && (
                            <p className="problem" data-testid="requirement-version-document-failed">
                              {t('requirement.versionDocFailed', { detail: activeVersionDoc.message })}
                            </p>
                          )}
                          {activeVersionDoc?.status === 'ready' && (
                            <div className="markdown-body document-body" data-testid="requirement-version-document-body">
                              {activeVersionDoc.text.trim() === ''
                                ? <p className="empty">{t('requirement.versionDocEmpty')}</p>
                                : renderMarkdown(activeVersionDoc.text)}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  )
                  : (
                    <li key={entry.key} className="history-entry" data-testid="requirement-timeline-review" data-round={entry.review.round} data-path={specPath(entry.review.report)}>
                      <div className="history-review" data-testid="requirement-review-history-item" data-round={entry.review.round}>
                        <span>
                          {t('requirement.timelineReview', { round: entry.review.round })}
                          <span data-testid="requirement-review-history-status" data-decision={decisionOf(entry.review)}>
                            {decisionChip(entry.review, 'requirement-timeline-review-status')}
                          </span>
                          <span className="time">{formatTimestamp(entry.review.at)}</span>
                        </span>
                        <span className="history-entry-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid="requirement-history-report-toggle"
                            data-round={entry.review.round}
                            aria-expanded={historyDoc === entry.key}
                            onPress={() => { setHistoryDoc(current => current === entry.key ? null : entry.key) }}
                          >
                            {historyDoc === entry.key ? t('requirement.historyReportHide') : t('requirement.historyReportShow')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid="requirement-open-report"
                            data-path={specPath(entry.review.report)}
                            onPress={() => { props.onOpenReader(specPath(entry.review.report)) }}
                          >
                            {t('requirement.openReport')}
                          </Button>
                          {decisionOf(entry.review) === 'pending' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              data-testid="requirement-review-history-reject"
                              data-round={entry.review.round}
                              isDisabled={locked}
                              ref={(node) => { if (node !== null) node.title = lockedHint ?? t('requirement.reviewRejectHistoryTitle') }}
                              onPress={() => { void execute(`reviewReject-${String(entry.review.round)}`, `/requirement_review_decide ${row.id} ${entry.review.round} rejected`) }}
                            >
                              {t('requirement.reviewRejectHistory')}
                            </Button>
                          )}
                        </span>
                      </div>
                      {historyDoc === entry.key && (
                        <div className="history-snapshot" data-testid="requirement-history-report" data-round={entry.review.round}>
                          <p className="detail-note requirement-doc-readonly" data-testid="requirement-history-report-readonly">{t('requirement.historyReportReadonly')}</p>
                          {activeHistoryReport === undefined && (
                            <p className="empty" data-testid="requirement-history-report-loading">{t('requirement.reportLoading')}</p>
                          )}
                          {activeHistoryReport?.status === 'failed' && (
                            <p className="problem" data-testid="requirement-history-report-failed">
                              {t('requirement.reportFailed', { detail: activeHistoryReport.message })}
                            </p>
                          )}
                          {activeHistoryReport?.status === 'ready' && (
                            <div className="markdown-body document-body" data-testid="requirement-history-report-body">
                              {renderMarkdown(activeHistoryReport.text)}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ),
                )}
                {row.reviews.length === 0 && (
                  <li className="empty" data-testid="requirement-timeline-review-empty">{t('requirement.noReviews')}</li>
                )}
                {row.versions.length === 0 && (
                  <li className="empty" data-testid="requirement-timeline-version-empty">{t('requirement.noVersions')}</li>
                )}
                <li data-testid="requirement-timeline-approved">
                  <Chip size="sm" variant="soft" className="tag">{t('requirement.timelineApproved')}</Chip>
                  <span className="time">{formatTimestamp(row.approvedAt ?? '—')}</span>
                  <span>{row.approvedVersion === undefined
                    ? t('requirement.notApproved')
                    : t('requirement.timelineApprovedVersion', { n: row.approvedVersion })}</span>
                </li>
              </ul>
            </section>
          </div>
        </aside>
      </div>
      {compareVersion !== null && (
        <div className="compare-layer" data-testid="requirement-version-compare" data-version={compareVersion}>
          <div className="compare-panel" role="dialog" aria-modal="true" aria-label={t('requirement.versionCompareTitle')}>
            <div className="compare-bar">
              <div>
                <h3>{t('requirement.versionCompareTitle')}</h3>
                <p className="compare-sub">{t('requirement.versionCompareRange', { from: compareVersion - 1, to: compareVersion })}</p>
              </div>
              <Button variant="secondary" data-testid="requirement-version-compare-close" onPress={() => { setCompareVersion(null) }}>
                {t('compare.close')}
              </Button>
            </div>
            <div className="compare-scroll">
              {versionDiff.status === 'loading' && (
                <p className="empty" data-testid="requirement-version-compare-loading">{t('compare.loading')}</p>
              )}
              {versionDiff.status === 'failed' && (
                <p className="problem" data-testid="requirement-version-compare-failed">
                  {t('requirement.versionCompareFailed', { detail: versionDiff.message })}
                </p>
              )}
              {versionDiff.status === 'ready' && (
                <div className="compare-columns">
                  <div className="compare-col" data-testid="requirement-version-compare-old">
                    <h5>{t('requirement.timelineVersion', { n: compareVersion - 1 })}</h5>
                    <div className="compare-text">
                      {compareColumn(versionDiff.lines, 'old').map((line, index) => (
                        <div key={index} className={line.kind === 'removed' ? 'compare-line removed' : 'compare-line'}>
                          {line.text === '' ? ' ' : line.text}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="compare-col" data-testid="requirement-version-compare-new">
                    <h5>{t('requirement.timelineVersion', { n: compareVersion })}</h5>
                    <div className="compare-text">
                      {compareColumn(versionDiff.lines, 'new').map((line, index) => (
                        <div key={index} className={line.kind === 'added' ? 'compare-line added' : 'compare-line'}>
                          {line.text === '' ? ' ' : line.text}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
