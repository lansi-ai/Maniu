/**
 * Agent 状态大盘：一张独立整页，汇总会话与任务、列出会话表、合并最近事件。
 *
 * 数据全部来自宿主推流与 `.spec` 投影，这里只展示、不写盘。关系图区域由外壳传入
 * 已映射好的任务/会话数据，本页只把 `DashboardGraph` 放进 `data-dashboard-graph-slot`。
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { DASHBOARD_REFRESH_MS, updatedAtLabel } from '../dashboard.ts'
import type {
  DashboardSessionRow, DashboardSessionState, DashboardSummary,
} from '../dashboard.ts'
import type { ActionLogEntry } from '../flow-history.ts'
import type { LcoderWorkspaceKey } from '../locales.ts'
import { SHELL_STATES } from './shell-data.ts'
import { DashboardGraph } from './DashboardGraph.tsx'
import type { DashboardGraphInput } from './dashboard-graph.ts'
import css from './Shell.module.css'

/** 本包词典的翻译函数。 */
type Translate = PropsLocale<'lcoderWorkspace'>['t']

/** 状态大盘的动作与数据。 */
export interface AgentDashboardPageProps {
  readonly t: Translate
  readonly sessions: readonly DashboardSessionRow[]
  readonly summary: DashboardSummary
  readonly events: readonly ActionLogEntry[]
  /** 按任务编号索引的日志读取问题；只标注对应行。 */
  readonly eventProblems: Readonly<Record<string, string>>
  readonly loading: boolean
  /** 整页读取失败的原因；为空时不显示。 */
  readonly error: string | null
  /** 关系图的数据；任务与认领/联调组由外壳映射。 */
  readonly graph: DashboardGraphInput
  /** 点关系图里的任务节点时打开任务详情。 */
  readonly onOpenTask: (taskId: string) => void
  readonly onBack: () => void
  readonly onRefresh: () => void
}

/** 会话状态到现有显示名的映射。 */
const STATUS_LABEL: Record<DashboardSessionState, {
  readonly key: LcoderWorkspaceKey
  readonly className: string | undefined
}> = {
  waiting: { key: 'shell.taskAwaiting', className: css.tagWarn },
  running: { key: 'shell.running', className: css.tagOk },
  idle: { key: 'shell.taskIdle', className: undefined },
}

/** 一条事件的可读内容；日志字段缺省时显示横线。 */
function eventText(entry: ActionLogEntry): string {
  const parts = [
    entry.action ?? entry.verdict ?? '',
    entry.mode ?? '',
    entry.result ?? '',
    entry.reason ?? '',
    entry.detail ?? '',
  ].filter(part => part !== '')
  return parts.length === 0 ? '—' : parts.join(' · ')
}

/**
 * 画一张状态大盘。
 * @param props - 汇总数据、事件流与页面动作。
 * @returns 状态大盘整页。
 */
export function AgentDashboardPage({
  t, sessions, summary, events, eventProblems, loading, error, graph, onOpenTask, onBack, onRefresh,
}: AgentDashboardPageProps): ReactNode {
  useEffect(() => {
    const timer = window.setInterval(onRefresh, DASHBOARD_REFRESH_MS)
    return () => { window.clearInterval(timer) }
  }, [onRefresh])

  const problemEntries = Object.entries(eventProblems)

  return (
    <div className={css.dashboardPage} data-lcoder-dashboard>
      <div className={css.dashboardHead}>
        <button type="button" className={css.secondaryBtn} onClick={onBack}>
          ← {t('shell.backToBoard')}
        </button>
        <div className={css.grow}>
          <h2>{t('shell.dashboard')}</h2>
          <p className={css.dashboardHeadHint}>{t('shell.dashboardHint')}</p>
        </div>
        <button type="button" className={css.secondaryBtn} disabled={loading} onClick={onRefresh}>
          {loading ? t('shell.dashboardRefreshing') : t('shell.dashboardRefresh')}
        </button>
      </div>

      {error === null ? null : <p className={css.problem}>{error}</p>}

      <section className={css.dashboardSection} data-dashboard-summary>
        <div className={css.dashboardSummary}>
          <div className={css.dashboardMetric}>
            <span className={css.dashboardMetricLabel}>{t('shell.dashboardSessionsTotal')}</span>
            <b className={css.dashboardMetricValue}>{String(summary.total)}</b>
          </div>
          <div className={css.dashboardMetric}>
            <span className={css.dashboardMetricLabel}>{t('shell.running')}</span>
            <b className={css.dashboardMetricValue}>{String(summary.running)}</b>
          </div>
          <div className={css.dashboardMetric}>
            <span className={css.dashboardMetricLabel}>{t('shell.taskIdle')}</span>
            <b className={css.dashboardMetricValue}>{String(summary.idle)}</b>
          </div>
          <div className={css.dashboardMetric}>
            <span className={css.dashboardMetricLabel}>{t('shell.taskAwaiting')}</span>
            <b className={css.dashboardMetricValue}>{String(summary.waiting)}</b>
          </div>
          <div className={css.dashboardMetric}>
            <span className={css.dashboardMetricLabel}>{t('shell.dashboardQueueTotal')}</span>
            <b className={css.dashboardMetricValue}>{String(summary.queueTotal)}</b>
          </div>
          {SHELL_STATES.map(state => (
            <div key={state.id} className={css.dashboardMetric} data-dashboard-task-state={state.id}>
              <span className={css.dashboardMetricLabel}>{t(state.labelKey)}</span>
              <b className={css.dashboardMetricValue}>{String(summary.tasks[state.id])}</b>
            </div>
          ))}
        </div>
      </section>

      <section className={css.dashboardSection} data-dashboard-graph-slot>
        <h3>{t('shell.dashboardGraph')}</h3>
        <DashboardGraph data={graph} t={t} onOpenTask={onOpenTask} />
      </section>

      <section className={css.dashboardSection}>
        <h3>{t('shell.dashboardSessionTable')}</h3>
        <div className={css.dashboardTableWrap}>
          <table className={css.dashboardTable}>
            <thead>
              <tr>
                <th>{t('shell.sessions')}</th>
                <th>{t('shell.dashboardRole')}</th>
                <th>{t('shell.dashboardState')}</th>
                <th>{t('shell.dashboardClaimedTask')}</th>
                <th>{t('shell.dashboardQueue')}</th>
                <th>{t('shell.dashboardUpdated')}</th>
                <th>{t('shell.dashboardWorkspace')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0
                ? (
                  <tr>
                    <td colSpan={7} className={css.dashboardEmpty}>{t('shell.dashboardNoSessions')}</td>
                  </tr>
                )
                : sessions.map((session) => {
                  const status = STATUS_LABEL[session.status]
                  return (
                    <tr key={session.sessionId} data-dashboard-session={session.sessionId}>
                      <td className={css.dashboardSessionName}>{session.name}</td>
                      <td>{session.role}</td>
                      <td>
                        <span className={`${css.tag}${status.className === undefined ? '' : ` ${status.className}`}`}>
                          {t(status.key)}
                        </span>
                      </td>
                      <td className={css.dashboardClaim}>
                        {session.taskId === undefined
                          ? t('shell.dashboardUnclaimed')
                          : (
                            <>
                              <code>{session.taskId}</code>
                              <span>{session.taskTitle ?? ''}</span>
                            </>
                          )}
                      </td>
                      <td className={css.dashboardNumber}>{String(session.queue)}</td>
                      <td className={css.dashboardUpdated}>{updatedAtLabel(session.updatedAt)}</td>
                      <td className={css.dashboardWorkspaceCell} title={session.workspace}>
                        {session.workspace === '' ? '—' : session.workspace}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={css.dashboardSection} data-dashboard-events>
        <h3>{t('shell.dashboardEvents')}</h3>
        {events.length === 0 && problemEntries.length === 0
          ? <p className={css.dashboardEmpty}>{t('shell.dashboardEventsEmpty')}</p>
          : (
            <div className={css.dashboardEventList}>
              {problemEntries.map(([taskId, problem]) => (
                <div key={`problem-${taskId}`} className={css.dashboardEventProblem} data-dashboard-event-problem={taskId}>
                  <span className={css.dashboardEventTime}>—</span>
                  <code>{taskId}</code>
                  <span className={`${css.tag} ${css.tagWarn}`}>{t('shell.dashboardEventProblemTag')}</span>
                  <span>{problem}</span>
                </div>
              ))}
              {events.map((entry, index) => (
                <div
                  key={`${entry.taskId}-${entry.source}-${String(index)}`}
                  className={css.dashboardEventRow}
                  data-dashboard-event={entry.taskId}
                >
                  <span className={css.dashboardEventTime}>{entry.at ?? '—'}</span>
                  <code>{entry.taskId}</code>
                  <span className={css.tag}>
                    {entry.source === 'flow'
                      ? t('shell.flowHistorySourceFlow')
                      : t('shell.flowHistorySourceSchedule')}
                  </span>
                  <span className={css.dashboardEventDetail}>{eventText(entry)}</span>
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  )
}
