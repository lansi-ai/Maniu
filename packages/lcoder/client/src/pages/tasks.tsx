/** 任务页：六列看板与列表，筛选共用一份投影。 */

import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { TaskRow } from '../spec/rows.ts'
import type { SessionSummary } from '../store.ts'
import {
  BOARD_COLUMNS, STATE_LABELS, boardColumnOf, emptyTaskFilter, filterTasks, runStatusOf, sortTasks,
  type TaskFilter,
} from '../spec/board.ts'

/** 任务页属性。 */
export interface TasksPageProps {
  readonly project: ProjectScope | null
  readonly projection: SpecProjection
  readonly sessions: readonly SessionSummary[]
  readonly loading: boolean
  readonly error: string | null
  readonly onReload: () => void
}

/**
 * 任务页。
 * @param props - 投影、会话列表与项目。
 * @returns 页面。
 */
export function TasksPage(props: TasksPageProps): JSX.Element {
  const [view, setView] = useState<'board' | 'list'>('board')
  const [filter, setFilter] = useState<TaskFilter>(emptyTaskFilter)
  const [selected, setSelected] = useState<string | null>(null)

  const running = useMemo(
    () => new Set(props.sessions.filter(session => session.running).map(session => session.sessionId)),
    [props.sessions],
  )
  const rows = useMemo(() => sortTasks(filterTasks(props.projection.tasks, filter)), [props.projection.tasks, filter])
  const roles = useMemo(
    () => [...new Set(props.projection.roles.map(role => role.id))].sort(),
    [props.projection.roles],
  )
  const active = rows.find(row => row.id === selected) ?? null
  const update = (patch: Partial<TaskFilter>): void => { setFilter(current => ({ ...current, ...patch })) }

  return (
    <section className="page" data-testid="page-tasks">
      <header className="page-head">
        <div>
          <h2>任务</h2>
          <p className="page-sub">{rows.length} 条任务 · {BOARD_COLUMNS.length} 列看板</p>
        </div>
        <div className="page-actions">
          <input
            className="search"
            data-testid="task-search"
            value={filter.text}
            placeholder="搜索任务"
            onChange={(event) => { update({ text: event.target.value }) }}
          />
          <select className="select" data-testid="task-grade" value={filter.grade} onChange={(event) => { update({ grade: event.target.value }) }}>
            <option value="">全部等级</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
          <select className="select" data-testid="task-session" value={filter.session} onChange={(event) => { update({ session: event.target.value }) }}>
            <option value="">全部会话</option>
            {props.sessions.map(session => (
              <option key={session.sessionId} value={session.sessionId}>{session.sessionId.slice(0, 8)}</option>
            ))}
          </select>
          <select className="select" data-testid="task-role" value={filter.role} onChange={(event) => { update({ role: event.target.value }) }}>
            <option value="">全部岗位</option>
            {roles.map(role => <option key={role} value={role}>{role}</option>)}
          </select>
          <div className="segmented" role="group" aria-label="任务视图">
            <button type="button" data-testid="task-view-board" className={view === 'board' ? 'active' : undefined} onClick={() => { setView('board') }}>看板</button>
            <button type="button" data-testid="task-view-list" className={view === 'list' ? 'active' : undefined} onClick={() => { setView('list') }}>列表</button>
          </div>
          <button type="button" className="pill" data-testid="task-reload" onClick={props.onReload}>
            {props.loading ? '读取中…' : '刷新'}
          </button>
        </div>
      </header>

      {props.project === null && <p className="empty" data-testid="task-no-project">先在「切换项目」里打开一个仓库。</p>}
      {props.error !== null && <pre className="problem" data-testid="task-problems">{props.error}</pre>}

      {props.project !== null && view === 'board' && (
        <div className="board" data-testid="task-board">
          {BOARD_COLUMNS.map((column) => {
            const columnRows = rows.filter(row => boardColumnOf(row) === column.id)
            return (
              <div className="board-column" key={column.id} data-testid="task-column" data-column={column.id}>
                <div className="board-head">
                  <span>{column.label}</span>
                  <span className="count">{columnRows.length}</span>
                </div>
                <div className="board-body">
                  {columnRows.map(row => (
                    <TaskCard key={row.id} task={row} running={running} selected={row.id === selected} onOpen={setSelected} />
                  ))}
                  {columnRows.length === 0 && <p className="empty">空</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {props.project !== null && view === 'list' && (
        <div className="table-wrap lg-glass-card" data-testid="task-list">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">编号</th>
                <th scope="col">标题</th>
                <th scope="col">列</th>
                <th scope="col">需求/方案</th>
                <th scope="col">轨</th>
                <th scope="col">依赖</th>
                <th scope="col">开立</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr
                  key={row.id}
                  data-testid="task-row"
                  data-task-id={row.id}
                  className={row.id === selected ? 'selected' : undefined}
                  tabIndex={0}
                  onClick={() => { setSelected(row.id) }}
                  onKeyDown={(event) => { if (event.key === 'Enter') setSelected(row.id) }}
                >
                  <td className="mono">{row.id}</td>
                  <td>{row.title}</td>
                  <td><span className="tag">{columnLabelOf(row)}</span></td>
                  <td>{row.requirement ?? row.proposal ?? '—'}</td>
                  <td>{row.track ?? '—'}</td>
                  <td>{row.dependsOn.length === 0 ? '—' : row.dependsOn.join('、')}</td>
                  <td className="mono">{row.openedAt?.slice(0, 10) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="empty" data-testid="task-empty">没有匹配的任务。</p>}
        </div>
      )}

      {active !== null && <TaskPeek task={active} onClose={() => { setSelected(null) }} />}
    </section>
  )
}

function columnLabelOf(task: TaskRow): string {
  const id = boardColumnOf(task)
  return BOARD_COLUMNS.find(column => column.id === id)?.label ?? STATE_LABELS[task.state] ?? task.state
}

function TaskCard(props: {
  readonly task: TaskRow
  readonly running: ReadonlySet<string>
  readonly selected: boolean
  readonly onOpen: (id: string) => void
}): JSX.Element {
  const status = runStatusOf(props.task, props.running)
  return (
    <button
      type="button"
      className={props.selected ? 'task-card lg-glass-card lg-sheen active' : 'task-card lg-glass-card lg-sheen'}
      data-testid="task-card"
      data-task-id={props.task.id}
      data-run-status={status}
      onClick={() => { props.onOpen(props.task.id) }}
    >
      <span className="task-card-head">
        <span className="mono">{props.task.id}</span>
        <span className="tag">{props.task.grade}</span>
      </span>
      <span className="task-card-title">{props.task.title}</span>
      <span className="task-card-tags">
        <span className="tag">{STATE_LABELS[props.task.state] ?? props.task.state}</span>
        {props.task.requirement !== undefined && <span className="tag">{props.task.requirement}</span>}
        {props.task.track !== undefined && <span className="tag">轨 {props.task.track}</span>}
        {props.task.role !== undefined && <span className="tag">岗位 {props.task.role}</span>}
        {status === 'running' && <span className="tag tag-ok">运行中</span>}
        {status === 'queued' && <span className="tag tag-warn">已认领</span>}
      </span>
    </button>
  )
}

function TaskPeek(props: { readonly task: TaskRow; readonly onClose: () => void }): JSX.Element {
  const task = props.task
  return (
    <aside className="peek lg-glass" data-testid="task-peek" data-task-id={task.id}>
      <div className="peek-head">
        <span className="mono">{task.id}</span>
        <button type="button" className="pill" onClick={props.onClose}>关闭</button>
      </div>
      <h3>{task.title}</h3>
      <p className="detail-line">{task.description === '' ? '（没有描述）' : task.description}</p>
      <dl className="kv">
        <dt>状态</dt><dd>{STATE_LABELS[task.state] ?? task.state}</dd>
        <dt>等级</dt><dd>{task.grade}</dd>
        <dt>规则</dt><dd>{task.rules.length === 0 ? '—' : task.rules.join('、')}</dd>
        <dt>证据</dt><dd>{task.evidence.length === 0 ? '—' : task.evidence.join('、')}</dd>
        <dt>依赖</dt><dd>{task.dependsOn.length === 0 ? '—' : task.dependsOn.join('、')}</dd>
        <dt>角色会话</dt><dd className="mono">{task.session ?? '—'}</dd>
      </dl>
      <p className="detail-note">契约、验收与附件在阶段 B 接入。</p>
    </aside>
  )
}
