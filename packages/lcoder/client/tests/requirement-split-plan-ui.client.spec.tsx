// @vitest-environment jsdom
/** T-240：拆分岗位建议表逐条确认执行 `/task_assign`，忽略只在本界面跳过，失败可见。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequirementDetail } from '../src/pages/requirement-detail.tsx'
import type { RequirementDocRow, TaskRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

function task(id: string, title: string): TaskRow {
  return {
    id,
    title,
    description: '',
    attachments: [],
    state: 'drafting',
    grade: 'B',
    rules: [],
    evidence: [],
    dependsOn: [],
    paths: [],
    irreversible: [],
    requirement: 'REQ-01',
    openedAt: '2026-11-17T13:00:00+08:00',
  }
}

const ROW: RequirementDocRow = {
  id: 'REQ-01',
  title: '佣金改造',
  text: '需求正文',
  state: 'confirmed',
  options: [],
  versions: [],
  reviews: [],
  splitPlan: {
    at: '2026-11-17T15:00:00+08:00',
    entries: [
      { task: 'T-01', role: 'vue', reason: '页面交互' },
      { task: 'T-02', role: 'dev' },
    ],
  },
}

function projectionOf(roles: SpecProjection['roles'] = [{ id: 'vue', name: 'Vue 工程师', inherits: 'dev' }]): SpecProjection {
  return {
    tasks: [task('T-01', '需求页'), task('T-02', '接口')],
    rules: [],
    contracts: [],
    proposals: [],
    requirements: [ROW],
    groups: [],
    roles,
    project: null,
    secrets: {},
    automation: null,
    agents: null,
    problems: [],
  }
}

function mockCommand(result: unknown): ReturnType<typeof vi.fn> {
  const call = vi.fn(async () => result)
  Object.defineProperty(window, 'lcoder', { configurable: true, value: { call } })
  return call
}

const SUCCESS = { ok: true, value: { result: { kind: 'success', text: 'T-01 已分配给岗位「Vue 工程师」（vue）' } } }
const FAILURE = { ok: true, value: { result: { kind: 'error', text: '岗位 vue 不认识：名册里没有，也不是内置角色' } } }

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
  Reflect.deleteProperty(window, 'lcoder')
})

function element(testId: string): Element | null {
  return container.querySelector(`[data-testid="${testId}"]`)
}

function renderDetail(calls: { readonly reload: () => void; readonly openTasks: () => void }): void {
  act(() => {
    root.render(
      <RequirementDetail
        row={ROW}
        project={PROJECT}
        projection={projectionOf()}
        sessions={[]}
        onClose={() => {}}
        onOpenTask={() => {}}
        onOpenReader={() => {}}
        onReload={calls.reload}
        onSplit={async () => ({ ok: true, message: 'ok' })}
        onRevise={async () => ({ ok: true, message: 'ok' })}
        onOpenTasks={calls.openTasks}
      />,
    )
  })
}

async function press(node: Element | null): Promise<void> {
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('拆分岗位建议表', () => {
  it('列出任务编号与标题、建议岗位与理由', () => {
    mockCommand(SUCCESS)
    renderDetail({ reload: () => {}, openTasks: () => {} })

    const rows = container.querySelectorAll('[data-testid="requirement-split-plan-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('T-01')
    expect(rows[0]?.textContent).toContain('需求页')
    expect(rows[0]?.textContent).toContain('Vue 工程师（vue）')
    expect(rows[0]?.textContent).toContain('页面交互')
    expect(rows[1]?.textContent).toContain('T-02')
    expect(rows[1]?.textContent).toContain('dev')
    expect(container.querySelectorAll('[data-testid="requirement-split-plan-confirm"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-testid="requirement-split-plan-ignore"]')).toHaveLength(2)
  })

  it('确认执行 /task_assign，成功显示回执并刷新；忽略不写盘；全部处理后提示去任务页', async () => {
    const call = mockCommand(SUCCESS)
    const reload = vi.fn()
    const openTasks = vi.fn()
    renderDetail({ reload, openTasks })

    await press(element('requirement-split-plan-confirm'))
    expect(call).toHaveBeenCalledWith('commands', 'execute', {
      agentId: 'session-scope',
      line: '/task_assign T-01 vue',
      submittedAttachments: [],
    })
    const assigned = container.querySelector('[data-testid="requirement-split-plan-row"][data-task-id="T-01"] [data-testid="requirement-split-plan-status"]')
    expect(assigned?.getAttribute('data-ok')).toBe('true')
    expect(assigned?.textContent).toContain('已分配')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(element('requirement-split-plan-done')).toBeNull()

    await press(container.querySelector('[data-testid="requirement-split-plan-ignore"][data-task-id="T-02"]'))
    expect(call).toHaveBeenCalledTimes(1)
    const ignored = container.querySelector('[data-testid="requirement-split-plan-row"][data-task-id="T-02"] [data-testid="requirement-split-plan-status"]')
    expect(ignored?.getAttribute('data-ok')).toBe('ignored')
    expect(ignored?.textContent).toContain('已忽略')

    expect(element('requirement-split-plan-done')).not.toBeNull()
    await press(element('requirement-split-plan-tasks'))
    expect(openTasks).toHaveBeenCalledTimes(1)
  })

  it('命令失败时显示失败原因，不静默也不提示完成，可重试', async () => {
    mockCommand(FAILURE)
    const reload = vi.fn()
    renderDetail({ reload, openTasks: () => {} })

    await press(element('requirement-split-plan-confirm'))
    const failed = container.querySelector('[data-testid="requirement-split-plan-row"][data-task-id="T-01"] [data-testid="requirement-split-plan-status"]')
    expect(failed?.getAttribute('data-ok')).toBe('false')
    expect(failed?.textContent).toContain('岗位 vue 不认识')
    expect(reload).not.toHaveBeenCalled()
    expect(element('requirement-split-plan-done')).toBeNull()
    expect(container.querySelector('[data-testid="requirement-split-plan-retry"][data-task-id="T-01"]')).not.toBeNull()
  })
})
