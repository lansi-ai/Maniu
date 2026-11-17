/** 需求详情：正文、候选、推荐、关联任务与讨论历史。 */

import { useCallback, useState } from 'react'
import type { JSX } from 'react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { RequirementDocRow, RequirementSplitPlanEntryRow } from '../spec/rows.ts'
import type { SessionSummary } from '../store.ts'
import { requirementStateLabel } from '../spec/board.ts'
import { readDiscussionHistory, type DiscussionHistory } from '../discussion/history.ts'
import { runCommand, type CommandOutcome } from '../commands/run.ts'
import { renderMarkdown } from '../markdown/markdown.tsx'
import { translate, type Translate } from '../locale.ts'
import { DetailDrawer } from './detail-drawer.tsx'

const zhText: Translate = (key, params) => translate('zh', key, params)

/** 评审报告与版本快照在阅读器里的仓库相对路径。 */
function specPath(relative: string): string {
  return `.spec/${relative.replace(/^\.?[\\/]/, '').replace(/^\.spec[\\/]/, '')}`
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
  /** 跳到任务页并只显示本需求关联的任务。 */
  readonly onOpenTasks: () => void
  /** 取词函数；缺省为中文词典。 */
  readonly t?: Translate
}

/**
 * 画出需求详情。
 * @param props - 需求、项目、投影与会话列表。
 * @returns 详情面板。
 */
export function RequirementDetail(props: RequirementDetailProps): JSX.Element {
  const t = props.t ?? zhText
  const row = props.row
  const [history, setHistory] = useState<DiscussionHistory | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<CommandOutcome | null>(null)
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set())
  const [assigns, setAssigns] = useState<Readonly<Record<string, CommandOutcome>>>({})
  const related = props.projection.tasks.filter(task => task.requirement === row.id || task.proposal === row.id)

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

  const split = async (): Promise<void> => {
    if (busy !== null) return
    setBusy('split')
    setResult(null)
    try {
      const answer = await props.onSplit()
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
  const canApprove = row.state === 'draft' && reviewed
  const canRelease = row.state === 'confirmed'
  const canClose = row.state === 'draft' || row.state === 'confirmed'

  const loadHistory = useCallback(async () => {
    if (historyBusy) return
    setHistoryBusy(true)
    try {
      setHistory(await readDiscussionHistory(props.project.path, props.sessions, row.id))
    } catch (cause: unknown) {
      setHistory({
        status: 'failed',
        groups: [],
        message: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      setHistoryBusy(false)
    }
  }, [historyBusy, props.project.path, props.sessions, row.id])

  return (
    <DetailDrawer
      testId="requirement-detail"
      closeTestId="requirement-detail-close"
      onClose={props.onClose}
      attributes={{ 'data-requirement-id': row.id }}
      head={(
        <div>
          <span className="mono">{row.id}</span>
          <span className="tag">{requirementStateLabel(row.state)}</span>
        </div>
      )}
    >
      <h3 data-testid="requirement-detail-title">{row.title ?? row.id}</h3>

      <section className="detail-section">
        <div className="detail-drawer-head">
          <h4>需求正文</h4>
          <button type="button" className="pill" data-testid="requirement-open-reader" onClick={() => { props.onOpenReader(`.spec/requirements/${row.id}.md`) }}>
            在阅读器中打开
          </button>
        </div>
        {row.text.trim() === ''
          ? <p className="empty">正文缺失。</p>
          : <div className="markdown-body tall" data-testid="requirement-document-body">{renderMarkdown(row.text)}</div>}
      </section>

      {row.options.length > 0 && (
        <section className="detail-section" data-testid="requirement-options">
          <h4>候选做法</h4>
          <ul className="plain-list compact">
            {row.options.map(option => (
              <li key={option.name}>
                <strong>{option.name}</strong>
                <span>{option.summary}</span>
                {option.cost !== undefined && <em>{option.cost}</em>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {row.recommendation !== undefined && (
        <section className="detail-section" data-testid="requirement-recommendation">
          <h4>推荐</h4>
          <p className="detail-line">{row.recommendation}</p>
        </section>
      )}

      {plan !== undefined && (
        <section className="detail-section" data-testid="requirement-split-plan">
          <h4>{t('requirement.splitPlanTitle')}</h4>
          <p className="detail-note">{t('requirement.splitPlanAt', { at: plan.at })}</p>
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
                          ? <span className="tag" data-testid="requirement-split-plan-status" data-ok="ignored">{t('requirement.roleIgnored')}</span>
                          : outcome === undefined
                            ? (
                              <div className="row-actions">
                                <button
                                  type="button"
                                  className="pill"
                                  data-testid="requirement-split-plan-confirm"
                                  data-task-id={entry.task}
                                  disabled={busy !== null}
                                  onClick={() => { void assign(entry) }}
                                >
                                  {t('requirement.confirmRole')}
                                </button>
                                <button
                                  type="button"
                                  className="link-button"
                                  data-testid="requirement-split-plan-ignore"
                                  data-task-id={entry.task}
                                  disabled={busy !== null}
                                  onClick={() => { ignore(entry.task) }}
                                >
                                  {t('requirement.ignoreRole')}
                                </button>
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
                            <button
                              type="button"
                              className="link-button"
                              data-testid="requirement-split-plan-retry"
                              data-task-id={entry.task}
                              disabled={busy !== null}
                              onClick={() => { void assign(entry) }}
                            >
                              {t('requirement.confirmRole')}
                            </button>
                            <button
                              type="button"
                              className="link-button"
                              data-testid="requirement-split-plan-ignore"
                              data-task-id={entry.task}
                              disabled={busy !== null}
                              onClick={() => { ignore(entry.task) }}
                            >
                              {t('requirement.ignoreRole')}
                            </button>
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
              <button type="button" className="link-button" data-testid="requirement-split-plan-tasks" onClick={props.onOpenTasks}>
                {t('requirement.splitPlanGoTasks')}
              </button>
            </p>
          )}
        </section>
      )}

      <section className="detail-section" data-testid="requirement-timeline">
        <h4>{t('requirement.timeline')}</h4>
        <ul className="timeline">
          <li data-testid="requirement-timeline-opened">
            <span className="tag">{t('requirement.timelineOpened')}</span>
            <span className="time">{row.openedAt ?? '—'}</span>
          </li>
          {row.reviews.map(review => (
            <li key={`review-${String(review.round)}`} data-testid="requirement-timeline-review" data-round={review.round}>
              <span className="tag">{t('requirement.timelineReview', { round: review.round })}</span>
              <span className="time">{review.at}</span>
              <button
                type="button"
                className="link-button"
                data-testid="requirement-open-report"
                data-path={specPath(review.report)}
                onClick={() => { props.onOpenReader(specPath(review.report)) }}
              >
                {t('requirement.openReport')}
              </button>
            </li>
          ))}
          {row.reviews.length === 0 && (
            <li className="empty" data-testid="requirement-timeline-review-empty">{t('requirement.noReviews')}</li>
          )}
          {row.versions.map(version => (
            <li key={`version-${String(version.n)}`} data-testid="requirement-timeline-version" data-version={version.n}>
              <span className="tag">{t('requirement.timelineVersion', { n: version.n })}</span>
              <span className="time">{version.at}</span>
              <button
                type="button"
                className="link-button"
                data-testid="requirement-open-version"
                data-version={version.n}
                data-path={`.spec/requirements/${row.id}/versions/v${String(version.n)}.md`}
                onClick={() => { props.onOpenReader(`.spec/requirements/${row.id}/versions/v${String(version.n)}.md`) }}
              >
                {t('requirement.openSnapshot')}
              </button>
            </li>
          ))}
          {row.versions.length === 0 && (
            <li className="empty" data-testid="requirement-timeline-version-empty">{t('requirement.noVersions')}</li>
          )}
          <li data-testid="requirement-timeline-approved">
            <span className="tag">{t('requirement.timelineApproved')}</span>
            <span className="time">{row.approvedAt ?? '—'}</span>
            <span>{row.approvedVersion === undefined
              ? t('requirement.notApproved')
              : t('requirement.timelineApprovedVersion', { n: row.approvedVersion })}</span>
          </li>
          {related.map(task => (
            <li key={`split-${task.id}`} data-testid="requirement-timeline-split" data-task-id={task.id}>
              <span className="tag">{t('requirement.timelineSplit')}</span>
              <span className="mono">{task.id}</span>
              <span className="time">{task.openedAt ?? '—'}</span>
            </li>
          ))}
          {related.length === 0 && (
            <li className="empty" data-testid="requirement-timeline-split-empty">{t('requirement.noSplit')}</li>
          )}
        </ul>
      </section>

      <section className="detail-section" data-testid="requirement-related">
        <div className="detail-drawer-head">
          <h4>关联任务</h4>
          {related.length > 0 && (
            <button type="button" className="pill" data-testid="requirement-view-tasks" onClick={props.onOpenTasks}>
              {t('requirement.opTasks')}
            </button>
          )}
        </div>
        {related.length === 0
          ? <p className="empty">还没有拆出任务。</p>
          : (
            <ul className="plain-list compact">
              {related.map(task => (
                <li key={task.id}>
                  <button type="button" className="link-button" data-testid="requirement-related-task" onClick={() => { props.onOpenTask(task.id) }}>
                    <span className="mono">{task.id}</span> {task.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="detail-section" data-testid="requirement-history">
        <div className="detail-drawer-head">
          <h4>讨论历史</h4>
          <button type="button" className="pill" data-testid="requirement-history-load" disabled={historyBusy} onClick={() => { void loadHistory() }}>
            {historyBusy ? '读取中…' : history === null ? '读取讨论历史' : '重读'}
          </button>
        </div>
        {history === null && <p className="empty">按参会身份与需求编号聚合讨论会话。</p>}
        {history !== null && history.groups.length === 0 && (
          <p className={history.status === 'failed' ? 'problem' : 'empty'} data-testid="requirement-history-empty">{history.message}</p>
        )}
        {history !== null && history.groups.map(group => (
          <div key={group.roleId} className="history-round" data-testid="requirement-history-round" data-role={group.roleId}>
            <h5>{group.roleName}</h5>
            {group.statements.map((statement, index) => (
              <p key={`${group.roleId}-${String(index)}`} className="detail-line">{statement}</p>
            ))}
          </div>
        ))}
      </section>

      <section className="detail-section" data-testid="requirement-actions">
        <h4>动作（命令通道）</h4>
        <div className="action-row">
          <button
            type="button"
            className="pill"
            data-testid="requirement-approve"
            disabled={!canApprove || busy !== null}
            title={reviewed ? undefined : t('requirement.approveNeedsReview')}
            onClick={() => { void execute('approve', `/requirement_approve ${row.id}`) }}
          >
            确认需求
          </button>
          <button type="button" className="pill" data-testid="requirement-split" disabled={!canRelease || busy !== null} onClick={() => { void split() }}>拆分任务</button>
          <button type="button" className="pill" data-testid="requirement-release" disabled={!canRelease || busy !== null} onClick={() => { void execute('release', `/requirement_release ${row.id}`) }}>上线</button>
          <button type="button" className="pill" data-testid="requirement-close" disabled={!canClose || busy !== null} onClick={() => { void execute('close', `/requirement_close ${row.id}`) }}>关闭</button>
        </div>
        {row.state === 'draft' && !reviewed && (
          <p className="detail-note" data-testid="requirement-approve-hint">{t('requirement.approveNeedsReview')}</p>
        )}
        {result !== null && (
          <p className={result.ok ? 'detail-line' : 'problem'} data-testid="requirement-action-result" data-ok={result.ok ? 'true' : 'false'}>
            {result.text}
          </p>
        )}
        <p className="detail-note">{t('requirement.splitNote')}</p>
      </section>
    </DetailDrawer>
  )
}
