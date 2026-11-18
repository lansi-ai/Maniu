/** 项目页：项目列表、当前标记、打开仓库。 */

import { useState } from 'react'
import type { JSX } from 'react'
import { Button, Card, Input } from '@heroui/react'
import { FolderGit2 } from 'lucide-react'
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

      <Card className="project-open">
        <Card.Header className="project-open-head">
          <span className="project-open-icon" aria-hidden="true"><FolderGit2 /></span>
          <Card.Title>打开仓库</Card.Title>
        </Card.Header>
        <Card.Content className="project-open-body">
          <div className="project-open-row">
            <Input
              id="project-path"
              data-testid="project-path"
              value={path}
              placeholder="输入仓库绝对路径"
              aria-label="打开仓库"
              variant="secondary"
              onChange={(event) => { setPath(event.target.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter') void submit() }}
            />
            <Button variant="secondary" data-testid="project-browse" onPress={() => { void browse() }}>浏览…</Button>
            <Button variant="primary" data-testid="project-open" isDisabled={busy} onPress={() => { void submit() }}>
              {busy ? '打开中…' : '打开'}
            </Button>
          </div>
          {failure !== null && <p className="notice" data-testid="project-error">{failure}</p>}
          {props.error !== null && <p className="notice">{props.error}</p>}
        </Card.Content>
      </Card>

      <ul className="project-list" data-testid="project-list">
        {props.items.map((workspace) => {
          const active = workspace.workspaceId === props.current?.workspaceId
          return (
            <li key={workspace.workspaceId}>
              <button
                type="button"
                className="project-card-shell"
                data-testid="project-item"
                data-workspace-id={workspace.workspaceId}
                aria-current={active ? 'true' : undefined}
                onClick={() => { props.onSelect(workspace) }}
              >
                <Card className={active ? 'project-card active' : 'project-card'}>
                  <span className="project-card-head">
                    <span className="project-card-icon" aria-hidden="true"><FolderGit2 /></span>
                    <span className="project-title">{workspace.title}</span>
                  </span>
                  <span className="project-path">{workspace.path}</span>
                  <span className="project-meta">{workspace.sessionIds.length} 个会话</span>
                </Card>
              </button>
            </li>
          )
        })}
      </ul>
      {props.items.length === 0 && <p className="empty" data-testid="project-empty">还没有登记过项目。输入路径打开一个仓库。</p>}
    </section>
  )
}
