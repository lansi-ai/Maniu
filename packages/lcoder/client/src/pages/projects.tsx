/** 项目页：项目列表、当前标记、打开仓库。 */

import { useState } from 'react'
import type { JSX } from 'react'
import type { ProjectScope, WorkspaceRow } from '../workspace/use-workspaces.ts'
import { openWorkspace, pickDirectory } from '../workspace/use-workspaces.ts'

/** 项目页属性。 */
export interface ProjectsPageProps {
  readonly items: readonly WorkspaceRow[]
  readonly current: ProjectScope | null
  readonly error: string | null
  readonly onSelect: (workspace: WorkspaceRow) => void
  readonly onOpened: (workspace: WorkspaceRow) => void
}

/**
 * 项目页。
 * @param props - 项目列表与选中回调。
 * @returns 页面。
 */
export function ProjectsPage(props: ProjectsPageProps): JSX.Element {
  const [path, setPath] = useState(props.current?.path ?? '')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const browse = async (): Promise<void> => {
    try {
      const entered = path.trim()
      const picked = await pickDirectory(entered === '' ? props.current?.path : entered)
      if (picked !== null) {
        setPath(picked)
        setFailure(null)
      }
    } catch (cause: unknown) {
      setFailure(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const submit = async (): Promise<void> => {
    const target = path.trim()
    if (target === '' || busy) return
    setBusy(true)
    setFailure(null)
    try {
      const answer = await openWorkspace(target)
      if (!answer.ok) {
        setFailure(answer.message)
        return
      }
      props.onOpened(answer.workspace)
    } catch (cause: unknown) {
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page" data-testid="page-projects">
      <header className="page-head">
        <div>
          <h2>切换项目</h2>
          <p className="page-sub">当前：{props.current === null ? '未选择项目' : `${props.current.title}（${props.current.path}）`}</p>
        </div>
      </header>

      <div className="project-open">
        <label className="field-label" htmlFor="project-path">打开仓库</label>
        <div className="project-open-row">
          <input
            id="project-path"
            data-testid="project-path"
            value={path}
            placeholder="输入仓库绝对路径"
            onChange={(event) => { setPath(event.target.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter') void submit() }}
          />
          <button type="button" className="pill" data-testid="project-browse" onClick={() => { void browse() }}>浏览…</button>
          <button type="button" className="pill pill-accent" data-testid="project-open" disabled={busy} onClick={() => { void submit() }}>
            {busy ? '打开中…' : '打开'}
          </button>
        </div>
        {failure !== null && <p className="notice" data-testid="project-error">{failure}</p>}
        {props.error !== null && <p className="notice">{props.error}</p>}
      </div>

      <ul className="project-list" data-testid="project-list">
        {props.items.map(workspace => (
          <li key={workspace.workspaceId}>
            <button
              type="button"
              className={workspace.workspaceId === props.current?.workspaceId ? 'project-card active' : 'project-card'}
              data-testid="project-item"
              data-workspace-id={workspace.workspaceId}
              onClick={() => { props.onSelect(workspace) }}
            >
              <span className="project-title">{workspace.title}</span>
              <span className="project-path">{workspace.path}</span>
              <span className="project-meta">{workspace.sessionIds.length} 个会话</span>
            </button>
          </li>
        ))}
      </ul>
      {props.items.length === 0 && <p className="empty" data-testid="project-empty">还没有登记过项目。输入路径打开一个仓库。</p>}
    </section>
  )
}
