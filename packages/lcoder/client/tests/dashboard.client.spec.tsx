// @vitest-environment jsdom
/**
 * T-324：总览 Dashboard 作为默认主页。
 *
 * 覆盖四种主行动分支与唯一主行动、进度漏斗带筛选跳转、活原型入口、
 * 左侧导航上下分层与 `project-info` 不再占一级入口。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/app.tsx'
import { DashboardPage, type DashboardPageProps } from '../src/pages/dashboard.tsx'
import type { UnaryCall } from '../src/prototype/remote.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { RequirementDocRow, TaskRow } from '../src/spec/rows.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'
import { translate, type Translate } from '../src/locale.ts'

const zh: Translate = (key, params) => translate('zh', key, params)

const PROJECT_KEY = 'lcoder.m2.project'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const HTML = '<!doctype html><html><body><h1>项目原型</h1></body></html>'

function requirement(id: string, state: 'draft' | 'confirmed', overrides: Partial<RequirementDocRow> = {}): RequirementDocRow {
  return {
    id,
    title: `${id} 标题`,
    text: '# 正文',
    state,
    options: [],
    versions: [],
    reviews: [],
    ...overrides,
  }
}

function task(id: string, state: string, title = `${id} 标题`): TaskRow {
  return {
    id,
    title,
    description: '',
    attachments: [],
    state,
    grade: 'A',
    rules: [],
    evidence: [],
    dependsOn: [],
    paths: [],
    irreversible: [],
  }
}

function projectionOf(requirements: readonly RequirementDocRow[], tasks: readonly TaskRow[] = []): SpecProjection {
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
    flow: null,
    problems: [],
  }
}

interface StagedView {
  readonly staged: null | {
    readonly requirementId: string
    readonly html: string
    readonly changeKind: 'visual'
    readonly summary: readonly string[]
    readonly changedDomPaths: readonly string[]
    readonly createdAt: string
  }
  readonly committedHtml: string | null
}

/** 只回答总览页用到的两条原型 Remote；其余返回空对象。 */
function prototypeCall(view: StagedView): UnaryCall {
  return vi.fn(async (namespace: string, method: string) => {
    if (namespace === 'prototype' && method === 'getStaged') {
      return { ok: true as const, value: { staged: view.staged, committedHtml: view.committedHtml } }
    }
    if (namespace === 'prototype' && method === 'listSnapshots') {
      return { ok: true as const, value: { snapshots: [] } }
    }
    return { ok: true as const, value: {} }
  })
}

const EMPTY_VIEW: StagedView = { staged: null, committedHtml: null }

function dashboardProps(overrides: Partial<DashboardPageProps> = {}): DashboardPageProps {
  return {
    t: zh,
    project: PROJECT,
    projection: projectionOf([]),
    loading: false,
    error: null,
    onReload: vi.fn(),
    requirementIds: [],
    onSwitchProject: vi.fn(),
    onOpenRequirements: vi.fn(),
    onOpenTasks: vi.fn(),
    onOpenPrototype: vi.fn(),
    onOpenChat: vi.fn(),
    onStartIntake: vi.fn(),
    onOpenRequirement: vi.fn(),
    call: prototypeCall(EMPTY_VIEW),
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  // HeroUI Modal 的 react-aria 依赖在 jsdom 里调用 CSS.escape，需补最小实现。
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { escape: (value: string) => value.replace(/[^\w-]/g, '\\$&') } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  Reflect.deleteProperty(window, 'lcoder')
  localStorage.clear()
})

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}

function element(testId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
}

async function press(node: Element | null): Promise<void> {
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await flush()
}

async function renderDashboard(overrides: Partial<DashboardPageProps> = {}): Promise<void> {
  await act(async () => { root.render(<DashboardPage {...dashboardProps(overrides)} />) })
  await flush()
}

function nextActionCard(): HTMLElement {
  const card = element('dashboard-next-action')
  expect(card).not.toBeNull()
  return card as HTMLElement
}

/** 主行动卡里只允许一个可点的行动按钮。 */
function expectSingleAction(kind: string): void {
  const card = nextActionCard()
  expect(card.getAttribute('data-action')).toBe(kind)
  expect(card.querySelectorAll('button')).toHaveLength(1)
  expect(card.querySelectorAll('[data-testid="dashboard-next-action-button"]')).toHaveLength(1)
}

describe('总览主行动', () => {
  it('空项目给立项主行动', async () => {
    const onStartIntake = vi.fn()
    await renderDashboard({ onStartIntake })

    expectSingleAction('intake')
    const button = element('dashboard-next-action-button')
    expect(button?.textContent).toContain('从想法开始立项')
    await press(button)
    expect(onStartIntake).toHaveBeenCalledTimes(1)
  })

  it('有待裁决评审时指向最大未决轮次，并只展示一个主行动', async () => {
    const onOpenRequirement = vi.fn()
    await renderDashboard({
      projection: projectionOf([
        requirement('REQ-01', 'draft', {
          reviews: [
            { round: 1, at: '2026-11-20T10:00:00.000Z', report: 'R1', decision: 'accepted' },
            { round: 2, at: '2026-11-21T10:00:00.000Z', report: 'R2' },
          ],
        }),
      ]),
      onOpenRequirement,
    })

    expectSingleAction('review')
    const button = element('dashboard-next-action-button')
    expect(button?.textContent).toContain('R2')
    await press(button)
    expect(onOpenRequirement).toHaveBeenCalledWith('REQ-01')
  })

  it('有未落盘暂存原型时指向原型确认', async () => {
    const onOpenPrototype = vi.fn()
    await renderDashboard({
      projection: projectionOf([requirement('REQ-01', 'confirmed')]),
      requirementIds: ['REQ-01'],
      call: prototypeCall({
        staged: {
          requirementId: '__project__',
          html: HTML,
          changeKind: 'visual',
          summary: ['页脚换色'],
          changedDomPaths: ['body > footer'],
          createdAt: '2026-11-23T00:00:00.000Z',
        },
        committedHtml: HTML,
      }),
      onOpenPrototype,
    })

    expectSingleAction('staged')
    await press(element('dashboard-next-action-button'))
    expect(onOpenPrototype).toHaveBeenCalledTimes(1)
  })

  it('有任务待验收时指向任务页的待验收阶段', async () => {
    const onOpenTasks = vi.fn()
    await renderDashboard({
      projection: projectionOf([requirement('REQ-01', 'confirmed')], [task('T-1', 'verifying')]),
      onOpenTasks,
    })

    expectSingleAction('verify')
    await press(element('dashboard-next-action-button'))
    expect(onOpenTasks).toHaveBeenCalledWith('verifying')
  })

  it('待验收优先于待开工，全部收口后回到需求回顾', async () => {
    const onOpenTasks = vi.fn()
    await renderDashboard({
      projection: projectionOf(
        [requirement('REQ-01', 'confirmed')],
        [task('T-1', 'drafting'), task('T-2', 'implementing'), task('T-3', 'verifying')],
      ),
      onOpenTasks,
    })
    expectSingleAction('verify')
    await press(element('dashboard-next-action-button'))
    expect(onOpenTasks).toHaveBeenCalledWith('verifying')

    await renderDashboard({
      projection: projectionOf([requirement('REQ-01', 'confirmed')], [task('T-1', 'drafting')]),
    })
    expectSingleAction('develop')

    await renderDashboard({
      projection: projectionOf([requirement('REQ-01', 'confirmed')], [task('T-1', 'closed')]),
    })
    expectSingleAction('browse')
  })
})

describe('总览进度漏斗', () => {
  it('按需求状态与任务阶段计数，数字卡带筛选条件跳转', async () => {
    const onOpenRequirements = vi.fn()
    const onOpenTasks = vi.fn()
    await renderDashboard({
      projection: projectionOf(
        [
          requirement('REQ-01', 'draft'),
          requirement('REQ-02', 'draft'),
          requirement('REQ-03', 'confirmed'),
          requirement('REQ-04', 'confirmed', { state: 'released' }),
        ],
        [task('T-1', 'drafting'), task('T-2', 'implementing'), task('T-3', 'verifying'), task('T-4', 'closed')],
      ),
      onOpenRequirements,
      onOpenTasks,
    })

    const draftStat = container.querySelector('[data-testid="dashboard-requirement-stat"][data-state="draft"]')
    expect(draftStat?.textContent).toContain('2')
    const releasedStat = container.querySelector('[data-testid="dashboard-requirement-stat"][data-state="released"]')
    expect(releasedStat?.textContent).toContain('1')

    const pendingStat = container.querySelector('[data-testid="dashboard-task-stat"][data-stage="pending"]')
    expect(pendingStat?.textContent).toContain('1')
    const verifyStat = container.querySelector('[data-testid="dashboard-task-stat"][data-stage="verifying"]')
    expect(verifyStat?.textContent).toContain('1')

    await press(draftStat)
    expect(onOpenRequirements).toHaveBeenCalledWith('draft')
    await press(verifyStat)
    expect(onOpenTasks).toHaveBeenCalledWith('verifying')
  })
})

describe('总览项目详情弹窗', () => {
  it('原项目信息页收进弹窗，仍可查看项目事实与流程配置', async () => {
    await renderDashboard({
      projection: {
        ...projectionOf([requirement('REQ-01', 'confirmed')]),
        project: {
          kind: 'web',
          repoUrl: '',
          branch: 'main',
          docs: { product: '', architecture: '', tests: '' },
          environments: [],
          tracks: [],
        },
      },
    })

    await press(element('dashboard-project-detail'))
    expect(element('dashboard-detail-dialog')).not.toBeNull()
    expect(element('page-project-info')).not.toBeNull()
    expect(element('flow-config-section')).not.toBeNull()
  })
})

describe('总览活原型卡', () => {
  it('有需求时工作室带上需求上下文，独立窗口试玩同一份 HTML', async () => {
    const studio = vi.fn(async (_request: unknown): Promise<void> => {})
    const preview = vi.fn(async (_html: string): Promise<void> => {})
    Object.defineProperty(window, 'lcoder', { configurable: true, value: { openPrototypeStudio: studio, openPrototypePreview: preview } })
    await renderDashboard({
      projection: projectionOf([requirement('REQ-01', 'confirmed')]),
      requirementIds: ['REQ-01'],
      call: prototypeCall({ staged: null, committedHtml: HTML }),
    })

    expect(element('dashboard-prototype-status')?.textContent).toContain('主原型已就绪')
    await press(element('dashboard-open-studio'))
    expect(studio).toHaveBeenCalledWith(expect.objectContaining({ requirementId: 'REQ-01', sessionId: 'session-scope', html: HTML }))
    await press(element('dashboard-open-window'))
    expect(preview).toHaveBeenCalledWith(HTML)
  })

  it('没有需求时禁用工作室并说明原因', async () => {
    await renderDashboard({ call: prototypeCall({ staged: null, committedHtml: HTML }) })

    const studio = element('dashboard-open-studio') as HTMLButtonElement
    expect(studio.disabled).toBe(true)
    expect(element('dashboard-studio-unavailable')?.textContent).toContain('工作室需要一条需求')
  })
})

/** 工作台 App 需要的窄宿主面；默认给一个已选项目的仓库。 */
function installAppApi(options: {
  readonly requirements: readonly { readonly id: string; readonly state: string }[]
  readonly tasks: readonly { readonly id: string; readonly state: string }[]
}): void {
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: {
      call: vi.fn(async (namespace: string, method: string, args: Record<string, unknown>) => {
        if (namespace === 'lcoderCloud' && method === 'state') {
          const state = { signedIn: true, needsLogin: false, user: null, quota: null, estimate: null, lastError: null }
          return { ok: true, value: { ok: true, value: state } }
        }
        if (namespace === 'session' && method === 'list') return { ok: true, value: { items: [] } }
        if (namespace === 'workspaceFiles' && method === 'list') {
          const path = typeof args.path === 'string' ? args.path : ''
          if (path === '.spec/requirements') {
            return {
              ok: true,
              value: {
                entries: options.requirements.flatMap(row => [
                  { name: `${row.id}.yaml`, type: 'file' },
                  { name: `${row.id}.md`, type: 'file' },
                ]),
              },
            }
          }
          if (path === '.spec/tasks') {
            return { ok: true, value: { entries: options.tasks.map(row => ({ name: `${row.id}.yaml`, type: 'file' })) } }
          }
          return { ok: true, value: { entries: [] } }
        }
        if (namespace === 'workspaceFiles' && method === 'read') {
          const path = typeof args.path === 'string' ? args.path : ''
          const requirementRow = options.requirements.find(row => path === `.spec/requirements/${row.id}.yaml`)
          if (requirementRow !== undefined) {
            return { ok: true, value: { text: `id: ${requirementRow.id}\ntitle: ${requirementRow.id} 标题\nstate: ${requirementRow.state}\noptions: []` } }
          }
          const documentRow = options.requirements.find(row => path === `.spec/requirements/${row.id}.md`)
          if (documentRow !== undefined) return { ok: true, value: { text: '# 正文' } }
          const taskRow = options.tasks.find(row => path === `.spec/tasks/${row.id}.yaml`)
          if (taskRow !== undefined) {
            return { ok: true, value: { text: `id: ${taskRow.id}\ntitle: ${taskRow.id} 标题\nstate: ${taskRow.state}\ngrade: A` } }
          }
          return { ok: false, error: { code: 'ENOENT', message: 'ENOENT: 文件不存在' } }
        }
        if (namespace === 'prototype' && method === 'getStaged') return { ok: true, value: { staged: null, committedHtml: null } }
        if (namespace === 'prototype' && method === 'listSnapshots') return { ok: true, value: { snapshots: [] } }
        return { ok: true, value: {} }
      }),
      hostState: () => () => {},
      hostStateNow: async () => ({ kind: 'ready', url: 'http://127.0.0.1:1' }),
      openStream: async () => 'stream-1',
      cancelStream: async () => {},
      onStreamFrame: () => () => {},
      onEvent: () => () => {},
      onWaterfall: () => () => {},
      onWaterfallCancel: () => () => {},
      eventResult: async () => {},
      window: async () => {},
      onCloseRequest: () => () => {},
      confirmClose: async () => {},
      windowState: () => () => {},
      windowStateNow: async () => ({ maximized: false, fullscreen: false }),
      appInfo: async () => ({ version: '0.0.0' }),
      update: async () => ({ kind: 'unavailable', version: '0.0.0', reason: 'no-feed' }),
      setLocale: async () => {},
      readPreferences: async () => ({ skin: 'dark', font: 'system', locale: 'zh', lastPickedDirectory: null }),
      writePreferences: async () => ({ skin: 'dark', font: 'system', locale: 'zh', lastPickedDirectory: null }),
      pickDirectory: async () => null,
    },
  })
}

async function renderApp(): Promise<void> {
  await act(async () => { root.render(<App />) })
  await flush()
}

describe('默认主页与左侧导航', () => {
  it('打开即落在总览，主工作区五项在上、全局四项贴底，project-info 不再占一级入口', async () => {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(PROJECT))
    installAppApi({ requirements: [], tasks: [] })
    await renderApp()

    expect(element('page-dashboard')).not.toBeNull()
    expect(element('nav-dashboard')?.getAttribute('aria-current')).toBe('page')

    const top = [...(element('navgroup-top')?.querySelectorAll('[data-testid^="nav-"]') ?? [])]
      .map(node => node.getAttribute('data-testid'))
    expect(top).toEqual(['nav-dashboard', 'nav-requirements', 'nav-prototype', 'nav-tasks', 'nav-chat'])

    const bottom = [...(element('navgroup-bottom')?.querySelectorAll('[data-testid^="nav-"]') ?? [])]
      .map(node => node.getAttribute('data-testid'))
    expect(bottom).toEqual(['nav-talents', 'nav-prototype-library', 'nav-projects', 'nav-settings'])

    expect(element('nav-project-info')).toBeNull()
  })

  it('点需求数字卡带状态筛选跳转，导航直达时清空筛选', async () => {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(PROJECT))
    installAppApi({
      requirements: [{ id: 'REQ-01', state: 'draft' }, { id: 'REQ-02', state: 'confirmed' }],
      tasks: [],
    })
    await renderApp()

    await press(container.querySelector('[data-testid="dashboard-requirement-stat"][data-state="draft"]'))
    expect(element('requirements-host')?.style.display).not.toBe('none')
    const rows = [...container.querySelectorAll('[data-testid="requirement-row"]')]
    expect(rows.map(node => node.getAttribute('data-requirement-id'))).toEqual(['REQ-01'])

    await press(element('nav-requirements'))
    expect(container.querySelectorAll('[data-testid="requirement-row"]')).toHaveLength(2)
  })

  it('点任务数字卡带阶段筛选跳转并显示可清除的筛选提示', async () => {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(PROJECT))
    installAppApi({
      requirements: [{ id: 'REQ-01', state: 'confirmed' }],
      tasks: [{ id: 'T-1', state: 'verifying' }, { id: 'T-2', state: 'implementing' }],
    })
    await renderApp()

    await press(container.querySelector('[data-testid="dashboard-task-stat"][data-stage="verifying"]'))
    expect(element('page-tasks')).not.toBeNull()
    const cards = [...container.querySelectorAll('[data-testid="task-card"]')]
    expect(cards.map(node => node.getAttribute('data-task-id'))).toEqual(['T-1'])
    expect(element('task-stage-filter')?.textContent).toContain('待验收')

    await press(element('task-stage-filter-clear'))
    expect(container.querySelectorAll('[data-testid="task-card"]')).toHaveLength(2)
  })

  it('没有项目时总览只引导选择项目', async () => {
    installAppApi({ requirements: [], tasks: [] })
    await renderApp()

    expect(element('dashboard-no-project')).not.toBeNull()
    expect(element('dashboard-next-action')).toBeNull()
    await press(element('dashboard-pick-project'))
    expect(element('page-projects')).not.toBeNull()
  })
})
