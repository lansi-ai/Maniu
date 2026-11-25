// @vitest-environment jsdom
/** T-325：任务负责人只显示中文岗位名，顶部铅笔在抽屉内闭环改派、添人与建岗。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { roleLabel, roleTitleOf, ruleTitleOf } from '../src/spec/board.ts'
import type { RuleRow, TaskRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'
import { TaskDetail } from '../src/pages/task-detail.tsx'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const RULE: RuleRow = { id: 'R-01', module: 'order', kind: 'behavior', status: 'confirmed', text: '订单导出必须校验权限\n细则见正文。' }

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'T-01',
    title: '订单导出',
    description: '',
    attachments: [],
    state: 'drafting',
    grade: 'B',
    rules: ['R-01'],
    evidence: [],
    dependsOn: [],
    paths: [],
    irreversible: [],
    role: 'fe-dev',
    ...overrides,
  }
}

const ROLES = [
  { id: 'fe-dev', name: '前端工程师-林夕', inherits: 'dev' },
  { id: 'api-dev', name: '接口工程师-陈默', inherits: 'dev' },
]

function projection(overrides: Partial<SpecProjection> = {}): SpecProjection {
  return {
    tasks: [task()],
    rules: [RULE],
    contracts: [],
    proposals: [],
    requirements: [],
    groups: [],
    roles: ROLES,
    project: null,
    secrets: {},
    automation: null,
    agents: null,
    problems: [],
    ...overrides,
  }
}

const TALENT = {
  id: 'talent-qa',
  scope: 'project',
  projectId: 'project-1',
  ownerUserId: 'owner-1',
  createdBy: 'user',
  name: '测试工程师',
  description: '负责验收',
  config: { version: 1, basePreset: 'maniu-dev' },
  revision: 1,
  canManage: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

let container: HTMLDivElement
let root: Root
let calls: { namespace: string; method: string; args: unknown }[]

function mockCall(namespace: string, method: string, args: unknown): Promise<unknown> {
  calls.push({ namespace, method, args })
  if (namespace === 'agentTalents' && method === 'projectIdentity') {
    return Promise.resolve({ ok: true, value: { state: 'ready', projectId: 'project-1' } })
  }
  if (namespace === 'agentPresets' && method === 'list') {
    return Promise.resolve({ ok: true, value: { presets: [{ id: 'maniu-dev', name: '开发工程师', isDefault: false }] } })
  }
  if (namespace === 'lcoderCloud' && method === 'talents') {
    return Promise.resolve({ ok: true, value: { ok: true, value: { items: [TALENT] } } })
  }
  if (namespace === 'lcoderCloud' && method === 'createTalent') {
    return Promise.resolve({ ok: true, value: { ok: true, value: TALENT } })
  }
  if (namespace === 'commands' && method === 'execute') {
    return Promise.resolve({ ok: true, value: { result: { kind: 'success', text: 'ok' } } })
  }
  return Promise.resolve({ ok: false, error: { code: 'unexpected', message: `${namespace}.${method}` } })
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  calls = []
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: { call: vi.fn(mockCall) },
  })
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

function element(testId: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  expect(node).not.toBeNull()
  return node as HTMLElement
}

async function press(testId: string): Promise<void> {
  const node = element(testId)
  await act(async () => {
    node.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function renderDetail(data: SpecProjection = projection(), current = task()): void {
  act(() => {
    root.render(
      <TaskDetail
        task={current}
        projection={data}
        project={PROJECT}
        sessions={[]}
        onClose={() => {}}
        onOpenDoc={() => {}}
        onReload={() => {}}
      />,
    )
  })
}

function commandLines(): string[] {
  return calls
    .filter(call => call.namespace === 'commands' && call.method === 'execute')
    .map(call => (call.args as { line: string }).line)
}

describe('纯中文岗位名', () => {
  it('剥掉人名后缀，英文岗位 id 不进入界面', () => {
    expect(roleTitleOf('前端工程师-林夕')).toBe('前端工程师')
    expect(roleTitleOf('接口工程师—陈默')).toBe('接口工程师')
    expect(roleTitleOf('测试工程师·苏晴')).toBe('测试工程师')
    expect(roleTitleOf('测试工程师|苏晴')).toBe('测试工程师')
    expect(roleTitleOf('fe-dev')).toBeUndefined()
    expect(roleLabel('fe-dev', ROLES)).toBe('前端工程师')
    expect(roleLabel('unknown-id', ROLES)).toBeUndefined()
    expect(roleLabel('dev', ROLES)).toBe('开发工程师')
  })

  it('规范约束优先显示中文摘要', () => {
    expect(ruleTitleOf(RULE)).toBe('订单导出必须校验权限')
  })
})

describe('TaskDetail 负责人改派', () => {
  it('主操作区没有大输入框与 datalist，顶部只有中文岗位名与铅笔', () => {
    renderDetail()
    expect(container.querySelector('[data-testid="task-role-input"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-assign"]')).toBeNull()
    expect(container.querySelector('datalist')).toBeNull()
    expect(container.querySelector('input[list]')).toBeNull()
    expect(element('task-assignee-name').textContent).toBe('前端工程师')
    expect(element('task-assignee-edit').getAttribute('aria-label')).toBe('更改负责人')
    expect(element('task-rules').textContent).toContain('订单导出必须校验权限')
    expect(element('task-rules').textContent).not.toContain('R-01')
    expect(element('task-confirm-advance')).not.toBeNull()
  })

  it('存量任务没有 role 时用 splitPlan 建议岗位展示并自动分配后推进', async () => {
    const data = projection({
      requirements: [{
        id: 'REQ-01', text: '', options: [], versions: [], reviews: [],
        splitPlan: { at: '2026-01-01T00:00:00.000Z', entries: [{ task: 'T-01', role: 'api-dev', reason: '接口' }] },
      }],
    })
    renderDetail(data, task({ role: undefined, requirement: 'REQ-01' }))
    expect(element('task-assignee-name').textContent).toBe('接口工程师')
    await press('task-confirm-advance')
    expect(commandLines()).toEqual(['/task_assign T-01 api-dev', '/task_split_ready T-01'])
  })

  it('铅笔浮层列出办公室中文岗位，点选即分配并收起', async () => {
    renderDetail()
    await press('task-assignee-edit')
    const options = [...container.querySelectorAll<HTMLElement>('[data-testid="task-assignee-option"]')]
    expect(options.map(node => node.textContent)).toEqual(['前端工程师', '接口工程师'])
    expect(container.textContent).not.toContain('fe-dev')
    expect(container.textContent).not.toContain('-林夕')
    await act(async () => { options[1]?.click(); await Promise.resolve(); await Promise.resolve() })
    expect(commandLines()).toEqual(['/task_assign T-01 api-dev'])
    expect(container.querySelector('[data-testid="task-assignee-popover"]')).toBeNull()
  })

  it('从人才库选岗位添人时先写名册再分配', async () => {
    renderDetail()
    await press('task-assignee-edit')
    await press('task-assignee-from-talent')
    const option = container.querySelector<HTMLElement>('[data-testid="task-assignee-talent-option"][data-role-title="测试工程师"]')
    expect(option?.textContent).toBe('测试工程师')
    await act(async () => { option?.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(commandLines()).toEqual([
      '/role_upsert {"id":"role-1","name":"测试工程师-成员1","inherits":"dev"}',
      '/task_assign T-01 role-1',
    ])
  })

  it('新建项目岗位按建岗、添人、分配串行执行，scope 固定为 project', async () => {
    renderDetail()
    await press('task-assignee-edit')
    await press('task-assignee-create-toggle')
    const name = element('task-assignee-new-name') as HTMLInputElement
    const duty = element('task-assignee-new-duty') as HTMLTextAreaElement
    // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 必须绑定原型再调用。
    const nameSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 必须绑定原型再调用。
    const dutySetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await act(async () => {
      nameSetter?.call(name, '性能工程师')
      name.dispatchEvent(new Event('input', { bubbles: true }))
      dutySetter?.call(duty, '负责性能指标')
      duty.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await press('task-assignee-create-submit')
    const create = calls.find(call => call.namespace === 'lcoderCloud' && call.method === 'createTalent')
    expect(create).toBeDefined()
    const input = (create?.args as { input: { scope: string; projectId: string } }).input
    expect(input.scope).toBe('project')
    expect(input.projectId).toBe('project-1')
    expect(commandLines()).toEqual([
      '/role_upsert {"id":"role-1","name":"性能工程师-成员1","inherits":"dev"}',
      '/task_assign T-01 role-1',
    ])
    expect(container.querySelector('[data-testid="task-assignee-popover"]')).toBeNull()
  })
})
