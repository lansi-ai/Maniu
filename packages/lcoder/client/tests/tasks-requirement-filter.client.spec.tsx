// @vitest-environment jsdom
/** T-238：从需求跳到任务页后只显示该需求关联任务，胶囊与清除可见。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TasksPage } from '../src/pages/tasks.tsx'
import type { TaskRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

function task(id: string, requirement?: string): TaskRow {
  return {
    id,
    title: `任务 ${id}`,
    description: '',
    attachments: [],
    state: 'drafting',
    grade: 'B',
    rules: [],
    evidence: [],
    dependsOn: [],
    paths: [],
    irreversible: [],
    ...(requirement === undefined ? {} : { requirement }),
  }
}

const PROJECTION: SpecProjection = {
  tasks: [task('T-01', 'REQ-01'), task('T-02', 'REQ-02'), task('T-03')],
  rules: [],
  contracts: [],
  proposals: [],
  requirements: [],
  groups: [],
  roles: [],
  project: null,
  secrets: {},
  automation: null,
  agents: null,
  problems: [],
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
  await act(async () => { (node as HTMLElement).click() })
}

function renderPage(requirementFilter: string | null, onClear: () => void = () => {}): void {
  act(() => {
    root.render(
      <TasksPage
        project={PROJECT}
        projection={PROJECTION}
        sessions={[]}
        loading={false}
        error={null}
        onReload={() => {}}
        requirementFilter={requirementFilter}
        onClearRequirementFilter={onClear}
      />,
    )
  })
}

function ids(testId: string, attribute: string): string[] {
  return [...container.querySelectorAll(`[data-testid="${testId}"]`)]
    .map(node => node.getAttribute(attribute) ?? '')
}

describe('任务页需求过滤', () => {
  it('看板与列表都只显示该需求关联任务', async () => {
    renderPage('REQ-01')
    expect(ids('task-card', 'data-task-id')).toEqual(['T-01'])

    await press('task-view-list')
    expect(ids('task-row', 'data-task-id')).toEqual(['T-01'])
  })

  it('顶部显示需求胶囊与清除按钮，清除回调可恢复全量', async () => {
    const clear = vi.fn()
    renderPage('REQ-01', clear)
    expect(element('task-requirement-filter')?.textContent).toContain('需求 REQ-01')

    await press('task-requirement-filter-clear')
    expect(clear).toHaveBeenCalledTimes(1)

    renderPage(null)
    expect(element('task-requirement-filter')).toBeNull()
    expect(ids('task-card', 'data-task-id')).toEqual(['T-01', 'T-02', 'T-03'])
  })
})
