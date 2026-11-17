// @vitest-environment jsdom
/** 人才库页的权限分支、删除引用拦截、内置角色并入全局库与项目库未绑定态。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translate, type MessageKey } from '../src/locale.ts'
import { TalentsPage } from '../src/pages/talents.tsx'
import type { SessionSummary } from '../src/store.ts'
import type { BuiltinPresetView, TalentRow } from '../src/talents/model.ts'
import type { BuiltinDetailState, TalentsHandle } from '../src/talents/use-talents.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const t = (key: MessageKey, params?: Readonly<Record<string, string | number>>): string =>
  translate('zh', key, params)

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

function talent(id: string, overrides: Partial<TalentRow> = {}): TalentRow {
  return {
    id,
    scope: 'global',
    projectId: null,
    ownerUserId: 'u1',
    createdBy: 'user',
    name: `人才 ${id}`,
    description: '说明',
    config: { version: 1 },
    revision: 1,
    canManage: true,
    createdAt: '2026-11-16T10:00:00.000Z',
    updatedAt: '2026-11-16T10:00:00.000Z',
    ...overrides,
  }
}

function builtin(id: string, overrides: Partial<BuiltinPresetView> = {}): BuiltinPresetView {
  return { id, name: `角色 ${id}`, description: '一句话说明', isDefault: false, ...overrides }
}

function session(sessionId: string, agentPreset: string): SessionSummary {
  return { sessionId, updatedAt: 1, running: false, blank: false, agentPreset }
}

/** 点卡片本身（不是卡片里的按钮）打开内置详情。 */
async function openCard(builtinId: string): Promise<void> {
  const card = container.querySelector<HTMLElement>(`[data-builtin-id="${builtinId}"]`)
  expect(card).not.toBeNull()
  await act(async () => {
    ;(card as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function handleOf(overrides: Partial<TalentsHandle> = {}): TalentsHandle {
  return {
    catalog: { plugins: [], presets: [] },
    catalogError: null,
    project: null,
    projectError: null,
    global: [],
    projectTalents: [],
    builtins: [],
    builtinsLoading: false,
    builtinsError: null,
    builtinDetails: {},
    loading: false,
    error: null,
    applyErrors: {},
    applied: new Set<string>(),
    busy: false,
    presetNames: {},
    reload: vi.fn(),
    create: vi.fn(async () => null),
    update: vi.fn(async () => null),
    remove: vi.fn(async () => null),
    checkRefs: vi.fn(async () => ({ ok: true as const, sessionIds: [] })),
    inspectBuiltin: vi.fn(),
    ...overrides,
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

async function press(testId: string): Promise<void> {
  const node = container.querySelector(`[data-testid="${testId}"]`)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function render(talents: TalentsHandle, project: ProjectScope | null = null, sessions: readonly SessionSummary[] = []): void {
  act(() => {
    root.render(
      <TalentsPage
        t={t}
        signedIn
        userId="u1"
        project={project}
        sessions={sessions}
        talents={talents}
      />,
    )
  })
}

describe('人才库页', () => {
  it('空库给可读空态，加载时给加载态', () => {
    render(handleOf())
    expect(container.querySelector('[data-testid="talent-empty"]')?.textContent).toContain('还没有全局人才')
    act(() => { root.unmount() })
    root = createRoot(container)
    render(handleOf({ loading: true }))
    expect(container.querySelector('[data-testid="talents-loading"]')).not.toBeNull()
  })

  it('他人创建的人才保留卡片，但隐藏改删并说明归属', () => {
    const mine = talent('a')
    const others = talent('b', { name: '别人的', ownerUserId: 'u2', canManage: false, createdBy: 'ai' })
    render(handleOf({ global: [mine, others], applied: new Set(['a', 'b']) }))
    const cards = container.querySelectorAll('[data-testid="talent-card"]')
    expect(cards).toHaveLength(2)
    const other = container.querySelector('[data-talent-id="b"]')
    expect(other?.querySelector('[data-testid="talent-edit"]')).toBeNull()
    expect(other?.querySelector('[data-testid="talent-delete"]')).toBeNull()
    expect(other?.querySelector('[data-testid="talent-cannot-manage"]')?.textContent).toContain('owner')
    expect(container.querySelector('[data-talent-id="a"] [data-testid="talent-edit"]')).not.toBeNull()
  })

  it('删除前查会话引用，有引用时拦住并列出会话', async () => {
    const checkRefs = vi.fn(async () => ({ ok: true as const, sessionIds: ['session-1', 'session-2'] }))
    const remove = vi.fn(async () => null)
    render(handleOf({ global: [talent('a')], applied: new Set(['a']), checkRefs, remove }))
    await press('talent-delete')
    expect(checkRefs).toHaveBeenCalledWith('a')
    expect(remove).not.toHaveBeenCalled()
    const blocked = container.querySelector('[data-testid="talent-delete-blocked"]')
    expect(blocked?.textContent).toContain('2 条本机会话')
    expect(blocked?.textContent).toContain('session-1')
    expect(container.querySelector('[data-testid="talent-delete-confirm"]')).toBeNull()
  })

  it('没有引用时先确认再删除', async () => {
    const remove = vi.fn(async () => null)
    render(handleOf({ global: [talent('a')], applied: new Set(['a']), remove }))
    await press('talent-delete')
    expect(container.querySelector('[data-testid="talent-delete-confirm"]')).not.toBeNull()
    await press('talent-delete-confirm')
    expect(remove).toHaveBeenCalledWith('a')
  })

  it('项目身份就绪时直接展示项目库，没有启用按钮', () => {
    const projectTalent = talent('p1', { name: '项目人才', scope: 'project', projectId: 'project-1' })
    render(handleOf({
      project: { path: 'E:/repo', projectId: 'project-1', state: 'ready' },
      projectTalents: [projectTalent],
      applied: new Set(['p1']),
    }), PROJECT)
    expect(container.querySelector('[data-testid="talent-list-project"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="talent-project-enable"]')).toBeNull()
    expect(container.querySelector('[data-testid="talent-create-project"]')).not.toBeNull()
  })

  it('老项目缺 projectId 时只显示补写中的加载态，没有手动入口', () => {
    render(handleOf({
      project: { path: 'E:/repo', projectId: null, state: 'unbound' },
    }), PROJECT)
    expect(container.querySelector('[data-testid="talent-project-pending"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="talent-project-enable"]')).toBeNull()
  })

  it('没有项目时项目库只提示先选项目', () => {
    render(handleOf())
    expect(container.querySelector('[data-testid="talent-project-missing"]')?.textContent).toContain('先选择一个项目')
  })

  it('下发失败只显示在该人才卡片上', () => {
    render(handleOf({
      global: [talent('a'), talent('b', { name: '第二个' })],
      applyErrors: { a: 'agent-talent/unknown-plugin: missing' },
      applied: new Set(['b']),
    }))
    const first = container.querySelector('[data-talent-id="a"]')
    expect(first?.textContent).toContain('下发失败')
    const second = container.querySelector('[data-talent-id="b"]')
    expect(second?.textContent).not.toContain('下发失败')
  })

  it('页面不提供开始会话入口', () => {
    render(handleOf({
      builtins: [builtin('maniu-pm')],
      global: [talent('a')],
      applied: new Set(['maniu-pm', 'a']),
    }))
    expect(container.querySelector('[data-testid="talent-start"]')).toBeNull()
    expect(container.querySelector('[data-testid="builtin-start"]')).toBeNull()
    expect(container.textContent).not.toContain('开始会话')
  })

  it('页头与分组不带说明小字，只留主标题与刷新', () => {
    render(handleOf({ builtins: [builtin('maniu-pm')], global: [talent('a')] }), PROJECT)
    const head = container.querySelector('[data-testid="page-talents"] .page-head')
    expect(head?.querySelector('h2')?.textContent).toBe('人才库')
    expect(head?.querySelector('[data-testid="talent-reload"]')).not.toBeNull()
    expect(container.querySelector('.page-sub')).toBeNull()
    expect(container.textContent).not.toContain('共 1 个人才')
    expect(container.textContent).not.toContain('随应用安装的角色')
    expect(container.textContent).not.toContain('所有项目都能选用')
    expect(container.textContent).not.toContain('只属于当前项目')
  })
})

describe('内置人才并入全局库', () => {
  it('内置卡片排在全局库开头，保留内置标、默认标与会话数', () => {
    render(
      handleOf({
        builtins: [
          builtin('maniu-pm', { name: '慢牛项目经理', description: '谈需求、拆任务', isDefault: true }),
          builtin('maniu-intake', { name: '慢牛立项' }),
        ],
        global: [talent('a', { name: '云端全局人才' })],
      }),
      null,
      [session('s1', 'maniu-pm'), session('s2', 'lcoder-pm'), session('s3', 'talent-cloud-1')],
    )
    expect(container.querySelector('[data-testid="talent-group-builtin"]')).toBeNull()
    const globalGroup = container.querySelector('[data-testid="talent-group-global"]')
    expect(globalGroup).not.toBeNull()
    const cards = [...(globalGroup?.querySelectorAll('[data-testid="talent-list-global"] > article') ?? [])]
    expect(cards.map(node => node.getAttribute('data-builtin-id') ?? node.getAttribute('data-talent-id')))
      .toEqual(['maniu-pm', 'maniu-intake', 'a'])
    expect(container.querySelectorAll('[data-testid="builtin-card"]')).toHaveLength(2)
    const pm = container.querySelector('[data-builtin-id="maniu-pm"]')
    expect(pm?.textContent).toContain('慢牛项目经理')
    expect(pm?.textContent).toContain('谈需求、拆任务')
    expect(pm?.querySelector('[data-testid="builtin-source"]')?.textContent).toBe('内置')
    expect(pm?.textContent).toContain('默认')
    expect(pm?.querySelector('[data-testid="builtin-sessions"]')?.textContent).toBe('2')
    expect(container.querySelector('[data-testid="talent-empty"]')).toBeNull()
  })

  it('内置为空、云端有内容时全局库照常显示，空态提示仍在', () => {
    render(handleOf({ builtins: [], global: [talent('a')] }))
    expect(container.querySelector('[data-testid="talent-empty-builtin"]')?.textContent).toContain('没有可用的内置角色')
    expect(container.querySelector('[data-testid="talent-empty"]')).toBeNull()
    expect(container.querySelectorAll('[data-testid="talent-card"]')).toHaveLength(1)
  })

  it('激活失败的内置角色标出原因，详情入口保留', () => {
    render(handleOf({ builtins: [builtin('maniu-ops', { broken: 'unknown plugin @x/y' })] }))
    const card = container.querySelector('[data-builtin-id="maniu-ops"]')
    expect(card?.querySelector('[data-testid="builtin-broken"]')?.textContent).toContain('unknown plugin @x/y')
    expect(card?.querySelector('[data-testid="builtin-detail-open"]')).not.toBeNull()
    expect(card?.querySelector('[data-testid="builtin-start"]')).toBeNull()
  })

  it('内置读取的加载、空态与宿主失败都在全局库里有可读提示', () => {
    render(handleOf({ builtinsLoading: true }))
    const loading = container.querySelector('[data-testid="talents-builtin-loading"]')
    expect(loading).not.toBeNull()
    expect(loading?.closest('[data-testid="talent-group-global"]')).not.toBeNull()
    act(() => { root.unmount() })
    root = createRoot(container)
    render(handleOf())
    expect(container.querySelector('[data-testid="talent-empty-builtin"]')?.textContent).toContain('没有可用的内置角色')
    act(() => { root.unmount() })
    root = createRoot(container)
    render(handleOf({ builtinsError: 'link_unavailable: 宿主连接已断开' }))
    const failure = container.querySelector('[data-testid="talents-builtin-error"]')
    expect(failure?.textContent).toContain('读取内置人才失败')
    expect(failure?.textContent).toContain('link_unavailable')
    expect(failure?.closest('[data-testid="talent-group-global"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="builtin-card"]')).toBeNull()
    expect(container.querySelector('[data-testid="talent-group-global"]')).not.toBeNull()
  })

  it('点卡片打开详情：人设、插件组合、工具面、会话数与只读标识', async () => {
    const detail: BuiltinDetailState = {
      loading: false,
      error: null,
      persona: '你是慢牛项目经理。',
      plugins: [
        { id: 'persona', name: '@deepseek-ai/dsh-persona', group: false, disabled: 'no' },
        { id: 'compaction', name: 'cordis:group', group: true, disabled: 'no' },
        { id: 'missing', name: '@deepseek-ai/dsh-missing', group: false, disabled: 'yes' },
        { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', group: false, disabled: 'conditional' },
      ],
      tools: [{ name: 'file_read', description: '读文件' }],
      toolsError: null,
    }
    const inspectBuiltin = vi.fn()
    render(handleOf({
      builtins: [builtin('maniu-pm', { name: '慢牛项目经理', description: '谈需求', isDefault: true })],
      builtinDetails: { 'maniu-pm': detail },
      catalog: {
        plugins: [{ name: '@deepseek-ai/dsh-persona' }, { name: '@deepseek-ai/dsh-tool-bash' }],
        presets: [],
      },
      inspectBuiltin,
    }), null, [session('s1', 'maniu-pm')])
    await openCard('maniu-pm')
    expect(inspectBuiltin).toHaveBeenCalledWith('maniu-pm')
    const drawer = container.querySelector('[data-testid="builtin-detail"]')
    expect(drawer).not.toBeNull()
    expect(drawer?.textContent).toContain('慢牛项目经理')
    expect(drawer?.textContent).toContain('跟随全局默认')
    expect(drawer?.textContent).toContain('maniu-pm')
    expect(drawer?.querySelector('[data-testid="builtin-persona"]')?.textContent).toContain('你是慢牛项目经理')
    const pluginRows = drawer?.querySelectorAll('[data-testid="builtin-plugins"] li') ?? []
    expect(pluginRows).toHaveLength(4)
    const pluginText = [...pluginRows].map(row => row.textContent ?? '').join('\n')
    expect(pluginText).toContain('分组')
    expect(pluginText).toContain('禁用')
    expect(pluginText).toContain('条件禁用')
    expect(drawer?.querySelector('[data-testid="builtin-plugin-unknown"]')?.textContent).toBe('未安装')
    expect(drawer?.querySelector('[data-testid="builtin-tools"]')?.textContent).toContain('file_read')
    // 内置人才只读：详情里没有改删入口。
    expect(drawer?.querySelector('[data-testid="talent-edit"]')).toBeNull()
    expect(drawer?.querySelector('[data-testid="talent-delete"]')).toBeNull()
  })

  it('详情读不到时给出可读失败，工具面照常显示', async () => {
    render(handleOf({
      builtins: [builtin('maniu-pm')],
      builtinDetails: {
        'maniu-pm': {
          loading: false,
          error: 'link_unavailable: 宿主连接已断开',
          persona: null,
          plugins: [],
          tools: [{ name: 'file_read', description: '' }],
          toolsError: null,
        },
      },
    }))
    await openCard('maniu-pm')
    const drawer = container.querySelector('[data-testid="builtin-detail"]')
    expect(drawer?.querySelector('[data-testid="builtin-detail-error"]')?.textContent).toContain('读取预设详情失败')
    expect(drawer?.querySelector('[data-testid="builtin-tools"]')?.textContent).toContain('file_read')
    expect(drawer?.querySelector('[data-testid="builtin-persona"]')).toBeNull()
  })

  it('工具面读不到时只在该区报原因', async () => {
    render(handleOf({
      builtins: [builtin('maniu-pm')],
      builtinDetails: {
        'maniu-pm': {
          loading: false,
          error: null,
          persona: '你是慢牛项目经理。',
          plugins: [],
          tools: [],
          toolsError: 'the preset exposes no tool scope',
        },
      },
    }))
    await openCard('maniu-pm')
    const drawer = container.querySelector('[data-testid="builtin-detail"]')
    expect(drawer?.querySelector('[data-testid="builtin-tools-error"]')?.textContent)
      .toContain('the preset exposes no tool scope')
    expect(drawer?.querySelector('[data-testid="builtin-persona"]')?.textContent).toContain('你是慢牛项目经理')
  })
})
