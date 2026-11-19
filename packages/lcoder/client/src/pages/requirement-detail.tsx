/** 需求详情：状态先行的头部三区（标题/指引/操作）、阶段 chips、结构化评审报告与待改项摘要、关联任务。 */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Button, Chip, Separator } from '@heroui/react'
import { FileText, RotateCw } from 'lucide-react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { RequirementDocRow, RequirementReviewRow, RequirementSplitPlanEntryRow } from '../spec/rows.ts'
import type { SessionSummary } from '../store.ts'
import { requirementStateLabel } from '../spec/board.ts'
import { readWorkspaceText } from '../spec/files.ts'
import { runCommand, type CommandOutcome } from '../commands/run.ts'
import { missingReviewRoles } from '../flow/config.ts'
import { renderMarkdown } from '../markdown/markdown.tsx'
import { translate, type MessageKey, type Translate } from '../locale.ts'
import { formatTimestamp, parseReviewReport, type ReviewPriority } from './requirement-report.ts'
import { DetailDrawer } from './detail-drawer.tsx'

const zhText: Translate = (key, params) => translate('zh', key, params)

/** 内联评审报告的单次行数上限；与阅读器一致。 */
const REPORT_LINES = 5000

/** 评审报告结论摘录的字数上限。 */
const EXCERPT_CHARS = 120

/** 详情页的操作口径按四态加未知态分流；未知态只留次级动作。 */
type DetailState = 'draft' | 'confirmed' | 'released' | 'closed' | 'unknown'

/** 一轮评审的人工处置；旧数据没有 decision 字段时按待处理看待。 */
type ReviewDecision = 'pending' | 'accepted' | 'rejected'

/** 起草态的三段交互：未评审、最新一轮待处置、最新一轮已处置。 */
type ReviewPhase = 'unreviewed' | ReviewDecision

function decisionOf(review: RequirementReviewRow): ReviewDecision {
  return review.decision === 'accepted' || review.decision === 'rejected' ? review.decision : 'pending'
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

const PRIORITY_KEY: Readonly<Record<ReviewPriority, MessageKey>> = {
  high: 'requirement.priority.high',
  medium: 'requirement.priority.medium',
  low: 'requirement.priority.low',
}

/** 状态徽标的语义色；state-* 类名保留给现有选择器。 */
const STATE_CHIP_COLOR: Readonly<Record<DetailState, 'accent' | 'success' | 'warning' | 'default'>> = {
  draft: 'accent',
  confirmed: 'success',
  released: 'warning',
  closed: 'default',
  unknown: 'default',
}

/** 评审待改项优先级的语义色。 */
const PRIORITY_CHIP_COLOR: Readonly<Record<ReviewPriority, 'danger' | 'warning' | 'default'>> = {
  high: 'danger',
  medium: 'warning',
  low: 'default',
}

/** 内联评审报告的读取状态。 */
type ReportState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly text: string }
  | { readonly status: 'failed'; readonly message: string }

/** 评审报告与版本快照在阅读器里的仓库相对路径。 */
function specPath(relative: string): string {
  return `.spec/${relative.replace(/^\.?[\\/]/, '').replace(/^\.spec[\\/]/, '')}`
}

/** 评审报告结论摘录：首 120 字，超出补省略号。 */
function excerptOf(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > EXCERPT_CHARS ? `${trimmed.slice(0, EXCERPT_CHARS)}…` : trimmed
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
  /** 发送改稿提案指令；起草态的「修改需求」走它。 */
  readonly onRevise: () => Promise<{ readonly ok: boolean; readonly message: string }>
  /** 基于此版本新建需求提案；确认态与终态的改动通道，后台发起不跳转。 */
  readonly onCreateBased: () => Promise<{ readonly ok: boolean; readonly message: string }>
  /** 跳到任务页并只显示本需求关联的任务。 */
  readonly onOpenTasks: () => void
  /** 取词函数；缺省为中文词典。 */
  readonly t?: Translate
}

/**
 * 画出需求详情。
 *
 * 头部三区置顶：需求标题加状态徽标与编号、状态驱动的指引句、随状态变化的操作栏；
 * 确认态与终态不渲染确认按钮。上线/关闭按状态枚举渲染，前置条件由 kernel 人机命令
 * 自身校验，失败回执直接展示。评审报告默认折叠成摘要，待改项先显示精简摘要，逐条展开后才渲染完整建议。
 * @param props - 需求、项目、投影与会话列表。
 * @returns 详情面板。
 */
export function RequirementDetail(props: RequirementDetailProps): JSX.Element {
  const t = props.t ?? zhText
  const row = props.row
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<CommandOutcome | null>(null)
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set())
  const [assigns, setAssigns] = useState<Readonly<Record<string, CommandOutcome>>>({})
  const [expandedTodos, setExpandedTodos] = useState<ReadonlySet<number>>(() => new Set())
  const [reportExpanded, setReportExpanded] = useState(false)
  const related = props.projection.tasks.filter(task => task.requirement === row.id || task.proposal === row.id)

  const state: DetailState = row.state === 'draft' || row.state === 'confirmed' || row.state === 'released' || row.state === 'closed'
    ? row.state
    : 'unknown'

  const latestReview = row.reviews.reduce<RequirementReviewRow | null>(
    (best, review) => best === null || review.round > best.round ? review : best,
    null,
  )
  const historyReviews = latestReview === null
    ? []
    : row.reviews.filter(review => review.round !== latestReview.round).sort((left, right) => right.round - left.round)
  const reportPath = latestReview === null ? null : specPath(latestReview.report)
  const [report, setReport] = useState<ReportState>({ status: 'loading' })

  // 内联报告与阅读器走同一条宿主文件通道；轮次或项目变化时重读，卸载后不再落状态。
  useEffect(() => {
    if (reportPath === null) return
    let disposed = false
    setReport({ status: 'loading' })
    void readWorkspaceText(props.project.scopeSessionId, reportPath, REPORT_LINES)
      .then((answer) => {
        if (disposed) return
        setReport(answer.ok
          ? { status: 'ready', text: answer.text }
          : { status: 'failed', message: `${answer.error.code}: ${answer.error.message}` })
      })
      .catch((cause: unknown) => {
        if (disposed) return
        setReport({ status: 'failed', message: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => { disposed = true }
  }, [reportPath, props.project.scopeSessionId])

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

  /** 后台发起一类操作：结果落回执条，忙碌期间不叠加第二次发起。 */
  const startOp = async (kind: string, run: () => Promise<{ readonly ok: boolean; readonly message: string }>): Promise<void> => {
    if (busy !== null) return
    setBusy(kind)
    setResult(null)
    try {
      const answer = await run()
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
  const planDone = plan !== undefined && plan.entries.every(
    entry => ignored.has(entry.task) || assigns[entry.task]?.ok === true,
  )
  const roleLabel = (id: string): string => {
    const name = props.projection.roles.find(role => role.id === id)?.name
    return name === undefined ? id : `${name}（${id}）`
  }

  const reviewed = row.reviews.length > 0
  const phase: ReviewPhase = latestReview === null ? 'unreviewed' : decisionOf(latestReview)
  const acceptedVersion = latestReview === null || decisionOf(latestReview) !== 'accepted'
    ? undefined
    : latestReview.appliedVersion ?? row.versions.reduce<number | undefined>(
      (best, version) => version.n > latestReview.round && (best === undefined || version.n > best) ? version.n : best,
      undefined,
    )
  const pendingReviseProposal = props.projection.proposals.some(proposal =>
    proposal.decision === 'draft'
    && proposal.requirementChange?.mode === 'revise'
    && proposal.requirementChange.target === row.id)
  const reviewPendingReason = latestReview === null
    ? undefined
    : t('requirement.reviewPendingReason', { round: latestReview.round })
  const reviewLabel = phase === 'unreviewed'
    ? t('requirement.opReviewStart')
    : phase === 'pending'
      ? t('requirement.opReview')
      : t('requirement.opReviewAgain')
  const missingRoles = missingReviewRoles(props.projection.flow, props.projection.roles, row.reviews)
  const approveReady = reviewed && missingRoles.length === 0
  const canApprove = state === 'draft' && approveReady
  const approveReason = !reviewed
    ? t('requirement.approveNeedsReview')
    : missingRoles.length > 0
      ? t('requirement.approveNeedsFlow', { roles: missingRoles.map(roleLabel).join('、') })
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
  const phaseHint = state !== 'draft'
    ? undefined
    : phase === 'unreviewed'
      ? t('requirement.phaseHint.start')
      : phase === 'pending'
        ? t('requirement.phaseHint.pending')
        : t('requirement.phaseHint.reviewAgain')

  /** 评审结论徽标：报告卡、阶段 chips 与历史轮次共用同一口径。 */
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

  const parsedReport = report.status === 'ready' ? parseReviewReport(report.text) : undefined
  const priorityCounts = (parsedReport?.todos ?? []).reduce<Record<ReviewPriority, number>>(
    (counts, todo) => {
      if (todo.priority !== undefined) counts[todo.priority] += 1
      return counts
    },
    { high: 0, medium: 0, low: 0 },
  )
  const toggleTodo = (index: number): void => {
    setExpandedTodos((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <DetailDrawer
      testId="requirement-detail"
      closeTestId="requirement-detail-close"
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
            isIconOnly
            className="detail-drawer-icon"
            variant="ghost"
            size="sm"
            data-testid="requirement-open-reader"
            aria-label={t('requirement.opOpenBody')}
            ref={(node) => { if (node !== null) node.title = t('requirement.opOpenBody') }}
            onPress={() => { props.onOpenReader(`.spec/requirements/${row.id}.md`) }}
          >
            <FileText aria-hidden="true" />
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
          </div>
          <span className="mono requirement-id" data-testid="requirement-detail-id">{row.id}</span>
          <p className="requirement-guide" data-testid="requirement-guide">{guide}</p>
          <div className="action-row requirement-ops" data-testid="requirement-actions">
            {state === 'draft' && (
              <>
                <Button
                  variant={phase === 'unreviewed' ? 'primary' : 'secondary'}
                  size="sm"
                  data-testid="requirement-detail-review"
                  data-variant={phase === 'unreviewed' ? 'primary' : 'secondary'}
                  data-phase={phase}
                  isDisabled={phase === 'pending' || busy !== null}
                  ref={(node) => {
                    if (node === null) return
                    node.title = reviewPendingReason ?? t(phase === 'unreviewed' ? 'requirement.opReviewTitleStart' : 'requirement.opReviewTitleAgain')
                  }}
                  onPress={() => { void startOp('review', props.onReview) }}
                >
                  {reviewLabel}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="requirement-detail-revise"
                  isDisabled={busy !== null}
                  ref={(node) => { if (node !== null) node.title = t('requirement.opReviseTitle') }}
                  onPress={() => { void startOp('revise', props.onRevise) }}
                >
                  {t('requirement.opRevise')}
                </Button>
                <Button
                  variant={phase === 'pending' || !canApprove ? 'secondary' : 'primary'}
                  size="sm"
                  data-testid="requirement-approve"
                  data-variant={phase === 'pending' || !canApprove ? 'secondary' : 'primary'}
                  isDisabled={!canApprove || busy !== null}
                  ref={(node) => { if (node !== null) node.title = approveReason ?? '' }}
                  onPress={() => { void execute('approve', `/requirement_approve ${row.id}`) }}
                >
                  {t('requirement.opApprove')}
                </Button>
              </>
            )}
            {state === 'confirmed' && related.length === 0 && (
              <Button
                variant="primary"
                size="sm"
                data-testid="requirement-split"
                isDisabled={busy !== null}
                onPress={() => { void startOp('split', props.onSplit) }}
              >
                {t('requirement.opSplit')}
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
                isDisabled={busy !== null}
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
                isDisabled={busy !== null}
                ref={(node) => { if (node !== null) node.title = t('requirement.opCloseTitle') }}
                onPress={() => { void execute('close', `/requirement_close ${row.id}`) }}
              >
                {t('requirement.opClose')}
              </Button>
            )}
          </div>
          {state === 'draft' && approveReason !== undefined && (
            <p className="detail-note" data-testid="requirement-approve-hint">{approveReason}</p>
          )}
          {state === 'draft' && phase === 'pending' && reviewPendingReason !== undefined && (
            <p className="detail-warning" data-testid="requirement-review-pending-reason">{reviewPendingReason}</p>
          )}
          {state === 'draft' && phase === 'pending' && pendingReviseProposal && (
            <p className="detail-warning" data-testid="requirement-review-proposal-hint">{t('requirement.reviewPendingProposal')}</p>
          )}
          {result !== null && (
            <p className={result.ok ? 'detail-line' : 'problem'} data-testid="requirement-action-result" data-ok={result.ok ? 'true' : 'false'}>
              {result.text}
            </p>
          )}
          {phaseHint !== undefined && (
            <p className="detail-note" data-testid="requirement-phase-hint">{phaseHint}</p>
          )}
        </div>
      )}
    >
      <section className="detail-section" data-testid="requirement-timeline">
        <h4>{t('requirement.timeline')}</h4>
        <ul className="timeline-chips">
          <li data-testid="requirement-timeline-opened">
            <Chip size="sm" variant="soft" className="tag">{t('requirement.timelineOpened')}</Chip>
            <span className="time">{formatTimestamp(row.openedAt ?? '—')}</span>
          </li>
          {row.reviews.map(review => (
            <li
              key={`review-${String(review.round)}`}
              className="chip-link"
              data-testid="requirement-timeline-review"
              data-round={review.round}
              data-path={specPath(review.report)}
              role="button"
              tabIndex={0}
              aria-label={t('requirement.timelineReview', { round: review.round })}
              onClick={() => { props.onOpenReader(specPath(review.report)) }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                props.onOpenReader(specPath(review.report))
              }}
            >
              <Chip size="sm" variant="soft" color="accent" className="tag">{t('requirement.timelineReview', { round: review.round })}</Chip>
              {decisionChip(review, 'requirement-timeline-review-status')}
              <span className="time">{formatTimestamp(review.at)}</span>
            </li>
          ))}
          {row.reviews.length === 0 && (
            <li className="empty" data-testid="requirement-timeline-review-empty">{t('requirement.noReviews')}</li>
          )}
          {row.versions.map(version => (
            <li key={`version-${String(version.n)}`} data-testid="requirement-timeline-version" data-version={version.n}>
              <Chip size="sm" variant="soft" className="tag">{t('requirement.timelineVersion', { n: version.n })}</Chip>
              <span className="time">{formatTimestamp(version.at)}</span>
              <Button
                variant="ghost"
                size="sm"
                data-testid="requirement-open-version"
                data-version={version.n}
                data-path={`.spec/requirements/${row.id}/versions/v${String(version.n)}.md`}
                onPress={() => { props.onOpenReader(`.spec/requirements/${row.id}/versions/v${String(version.n)}.md`) }}
              >
                {t('requirement.openSnapshot')}
              </Button>
            </li>
          ))}
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

      <section
        className="detail-section"
        data-testid="requirement-review-report"
        {...(latestReview === null ? {} : { 'data-round': latestReview.round })}
      >
        <Separator className="detail-divider" />
        {latestReview === null || reportPath === null
          ? (
            <>
              <h4>{t('requirement.reportHeading')}</h4>
              <p className="empty" data-testid="requirement-report-empty">{t('requirement.reportEmpty')}</p>
            </>
          )
          : (
            <>
              <div className="detail-drawer-head">
                <div className="row-actions">
                  <h4>{t('requirement.reportTitle', { round: latestReview.round })}</h4>
                  {decisionChip(latestReview, 'requirement-review-status')}
                </div>
                <div className="row-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="requirement-report-open"
                    onPress={() => { props.onOpenReader(reportPath) }}
                  >
                    {t('requirement.openReport')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="requirement-report-toggle"
                    aria-expanded={reportExpanded}
                    onPress={() => { setReportExpanded(current => !current) }}
                  >
                    {reportExpanded ? t('requirement.collapse') : t('requirement.expand')}
                  </Button>
                </div>
              </div>
              <div className="requirement-report-summary" data-testid="requirement-report-summary">
                <span className="time">{formatTimestamp(latestReview.at)}</span>
                {report.status === 'loading' && (
                  <span data-testid="requirement-report-loading">{t('requirement.reportLoading')}</span>
                )}
                {report.status === 'failed' && (
                  <span className="problem" data-testid="requirement-report-failed">
                    {t('requirement.reportFailed', { detail: report.message })}
                  </span>
                )}
                {report.status === 'ready' && parsedReport !== undefined && (
                  <>
                    {parsedReport.summary !== '' && (
                      <div className="requirement-report-card card-summary" data-testid="requirement-report-summary-card">
                        <span className="requirement-card-label">{t('requirement.reportSummary')}</span>
                        <p className="requirement-card-text" data-testid="requirement-report-summary-text">{parsedReport.summary}</p>
                      </div>
                    )}
                    {parsedReport.todos.length > 0 && (
                      <div className="requirement-report-card card-todos" data-testid="requirement-report-todos">
                        <div className="detail-drawer-head">
                          <span className="requirement-card-label">{t('requirement.reportTodos')}</span>
                          <span className="requirement-todo-summary" data-testid="requirement-todo-summary">
                            {t('requirement.todoStats', {
                              high: String(priorityCounts.high),
                              medium: String(priorityCounts.medium),
                              low: String(priorityCounts.low),
                            })}
                          </span>
                        </div>
                        <ul className="requirement-todo-list">
                          {parsedReport.todos.map((todo, index) => {
                            const expanded = expandedTodos.has(index)
                            return (
                              <li
                                key={`todo-${String(index)}`}
                                className="requirement-todo"
                                data-testid="requirement-report-todo"
                                data-priority={todo.priority ?? ''}
                              >
                                <div className="requirement-todo-main">
                                  {todo.priority !== undefined && (
                                    <Chip
                                      size="sm"
                                      variant="soft"
                                      color={PRIORITY_CHIP_COLOR[todo.priority]}
                                      className={`priority-badge priority-${todo.priority}`}
                                      data-testid="requirement-report-priority"
                                    >
                                      {t(PRIORITY_KEY[todo.priority])}
                                    </Chip>
                                  )}
                                  <span className="requirement-todo-text">{expanded ? todo.text : todo.summary}</span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="requirement-todo-toggle"
                                  data-testid="requirement-todo-toggle"
                                  aria-expanded={expanded}
                                  onPress={() => { toggleTodo(index) }}
                                >
                                  {expanded ? t('requirement.collapse') : t('requirement.todoDetails')}
                                </Button>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}
                    {parsedReport.summary === '' && parsedReport.todos.length === 0 && (
                      <>
                        <span className="requirement-excerpt-label">{t('requirement.reportExcerpt')}</span>
                        <span data-testid="requirement-report-excerpt">{excerptOf(report.text)}</span>
                      </>
                    )}
                  </>
                )}
              </div>
              {reportExpanded && report.status === 'ready' && (
                <div className="markdown-body tall" data-testid="requirement-report-body">{renderMarkdown(report.text)}</div>
              )}
              {phase === 'pending' && (
                <div className="requirement-review-decision" data-testid="requirement-review-decision">
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="requirement-review-accept"
                    isDisabled={busy !== null}
                    ref={(node) => { if (node !== null) node.title = t('requirement.reviewAcceptTitle') }}
                    onPress={() => { void startOp('reviewAccept', props.onRevise) }}
                  >
                    {t('requirement.reviewAccept')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="requirement-review-reject"
                    isDisabled={busy !== null}
                    ref={(node) => { if (node !== null) node.title = t('requirement.reviewRejectTitle') }}
                    onPress={() => { void execute('reviewReject', `/requirement_review_decide ${row.id} ${latestReview.round} rejected`) }}
                  >
                    {t('requirement.reviewReject')}
                  </Button>
                  <p className="detail-note" data-testid="requirement-review-accept-hint">{t('requirement.reviewAcceptHint')}</p>
                </div>
              )}
              {historyReviews.length > 0 && (
                <ul className="requirement-report-history plain-list compact">
                  {historyReviews.map(review => (
                    <li key={review.round} data-testid="requirement-review-history-item" data-round={review.round}>
                      <span>
                        {t('requirement.timelineReview', { round: review.round })}
                        {decisionChip(review, 'requirement-review-history-status')}
                        <span className="time">{formatTimestamp(review.at)}</span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid="requirement-open-report"
                        data-path={specPath(review.report)}
                        onPress={() => { props.onOpenReader(specPath(review.report)) }}
                      >
                        {t('requirement.openReport')}
                      </Button>
                      {decisionOf(review) === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid="requirement-review-history-reject"
                          data-round={review.round}
                          isDisabled={busy !== null}
                          ref={(node) => { if (node !== null) node.title = t('requirement.reviewRejectHistoryTitle') }}
                          onPress={() => { void execute(`reviewReject-${String(review.round)}`, `/requirement_review_decide ${row.id} ${review.round} rejected`) }}
                        >
                          {t('requirement.reviewRejectHistory')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
      </section>

      {plan !== undefined && (
        <section className="detail-section" data-testid="requirement-split-plan">
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
                  const done = ignored.has(entry.task) || outcome?.ok === true
                  return (
                    <tr key={entry.task} data-testid="requirement-split-plan-row" data-task-id={entry.task}>
                      <td><span className="mono">{entry.task}</span> {task?.title ?? ''}</td>
                      <td>{roleLabel(entry.role)}</td>
                      <td>{entry.reason ?? '—'}</td>
                      <td>
                        {ignored.has(entry.task)
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
                        {!done && outcome !== undefined && (
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

      <section className="detail-section" data-testid="requirement-related">
        <Separator className="detail-divider" />
        <div className="detail-drawer-head">
          <h4>关联任务</h4>
          {related.length > 0 && (
            <Button variant="ghost" size="sm" data-testid="requirement-view-tasks" onPress={props.onOpenTasks}>
              {t('requirement.opTasks')}
            </Button>
          )}
        </div>
        {related.length === 0
          ? <p className="empty">还没有拆出任务。</p>
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

    </DetailDrawer>
  )
}
