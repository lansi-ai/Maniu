/** 需求页：列表、搜索、状态筛选；详情在阶段 B 接入。 */

import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { SessionSummary } from '../store.ts'
import { requirementStateLabel } from '../spec/board.ts'
import { RequirementDetail } from './requirement-detail.tsx'
import { TaskDetail } from './task-detail.tsx'
import { ReaderOverlay } from './reader.tsx'
import { IntakeWizard, type IntakeResult } from './intake-wizard.tsx'

/** 需求页属性。 */
export interface RequirementsPageProps {
  readonly project: ProjectScope | null
  readonly projection: SpecProjection
  readonly sessions: readonly SessionSummary[]
  readonly loading: boolean
  readonly intakeResult: IntakeResult | null
  readonly onClearIntakeResult: () => void
  readonly onReload: () => void
  readonly onStartIntake: (prompt: string) => Promise<{ readonly ok: boolean; readonly message: string }>
  readonly onStartSession: (prompt: string) => Promise<{ readonly ok: boolean; readonly message: string }>
}

/**
 * 需求页。
 * @param props - 投影与项目。
 * @returns 页面。
 */
export function RequirementsPage(props: RequirementsPageProps): JSX.Element {
  const [text, setText] = useState('')
  const [state, setState] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [readerPath, setReaderPath] = useState<string | null>(null)
  const [wizard, setWizard] = useState(false)

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
          <button type="button" className="pill pill-accent" data-testid="intake-open" disabled={props.project === null} onClick={() => { setWizard(true) }}>{props.intakeResult === null ? '立项向导' : '立项结果'}</button>
        </div>
      </header>

      {props.project === null && <p className="empty" data-testid="requirement-no-project">先在「切换项目」里打开一个仓库。</p>}

      {props.project !== null && (
        <div className="split">
          <div className="table-wrap lg-glass-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">编号</th>
                  <th scope="col">标题</th>
                  <th scope="col">状态</th>
                  <th scope="col">候选</th>
                  <th scope="col">推荐</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
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
                    <td>{row.options.length}</td>
                    <td className="clamp">{row.recommendation ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="empty" data-testid="requirement-empty">没有匹配的需求。</p>}
          </div>

          {active !== null && (
            <RequirementDetail
              row={active}
              project={props.project}
              projection={props.projection}
              sessions={props.sessions}
              onClose={() => { setSelected(null) }}
              onOpenTask={setTaskId}
              onOpenReader={setReaderPath}
              onReload={props.onReload}
              onStartSession={props.onStartSession}
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
          onStart={props.onStartIntake}
          onOpenRequirement={(id) => { setWizard(false); setSelected(id) }}
          onReload={props.onReload}
        />
      )}

      {readerPath !== null && props.project !== null && (
        <ReaderOverlay
          scopeSessionId={props.project.scopeSessionId}
          path={readerPath}
          onClose={() => { setReaderPath(null) }}
        />
      )}
    </section>
  )
}
