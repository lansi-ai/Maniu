/** 需求详情：单行头部 + 文档 Tab 栏 + 当前文档专属操作栏 + 正文阅读区；关联任务在阅读区之后，阶段 chips 只保留 DOM。 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Button, Chip, Separator } from '@heroui/react'
import { ChevronDown, ChevronRight, ChevronUp, FileCode2, History, Sparkles, Table2, X } from 'lucide-react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { ProposalRow, RequirementChangeRow, RequirementDocRow, RequirementReviewRow, RequirementSplitPlanEntryRow } from '../spec/rows.ts'
import type { SessionSummary } from '../store.ts'
import { requirementStateLabel } from '../spec/board.ts'
import { diffLines, type DiffLine } from '../spec/diff.ts'
import { deriveRevisionAnnotations } from '../spec/revision-annotations.ts'
import type { RevisionAnnotations, VersionFilter, VersionSnapshot } from '../spec/revision-annotations.ts'
import { readWorkspaceText, WORKSPACE_READ_LINES } from '../spec/files.ts'
import { runCommand, type CommandOutcome } from '../commands/run.ts'
import { canApproveRequirement, canModifyDraft, canReviewRequirement, type ModifyBlockReason } from './requirement-gate.ts'
import { MarkdownDocumentViewer } from '../markdown/document-viewer.tsx'
import { translate, type MessageKey, type Translate } from '../locale.ts'
import { formatTimestamp, isConfirmableReviewReport, parseReviewReport, type ReviewPriority, type ReviewTodo } from './requirement-report.ts'
import type { ReviewDecisions } from '../intake/prompts.ts'
import { DetailDrawer } from './detail-drawer.tsx'
import { ProposalDiff } from './proposal-compare.tsx'
import { AnnotatedDocumentBody, AnnotationToggle, RevisionAnnotationFilters } from './requirement-annotations.tsx'

const zhText: Translate = (key, params) => translate('zh', key, params)

/** 内联评审报告的单次行数上限；与阅读器一致。 */
const REPORT_LINES = WORKSPACE_READ_LINES

function formatHistoryTimestamp(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '—') return value
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const ms = Date.parse(trimmed)
    if (!Number.isNaN(ms)) {
      const date = new Date(ms)
      const pad = (n: number): string => String(n).padStart(2, '0')
      return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }
  }
  return formatTimestamp(value)
}

/** 处置日期只留月日；时间戳解析不了时原样返回。 */
function formatReviewDay(value: string): string {
  const formatted = formatTimestamp(value)
  return /^\d{4}-\d{2}-\d{2}/.test(formatted) ? formatted.slice(5, 10) : formatted
}

/** 详情页的操作口径按四态加未知态分流；未知态只留次级动作。 */
type DetailState = 'draft' | 'confirmed' | 'released' | 'closed' | 'unknown'

/** 一轮评审的人工处置；旧数据没有 decision 字段时按待处理看待。 */
type ReviewDecision = 'pending' | 'accepted' | 'rejected'

/** 起草态的三段交互：未评审、最新一轮待处置、最新一轮已处置。 */
type ReviewPhase = 'unreviewed' | ReviewDecision

/** 详情顶面的三块工作面；正文与评审共用文档加载逻辑，任务独立成屏。 */
type Workface = 'body' | 'review' | 'tasks'

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

/** 已处置结论的完整说法：采纳且已产出新版本时点出版本号。 */
function reviewDecisionText(t: Translate, review: RequirementReviewRow): string {
  if (decisionOf(review) === 'rejected') return t('requirement.reviewDecidedRejected')
  return review.appliedVersion === undefined
    ? t('requirement.reviewDecidedAccepted')
    : t('requirement.reviewDecidedAcceptedApplied', { version: review.appliedVersion })
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

/** 只读批注的版本快照读取状态；缓存命中时直接进入 ready。 */
type AnnotationsState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshots: readonly VersionSnapshot[] }
  | { readonly status: 'failed'; readonly message: string }

/** 当前文档标签承载的内容：草稿、历史版本快照或某一轮评审报告。 */
type ActiveDocKind = 'draft' | 'version' | 'report'

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
export type RunningOpKind = 'review' | 'revise' | 'patch' | 'split' | 'amend' | 'delta'

/** 在途操作对应的锁定提示文案。 */
const OP_LOCKED_KEY: Readonly<Record<RunningOpKind, MessageKey>> = {
  review: 'requirement.opLocked.review',
  revise: 'requirement.opLocked.revise',
  patch: 'requirement.opLocked.patch',
  split: 'requirement.opLocked.split',
  amend: 'requirement.opLocked.amend',
  delta: 'requirement.opLocked.delta',
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
  /** 从当前详情页打开统一「提变更 / 加功能」分流弹窗。 */
  readonly onChangeTriage?: (() => void) | undefined
  /** 统一分流弹窗打开期间不抢 Esc。 */
  readonly triageOpen?: boolean | undefined
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
  const amendCount = row.amendCount ?? row.amendments?.length ?? 0

  const latestReview = row.reviews.reduce<RequirementReviewRow | null>(
    (best, review) => best === null || review.round > best.round ? review : best,
    null,
  )
  const latestRound = latestReview?.round
  const phase: ReviewPhase = latestReview === null ? 'unreviewed' : decisionOf(latestReview)
  /** 最新一轮已处置时进入只读视图：结论一行、意见轻量列表、无逐条裁决。 */
  const isReadOnlyReview = latestReview !== null && decisionOf(latestReview) !== 'pending'
  /** 已采纳并落版时可供跳转的版本号；放弃或无版本时缺省。 */
  const appliedVersion = latestReview !== null && decisionOf(latestReview) === 'accepted'
    ? latestReview.appliedVersion
    : undefined

  /** 当前工作面：待处置评审优先落到评审处理，其余状态落在正文。 */
  const [workface, setWorkface] = useState<Workface>(phase === 'pending' ? 'review' : 'body')
  /** 有评审才显示评审处理面；终态、有任务或有拆分方案才显示关联任务面，草稿期隐藏。 */
  const reviewFaceVisible = row.reviews.length > 0
  const tasksFaceVisible = state === 'confirmed' || state === 'released' || state === 'closed'
    || related.length > 0 || row.splitPlan !== undefined
  const showWorkfaceTabs = reviewFaceVisible || tasksFaceVisible

  // 正文与评审面各自只展示一份当前文档；历史快照与历史报告移入历史抽屉。
  const activeDoc = workface === 'review' && latestRound !== undefined ? `r${String(latestRound)}` : 'draft'
  const activeDocKind = docKindOf(activeDoc)
  /** 评审面只承载最新一轮；历史轮次在抽屉里只读展开。 */
  const activeReview = workface === 'review' ? latestReview : null
  const reportPath = activeReview === null ? null : specPath(activeReview.report)
  const [report, setReport] = useState<ReportState>({ status: 'loading' })
  const [compareVersion, setCompareVersion] = useState<number | null>(null)
  const [versionDiff, setVersionDiff] = useState<VersionDiffState>({ status: 'idle' })

  // 只读修改批注：默认关闭，开启后才按需求编号并发读取版本快照，读到的结果按编号与版本数缓存。
  const latestVersion = row.versions.reduce((max, version) => Math.max(max, version.n), 0)
  const canAnnotate = latestVersion >= 2 || (row.amendments?.length ?? 0) > 0
  const annotationCacheKey = `${props.project.scopeSessionId}:${row.id}:${String(latestVersion)}`
  const snapshotCache = useRef<Map<string, readonly VersionSnapshot[]>>(new Map())
  const annotationLayoutRef = useRef<HTMLDivElement>(null)
  const [annotationsOpen, setAnnotationsOpen] = useState(false)
  const [annotations, setAnnotations] = useState<AnnotationsState>({ status: 'idle' })
  const [annotationFilter, setAnnotationFilter] = useState<VersionFilter>('all')
  /** 从结论行跳转时待校正的批注版本；批注数据就绪后决定筛选还是回退全部。 */
  const [pendingAnnotationVersion, setPendingAnnotationVersion] = useState<number | null>(null)
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null)
  const [expandedAnnotations, setExpandedAnnotations] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedSegments, setExpandedSegments] = useState<ReadonlySet<string>>(() => new Set())

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

  // 切换需求或版本数时收起批注并清空派生状态，避免沿用上一份需求的批注选中项。
  useEffect(() => {
    setAnnotationsOpen(false)
    setAnnotations({ status: 'idle' })
    setAnnotationFilter('all')
    setPendingAnnotationVersion(null)
    setSelectedAnnotation(null)
    setExpandedAnnotations(new Set())
    setExpandedSegments(new Set())
  }, [row.id, latestVersion])

  // 批注快照并发读取：缓存命中直接复用，失败带结构化原因；只读，不写回规格库。
  useEffect(() => {
    if (!annotationsOpen) return
    const cached = snapshotCache.current.get(annotationCacheKey)
    if (cached !== undefined) {
      setAnnotations({ status: 'ready', snapshots: cached })
      return
    }
    let disposed = false
    setAnnotations({ status: 'loading' })
    const ordered = [...row.versions].sort((left, right) => left.n - right.n)
    void Promise.all(ordered.map(version =>
      readWorkspaceText(props.project.scopeSessionId, versionPath(row.id, version.n), REPORT_LINES)))
      .then((answers) => {
        if (disposed) return
        const failed = answers.find(answer => !answer.ok)
        if (failed) {
          setAnnotations({ status: 'failed', message: `${failed.error.code}: ${failed.error.message}` })
          return
        }
        const snapshots: VersionSnapshot[] = ordered.map((version, index) => {
          const answer = answers[index]
          const text = answer !== undefined && answer.ok ? answer.text : ''
          return {
            version: version.n,
            at: version.at,
            ...(version.note === undefined ? {} : { note: version.note }),
            text,
          }
        })
        // 单版但有修补记录时，把当前正文当作一次修改，让批注仍可演示。
        const lastAmendment = row.amendments?.[row.amendments.length - 1]
        if (latestVersion <= 1 && lastAmendment !== undefined) {
          snapshots.push({ version: 2, at: lastAmendment.at, note: lastAmendment.summary, text: row.text })
        }
        snapshotCache.current.set(annotationCacheKey, snapshots)
        setAnnotations({ status: 'ready', snapshots })
      })
      .catch((cause: unknown) => {
        if (disposed) return
        setAnnotations({ status: 'failed', message: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => { disposed = true }
  }, [annotationsOpen, annotationCacheKey, row.id, row.text, latestVersion, props.project.scopeSessionId])

  const revisionData = useMemo<RevisionAnnotations | null>(() => {
    if (annotations.status !== 'ready') return null
    return deriveRevisionAnnotations(annotations.snapshots, row.text, row.amendments ?? [])
  }, [annotations, row.text, row.amendments])

  // 批注数据就绪后校正版本筛选：目标版本不在数据里时回到全部，避免筛出空列表。
  useEffect(() => {
    if (pendingAnnotationVersion === null) return
    if (annotations.status === 'idle' || annotations.status === 'loading') return
    const known = revisionData !== null && revisionData.versions.includes(pendingAnnotationVersion)
    setAnnotationFilter(known ? pendingAnnotationVersion : 'all')
    setPendingAnnotationVersion(null)
  }, [pendingAnnotationVersion, annotations.status, revisionData])

  /** 结论行的版本入口：回到正文、展开批注并按该版本筛选，数据就绪后再校正。 */
  const openVersionChanges = (version: number): void => {
    setWorkface('body')
    setAnnotationsOpen(true)
    setAnnotationFilter(version)
    setPendingAnnotationVersion(version)
  }

  // 卡与正文同处一行，选中后只对正文节点做行内轻量滚动兜底，不跨段跳转。
  const focusAnnotation = (id: string): void => {
    setSelectedAnnotation(id)
    const counterpart = annotationLayoutRef.current?.querySelector(
      `[data-annotation-id="${id}"][data-annotation-side="body"]`,
    )
    if (counterpart !== null && counterpart !== undefined && typeof counterpart.scrollIntoView === 'function') {
      counterpart.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }
  const toggleInSet = (current: ReadonlySet<string>, id: string): ReadonlySet<string> => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  // 说明栏自动聚焦；收起后不残留焦点。
  useEffect(() => {
    if (modify.open) noteRef.current?.focus()
  }, [modify.open])

  // Esc 分层退出：批量菜单 → 版本对照 → 差异 → 说明栏 → 详情；阅读层与分流弹窗打开时不抢 Esc。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || props.readerOpen === true || props.triageOpen === true) return
      event.stopPropagation()
      if (batchMenuOpen) setBatchMenuOpen(false)
      else if (annotationsOpen) setAnnotationsOpen(false)
      else if (historyOpen) setHistoryOpen(false)
      else if (compareVersion !== null) setCompareVersion(null)
      else if (props.diffOpen === true) props.onCloseDiff?.()
      else if (modify.open) props.onModifyCancel?.()
      else props.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [
    batchMenuOpen,
    annotationsOpen,
    historyOpen,
    compareVersion,
    props.diffOpen,
    props.onClose,
    props.onCloseDiff,
    props.onModifyCancel,
    props.readerOpen,
    props.triageOpen,
    modify.open,
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
  /** 待处置评审且当前不在评审工作面时，正文顶部显示黄条提示。 */
  const bannerVisible = state === 'draft' && phase === 'pending' && reviewPendingReason !== undefined
  const proposalVisible = state === 'draft' && pendingPatchProposal

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
  const reportCanConfirm = activeReport?.status === 'ready' && !hasTodos && isConfirmableReviewReport(activeReport.text)
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
  /** 意见少或优先级只有一种时筛选没有区分度，整体收起并让筛选保持「全部」。 */
  const priorityKinds = new Set(todos.map(todo => todo.priority ?? 'none')).size
  const showPriorityFilter = todos.length > 5 && priorityKinds > 1
  const visibleTodos = todos
    .map((todo, index) => ({ todo, index }))
    .filter(({ todo }) => !showPriorityFilter || priorityFilter === 'all' || todo.priority === priorityFilter)

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
              variant="ghost"
              size="sm"
              className="requirement-history-trigger"
              data-testid="requirement-history-trigger"
              aria-label={historyTriggerLabel}
              aria-expanded={historyOpen}
              ref={(node) => { if (node !== null) node.title = historyTriggerLabel }}
              onPress={() => { setHistoryOpen(true) }}
            >
              <History size={16} aria-hidden="true" />
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
              <Chip
                size="sm"
                variant="soft"
                className="tag requirement-version-badge"
                data-testid="requirement-version-badge"
              >
                {`v${String(historyVersionLabel)}`}
              </Chip>
              {amendCount > 0 && (
                <Chip
                  size="sm"
                  variant="soft"
                  color={amendCount >= 5 ? 'warning' : 'default'}
                  className="tag"
                  data-testid="requirement-amend-count"
                  ref={(node) => { if (node !== null) node.title = amendCount >= 5 ? t('requirement.amendCountCheckTitle') : t('requirement.amendCountTitle') }}
                >
                  {t('requirement.amendCountChip', { count: amendCount })}
                </Chip>
              )}
              <div className="action-row requirement-global-ops" data-testid="requirement-global-actions">
                {state === 'draft' && (() => {
                  const reviewButton = (
                    <Button
                      key="review"
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
                  )
                  const reviseButton = (
                    <Button
                      key="revise"
                      variant="secondary"
                      size="sm"
                      data-testid="requirement-detail-revise"
                      isDisabled={locked || !modifyGate.ok}
                      ref={(node) => { if (node !== null) node.title = lockedHint ?? modifyBlockReason ?? t('requirement.opReviseTitle') }}
                      onPress={() => { if (!locked && modifyGate.ok) props.onModifyRequest() }}
                    >
                      {t('requirement.opRevise')}
                    </Button>
                  )
                  const approveButton = (
                    <Button
                      key="approve"
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
                  )
                  return canApprove && phase !== 'pending'
                    ? [approveButton, reviewButton, reviseButton]
                    : [reviewButton, reviseButton, approveButton]
                })()}
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
                {(state === 'confirmed' || state === 'released') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="requirement-detail-change-triage"
                    isDisabled={locked}
                    onPress={() => { props.onChangeTriage?.() }}
                  >
                    <Sparkles size={14} aria-hidden="true" />
                    {t('triage.openButton')}
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
              </div>
            </div>
            {lockedHint !== undefined && (
              <p className="detail-note" data-testid="requirement-op-locked-hint">{lockedHint}</p>
            )}
            {proposalVisible && (
              <p className="detail-warning" data-testid="requirement-review-proposal-hint">{t('requirement.reviewPendingProposal')}</p>
            )}
            {result !== null && !result.ok && (
              <p className="problem" data-testid="requirement-action-result" data-ok="false">
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
            <div
              className="requirement-workfaces"
              data-testid="requirement-doc-tabs"
              role="tablist"
              aria-label={t('requirement.workfaceTabsLabel')}
              hidden={!showWorkfaceTabs}
            >
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
            {/* 第三层：当前选中评审报告的专属决策栏，紧贴标签栏下方。 */}
            <div
              className="action-row requirement-ops requirement-doc-actions"
              data-testid="requirement-actions"
              data-active-doc={activeDoc}
              data-active-doc-kind={activeDocKind}
              hidden={activeDocKind !== 'report' || activeReview === null ? true : undefined}
              role="toolbar"
              aria-label={t('requirement.actionsLabel')}
            >
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
                          {reportCanConfirm
                            ? (
                              <Button
                                variant="primary"
                                size="sm"
                                data-testid="requirement-review-pass"
                                isDisabled={locked}
                                ref={(node) => { if (node !== null) node.title = lockedHint ?? t('requirement.reviewPassTitle') }}
                                onPress={() => { void execute('reviewPass', `/requirement_review_decide ${row.id} ${String(activeReview.round)} accepted`) }}
                              >
                                {t('requirement.reviewPassAction')}
                              </Button>
                            )
                            : (
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
                            )}
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
                      <div className="requirement-review-decided-bar" data-testid="requirement-review-decided-bar">
                        <span className="review-decided-line" data-testid="requirement-review-decided" data-decision={decisionOf(activeReview)}>
                          <span className="review-decided-dot" data-decision={decisionOf(activeReview)} aria-hidden="true" />
                          {t('requirement.reviewDecidedLine', {
                            round: activeReview.round,
                            decision: reviewDecisionText(t, activeReview),
                            date: formatReviewDay(activeReview.decidedAt ?? activeReview.at),
                          })}
                        </span>
                        {decisionOf(activeReview) === 'accepted' && appliedVersion !== undefined && canAnnotate && (
                          <button
                            type="button"
                            className="link-button review-decided-action"
                            data-testid="requirement-review-open-changes"
                            onClick={() => { openVersionChanges(appliedVersion) }}
                          >
                            {t('requirement.reviewOpenChanges', { version: appliedVersion })}
                          </button>
                        )}
                        {hasTodos && (
                          <button
                            type="button"
                            className="link-button review-decided-action"
                            data-testid="requirement-report-markdown-toggle"
                            aria-label={t(showRawMarkdown ? 'requirement.reviewMarkdownHide' : 'requirement.reviewMarkdownShow')}
                            aria-pressed={showRawMarkdown}
                            title={t(showRawMarkdown ? 'requirement.reviewMarkdownHide' : 'requirement.reviewMarkdownShow')}
                            onClick={() => { setShowRawMarkdown(current => !current) }}
                          >
                            {t(showRawMarkdown ? 'requirement.reviewMarkdownHideText' : 'requirement.reviewMarkdownShowText')}
                          </button>
                        )}
                      </div>
                    )}
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
                {bannerVisible && workface !== 'review' && (
                  <div className="detail-warning requirement-review-pending-banner" data-testid="requirement-review-pending-reason">
                    <span>{reviewPendingReason}</span>
                    <button
                      type="button"
                      className="link-button requirement-goto-review"
                      data-testid="requirement-goto-review"
                      onClick={() => { setWorkface('review') }}
                    >
                      {t('requirement.gotoReview')}
                    </button>
                  </div>
                )}
                <div
                  className="requirement-document-layout"
                  ref={annotationLayoutRef}
                >
                  <div className="requirement-document-main">
                    {annotationsOpen && (
                      <div className="requirement-annotation-track" data-testid="requirement-annotation-track">
                        {annotations.status === 'loading' && (
                          <p className="empty" data-testid="requirement-annotation-loading">{t('requirement.annotations.loading')}</p>
                        )}
                        {annotations.status === 'failed' && (
                          <p className="problem" data-testid="requirement-annotation-failed">
                            {t('requirement.annotations.failed', { detail: annotations.message })}
                          </p>
                        )}
                        {revisionData !== null && (
                          <RevisionAnnotationFilters
                            data={revisionData}
                            filter={annotationFilter}
                            t={t}
                            onFilter={setAnnotationFilter}
                          />
                        )}
                      </div>
                    )}
                    <MarkdownDocumentViewer
                      text={row.text}
                      title={row.title ?? row.id}
                      subtitle={row.id}
                      emptyText={t('requirement.bodyEmpty')}
                      t={t}
                      className={annotationsOpen ? 'with-annotations' : undefined}
                      bodyTestId="requirement-document-body"
                      controlsTestIdPrefix="requirement-doc"
                      toolbarExtra={canAnnotate
                        ? (
                          <AnnotationToggle
                            open={annotationsOpen}
                            count={revisionData?.changeCount ?? (latestVersion > 1 ? latestVersion - 1 : (row.amendments?.length ?? 0))}
                            t={t}
                            onToggle={() => { setAnnotationsOpen(current => !current) }}
                          />
                        )
                        : undefined}
                      bodyOverride={annotationsOpen && revisionData !== null
                        ? (
                          <AnnotatedDocumentBody
                            data={revisionData}
                            filter={annotationFilter}
                            selectedId={selectedAnnotation}
                            expanded={expandedAnnotations}
                            segmentExpanded={expandedSegments}
                            t={t}
                            onSelect={focusAnnotation}
                            onToggleExpand={(id) => { setExpandedAnnotations(current => toggleInSet(current, id)) }}
                            onToggleSegments={(id) => { setExpandedSegments(current => toggleInSet(current, id)) }}
                          />
                        )
                        : undefined}
                    />
                  </div>
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
                      {activeReport?.status === 'ready' && (() => {
                        return (
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
                                  {(showPriorityFilter || !isReadOnlyReview) && (
                                    <div className="review-todo-toolbar" data-testid="requirement-review-toolbar">
                                      {showPriorityFilter && (
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
                                      )}
                                      {!isReadOnlyReview && (
                                        <div className="review-toolbar-right">
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
                                          <Button
                                            isIconOnly
                                            variant="secondary"
                                            size="sm"
                                            className="review-markdown-toggle"
                                            data-testid="requirement-report-markdown-toggle"
                                            aria-label={t('requirement.reviewMarkdownShow')}
                                            ref={(node) => { if (node !== null) node.title = t('requirement.reviewMarkdownShow') }}
                                            onPress={() => { setShowRawMarkdown(true) }}
                                          >
                                            <FileCode2 size={14} aria-hidden="true" />
                                          </Button>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  <div className="table-wrap review-todo-wrap" data-testid="requirement-review-todos">
                                    <table
                                      className={`data-table review-todo-table${isReadOnlyReview ? ' is-readonly' : ''}`}
                                      data-has-category={hasAnyCategory ? 'true' : 'false'}
                                      data-readonly={isReadOnlyReview ? 'true' : 'false'}
                                    >
                                      {!isReadOnlyReview && (
                                        <thead>
                                          <tr>
                                            <th scope="col">{t(hasAnyCategory ? 'requirement.reviewColLevel' : 'requirement.reviewColLevelOnly')}</th>
                                            <th scope="col">{t('requirement.reviewColIssue')}</th>
                                            <th scope="col">{t('requirement.reviewColVerdict')}</th>
                                          </tr>
                                        </thead>
                                      )}
                                      <tbody>
                                        {visibleTodos.map(({ todo, index }) => {
                                          const verdict = verdictOf(index)
                                          const expanded = reviewUi.expanded === index
                                          const note = (reviewUi.notes[index] ?? '').trim()
                                          return (
                                            <Fragment key={index}>
                                              <tr
                                                className={`review-todo-row${expanded ? ' is-expanded' : ''}`}
                                                data-testid="requirement-review-todo-row"
                                                data-index={index}
                                                data-verdict={verdict}
                                                onClick={() => { toggleExpanded(index) }}
                                              >
                                                <td className="review-todo-level">
                                                  {isReadOnlyReview
                                                    ? (
                                                      <Chip
                                                        size="sm"
                                                        variant="soft"
                                                        color={PRIORITY_COLOR[todo.priority ?? 'none']}
                                                        className="review-todo-priority"
                                                        data-priority={todo.priority ?? 'none'}
                                                      >
                                                        {todo.category !== undefined && todo.category !== ''
                                                          ? todo.category
                                                          : t(priorityLabelKey(todo.priority))}
                                                      </Chip>
                                                    )
                                                    : (
                                                      <>
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
                                                      </>
                                                    )}
                                                </td>
                                                <td className="review-todo-title">
                                                  <span className="review-todo-title-inner">
                                                    {!isReadOnlyReview && (
                                                      <span className="review-todo-arrow" aria-hidden="true">
                                                        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                                      </span>
                                                    )}
                                                    <strong>{todo.title}</strong>
                                                    {isReadOnlyReview && (
                                                      <span className="review-todo-arrow" aria-hidden="true">
                                                        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                                      </span>
                                                    )}
                                                  </span>
                                                </td>
                                                {!isReadOnlyReview && (
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
                                                )}
                                              </tr>
                                              {expanded && (
                                                <tr className="todo-detail-row" data-testid="requirement-review-todo-detail" data-index={index}>
                                                  <td colSpan={isReadOnlyReview ? 2 : 3}>
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
                                                        {isReadOnlyReview
                                                          ? note !== '' && (
                                                            <section className="todo-detail-block todo-detail-note">
                                                              <h6>{t('requirement.reviewTodoNote')}</h6>
                                                              <p data-testid="requirement-review-todo-note" data-index={index}>{note}</p>
                                                            </section>
                                                          )
                                                          : (
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
                                                                onBlur={() => { setNoteFocused(id => (id === index ? null : id)) }}
                                                                onChange={(event) => { setNote(index, event.target.value) }}
                                                              />
                                                            </section>
                                                          )}
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
                                <MarkdownDocumentViewer
                                  text={activeReport.text}
                                  t={t}
                                  bodyTestId="requirement-report-body"
                                  controlsTestIdPrefix="requirement-report-doc"
                                  compact
                                  toolbarExtra={hasTodos && !isReadOnlyReview
                                    ? (
                                      <Button
                                        isIconOnly
                                        variant="secondary"
                                        size="sm"
                                        className="review-markdown-toggle"
                                        data-testid="requirement-report-markdown-toggle"
                                        aria-label={t('requirement.reviewMarkdownHide')}
                                        ref={(node) => { if (node !== null) node.title = t('requirement.reviewMarkdownHide') }}
                                        onPress={() => { setShowRawMarkdown(false) }}
                                      >
                                        <Table2 size={14} aria-hidden="true" />
                                      </Button>
                                    )
                                    : undefined}
                                />
                              )}
                          </>
                        )
                      })()}
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
      <div className="requirement-history-layer" data-testid="requirement-history-layer" hidden={!historyOpen}>
        <div className="requirement-history-scrim" data-testid="requirement-history-scrim" onClick={() => { setHistoryOpen(false) }} />
        <aside
          className="requirement-history-panel"
          data-testid="requirement-history-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={t('requirement.historyTitle')}
        >
          <div className="requirement-history-bar">
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
          <div className="requirement-history-scroll">
            {historyEntries.length === 0 && (
              <p className="empty" data-testid="requirement-history-empty">{t('requirement.historyEmpty')}</p>
            )}
            <section className="detail-section" data-testid="requirement-timeline">
              <h4>{t('requirement.timeline')}</h4>
              <div className="requirement-history-approved" data-testid="requirement-timeline-approved">
                <Chip size="sm" variant="soft" className="tag">{t('requirement.timelineApproved')}</Chip>
                <span className="requirement-history-approved-text">
                  {row.approvedVersion === undefined
                    ? t('requirement.notApproved')
                    : t('requirement.timelineApprovedVersion', { n: row.approvedVersion })}
                </span>
                <span className="time">{formatHistoryTimestamp(row.approvedAt ?? '—')}</span>
              </div>
              {(() => {
                const hasV1 = row.versions.some(item => item.n === 1)
                const latestVersion = row.versions.reduce((best, item) => Math.max(best, item.n), 0)
                return (
                  <ul className="timeline-chips history-list">
                    {!hasV1 && (
                      <li className="requirement-history-entry" data-testid="requirement-timeline-opened">
                        <div className="requirement-history-entry-head">
                          <span className="requirement-history-entry-title">
                            <Chip size="sm" variant="soft" className="tag">{t('requirement.timelineOpened')}</Chip>
                          </span>
                          <span className="time">{formatHistoryTimestamp(row.openedAt ?? '—')}</span>
                        </div>
                      </li>
                    )}
                    {historyEntries.map((entry) => {
                      if (entry.kind === 'version') {
                        const isLatest = entry.n === latestVersion && latestVersion > 0
                        const isInitial = entry.n === 1
                        return (
                          <li
                            key={entry.key}
                            className={`requirement-history-entry${isLatest ? ' is-latest' : ''}`}
                            data-testid="requirement-timeline-version"
                            data-version={entry.n}
                            data-latest={isLatest ? 'true' : undefined}
                          >
                            <div className="requirement-history-entry-head">
                              <span className="requirement-history-entry-title">
                                <Chip size="sm" variant="soft" className="tag">{t('requirement.timelineVersion', { n: entry.n })}</Chip>
                                {isLatest && (
                                  <span className="requirement-history-badge is-latest">{t('requirement.timelineLatest')}</span>
                                )}
                                {isInitial && (
                                  <span className="requirement-history-badge">{t('requirement.timelineInitial')}</span>
                                )}
                              </span>
                              <span className="time">{formatHistoryTimestamp(entry.at)}</span>
                            </div>
                            <span className="requirement-history-actions">
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
                          </li>
                        )
                      }
                      const decision = decisionOf(entry.review)
                      return (
                        <li
                          key={entry.key}
                          className={`requirement-history-entry is-review is-review-${decision}`}
                          data-testid="requirement-timeline-review"
                          data-round={entry.review.round}
                          data-path={specPath(entry.review.report)}
                        >
                          <div className="requirement-history-review" data-testid="requirement-review-history-item" data-round={entry.review.round}>
                            <div className="requirement-history-entry-head">
                              <span className="requirement-history-entry-title">
                                <span className="requirement-history-review-label">{t('requirement.timelineReview', { round: entry.review.round })}</span>
                                <span data-testid="requirement-review-history-status" data-decision={decision}>
                                  {decisionChip(entry.review, 'requirement-timeline-review-status')}
                                </span>
                              </span>
                              <span className="time">{formatHistoryTimestamp(entry.review.at)}</span>
                            </div>
                            <span className="requirement-history-actions">
                              <Button
                                variant="ghost"
                                size="sm"
                                data-testid="requirement-open-report"
                                data-path={specPath(entry.review.report)}
                                onPress={() => { props.onOpenReader(specPath(entry.review.report)) }}
                              >
                                {t('requirement.openReport')}
                              </Button>
                              {decision === 'pending' && (
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
                        </li>
                      )
                    })}
                    {row.reviews.length === 0 && (
                      <li className="empty" data-testid="requirement-timeline-review-empty">{t('requirement.noReviews')}</li>
                    )}
                    {row.versions.length === 0 && (
                      <li className="empty" data-testid="requirement-timeline-version-empty">{t('requirement.noVersions')}</li>
                    )}
                  </ul>
                )
              })()}
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
