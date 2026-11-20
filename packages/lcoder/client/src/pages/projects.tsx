/** 项目页：当前项目、新建项目入口与项目列表。 */

import { useState } from 'react'
import type { JSX } from 'react'
import { Button, Chip } from '@heroui/react'
import { FolderGit2, Plus } from 'lucide-react'
import type { Translate } from '../locale.ts'
import type { ProjectScope, WorkspaceRow } from '../workspace/use-workspaces.ts'
import { openWorkspace, pickDirectory } from '../workspace/use-workspaces.ts'

/** 项目页属性。 */
export interface ProjectsPageProps {
  readonly items: readonly WorkspaceRow[]
  readonly current: ProjectScope | null
  readonly error: string | null
  readonly t: Translate
  readonly onSelect: (workspace: WorkspaceRow) => void
  readonly onOpened: (workspace: WorkspaceRow) => void
}

/**
 * 项目页：单一「新建项目」入口，当前项目置顶的行列表。
 * @param props - 项目列表、当前项目与选中回调。
 * @returns 页面。
 */
export function ProjectsPage(props: ProjectsPageProps): JSX.Element {
  const { t } = props
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const createProject = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    let opened: WorkspaceRow | null = null
    try {
      const picked = await pickDirectory(props.current?.path)
      if (picked !== null) {
        const answer = await openWorkspace(picked)
        if (!answer.ok) setFailure(t('projects.openFailed', { detail: answer.message }))
        else opened = answer.workspace
      }
    } catch (cause: unknown) {
      setFailure(t('projects.pickFailed', { detail: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setBusy(false)
    }
    if (opened !== null) props.onOpened(opened)
  }

  const rows: readonly WorkspaceRow[] = (() => {
    const current = props.items.find(item => item.workspaceId === props.current?.workspaceId)
    if (current === undefined) return props.items
    return [current, ...props.items.filter(item => item.workspaceId !== current.workspaceId)]
  })()

  return (
    <section className="page" data-testid="page-projects">
      <header className="page-head">
        <div>
          <h2>{t('projects.title')}</h2>
          <p className="page-sub">
            {props.current === null
              ? t('projects.none')
              : t('projects.current', { title: props.current.title, path: props.current.path })}
          </p>
        </div>
        <div className="page-actions">
          <Button variant="primary" data-testid="project-open" isDisabled={busy} onPress={() => { void createProject() }}>
            <Plus size={16} aria-hidden="true" /> {busy ? t('projects.newBusy') : t('projects.new')}
          </Button>
        </div>
      </header>

      {failure !== null && <p className="notice" data-testid="project-error">{failure}</p>}
      {props.error !== null && <p className="notice">{props.error}</p>}

      <ul className="project-list" data-testid="project-list">
        {rows.map((workspace) => {
          const active = workspace.workspaceId === props.current?.workspaceId
          return (
            <li key={workspace.workspaceId}>
              <button
                type="button"
                className="project-card-shell"
                data-testid="project-item"
                data-workspace-id={workspace.workspaceId}
                data-current={active ? 'true' : undefined}
                aria-current={active ? 'true' : undefined}
                onClick={() => { props.onSelect(workspace) }}
              >
                <span className="project-card-icon" aria-hidden="true"><FolderGit2 /></span>
                <span className="project-card-body">
                  <span className="project-card-head">
                    <span className="project-title">{workspace.title}</span>
                    {active && <Chip size="sm" variant="soft" color="accent">{t('projects.currentBadge')}</Chip>}
                  </span>
                  <span className="project-path">{workspace.path}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {rows.length === 0 && <p className="empty" data-testid="project-empty">{t('projects.empty')}</p>}
    </section>
  )
}
