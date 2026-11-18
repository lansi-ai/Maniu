// @vitest-environment jsdom
/** T-250：需求详情状态先行——四态操作栏与指引句、标题三区、配齐禁用原因、正文与报告折叠、阶段 chips、后台发起通道。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { RequirementDetail } from '../src/pages/requirement-detail.tsx'
import type { FlowConfigRow, JobRoleRow, RequirementDocRow, TaskRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const TASK: TaskRow = {
  id: 'T-01',
  title: '实施任务',
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

const LONG_TEXT = `# 文档自带大标题

${Array.from({ length: 12 }, (_, index) => `这是正文的第 ${String(index + 1)} 行，用来验证折叠预览只取首六行或二百字。`).join('\n')}`

const DRAFT: RequirementDocRow = {
  id: 'REQ-01',
  title: '佣金改造',
  text: LONG_TEXT,
  state: 'draft',
  options: [],
  openedAt: '2026-11-17T09:00:00+08:00',
  versions: [
    { n: 1, at: '2026-11-17T09:00:00+08:00' },
    { n: 2, at: '2026-11-17T11:00:00+08:00' },
  ],
  reviews: [{ round: 1, at: '2026-11-17T10:30:00+08:00', report: 'requirements/REQ-01/reviews/R1.md', role: 'maniu-pm' }],
}

const TWO_ROLE_FLOW: FlowConfigRow = {
  nodes: [{ node: 'review', roles: ['maniu-pm', 'maniu-manager'], auto: true }],
}

const ROSTER: readonly JobRoleRow[] = [{ id: 'ops-lead', name: '运维负责人', inherits: 'manager' }]

function projectionOf(
  requirements: readonly RequirementDocRow[],
  extra: { readonly tasks?: readonly TaskRow[]; readonly flow?: FlowConfigRow | null; readonly roles?: readonly JobRoleRow[] } = {},
): SpecProjection {
  return {
    tasks: extra.tasks ?? [],
    rules: [],
    contracts: [],
    proposals: [],
    requirements,
    groups: [],
    roles: extra.roles ?? [],
    project: null,
    secrets: {},
    automation: null,
    agents: null,
    problems: [],
    flow: extra.flow ?? null,
  }
}

let container: HTMLDivElement
let root: Root
let commands: string[]
let commandError: string | null

const REPORT_TEXT = `# 评审结论

${'评审意见正文。'.repeat(40)}`

async function fakeCall(namespace: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  if (namespace === 'workspaceFiles' && method === 'read') return { ok: true, value: { text: REPORT_TEXT } }
  if (namespace === 'commands' && method === 'execute') {
    commands.push(String(args.line))
    return commandError === null
      ? { ok: true, value: { result: { kind: 'success', text: 'REQ-01 已过审' } } }
      : { ok: true, value: { result: { kind: 'error', text: commandError } } }
  }
  throw new Error(`未预期调用 ${namespace}/${method}`)
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  Object.defineProperty(window, 'lcoder', { configurable: true, value: { call: vi.fn(fakeCall) } })
  commands = []
  commandError = null
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

interface DetailCalls {
  readonly readers: string[]
  readonly review: Mock<() => Promise<{ readonly ok: boolean; readonly message: string }>>
  readonly revise: Mock<() => Promise<{ readonly ok: boolean; readonly message: string }>>
  readonly createBased: Mock<() => Promise<{ readonly ok: boolean; readonly message: string }>>
  readonly split: Mock<() => Promise<{ readonly ok: boolean; readonly message: string }>>
  readonly reload: Mock<() => void>
  readonly tasksOpened: Mock<() => void>
}

function callsOf(): DetailCalls {
  return {
    readers: [],
    review: vi.fn(async () => ({ ok: true, message: '评审指令已发送' })),
    revise: vi.fn(async () => ({ ok: true, message: '改稿指令已发送' })),
    createBased: vi.fn(async () => ({ ok: true, message: '新建指令已发送' })),
    split: vi.fn(async () => ({ ok: true, message: '拆分指令已发送' })),
    reload: vi.fn(),
    tasksOpened: vi.fn(),
  }
}

async function renderDetail(
  row: RequirementDocRow,
  calls: DetailCalls,
  extra: { readonly tasks?: readonly TaskRow[]; readonly flow?: FlowConfigRow | null; readonly roles?: readonly JobRoleRow[] } = {},
): Promise<void> {
  act(() => {
    root.render(
      <RequirementDetail
        row={row}
        project={PROJECT}
        projection={projectionOf([row], extra)}
        sessions={[]}
        onClose={() => {}}
        onOpenTask={() => {}}
        onOpenReader={(path) => { calls.readers.push(path) }}
        onReload={calls.reload}
        onSplit={calls.split}
        onReview={calls.review}
        onRevise={calls.revise}
        onCreateBased={calls.createBased}
        onOpenTasks={calls.tasksOpened}
      />,
    )
  })
  await act(async () => { await Promise.resolve() })
}

async function press(testId: string): Promise<void> {
  const node = element(testId)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('四态操作栏与指引句', () => {
  it('draft 给评审/修改需求/确认需求，指引待评审', async () => {
    await renderDetail(DRAFT, callsOf())
    expect(element('requirement-detail-review')).not.toBeNull()
    expect(element('requirement-detail-revise')).not.toBeNull()
    expect(element('requirement-approve')).not.toBeNull()
    expect(element('requirement-split')).toBeNull()
    expect(element('requirement-detail-create-based')).toBeNull()
    expect(element('requirement-guide')?.textContent).toContain('待评审')
  })

  it('confirmed 无关联任务给拆分与基于此版本新建，不再渲染确认按钮', async () => {
    const confirmed: RequirementDocRow = { ...DRAFT, state: 'confirmed' }
    await renderDetail(confirmed, callsOf())
    expect(element('requirement-approve')).toBeNull()
    expect(element('requirement-detail-review')).toBeNull()
    expect(element('requirement-detail-revise')).toBeNull()
    expect(element('requirement-split')).not.toBeNull()
    expect(element('requirement-detail-create-based')).not.toBeNull()
    expect(element('requirement-detail-tasks')).toBeNull()
    expect(element('requirement-guide')?.textContent).toContain('已确认')
  })

  it('confirmed 有关联任务时拆分换成查看任务', async () => {
    const confirmed: RequirementDocRow = { ...DRAFT, state: 'confirmed' }
    const calls = callsOf()
    await renderDetail(confirmed, calls, { tasks: [TASK] })
    expect(element('requirement-split')).toBeNull()
    expect(element('requirement-detail-tasks')).not.toBeNull()
    await press('requirement-detail-tasks')
    expect(calls.tasksOpened).toHaveBeenCalledTimes(1)
  })

  it('released 与 closed 给查看任务与基于此版本新建，没有确认/拆分/改稿', async () => {
    for (const state of ['released', 'closed'] as const) {
      const row: RequirementDocRow = { ...DRAFT, state }
      await renderDetail(row, callsOf(), { tasks: [TASK] })
      expect(element('requirement-approve')).toBeNull()
      expect(element('requirement-split')).toBeNull()
      expect(element('requirement-detail-revise')).toBeNull()
      expect(element('requirement-detail-tasks')).not.toBeNull()
      expect(element('requirement-detail-create-based')).not.toBeNull()
      expect(element('requirement-guide')?.textContent).toContain(state === 'released' ? '已上线' : '已关闭')
    }
  })

  it('未知状态只留次级动作并说明', async () => {
    const row: RequirementDocRow = { ...DRAFT, state: 'unknown' }
    await renderDetail(row, callsOf())
    expect(element('requirement-approve')).toBeNull()
    expect(element('requirement-split')).toBeNull()
    expect(element('requirement-detail-create-based')).toBeNull()
    expect(element('requirement-detail-reload')).not.toBeNull()
    expect(element('requirement-open-reader')).not.toBeNull()
    expect(element('requirement-guide')?.textContent).toContain('状态未知')
  })
})

describe('头部标题三区', () => {
  it('大标题取 row.title，状态徽标与 REQ 编号同排；文档自带 H1 不抢页面标题', async () => {
    await renderDetail(DRAFT, callsOf())
    const title = element('requirement-detail-title')
    expect(title?.textContent).toBe('佣金改造')
    expect(title?.tagName).toBe('H2')
    expect(element('requirement-state-badge')?.textContent).toBe('草稿')
    expect(element('requirement-state-badge')?.className).toContain('state-draft')
    expect(element('requirement-detail-id')?.textContent).toBe('REQ-01')
    expect(element('requirement-document-preview')?.querySelector('h1')?.textContent).toBe('文档自带大标题')
  })

  it('缺标题时回退需求编号', async () => {
    const row: RequirementDocRow = {
      id: 'REQ-01',
      text: LONG_TEXT,
      state: 'draft',
      options: [],
      versions: [],
      reviews: [],
    }
    await renderDetail(row, callsOf())
    expect(element('requirement-detail-title')?.textContent).toBe('REQ-01')
  })

  it('徽标颜色随状态：confirmed 绿、终态灰', async () => {
    const confirmed: RequirementDocRow = { ...DRAFT, state: 'confirmed' }
    await renderDetail(confirmed, callsOf())
    expect(element('requirement-state-badge')?.className).toContain('state-confirmed')
    const released: RequirementDocRow = { ...DRAFT, state: 'released' }
    await renderDetail(released, callsOf())
    expect(element('requirement-state-badge')?.className).toContain('state-released')
  })
})

describe('确认需求的配齐口径', () => {
  it('没有评审时禁用确认并在 title 与提示里说明原因', async () => {
    const row: RequirementDocRow = { ...DRAFT, reviews: [] }
    await renderDetail(row, callsOf())
    const approve = element('requirement-approve') as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(approve.title).toContain('至少完成一轮评审')
    expect(element('requirement-approve-hint')?.textContent).toContain('至少完成一轮评审')
  })

  it('有评审且无流程配置时可确认', async () => {
    await renderDetail(DRAFT, callsOf())
    const approve = element('requirement-approve') as HTMLButtonElement
    expect(approve.disabled).toBe(false)
    expect(approve.title).toBe('')
    expect(element('requirement-approve-hint')).toBeNull()
  })

  it('流程要求双岗而只有一岗署名时禁用，原因点名缺的岗位', async () => {
    await renderDetail(DRAFT, callsOf(), { flow: TWO_ROLE_FLOW })
    const approve = element('requirement-approve') as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(approve.title).toContain('评审未配齐')
    expect(approve.title).toContain('maniu-manager')
    expect(element('requirement-approve-hint')?.textContent).toContain('maniu-manager')
  })

  it('双岗各消费一轮署名评审后配齐可确认', async () => {
    const row: RequirementDocRow = {
      ...DRAFT,
      reviews: [
        ...DRAFT.reviews,
        { round: 2, at: '2026-11-17T11:30:00+08:00', report: 'requirements/REQ-01/reviews/R2.md', role: 'maniu-manager' },
      ],
    }
    await renderDetail(row, callsOf(), { flow: TWO_ROLE_FLOW })
    expect((element('requirement-approve') as HTMLButtonElement).disabled).toBe(false)
    expect(element('requirement-approve-hint')).toBeNull()
  })

  it('名册岗位按 inherits 根匹配；缺岗原因用名册显示名', async () => {
    const flow: FlowConfigRow = { nodes: [{ node: 'review', roles: ['maniu-pm', 'ops-lead'], auto: true }] }
    await renderDetail(DRAFT, callsOf(), { flow, roles: ROSTER })
    const approve = element('requirement-approve') as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(approve.title).toContain('运维负责人（ops-lead）')

    const row: RequirementDocRow = {
      ...DRAFT,
      reviews: [
        ...DRAFT.reviews,
        { round: 2, at: '2026-11-17T11:30:00+08:00', report: 'requirements/REQ-01/reviews/R2.md', role: 'maniu-manager' },
      ],
    }
    await renderDetail(row, callsOf(), { flow, roles: ROSTER })
    expect((element('requirement-approve') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('正文默认折叠', () => {
  it('长正文只预览首几行，展开后才渲染全文，可再收起', async () => {
    await renderDetail(DRAFT, callsOf())
    const preview = element('requirement-document-preview')
    expect(preview).not.toBeNull()
    expect(preview?.textContent).toContain('第 1 行')
    expect(preview?.textContent).not.toContain('第 12 行')
    expect(element('requirement-document-body')).toBeNull()
    expect(element('requirement-body-toggle')?.textContent).toBe('展开全文')

    await press('requirement-body-toggle')
    expect(element('requirement-document-preview')).toBeNull()
    expect(element('requirement-document-body')?.textContent).toContain('第 12 行')
    expect(element('requirement-body-toggle')?.textContent).toBe('收起')

    await press('requirement-body-toggle')
    expect(element('requirement-document-preview')).not.toBeNull()
    expect(element('requirement-document-body')).toBeNull()
  })

  it('短正文直接全量渲染，不画展开开关', async () => {
    const row: RequirementDocRow = { ...DRAFT, text: '短正文' }
    await renderDetail(row, callsOf())
    expect(element('requirement-body-toggle')).toBeNull()
    expect(element('requirement-document-body')?.textContent).toContain('短正文')
  })

  it('正文缺失给空态', async () => {
    const row: RequirementDocRow = { ...DRAFT, text: '   ' }
    await renderDetail(row, callsOf())
    expect(element('requirement-document-empty')?.textContent).toContain('正文缺失')
    expect(element('requirement-body-toggle')).toBeNull()
  })
})

describe('评审报告摘要卡', () => {
  it('结论摘录截取首 120 字，全文展开后才渲染', async () => {
    await renderDetail(DRAFT, callsOf())
    const excerpt = element('requirement-report-excerpt')
    expect(excerpt?.textContent?.length).toBe(121)
    expect(excerpt?.textContent?.endsWith('…')).toBe(true)
    expect(element('requirement-report-summary')?.textContent).toContain('结论摘录')
    expect(element('requirement-report-body')).toBeNull()
    await press('requirement-report-toggle')
    expect(element('requirement-report-body')?.textContent).toContain('评审意见正文')
  })
})

describe('阶段进度 chips', () => {
  it('横排 chips 紧跟头部，评审与版本带打开入口', async () => {
    const calls = callsOf()
    await renderDetail(DRAFT, calls)
    const body = container.querySelector('.detail-drawer-body')
    const sections = body?.querySelectorAll(':scope > section') ?? []
    expect(sections[0]?.getAttribute('data-testid')).toBe('requirement-timeline')
    expect(body?.querySelector('.timeline-chips')).not.toBeNull()
    expect(element('requirement-timeline-approved')?.textContent).toContain('尚未过审')

    await act(async () => {
      ;(container.querySelector('[data-testid="requirement-open-version"][data-version="2"]') as HTMLElement).click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(calls.readers).toEqual(['.spec/requirements/REQ-01/versions/v2.md'])
  })
})

describe('发布与关闭通道', () => {
  it('四态有无矩阵：draft 只有关闭，confirmed 上线加关闭，released 只有关闭，closed 无写操作', async () => {
    await renderDetail(DRAFT, callsOf())
    expect(element('requirement-close')).not.toBeNull()
    expect(element('requirement-release')).toBeNull()

    const confirmed: RequirementDocRow = { ...DRAFT, state: 'confirmed' }
    await renderDetail(confirmed, callsOf())
    expect(element('requirement-release')).not.toBeNull()
    expect(element('requirement-close')).not.toBeNull()

    const released: RequirementDocRow = { ...DRAFT, state: 'released' }
    await renderDetail(released, callsOf())
    expect(element('requirement-release')).toBeNull()
    expect(element('requirement-close')).not.toBeNull()

    const closed: RequirementDocRow = { ...DRAFT, state: 'closed' }
    await renderDetail(closed, callsOf())
    expect(element('requirement-release')).toBeNull()
    expect(element('requirement-close')).toBeNull()
    expect(element('requirement-approve')).toBeNull()
  })

  it('关闭与上线点击走对应人机命令字符串并展示回执', async () => {
    await renderDetail(DRAFT, callsOf())
    await press('requirement-close')
    expect(commands).toEqual(['/requirement_close REQ-01'])
    expect(element('requirement-action-result')?.getAttribute('data-ok')).toBe('true')

    const confirmed: RequirementDocRow = { ...DRAFT, state: 'confirmed' }
    await renderDetail(confirmed, callsOf())
    await press('requirement-release')
    expect(commands[commands.length - 1]).toBe('/requirement_release REQ-01')
  })

  it('kernel 拒绝时按钮仍可点，失败给可读提示', async () => {
    commandError = 'REQ-01 已上线，是终态，不再关闭；要记录后续变更请另开一条需求'
    const released: RequirementDocRow = { ...DRAFT, state: 'released' }
    await renderDetail(released, callsOf())
    const close = element('requirement-close') as HTMLButtonElement
    expect(close.disabled).toBe(false)
    await press('requirement-close')
    expect(commands).toEqual(['/requirement_close REQ-01'])
    const result = element('requirement-action-result')
    expect(result?.getAttribute('data-ok')).toBe('false')
    expect(result?.textContent).toContain('不再关闭')
  })
})

describe('后台发起与次级动作', () => {
  it('评审与基于此版本新建都走页面回调并展示回执，不跳转', async () => {
    const calls = callsOf()
    await renderDetail(DRAFT, calls)
    await press('requirement-detail-review')
    expect(calls.review).toHaveBeenCalledTimes(1)
    expect(element('requirement-action-result')?.textContent).toContain('评审指令已发送')

    const confirmed: RequirementDocRow = { ...DRAFT, state: 'confirmed' }
    await renderDetail(confirmed, calls)
    await press('requirement-detail-create-based')
    expect(calls.createBased).toHaveBeenCalledTimes(1)
    expect(element('requirement-action-result')?.textContent).toContain('新建指令已发送')
  })

  it('刷新与阅读器打开正文是常驻次级动作', async () => {
    const calls = callsOf()
    await renderDetail(DRAFT, calls)
    await press('requirement-detail-reload')
    expect(calls.reload).toHaveBeenCalledTimes(1)
    await press('requirement-open-reader')
    expect(calls.readers).toEqual(['.spec/requirements/REQ-01.md'])
  })
})
