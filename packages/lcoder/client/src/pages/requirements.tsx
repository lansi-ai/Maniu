/** 需求页：列表、搜索、状态筛选；详情在阶段 B 接入。 */

import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { ProjectScope } from '../workspace/use-workspaces.ts'
import type { SpecProjection } from '../spec/load.ts'
import type { RequirementDocRow } from '../spec/rows.ts'
import { requirementStateLabel } from '../spec/board.ts'

/** 需求页属性。 */
export interface RequirementsPageProps {
  readonly project: ProjectScope | null
  readonly projection: SpecProjection
  readonly loading: boolean
  readonly error: string | null
  readonly onReload: () => void
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

  const rows = useMemo(() => {
    const query = text.trim().toLowerCase()
    return props.projection.requirements.filter((row) => {
      if (state !== '' && row.state !== state) return false
      if (query === '') return true
      return `${row.id} ${row.title ?? ''} ${row.text}`.toLowerCase().includes(query)
    })
  }, [props.projection.requirements, state, text])

  const active = rows.find(row => row.id === selected) ?? null

  return (
    <section className="page" data-testid="page-requirements">
      <header className="page-head">
        <div>
          <h2>需求</h2>
          <p className="page-sub">来自 {props.project?.path ?? '未选择项目'} 的 .spec/requirements</p>
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
        </div>
      </header>

      {props.project === null && <p className="empty" data-testid="requirement-no-project">先在「切换项目」里打开一个仓库。</p>}
      {props.error !== null && <pre className="problem" data-testid="requirement-problems">{props.error}</pre>}

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

          <aside className="detail lg-glass-card" data-testid="requirement-summary">
            {active === null
              ? <p className="empty">选一条需求查看概要。</p>
              : <RequirementSummary row={active} />}
          </aside>
        </div>
      )}
    </section>
  )
}

function RequirementSummary(props: { readonly row: RequirementDocRow }): JSX.Element {
  const row = props.row
  return (
    <div className="detail-body">
      <div className="detail-head">
        <span className="mono">{row.id}</span>
        <span className="tag">{requirementStateLabel(row.state)}</span>
      </div>
      <h3>{row.title ?? row.id}</h3>
      {row.recommendation !== undefined && <p className="detail-line">推荐：{row.recommendation}</p>}
      {row.options.length > 0 && (
        <>
          <h4>候选做法</h4>
          <ul className="plain-list">
            {row.options.map(option => (
              <li key={option.name}>
                <strong>{option.name}</strong>
                <span>{option.summary}</span>
                {option.cost !== undefined && <em>{option.cost}</em>}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="detail-note">正文与讨论历史在阶段 B 接入。</p>
    </div>
  )
}
