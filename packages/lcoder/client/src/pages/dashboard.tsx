/**
 * 总览页：当前项目的头部事实、唯一主行动、进度漏斗、活原型状态与近期动态。
 *
 * 只读 `SpecProjection` 与 `prototype/getStaged`，不新增持久化；主行动按固定优先级
 * 从真实状态推出，页面上只有一个。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Button, Card, Chip, Modal, Separator, useOverlayState } from '@heroui/react'
import { ArrowRight, Frame, LayoutDashboard, MessageSquare, Sparkles } from 'lucide-react'

import type { MessageKey, Translate } from '../locale.ts'
import type { PrototypeSnapshotMeta, PrototypeStagedView, UnaryCall } from '../prototype/remote.ts'
import { getStagedPrototype, listPrototypeSnapshots } from '../prototype/remote.ts'
import { causeText, openPreview, openStudio } from '../prototype/open.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { TaskStage } from '../spec/board.ts'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import {
  nextActionOf, recentActivityOf, requirementFunnelOf, taskFunnelOf, type NextAction, type NextActionKind,
} from './dashboard-model.ts'
import { ProjectInfoPage } from './project-info.tsx'
import { formatTimestamp } from './requirement-report.ts'

const NEXT_TITLE_KEY: Readonly<Record<NextActionKind, MessageKey>> = {
  intake: 'dashboard.next.intake.title',
  review: 'dashboard.next.review.title',
  staged: 'dashboard.next.staged.title',
  verify: 'dashboard.next.verify.title',
  develop: 'dashboard.next.develop.title',
  browse: 'dashboard.next.browse.title',
}

const NEXT_HINT_KEY: Readonly<Record<NextActionKind, MessageKey>> = {
  intake: 'dashboard.next.intake.hint',
  review: 'dashboard.next.review.hint',
  staged: 'dashboard.next.staged.hint',
  verify: 'dashboard.next.verify.hint',
  develop: 'dashboard.next.develop.hint',
  browse: 'dashboard.next.browse.hint',
}

const NEXT_BUTTON_KEY: Readonly<Record<NextActionKind, MessageKey>> = {
  intake: 'dashboard.next.intake.button',
  review: 'dashboard.next.review.button',
  staged: 'dashboard.next.staged.button',
  verify: 'dashboard.next.verify.button',
  develop: 'dashboard.next.develop.button',
  browse: 'dashboard.next.browse.button',
}

const TASK_STAGE_LABEL: Readonly<Record<TaskStage, MessageKey>> = {
  pending: 'task.stage.pending',
  implementing: 'task.stage.implementing',
  verifying: 'task.stage.verifying',
  closed: 'task.stage.closed',
}

/** 总览页属性。 */
export interface DashboardPageProps {
  readonly t: Translate
  /** 当前激活项目；null 时只画选择项目的空态。 */
  readonly project: ProjectScope | null
  readonly projection: SpecProjection
  readonly loading: boolean
  readonly error: string | null
  readonly onReload: () => void
  /** 现有需求编号，按新到旧排列；工作室需要最新一条作为上下文。 */
  readonly requirementIds: readonly string[]
  /** 跳到项目页切换项目。 */
  readonly onSwitchProject: () => void
  /** 跳到需求页；`state` 非空时带上状态筛选。 */
  readonly onOpenRequirements: (state?: string) => void
  /** 跳到任务页；`stage` 非空时带上阶段筛选。 */
  readonly onOpenTasks: (stage?: TaskStage) => void
  /** 跳到原型页；`requirementId` 缺省为项目级视图。 */
  readonly onOpenPrototype: (requirementId?: string) => void
  /** 跳到对话页。 */
  readonly onOpenChat: () => void
  /** 打开立项向导：跳到需求页并直接展开访谈入口。 */
  readonly onStartIntake: () => void
  /** 打开某条需求的详情，用于处置未决评审。 */
  readonly onOpenRequirement: (requirementId: string) => void
  /** preset 名册显示名；项目详情里的流程配置优先取它。 */
  readonly presetNames?: Readonly<Record<string, string>>
  /** 一元调用注入点；缺省走宿主 preload。 */
  readonly call?: UnaryCall
}

/**
 * 画出当前项目的总览。
 * @param props - 项目、投影、跳转回调与宿主调用。
 * @returns 总览页。
 */
export function DashboardPage(props: DashboardPageProps): JSX.Element {
  const t = props.t
  const scopeSessionId = props.project?.scopeSessionId ?? null
  const invoke = useMemo<UnaryCall>(
    () => props.call ?? ((namespace, method, args) => window.lcoder.call(namespace, method, args)),
    [props.call],
  )
  const [view, setView] = useState<PrototypeStagedView | null>(null)
  const [snapshots, setSnapshots] = useState<readonly PrototypeSnapshotMeta[]>([])
  const [prototypeLoading, setPrototypeLoading] = useState(false)
  const [prototypeError, setPrototypeError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const detailState = useOverlayState({
    isOpen: detailOpen,
    onOpenChange: (open) => { if (!open) setDetailOpen(false) },
  })

  /**
   * 读项目级暂存视图与历史快照；快照读取失败不挡状态卡。
   * @returns 读取完成。
   */
  const loadPrototype = useCallback(async (): Promise<void> => {
    if (scopeSessionId === null) {
      setView(null)
      setSnapshots([])
      return
    }
    setPrototypeLoading(true)
    setPrototypeError(null)
    try {
      setView(await getStagedPrototype(scopeSessionId, undefined, invoke))
    } catch (cause: unknown) {
      setPrototypeError(causeText(cause))
    } finally {
      setPrototypeLoading(false)
    }
    try {
      setSnapshots(await listPrototypeSnapshots(scopeSessionId, undefined, invoke))
    } catch {
      // 快照列表是次要信息：读不到时清空，不遮住主原型状态。
      setSnapshots([])
    }
  }, [invoke, scopeSessionId])

  useEffect(() => {
    void loadPrototype()
  }, [loadPrototype])

  // 工作室是独立窗口：回到主窗时重读，落盘后的正式版立刻反映到状态卡。
  useEffect(() => {
    const refresh = (): void => { void loadPrototype() }
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh) }
  }, [loadPrototype])

  const requirements = props.projection.requirements
  const tasks = props.projection.tasks
  const requirementFunnel = useMemo(() => requirementFunnelOf(requirements), [requirements])
  const taskFunnel = useMemo(() => taskFunnelOf(tasks), [tasks])
  const staged = view?.staged ?? null
  const committedHtml = view?.committedHtml ?? null
  const nextAction = useMemo(
    () => nextActionOf({ requirements, tasks, staged: staged !== null }),
    [requirements, staged, tasks],
  )
  const activity = useMemo(() => recentActivityOf(requirements, tasks), [requirements, tasks])
  const latestSnapshot = snapshots[0]
  const studioRequirementId = props.requirementIds[0]
  const info = props.projection.project

  const reload = (): void => {
    setNotice(null)
    props.onReload()
    void loadPrototype()
  }

  const runNextAction = (action: NextAction): void => {
    if (action.kind === 'intake') {
      props.onStartIntake()
      return
    }
    if (action.kind === 'review' && action.requirementId !== undefined) {
      props.onOpenRequirement(action.requirementId)
      return
    }
    if (action.kind === 'staged') {
      props.onOpenPrototype()
      return
    }
    if (action.kind === 'verify') {
      props.onOpenTasks('verifying')
      return
    }
    if (action.kind === 'develop') {
      props.onOpenTasks('pending')
      return
    }
    props.onOpenRequirements()
  }

  const openStudioWindow = async (): Promise<void> => {
    const html = staged?.html ?? committedHtml
    if (html === null || studioRequirementId === undefined) return
    setNotice(null)
    try {
      await openStudio({
        requirementId: studioRequirementId,
        ...(scopeSessionId === null ? {} : { sessionId: scopeSessionId }),
        html,
        beforeHtml: committedHtml ?? html,
      })
    } catch (cause: unknown) {
      setNotice(t('dashboard.openFailed', { detail: causeText(cause) }))
    }
  }

  const openPreviewWindow = async (): Promise<void> => {
    const html = staged?.html ?? committedHtml
    if (html === null) return
    setNotice(null)
    try {
      await openPreview(html)
    } catch (cause: unknown) {
      setNotice(t('dashboard.openFailed', { detail: causeText(cause) }))
    }
  }

  if (props.project === null) {
    return (
      <section className="page dashboard-page" data-testid="page-dashboard">
        <Card className="info-card dashboard-empty" data-testid="dashboard-no-project">
          <div className="dashboard-empty-body">
            <LayoutDashboard className="dashboard-empty-icon" size={28} aria-hidden="true" />
            <h2>{t('dashboard.noProject.title')}</h2>
            <p className="page-sub">{t('dashboard.noProject.body')}</p>
            <Button variant="primary" data-testid="dashboard-pick-project" onPress={props.onSwitchProject}>
              {t('dashboard.noProject.action')}
            </Button>
          </div>
        </Card>
      </section>
    )
  }

  return (
    <section className="page dashboard-page" data-testid="page-dashboard">
      <header className="page-head dashboard-head" data-testid="dashboard-head">
        <div className="dashboard-head-main">
          <h2 data-testid="dashboard-project-title">{props.project.title}</h2>
          <p className="page-sub mono" data-testid="dashboard-project-path">{props.project.path}</p>
          <p className="page-sub" data-testid="dashboard-project-facts">
            {t('dashboard.projectFacts', {
              kind: info?.kind ?? '—',
              branch: info?.branch ?? '—',
            })}
          </p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" data-testid="dashboard-refresh" isDisabled={props.loading} onPress={reload}>
            {props.loading ? t('dashboard.refreshing') : t('dashboard.refresh')}
          </Button>
          <Button variant="secondary" data-testid="dashboard-project-detail" onPress={() => { setDetailOpen(true) }}>
            {t('dashboard.projectDetail')}
          </Button>
          <Button variant="primary" data-testid="dashboard-switch-project" onPress={props.onSwitchProject}>
            {t('dashboard.switchProject')}
          </Button>
        </div>
      </header>

      {props.error !== null && (
        <pre className="problem" data-testid="dashboard-problems">{props.error}</pre>
      )}

      <Card className="dashboard-next" data-testid="dashboard-next-action" data-action={nextAction.kind}>
        <div className="dashboard-next-copy">
          <span className="dashboard-next-label">{t('dashboard.nextLabel')}</span>
          <p className="dashboard-next-title">
            {t(NEXT_TITLE_KEY[nextAction.kind], {
              count: nextAction.count,
              round: nextAction.round ?? 0,
            })}
          </p>
          <p className="dashboard-next-hint">
            {t(NEXT_HINT_KEY[nextAction.kind], {
              count: nextAction.count,
              round: nextAction.round ?? 0,
            })}
          </p>
        </div>
        <Button
          variant="primary"
          data-testid="dashboard-next-action-button"
          onPress={() => { runNextAction(nextAction) }}
        >
          {t(NEXT_BUTTON_KEY[nextAction.kind], {
            count: nextAction.count,
            round: nextAction.round ?? 0,
          })}
          <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </Card>

      <div className="dashboard-funnels">
        <Card className="info-card dashboard-funnel" data-testid="dashboard-requirement-funnel">
          <h3>{t('dashboard.requirementFunnel')}</h3>
          <div className="dashboard-stat-grid">
            <FunnelStat
              testId="dashboard-requirement-stat"
              state="draft"
              label={t('dashboard.requirement.draft')}
              count={requirementFunnel.draft}
              ariaLabel={t('dashboard.statAria', { label: t('dashboard.requirement.draft'), count: requirementFunnel.draft })}
              onPress={() => { props.onOpenRequirements('draft') }}
            />
            <FunnelStat
              testId="dashboard-requirement-stat"
              state="confirmed"
              label={t('dashboard.requirement.confirmed')}
              count={requirementFunnel.confirmed}
              ariaLabel={t('dashboard.statAria', { label: t('dashboard.requirement.confirmed'), count: requirementFunnel.confirmed })}
              onPress={() => { props.onOpenRequirements('confirmed') }}
            />
            <FunnelStat
              testId="dashboard-requirement-stat"
              state="released"
              label={t('dashboard.requirement.released')}
              count={requirementFunnel.released}
              ariaLabel={t('dashboard.statAria', { label: t('dashboard.requirement.released'), count: requirementFunnel.released })}
              onPress={() => { props.onOpenRequirements('released') }}
            />
          </div>
        </Card>

        <Card className="info-card dashboard-funnel" data-testid="dashboard-task-funnel">
          <h3>{t('dashboard.taskFunnel')}</h3>
          <div className="dashboard-stat-grid">
            {(['pending', 'implementing', 'verifying', 'closed'] as const).map(stage => (
              <FunnelStat
                key={stage}
                testId="dashboard-task-stat"
                stage={stage}
                label={t(TASK_STAGE_LABEL[stage])}
                count={taskFunnel[stage]}
                ariaLabel={t('dashboard.statAria', { label: t(TASK_STAGE_LABEL[stage]), count: taskFunnel[stage] })}
                onPress={() => { props.onOpenTasks(stage) }}
              />
            ))}
          </div>
        </Card>
      </div>

      <div className="dashboard-grid">
        <Card className="info-card dashboard-card" data-testid="dashboard-prototype-card">
          <div className="dashboard-card-head">
            <h3>{t('dashboard.prototypeTitle')}</h3>
            <Chip
              size="sm"
              variant="soft"
              color={staged !== null ? 'warning' : committedHtml !== null ? 'success' : 'default'}
              data-testid="dashboard-prototype-state"
              data-staged={staged !== null ? 'true' : 'false'}
            >
              {t(staged !== null
                ? 'dashboard.prototype.stagedBadge'
                : committedHtml !== null ? 'dashboard.prototype.readyBadge' : 'dashboard.prototype.emptyBadge')}
            </Chip>
          </div>
          <p className="detail-line" data-testid="dashboard-prototype-status">
            {prototypeLoading && view === null
              ? t('dashboard.prototypeLoading')
              : staged !== null
                ? t('dashboard.prototypeStaged', { count: staged.summary.length })
                : committedHtml !== null
                  ? t('dashboard.prototypeReady')
                  : t('dashboard.prototypeEmpty')}
          </p>
          {staged !== null && staged.summary.length > 0 && (
            <ul className="plain-list compact" data-testid="dashboard-prototype-summary">
              {staged.summary.map((line, index) => <li key={`${String(index)}-${line}`}>{line}</li>)}
            </ul>
          )}
          {latestSnapshot !== undefined && (
            <p className="detail-note" data-testid="dashboard-prototype-latest">
              {t('dashboard.prototypeLatest', { at: formatTimestamp(latestSnapshot.createdAt) })}
            </p>
          )}
          {prototypeError !== null && (
            <p className="problem" data-testid="dashboard-prototype-error">
              {t('dashboard.prototypeError', { detail: prototypeError })}
            </p>
          )}
          <div className="dashboard-card-actions">
            <Button
              variant="primary"
              data-testid="dashboard-open-studio"
              isDisabled={studioRequirementId === undefined || (staged === null && committedHtml === null)}
              onPress={() => { void openStudioWindow() }}
            >
              <Frame size={14} aria-hidden="true" />
              {t('dashboard.openStudio')}
            </Button>
            <Button
              variant="secondary"
              data-testid="dashboard-open-window"
              isDisabled={staged === null && committedHtml === null}
              onPress={() => { void openPreviewWindow() }}
            >
              {t('dashboard.openWindow')}
            </Button>
          </div>
          {studioRequirementId === undefined && (
            <p className="detail-note" data-testid="dashboard-studio-unavailable">{t('dashboard.studioUnavailable')}</p>
          )}
          {notice !== null && <p className="detail-note" data-testid="dashboard-notice">{notice}</p>}
        </Card>

        <Card className="info-card dashboard-card" data-testid="dashboard-activity-card">
          <div className="dashboard-card-head">
            <h3>{t('dashboard.recentTitle')}</h3>
            <Chip size="sm" variant="soft" color="default">{activity.length}</Chip>
          </div>
          {activity.length === 0
            ? <p className="empty" data-testid="dashboard-recent-empty">{t('dashboard.recentEmpty')}</p>
            : (
              <ul className="dashboard-recent-list" data-testid="dashboard-recent-list">
                {activity.map(item => (
                  <li key={`${item.kind}-${item.id}`}>
                    <button
                      type="button"
                      className="dashboard-recent-item"
                      data-testid="dashboard-recent-item"
                      data-kind={item.kind}
                      data-id={item.id}
                      onClick={() => {
                        if (item.kind === 'requirement') props.onOpenRequirements()
                        else props.onOpenTasks()
                      }}
                    >
                      <Chip size="sm" variant="secondary">
                        {t(item.kind === 'requirement' ? 'dashboard.recentRequirement' : 'dashboard.recentTask')}
                      </Chip>
                      <span className="dashboard-recent-id mono">{item.id}</span>
                      <span className="dashboard-recent-title">{item.title}</span>
                      <span className="dashboard-recent-time mono">{formatTimestamp(item.at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          <Separator className="info-divider" />
          <span className="detail-line">{t('dashboard.quickTitle')}</span>
          <div className="dashboard-card-actions">
            <Button variant="secondary" data-testid="dashboard-quick-change" onPress={() => { props.onOpenRequirements() }}>
              <Sparkles size={14} aria-hidden="true" />
              {t('dashboard.quickChange')}
            </Button>
            <Button variant="secondary" data-testid="dashboard-quick-chat" onPress={props.onOpenChat}>
              <MessageSquare size={14} aria-hidden="true" />
              {t('dashboard.quickChat')}
            </Button>
          </div>
        </Card>
      </div>

      <Modal.Root state={detailState}>
        <Modal.Backdrop isDismissable variant="transparent" className="glass-modal-backdrop">
          <Modal.Container placement="center" size="lg" className="glass-modal">
            <Modal.Dialog className="glass-modal-panel dashboard-detail-panel" data-testid="dashboard-detail-dialog">
              <Modal.Header>
                <Modal.Heading>{t('dashboard.projectDetail')}</Modal.Heading>
                <Modal.CloseTrigger data-testid="dashboard-detail-close" aria-label={t('dashboard.close')} />
              </Modal.Header>
              <Modal.Body>
                <ProjectInfoPage
                  t={t}
                  project={props.project}
                  projection={props.projection}
                  loading={props.loading}
                  error={props.error}
                  onReload={props.onReload}
                  embedded
                  {...(props.presetNames === undefined ? {} : { presetNames: props.presetNames })}
                />
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </section>
  )
}

interface FunnelStatProps {
  readonly testId: string
  /** 需求漏斗的状态键；任务漏斗用 `stage`。 */
  readonly state?: string
  readonly stage?: TaskStage
  readonly label: string
  readonly count: number
  readonly ariaLabel: string
  readonly onPress: () => void
}

/** 漏斗里的一格数字卡：整块可点，带筛选条件跳到对应页面。 */
function FunnelStat(props: FunnelStatProps): JSX.Element {
  return (
    <button
      type="button"
      className="dashboard-stat"
      data-testid={props.testId}
      {...(props.state === undefined ? {} : { 'data-state': props.state })}
      {...(props.stage === undefined ? {} : { 'data-stage': props.stage })}
      aria-label={props.ariaLabel}
      onClick={props.onPress}
    >
      <span className="dashboard-stat-value">{props.count}</span>
      <span className="dashboard-stat-label">{props.label}</span>
    </button>
  )
}
