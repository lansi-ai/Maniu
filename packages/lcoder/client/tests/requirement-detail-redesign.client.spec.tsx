// @vitest-environment jsdom
/** T-250：需求详情状态先行——四态操作栏与指引句、标题三区、配齐禁用原因、正文与报告折叠、阶段 chips、后台发起通道。T-286：四层重排，操作栏与正文随文档标签切换。T-287：头部压成单行，报告只画一份 Markdown，阶段 chips 收起。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { RequirementDetail, type RunningOpKind } from '../src/pages/requirement-detail.tsx'
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
  reviews: [{
    round: 1,
    at: '2026-11-17T10:30:00+08:00',
    report: 'requirements/REQ-01/reviews/R1.md',
    role: 'maniu-pm',
    decision: 'accepted',
    decidedAt: '2026-11-17T11:00:00+08:00',
    appliedVersion: 2,
  }],
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

const STRUCTURED_REPORT = `# 评审报告

## 摘要

需求目标清楚，主要缺口是**代发订单边界**。

## 结论

需要修改。

## 待改项

- 位置：验收口径。建议写清异常返回码。优先级：低
- 位置：正文「范围」。建议补上**代发订单**不参与佣金。优先级：高`

let reportText = REPORT_TEXT

async function fakeCall(namespace: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  if (namespace === 'workspaceFiles' && method === 'read') {
    const path = String(args.path)
    if (path.includes('/versions/')) {
      return { ok: true, value: { text: path.includes('v1.md') ? '旧版正文' : '新版正文' } }
    }
    return { ok: true, value: { text: reportText } }
  }
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
  reportText = REPORT_TEXT
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
        onModifyRequest={() => {}}
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

async function openTab(selector: string): Promise<void> {
  const node = container.querySelector(selector)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function renderLockedDetail(
  row: RequirementDocRow,
  extra: { readonly runningOp?: RunningOpKind | null; readonly onModifyRequest?: () => void } = {},
): Promise<void> {
  const calls = callsOf()
  act(() => {
    root.render(
      <RequirementDetail
        row={row}
        project={PROJECT}
        projection={projectionOf([row])}
        sessions={[]}
        onClose={() => {}}
        onOpenTask={() => {}}
        onOpenReader={() => {}}
        onReload={calls.reload}
        onSplit={calls.split}
        onReview={calls.review}
        onRevise={calls.revise}
        onModifyRequest={extra.onModifyRequest ?? (() => {})}
        onCreateBased={calls.createBased}
        onOpenTasks={calls.tasksOpened}
        runningOp={extra.runningOp}
      />,
    )
  })
  await act(async () => { await Promise.resolve() })
}

describe('四态操作栏与指引句', () => {
  it('draft 未评审时评审为主按钮，修改需求为次，确认需求禁用并说明原因', async () => {
    await renderDetail({ ...DRAFT, reviews: [] }, callsOf())
    const review = element('requirement-detail-review') as HTMLButtonElement
    expect(review.disabled).toBe(false)
    expect(review.getAttribute('data-variant')).toBe('primary')
    expect(review.textContent).toContain('发起评审')
    expect(element('requirement-detail-revise')).not.toBeNull()
    expect(element('requirement-split')).toBeNull()
    expect(element('requirement-detail-create-based')).toBeNull()
    expect(element('requirement-guide')?.textContent).toContain('待评审')
    expect((element('requirement-approve') as HTMLButtonElement).disabled).toBe(true)
    expect(element('requirement-phase-hint')?.textContent).toContain('第 1 步')
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
    expect(element('requirement-split-again')).not.toBeNull()
    expect(element('requirement-detail-tasks')).not.toBeNull()
    await press('requirement-detail-tasks')
    expect(calls.tasksOpened).toHaveBeenCalledTimes(1)
  })

  it('confirmed 半截拆分无岗位建议时保留补充拆分入口，点击重新发拆分', async () => {
    const confirmed: RequirementDocRow = { ...DRAFT, state: 'confirmed' }
    const calls = callsOf()
    await renderDetail(confirmed, calls, { tasks: [TASK] })
    const again = element('requirement-split-again') as HTMLButtonElement
    expect(again.getAttribute('data-testid')).toBe('requirement-split-again')
    expect(again.disabled).toBe(false)
    await press('requirement-split-again')
    expect(calls.split).toHaveBeenCalledTimes(1)
    expect(element('requirement-action-result')?.textContent).toContain('拆分指令已发送')
  })

  it('有岗位建议时不再重复给补充拆分入口', async () => {
    const confirmed: RequirementDocRow = {
      ...DRAFT,
      state: 'confirmed',
      splitPlan: { at: '2026-11-17T15:00:00+08:00', entries: [{ task: 'T-01', role: 'dev' }] },
    }
    await renderDetail(confirmed, callsOf(), { tasks: [TASK] })
    expect(element('requirement-split-again')).toBeNull()
    expect(element('requirement-detail-tasks')).not.toBeNull()
    expect(element('requirement-split-plan')).not.toBeNull()
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
    expect(element('requirement-document-body')).not.toBeNull()
    expect(element('requirement-guide')?.textContent).toContain('状态未知')
  })
})

describe('头部单行标题', () => {
  it('大标题取 row.title，状态徽标、REQ 编号与全局动作同排；正文内联在详情主区，首屏即可读', async () => {
    await renderDetail(DRAFT, callsOf())
    const title = element('requirement-detail-title')
    expect(title?.textContent).toBe('佣金改造')
    expect(title?.tagName).toBe('H2')
    expect(element('requirement-state-badge')?.textContent).toBe('草稿')
    expect(element('requirement-state-badge')?.className).toContain('state-draft')
    expect(element('requirement-detail-id')?.textContent).toBe('REQ-01')
    const titleRow = container.querySelector('.requirement-title-row') as HTMLElement
    expect(titleRow).not.toBeNull()
    for (const id of ['requirement-detail-title', 'requirement-state-badge', 'requirement-detail-id', 'requirement-global-actions', 'requirement-close']) {
      expect(titleRow.contains(element(id))).toBe(true)
    }
    const body = element('requirement-document-body')
    expect(body).not.toBeNull()
    expect(body?.className).toContain('markdown-body')
    expect(body?.querySelector('h1')?.textContent).toContain('文档自带大标题')
    expect(element('requirement-open-reader')).toBeNull()
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
        { round: 2, at: '2026-11-17T11:30:00+08:00', report: 'requirements/REQ-01/reviews/R2.md', role: 'maniu-manager', decision: 'accepted' },
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
        { round: 2, at: '2026-11-17T11:30:00+08:00', report: 'requirements/REQ-01/reviews/R2.md', role: 'maniu-manager', decision: 'accepted' },
      ],
    }
    await renderDetail(row, callsOf(), { flow, roles: ROSTER })
    expect((element('requirement-approve') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('当前正文内联在详情主区', () => {
  it('打开即可读完整 Markdown 正文，不再需要折叠开关，也不再叠一层全屏阅读器入口', async () => {
    await renderDetail(DRAFT, callsOf())
    const body = element('requirement-document-body')
    expect(body).not.toBeNull()
    expect(body?.className).toContain('markdown-body')
    expect(body?.textContent).toContain('这是正文的第 1 行')
    expect(body?.textContent).toContain('这是正文的第 12 行')
    expect(element('requirement-document-preview')).toBeNull()
    expect(element('requirement-document-empty')).toBeNull()
    expect(element('requirement-body-toggle')).toBeNull()
    expect(element('requirement-open-reader')).toBeNull()
  })
})

describe('评审报告单份 Markdown', () => {
  it('报告标签直接渲染完整 Markdown，不再有摘要卡、收起开关与重复摘录', async () => {
    await renderDetail(DRAFT, callsOf())
    await openTab('[data-testid="requirement-workface-review"]')
    const body = element('requirement-report-body')
    expect(body?.className).toContain('markdown-body')
    expect(body?.className).toContain('document-body')
    expect(body?.querySelector('h1')?.textContent).toContain('评审结论')
    expect(body?.textContent).toContain('评审意见正文')
    expect(element('requirement-report-summary')).toBeNull()
    expect(element('requirement-report-excerpt')).toBeNull()
    expect(element('requirement-report-toggle')).toBeNull()
    expect(element('requirement-report-open')).toBeNull()
    expect(element('requirement-review-accept-hint')).toBeNull()
  })

  it('结构化报告默认给摘要条与紧凑表格，Markdown 全文只在切换后渲染', async () => {
    reportText = STRUCTURED_REPORT
    await renderDetail(DRAFT, callsOf())
    await openTab('[data-testid="requirement-workface-review"]')
    expect(element('requirement-report-body')).toBeNull()
    expect(element('requirement-review-summary-bar')?.textContent).toContain('主要缺口是')
    expect(container.querySelectorAll('[data-testid="requirement-review-todo-row"]')).toHaveLength(2)
    expect(container.textContent).not.toContain('建议补上代发订单不参与佣金')
    // 切换后只显示一份 Markdown，不再同时画表格与文字墙。
    await openTab('[data-testid="requirement-report-markdown-toggle"]')
    const body = element('requirement-report-body')
    expect(body?.querySelectorAll('h2')).toHaveLength(3)
    expect(body?.querySelector('h2')?.textContent).toBe('摘要')
    expect(body?.textContent).toContain('建议补上代发订单不参与佣金')
    expect(element('requirement-review-todos')).toBeNull()
  })

  it('报告生成时间移入操作栏右侧，按可读格式展示', async () => {
    await renderDetail(DRAFT, callsOf())
    await openTab('[data-testid="requirement-workface-review"]')
    expect(element('requirement-review-at')?.textContent).toBe('2026-11-17 10:30')
    expect(element('requirement-review-at')?.closest('[data-testid="requirement-actions-review"]')).not.toBeNull()
  })
})

describe('详情页去冗余', () => {
  it('候选做法、推荐、讨论历史与阶段进度里的关联任务都不再渲染', async () => {
    const row: RequirementDocRow = {
      ...DRAFT,
      options: [{ name: '加参数', summary: '改动小' }],
      recommendation: '推荐加参数',
    }
    await renderDetail(row, callsOf(), { tasks: [TASK] })
    expect(element('requirement-options')).toBeNull()
    expect(element('requirement-recommendation')).toBeNull()
    expect(element('requirement-history')).toBeNull()
    expect(element('requirement-timeline-split')).toBeNull()
    expect(element('requirement-related')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="requirement-related-task"]')).toHaveLength(1)
  })
})

describe('阶段进度 chips', () => {
  it('节点保留在文档阅读区之后但不再展示，评审与版本仍带打开入口', async () => {
    const calls = callsOf()
    await renderDetail(DRAFT, calls)
    const body = container.querySelector('.detail-drawer-body')
    const pane = body?.querySelector('.detail-content-pane')
    const order = Array.from(pane?.children ?? []).map(node => node.getAttribute('data-testid'))
    expect(order.slice(0, 4)).toEqual([
      'requirement-doc-tabs',
      'requirement-actions',
      'requirement-doc-pane',
      'requirement-related',
    ])
    expect(element('requirement-history-layer')?.hasAttribute('hidden')).toBe(true)
    expect(element('requirement-history-drawer')?.querySelector('.timeline-chips')).not.toBeNull()
    expect(element('requirement-timeline-approved')?.textContent).toContain('尚未过审')

    await act(async () => {
      ;(container.querySelector('[data-testid="requirement-open-version"][data-version="2"]') as HTMLElement).click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(calls.readers).toEqual(['.spec/requirements/REQ-01/versions/v2.md'])
  })
})

describe('版本对照只读入口', () => {
  it('两个版本时给对比上一版，双栏展示 v(n-1)→v(n) 差异且不写盘', async () => {
    await renderDetail(DRAFT, callsOf())
    const compareButton = container.querySelector('[data-testid="requirement-compare-version"][data-version="2"]')
    expect(compareButton).not.toBeNull()
    await press('requirement-compare-version')

    const layer = element('requirement-version-compare')
    expect(layer).not.toBeNull()
    expect(layer?.getAttribute('data-version')).toBe('2')
    expect(element('requirement-version-compare-loading') ?? element('requirement-version-compare-old')).not.toBeNull()

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(element('requirement-version-compare-old')?.textContent).toContain('旧版正文')
    expect(element('requirement-version-compare-new')?.textContent).toContain('新版正文')
    expect(element('requirement-version-compare-old')?.querySelector('.compare-line.removed')).not.toBeNull()
    expect(element('requirement-version-compare-new')?.querySelector('.compare-line.added')).not.toBeNull()
    expect(commands).toEqual([])

    await press('requirement-version-compare-close')
    expect(element('requirement-version-compare')).toBeNull()
  })

  it('只有一个版本时不显示对比入口', async () => {
    const row: RequirementDocRow = { ...DRAFT, versions: [{ n: 1, at: '2026-11-17T09:00:00+08:00' }] }
    await renderDetail(row, callsOf())
    expect(element('requirement-compare-version')).toBeNull()
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

describe('评审三态驱动的主次操作', () => {
  const PENDING: RequirementDocRow = {
    ...DRAFT,
    versions: [{ n: 1, at: '2026-11-17T09:00:00+08:00' }],
    reviews: [{ round: 1, at: '2026-11-17T10:30:00+08:00', report: 'requirements/REQ-01/reviews/R1.md', role: 'maniu-pm' }],
  }
  const REJECTED: RequirementDocRow = {
    ...DRAFT,
    reviews: [{
      round: 1,
      at: '2026-11-17T10:30:00+08:00',
      report: 'requirements/REQ-01/reviews/R1.md',
      role: 'maniu-pm',
      decision: 'rejected',
      decidedAt: '2026-11-17T11:00:00+08:00',
    }],
  }

  it('最新一轮待处置时只保留醒目横幅，评审/改稿/确认都禁用并联动报告标签', async () => {
    const calls = callsOf()
    await renderDetail(PENDING, calls)
    const review = element('requirement-detail-review') as HTMLButtonElement
    expect(review.disabled).toBe(true)
    expect(review.title).toContain('R1 评审尚未处理')
    expect(review.getAttribute('data-variant')).toBe('secondary')
    const banner = element('requirement-review-pending-reason')
    expect(banner?.textContent).toContain('R1 评审待处理')
    expect(banner?.textContent).toContain('当前需求版本已锁定')
    expect(banner?.className).toContain('detail-warning')
    // 待处置态不再叠加灰色的阶段提示与确认原因。
    expect(element('requirement-phase-hint')).toBeNull()
    expect(element('requirement-approve-hint')).toBeNull()
    // 送审即锁定：原地修改需求也被禁用。
    const revise = element('requirement-detail-revise') as HTMLButtonElement
    expect(revise.disabled).toBe(true)
    expect(revise.title).toContain('送审后已锁定')
    // 顶部的灰色指引句在黄色横幅出现时不再复读。
    expect(element('requirement-guide')).toBeNull()
    expect((element('requirement-approve') as HTMLButtonElement).getAttribute('data-variant')).toBe('secondary')
    expect((element('requirement-approve') as HTMLButtonElement).disabled).toBe(true)
    // 文档栏默认联动到最新报告，正文/时间线/报告节点仍留在 DOM。
    expect(element('requirement-workface-review')?.getAttribute('data-active')).toBe('true')
    expect(element('requirement-review-report')?.getAttribute('data-pending-report')).toBe('true')
    expect(element('requirement-document-body')).not.toBeNull()
    expect(element('requirement-timeline')).not.toBeNull()
    await press('requirement-detail-review')
    expect(calls.review).not.toHaveBeenCalled()
  })

  it('已采纳生成新版后解锁复评与原地改稿，确认恢复主按钮', async () => {
    await renderDetail(DRAFT, callsOf())
    const review = element('requirement-detail-review') as HTMLButtonElement
    expect(review.disabled).toBe(false)
    expect(review.textContent).toContain('发起复评')
    expect(review.getAttribute('data-variant')).toBe('secondary')
    expect((element('requirement-detail-revise') as HTMLButtonElement).disabled).toBe(false)
    expect(element('requirement-guide')?.textContent).toContain('已生成 v2')
    expect((element('requirement-approve') as HTMLButtonElement).getAttribute('data-variant')).toBe('primary')
  })

  it('已放弃时可重新评审或定稿，但原地改稿仍锁定', async () => {
    await renderDetail(REJECTED, callsOf())
    expect((element('requirement-detail-review') as HTMLButtonElement).disabled).toBe(false)
    expect((element('requirement-detail-revise') as HTMLButtonElement).disabled).toBe(true)
    expect(element('requirement-guide')?.textContent).toContain('已放弃 R1')
    expect((element('requirement-approve') as HTMLButtonElement).getAttribute('data-variant')).toBe('primary')
  })

  it('刷新收进右上角工具组，当前正文不再有重复的全屏阅读器入口', async () => {
    await renderDetail(DRAFT, callsOf())
    const tools = element('requirement-quick-tools')
    expect(tools).not.toBeNull()
    expect(tools?.closest('.detail-drawer-bar')).not.toBeNull()
    expect(tools?.querySelector('[data-testid="requirement-detail-reload"]')).not.toBeNull()
    expect(tools?.querySelector('[data-testid="requirement-open-reader"]')).toBeNull()
    expect(element('requirement-actions')?.querySelector('[data-testid="requirement-detail-reload"]')).toBeNull()
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

  it('刷新是常驻次级动作，当前正文首屏可读且不再叠全屏阅读器入口', async () => {
    const calls = callsOf()
    await renderDetail(DRAFT, calls)
    await press('requirement-detail-reload')
    expect(calls.reload).toHaveBeenCalledTimes(1)
    expect(element('requirement-document-body')?.textContent).toContain('这是正文的第 1 行')
    expect(element('requirement-open-reader')).toBeNull()
  })
})

describe('独立文档切换栏', () => {
  it('草稿/版本/报告并列为标签，锁定版本与已处置报告给出只读徽标，正文与报告节点常驻 DOM', async () => {
    await renderDetail(DRAFT, callsOf())
    expect(element('requirement-doc-tabs')).not.toBeNull()
    const bodyTab = element('requirement-workface-body')
    expect(bodyTab?.textContent).toContain('需求正文')
    expect(bodyTab?.getAttribute('data-active')).toBe('true')

    // 草稿期不显示关联任务面；有评审才显示评审处理面。
    expect(element('requirement-workface-review')).not.toBeNull()
    expect(element('requirement-workface-review')?.getAttribute('data-pending')).toBe('false')
    expect(element('requirement-workface-tasks')).toBeNull()

    const confirmed: RequirementDocRow = { ...DRAFT, state: 'confirmed' }
    await renderDetail(confirmed, callsOf())
    expect(element('requirement-workface-tasks')).not.toBeNull()
    // 切换工作面只切高亮，正文/时间线/报告节点仍在 DOM 供既有查询使用。
    expect(element('requirement-document-body')).not.toBeNull()
    expect(element('requirement-review-report')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="requirement-timeline-version"]')).toHaveLength(2)
  })
})

describe('工作面按阶段收敛', () => {
  it('纯草稿隐藏评审处理与关联任务', async () => {
    const pureDraft: RequirementDocRow = {
      ...DRAFT,
      versions: [],
      reviews: [],
    }
    await renderDetail(pureDraft, callsOf())
    expect(element('requirement-workface-body')?.getAttribute('data-active')).toBe('true')
    expect(element('requirement-workface-review')).toBeNull()
    expect(element('requirement-workface-tasks')).toBeNull()
    expect(element('requirement-history-trigger')?.textContent).toContain('v1')
    expect(element('requirement-history-trigger')?.textContent).not.toContain('R')
  })

  it('pending 评审默认进入评审处理并高亮', async () => {
    const pending: RequirementDocRow = {
      ...DRAFT,
      reviews: [{ round: 2, at: '2026-11-17T12:00:00+08:00', report: 'requirements/REQ-01/reviews/R2.md', role: 'maniu-pm' }],
    }
    await renderDetail(pending, callsOf())
    expect(element('requirement-workface-review')?.getAttribute('data-active')).toBe('true')
    expect(element('requirement-workface-review')?.getAttribute('data-pending')).toBe('true')
    expect(element('requirement-workface-pending-badge')).not.toBeNull()
    expect(element('requirement-review-report')?.hasAttribute('hidden')).toBe(false)
    expect(element('requirement-document')?.hasAttribute('hidden')).toBe(true)
    expect(element('requirement-history-trigger')?.textContent).toContain('v2')
    expect(element('requirement-history-trigger')?.textContent).toContain('R2')
  })
})

describe('文档栏四层顺序与专属操作栏', () => {
  const PENDING: RequirementDocRow = {
    ...DRAFT,
    versions: [{ n: 1, at: '2026-11-17T09:00:00+08:00' }],
    reviews: [{ round: 1, at: '2026-11-17T10:30:00+08:00', report: 'requirements/REQ-01/reviews/R1.md', role: 'maniu-pm' }],
  }

  function hidden(element: Element | null): boolean {
    return element?.hasAttribute('hidden') === true
  }

  it('全局头部、标签栏、文档操作栏、正文阅读区自上而下排列，头部只占一行', async () => {
    await renderDetail(DRAFT, callsOf())
    const hero = container.querySelector('.requirement-hero') as HTMLElement
    const tabs = element('requirement-doc-tabs') as HTMLElement
    const actions = element('requirement-actions') as HTMLElement
    const docPane = element('requirement-doc-pane') as HTMLElement
    expect(hero.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tabs.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(actions.compareDocumentPosition(docPane) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const titleRow = element('requirement-detail-title')?.parentElement as HTMLElement
    expect(titleRow.className).toContain('requirement-title-row')
    for (const id of ['requirement-detail-title', 'requirement-state-badge', 'requirement-detail-id', 'requirement-global-actions', 'requirement-close']) {
      expect(titleRow.contains(element(id))).toBe(true)
    }
    expect(element('requirement-global-actions')?.closest('.requirement-hero')).not.toBeNull()
    expect(element('requirement-close')?.closest('.requirement-hero')).not.toBeNull()
    // 关闭按钮排在全局动作行的最末，标题行内没有独立占行的动作区。
    const ops = element('requirement-global-actions') as HTMLElement
    expect(ops.lastElementChild?.getAttribute('data-testid')).toBe('requirement-close')
    expect(element('requirement-actions')?.getAttribute('data-active-doc')).toBe('draft')
  })

  it('草稿标签只给评审/修改/确认三按钮，正文显示当前草稿', async () => {
    await renderDetail(DRAFT, callsOf())
    const draftGroup = element('requirement-actions-draft') as HTMLElement
    expect(hidden(draftGroup)).toBe(false)
    expect(element('requirement-detail-review')?.closest('[hidden]')).toBeNull()
    expect(element('requirement-detail-revise')).not.toBeNull()
    expect(element('requirement-approve')).not.toBeNull()
    expect(element('requirement-actions-review')).toBeNull()
    expect(element('requirement-actions-version')).toBeNull()
    expect(hidden(element('requirement-document'))).toBe(false)
    expect(hidden(element('requirement-review-report'))).toBe(true)
  })

  it('待处置报告标签只给采纳/放弃，草稿三按钮隐藏但仍在 DOM', async () => {
    const calls = callsOf()
    await renderDetail(PENDING, calls)
    expect(element('requirement-actions-review')?.getAttribute('data-decision')).toBe('pending')
    expect(element('requirement-review-accept')?.textContent).toContain('提交所选处理')
    expect(element('requirement-review-count')?.textContent).toContain('采纳 0')
    expect(element('requirement-review-reject')?.textContent).toContain('整轮放弃（全部不改）')
    // 采纳走 requirement_revise 直接落新版本，不再有「去顶部对比」的灰字提示。
    expect(element('requirement-review-accept-hint')).toBeNull()
    expect(element('requirement-review-at')?.textContent).toBe('2026-11-17 10:30')
    expect(hidden(element('requirement-actions-draft'))).toBe(true)
    // 既有查询仍能拿到草稿按钮，只是当前标签下不可见。
    expect(element('requirement-detail-review')).not.toBeNull()
    expect(element('requirement-detail-revise')).not.toBeNull()
    expect(element('requirement-approve')).not.toBeNull()
    expect(hidden(element('requirement-document'))).toBe(true)
    expect(hidden(element('requirement-review-report'))).toBe(false)
    expect(element('requirement-review-report')?.getAttribute('data-round')).toBe('1')
    expect(element('requirement-report-body')?.textContent).toContain('评审意见正文')

    await press('requirement-review-reject')
    expect(commands).toEqual(['/requirement_review_decide REQ-01 1 rejected'])
  })

  it('切回草稿标签只给草稿三按钮并隐藏报告区，待处置仍禁用', async () => {
    await renderDetail(PENDING, callsOf())
    await openTab('[data-testid="requirement-workface-body"]')
    expect(hidden(element('requirement-actions-draft'))).toBe(false)
    expect(element('requirement-actions-review')).toBeNull()
    expect(element('requirement-review-decision')).toBeNull()
    expect((element('requirement-detail-review') as HTMLButtonElement).disabled).toBe(true)
    expect((element('requirement-detail-revise') as HTMLButtonElement).disabled).toBe(true)
    expect(hidden(element('requirement-document'))).toBe(false)
    expect(hidden(element('requirement-review-report'))).toBe(true)
    expect(element('requirement-review-report')).not.toBeNull()
  })

  it('历史抽屉展开版本快照并给对比上一版，只读展示且不写盘', async () => {
    await renderDetail(DRAFT, callsOf())
    await openTab('[data-testid="requirement-history-version-toggle"][data-version="2"]')
    const snapshot = element('requirement-version-document')
    expect(snapshot?.getAttribute('data-version')).toBe('2')
    expect(snapshot?.textContent).toContain('只读')
    expect(container.querySelector('[data-testid="requirement-compare-version"][data-version="2"]')).not.toBeNull()
    expect(element('requirement-version-document-body')?.textContent).toContain('新版正文')
    // 时间线版本 chips 仍在 DOM 供既有查询。
    expect(container.querySelectorAll('[data-testid="requirement-timeline-version"]')).toHaveLength(2)

    await press('requirement-compare-version')
    expect(element('requirement-version-compare')?.getAttribute('data-version')).toBe('2')
  })

  it('已处置报告标签只读：给结论徽标与只读说明，没有写操作按钮', async () => {
    await renderDetail(DRAFT, callsOf())
    await openTab('[data-testid="requirement-workface-review"]')
    expect(element('requirement-review-decided-status')?.textContent).toContain('已采纳')
    expect(element('requirement-review-decided')?.textContent).toContain('只读')
    expect(element('requirement-review-accept')).toBeNull()
    expect(element('requirement-review-reject')).toBeNull()
    expect(element('requirement-report-body')).not.toBeNull()
  })
})

describe('在途操作互斥锁定', () => {
  it('runningOp 非空时详情业务按钮全部锁定并给出对应提示', async () => {
    await renderLockedDetail(DRAFT, { runningOp: 'review' })
    for (const id of ['requirement-detail-review', 'requirement-detail-revise', 'requirement-approve', 'requirement-close']) {
      expect((element(id) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(element('requirement-op-locked-hint')?.textContent).toContain('需求评审')
    expect((element('requirement-detail-review') as HTMLButtonElement).title).toContain('需求评审')
  })

  it('四种在途操作给出各自的提示文案', async () => {
    const cases = [
      ['review', '需求评审'],
      ['revise', '需求改稿'],
      ['patch', '修改提案'],
      ['split', '需求拆分'],
    ] as const
    for (const [kind, word] of cases) {
      await renderLockedDetail(DRAFT, { runningOp: kind })
      expect(element('requirement-op-locked-hint')?.textContent).toContain(word)
    }
  })

  it('未传 runningOp 时行为不变，点修改需求仍走回调', async () => {
    const onModifyRequest = vi.fn()
    await renderLockedDetail(DRAFT, { onModifyRequest })
    expect((element('requirement-detail-review') as HTMLButtonElement).disabled).toBe(false)
    expect(element('requirement-op-locked-hint')).toBeNull()
    await press('requirement-detail-revise')
    expect(onModifyRequest).toHaveBeenCalledTimes(1)
  })

  it('锁定时点修改需求不触发打开说明栏回调', async () => {
    const onModifyRequest = vi.fn()
    await renderLockedDetail(DRAFT, { runningOp: 'review', onModifyRequest })
    await press('requirement-detail-revise')
    expect(onModifyRequest).not.toHaveBeenCalled()
  })
})
