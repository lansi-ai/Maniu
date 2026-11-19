// @vitest-environment jsdom
/** T-238：需求表的创建时间与操作列，按状态给评审、改稿、拆分与查看任务。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RequirementsPage } from '../src/pages/requirements.tsx'
import type { RequirementDocRow, TaskRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

function task(overrides: Partial<TaskRow> & { readonly id: string; readonly title: string }): TaskRow {
  return {
    description: '',
    attachments: [],
    state: 'drafting',
    grade: 'B',
    rules: [],
    evidence: [],
    dependsOn: [],
    paths: [],
    irreversible: [],
    ...overrides,
  }
}

const DRAFT: RequirementDocRow = {
  id: 'REQ-01',
  title: '草稿需求',
  text: '草稿正文',
  state: 'draft',
  options: [],
  versions: [],
  reviews: [{ round: 1, at: '2026-11-17T10:00:00+08:00', report: 'requirements/REQ-01/reviews/R1.md', decision: 'rejected' }],
  openedAt: '2026-11-16T09:00:00+08:00',
}

const CONFIRMED_EMPTY: RequirementDocRow = {
  id: 'REQ-02',
  title: '待拆分需求',
  text: '已确认正文',
  state: 'confirmed',
  options: [],
  versions: [],
  reviews: [],
  openedAt: '2026-11-15T09:00:00+08:00',
}

const CONFIRMED_TASKED: RequirementDocRow = {
  id: 'REQ-03',
  title: '已拆需求',
  text: '已拆正文',
  state: 'confirmed',
  options: [],
  versions: [],
  reviews: [],
}

function projectionOf(requirements: readonly RequirementDocRow[], tasks: readonly TaskRow[]): SpecProjection {
  return {
    tasks,
    rules: [],
    contracts: [],
    proposals: [],
    requirements,
    groups: [],
    roles: [],
    project: null,
    secrets: {},
    automation: null,
    agents: null,
    problems: [],
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

function element(testId: string): Element | null {
  return container.querySelector(`[data-testid="${testId}"]`)
}

async function press(testId: string): Promise<void> {
  const node = element(testId)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

interface StartCall {
  readonly prompt: string
  readonly preset?: string
}

function renderPage(
  projection: SpecProjection,
  calls: StartCall[],
  onOpenTasks: (id: string) => void = () => {},
): void {
  act(() => {
    root.render(
      <RequirementsPage
        project={PROJECT}
        projection={projection}
        sessions={[]}
        loading={false}
        error={null}
        intakeResult={null}
        onClearIntakeResult={() => {}}
        onReload={() => {}}
        onStartIntake={async () => ({ ok: true, message: 'ok' })}
        onStartSession={async (prompt, preset) => {
          calls.push(preset === undefined ? { prompt } : { prompt, preset })
          return { ok: true, message: 'ok' }
        }}
        onOpenSession={() => {}}
        onOpenTasks={onOpenTasks}
      />,
    )
  })
}

describe('需求表列', () => {
  it('去掉候选与推荐列，补创建时间与操作列', () => {
    renderPage(projectionOf([DRAFT, CONFIRMED_TASKED], []), [])
    const heads = [...container.querySelectorAll('thead th')].map(node => node.textContent)
    expect(heads).toEqual(['编号', '标题', '状态', '创建时间', '操作'])
    const opened = [...container.querySelectorAll('tbody tr')]
      .map(row => row.children[3]?.textContent)
    expect(opened).toEqual(['2026-11-16', '—'])
  })
})

describe('需求表操作分支', () => {
  it('草稿行给评审与修改需求，点击评审不打开详情', async () => {
    const calls: StartCall[] = []
    renderPage(projectionOf([DRAFT], []), calls)

    expect(element('requirement-op-review')).not.toBeNull()
    expect(element('requirement-op-revise')).not.toBeNull()
    expect(element('requirement-op-split')).toBeNull()

    await press('requirement-op-review')
    expect(element('requirement-detail')).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.preset).toBe('maniu-pm')
    expect(calls[0]?.prompt).toContain('需求评审：请对需求 REQ-01（草稿需求）')
    expect(calls[0]?.prompt).toContain('文档完备性')
    expect(calls[0]?.prompt).toContain('合理性')
    expect(calls[0]?.prompt).toContain('需求角度')
    expect(calls[0]?.prompt).toContain('技术实现角度')
    expect(calls[0]?.prompt).toContain('requirement_review_draft')
    expect(calls[0]?.prompt).toContain('不改需求正文')
  })

  it('修改需求交给需求分析师，带编号、标题、正文与最近评审报告', async () => {
    const calls: StartCall[] = []
    renderPage(projectionOf([DRAFT], []), calls)

    await press('requirement-op-revise')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.preset).toBe('maniu-intake')
    expect(calls[0]?.prompt).toContain('需求改稿：请修订需求 REQ-01（草稿需求）')
    expect(calls[0]?.prompt).toContain('草稿正文')
    expect(calls[0]?.prompt).toContain('.spec/requirements/REQ-01/reviews/R1.md')
    expect(calls[0]?.prompt).toContain('requirement_revise')
    expect(calls[0]?.prompt).toContain('不改状态')
  })

  it('已过审且没有关联任务时给拆分，交给研发经理', async () => {
    const calls: StartCall[] = []
    renderPage(projectionOf([CONFIRMED_EMPTY], []), calls)

    expect(element('requirement-op-tasks')).toBeNull()
    await press('requirement-op-split')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.preset).toBe('maniu-manager')
    expect(calls[0]?.prompt).toContain('需求拆分：请把需求 REQ-02（待拆分需求）')
    expect(calls[0]?.prompt).toContain('requirement_split_plan')
    expect(calls[0]?.prompt).toContain('不分配岗位')
  })

  it('已有关联任务时给查看任务，不改发会话', async () => {
    const calls: StartCall[] = []
    const opened: string[] = []
    renderPage(
      projectionOf([CONFIRMED_TASKED], [task({ id: 'T-01', title: '实施任务', requirement: 'REQ-03' })]),
      calls,
      (id) => { opened.push(id) },
    )

    expect(element('requirement-op-split')).toBeNull()
    await press('requirement-op-tasks')
    expect(opened).toEqual(['REQ-03'])
    expect(calls).toHaveLength(0)
    expect(element('requirement-detail')).toBeNull()
  })
})
