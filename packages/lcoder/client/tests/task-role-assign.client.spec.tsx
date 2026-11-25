// @vitest-environment jsdom
/** T-330：任务负责人胶囊只显示人名，点开是人物名片，可原地切到改派、添人与建岗。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseRoleIdentity, roleLabel, roleTitleOf, ruleTitleOf } from '../src/spec/board.ts'
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
  {
    id: 'fe-dev',
    name: '前端工程师-林夕',
    inherits: 'dev',
    persona: '负责前端页面与交互实现。',
    derivedFrom: '系统岗位库',
    signals: { strong: ['React', 'TypeScript'], medium: [], preferredPaths: ['packages/lcoder/client'] },
  },
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

describe('纯中文岗位名与人物名片解析', () => {
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

  it('把岗位名拆成人名与岗位名，并透传名册字段', () => {
    expect(parseRoleIdentity('fe-dev', ROLES)).toEqual({
      roleTitle: '前端工程师',
      personName: '林夕',
      displayName: '林夕',
      persona: '负责前端页面与交互实现。',
      derivedFrom: '系统岗位库',
      signals: { strong: ['React', 'TypeScript'], medium: [], preferredPaths: ['packages/lcoder/client'] },
    })
    expect(parseRoleIdentity('dev')).toEqual({ roleTitle: '开发工程师', displayName: '开发工程师' })
    expect(parseRoleIdentity('unknown-id', ROLES)).toEqual({})
    expect(parseRoleIdentity(undefined, ROLES)).toEqual({})
    expect(parseRoleIdentity('no-sep', [{ id: 'no-sep', name: '测试工程师' }]))
      .toEqual({ roleTitle: '测试工程师', displayName: '测试工程师' })
    expect(parseRoleIdentity('id-tail', [{ id: 'id-tail', name: '测试工程师-fe-dev' }]))
      .toEqual({ roleTitle: '测试工程师', displayName: '测试工程师' })
    expect(parseRoleIdentity('same', [{ id: 'same', name: '测试工程师-测试工程师' }]))
      .toEqual({ roleTitle: '测试工程师', displayName: '测试工程师' })
  })

  it('规范约束优先显示中文摘要', () => {
    expect(ruleTitleOf(RULE)).toBe('订单导出必须校验权限')
  })
})

describe('TaskDetail 负责人人物名片', () => {
  it('顶部胶囊只显示人名，没有铅笔按钮，也不泄露英文 id', () => {
    renderDetail()
    expect(container.querySelector('[data-testid="task-role-input"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-assign"]')).toBeNull()
    expect(container.querySelector('datalist')).toBeNull()
    expect(container.querySelector('input[list]')).toBeNull()
    expect(container.querySelector('[data-testid="task-assignee-edit"]')).toBeNull()
    expect(element('task-assignee-name').textContent).toBe('林夕')
    const pill = element('task-assignee-pill')
    expect(pill.tagName).toBe('BUTTON')
    expect(pill.getAttribute('aria-haspopup')).toBe('dialog')
    expect(pill.getAttribute('aria-expanded')).toBe('false')
    expect(pill.getAttribute('aria-label')).toBe('查看负责人名片：林夕')
    expect(pill.textContent).toContain('负责人')
    expect(container.textContent).not.toContain('fe-dev')
    expect(container.textContent).not.toContain('api-dev')
    expect(container.textContent).not.toContain('-林夕')
  })

  it('点胶囊先看人物名片：姓名、岗位徽标、职责、擅长范围与名下任务数', async () => {
    const data = projection({
      tasks: [
        task(),
        task({ id: 'T-02', state: 'implementing' }),
        task({ id: 'T-03', state: 'closed' }),
        task({ id: 'T-04', role: 'api-dev', state: 'closed' }),
      ],
    })
    renderDetail(data)
    await press('task-assignee-pill')
    expect(element('task-assignee-pill').getAttribute('aria-expanded')).toBe('true')
    expect(element('task-assignee-profile-name').textContent).toBe('林夕')
    expect(element('task-assignee-role-badge').textContent).toBe('前端工程师')
    expect(element('task-assignee-derived').textContent).toBe('来自 系统岗位库')
    expect(element('task-assignee-persona').textContent).toBe('负责前端页面与交互实现。')
    const skills = element('task-assignee-skills')
    expect(skills.textContent).toContain('packages/lcoder/client')
    expect(skills.textContent).toContain('React')
    expect(skills.textContent).toContain('TypeScript')
    expect(element('task-assignee-stats').textContent).toBe('名下 3 个任务 · 1 进行中 · 1 已完成')
    expect(container.querySelector('[data-testid="task-assignee-option"]')).toBeNull()
  })

  it('名片内「更换负责人」原地切到改派列表，可返回并完成改派', async () => {
    renderDetail()
    await press('task-assignee-pill')
    await press('task-assignee-change')
    expect(container.querySelector('[data-testid="task-assignee-profile"]')).toBeNull()
    expect(element('task-assignee-picker')).not.toBeNull()
    expect(element('task-assignee-back')).not.toBeNull()
    const options = [...container.querySelectorAll<HTMLElement>('[data-testid="task-assignee-option"]')]
    expect(options.map(node => node.getAttribute('data-role-id'))).toEqual(['fe-dev', 'api-dev'])
    expect(options.map(node => node.textContent)).toEqual(['林夕前端工程师', '陈默接口工程师'])
    expect(container.textContent).not.toContain('fe-dev')
    expect(container.querySelector('[data-role-id="fe-dev"] [data-testid="task-assignee-current"]')).not.toBeNull()
    await press('task-assignee-back')
    expect(element('task-assignee-profile')).not.toBeNull()
    await press('task-assignee-change')
    const currentOptions = [...container.querySelectorAll<HTMLElement>('[data-testid="task-assignee-option"]')]
    await act(async () => {
      currentOptions[1]?.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(commandLines()).toEqual(['/task_assign T-01 api-dev'])
    expect(container.querySelector('[data-testid="task-assignee-popover"]')).toBeNull()
  })

  it('从人才库选岗位添人时先写名册再分配', async () => {
    renderDetail()
    await press('task-assignee-pill')
    await press('task-assignee-change')
    await press('task-assignee-from-talent')
    const option = container.querySelector<HTMLElement>('[data-testid="task-assignee-talent-option"][data-role-title="测试工程师"]')
    expect(option?.textContent).toBe('测试工程师')
    await act(async () => { option?.click(); await Promise.resolve(); await Promise.resolve() })
    expect(commandLines()).toEqual([
      '/role_upsert {"id":"role-1","name":"测试工程师-成员1","inherits":"dev"}',
      '/task_assign T-01 role-1',
    ])
  })

  it('新建项目岗位按建岗、添人、分配串行执行，scope 固定为 project', async () => {
    renderDetail()
    await press('task-assignee-pill')
    await press('task-assignee-change')
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

  it('未分配时胶囊直接进改派列表，没有名片与返回入口', async () => {
    renderDetail(projection(), task({ role: undefined }))
    expect(element('task-assignee-name').textContent).toBe('待指定')
    expect(container.querySelector('.task-assignee-avatar')).toBeNull()
    expect(element('task-assignee-pill').getAttribute('aria-label')).toBe('指定负责人')
    await press('task-assignee-pill')
    expect(element('task-assignee-picker')).not.toBeNull()
    expect(container.querySelector('[data-testid="task-assignee-profile"]')).toBeNull()
    expect(container.querySelector('[data-testid="task-assignee-back"]')).toBeNull()
    const options = [...container.querySelectorAll<HTMLElement>('[data-testid="task-assignee-option"]')]
    expect(options.map(node => node.textContent)).toEqual(['林夕前端工程师', '陈默接口工程师'])
  })

  it('负责人胶囊只显示人名，头像只在名片里保留', async () => {
    renderDetail()
    expect(element('task-assignee-name').textContent).toBe('林夕')
    expect(container.querySelector('.task-assignee-avatar')).toBeNull()

    await press('task-assignee-pill')
    expect(element('task-assignee-profile')).not.toBeNull()
    expect(container.querySelectorAll('.task-assignee-avatar.is-large')).toHaveLength(1)
  })

  it('点外部或按 Esc 收起浮卡，任务详情抽屉保持打开', async () => {
    renderDetail()
    await press('task-assignee-pill')
    expect(element('task-assignee-profile')).not.toBeNull()
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="task-assignee-popover"]')).toBeNull()
    expect(element('task-detail')).not.toBeNull()

    await press('task-assignee-pill')
    expect(element('task-assignee-profile')).not.toBeNull()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[data-testid="task-assignee-popover"]')).toBeNull()
    expect(element('task-detail')).not.toBeNull()
  })

  it('存量任务没有 role 时用 splitPlan 建议岗位展示并自动分配后推进', async () => {
    const data = projection({
      requirements: [{
        id: 'REQ-01', text: '', options: [], versions: [], reviews: [],
        splitPlan: { at: '2026-01-01T00:00:00.000Z', entries: [{ task: 'T-01', role: 'api-dev', reason: '接口' }] },
      }],
    })
    renderDetail(data, task({ role: undefined, requirement: 'REQ-01' }))
    expect(element('task-assignee-name').textContent).toBe('陈默')
    await press('task-confirm-advance')
    const start = document.body.querySelector<HTMLElement>('[data-testid="task-advance-confirm-start"]')
    expect(start).not.toBeNull()
    expect(start?.textContent).toContain('确认开始')
    await act(async () => {
      start!.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(commandLines()).toEqual(['/task_assign T-01 api-dev', '/task_split_ready T-01'])
  })
})
