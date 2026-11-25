// @vitest-environment jsdom
/** T-238 阶段时间线；T-311：时间线迁入历史抽屉，按时间倒序展示版本快照与只读评审报告。 */
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

const ROW: RequirementDocRow = {
  id: 'REQ-01',
  title: '评审需求',
  text: '需求正文',
  state: 'draft',
  options: [],
  openedAt: '2026-11-17T09:00:00+08:00',
  versions: [
    { n: 1, at: '2026-11-17T09:00:00+08:00', note: '初稿' },
    { n: 2, at: '2026-11-17T11:00:00+08:00' },
  ],
  reviews: [{ round: 1, at: '2026-11-17T10:30:00+08:00', report: 'requirements/REQ-01/reviews/R1.md' }],
  approvedAt: '2026-11-17T12:00:00+08:00',
  approvedVersion: 2,
}

const UNREVIEWED: RequirementDocRow = {
  id: 'REQ-02',
  title: '未评审需求',
  text: '正文',
  state: 'draft',
  options: [],
  versions: [],
  reviews: [],
}

function projectionOf(requirements: readonly RequirementDocRow[]): SpecProjection {
  return {
    tasks: [TASK],
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
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: { call: vi.fn(async () => ({ ok: true, value: { text: '# 评审报告' } })) },
  })
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
  readonly tasksOpened: () => void
  readonly split: () => Promise<{ readonly ok: boolean; readonly message: string }>
}

async function renderDetail(row: RequirementDocRow, calls: DetailCalls): Promise<void> {
  act(() => {
    root.render(
      <RequirementDetail
        row={row}
        project={PROJECT}
        projection={projectionOf([row])}
        sessions={[]}
        onClose={() => {}}
        onOpenTask={() => {}}
        onOpenReader={(path) => { calls.readers.push(path) }}
        onReload={() => {}}
        onSplit={calls.split}
        onReview={async () => ({ ok: true, message: 'ok' })}
        onRevise={async () => ({ ok: true, message: 'ok' })}
        onModifyRequest={() => {}}
        onCreateBased={async () => ({ ok: true, message: 'ok' })}
        onOpenTasks={calls.tasksOpened}
      />,
    )
  })
  await act(async () => { await Promise.resolve() })
}

async function pressSelector(selector: string): Promise<void> {
  const node = container.querySelector(selector)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function callsOf(): DetailCalls {
  return { readers: [], tasksOpened: () => {}, split: async () => ({ ok: true, message: 'ok' }) }
}

describe('需求详情阶段时间线', () => {
  it('列出创建、评审、版本与过审，v1 合并显示创建标识且不重复出现独立创建项', async () => {
    await renderDetail(ROW, callsOf())

    expect(element('requirement-timeline-opened')).toBeNull()

    const reviews = container.querySelectorAll('[data-testid="requirement-timeline-review"]')
    expect(reviews).toHaveLength(1)
    expect(reviews[0]?.textContent).toContain('评审 R1')
    expect(reviews[0]?.textContent).toContain('2026-11-17 10:30')

    // 混排条目按落盘时间倒序：v2(11:00，最新) → R1(10:30) → v1(09:00，创建)。
    const versions = container.querySelectorAll('[data-testid="requirement-timeline-version"]')
    expect(versions).toHaveLength(2)
    expect(versions[0]?.textContent).toContain('版本 v2')
    expect(versions[0]?.textContent).toContain('最新')
    expect(versions[0]?.textContent).toContain('2026-11-17 11:00')
    expect(versions[1]?.textContent).toContain('版本 v1')
    expect(versions[1]?.textContent).toContain('创建')
    expect(versions[1]?.textContent).toContain('2026-11-17 09:00')

    const approved = element('requirement-timeline-approved')
    expect(approved?.textContent).toContain('2026-11-17 12:00')
    expect(approved?.textContent).toContain('批准版本 v2')

    expect(element('requirement-history-drawer')).not.toBeNull()
    expect(element('requirement-history-layer')?.hasAttribute('hidden')).toBe(true)
  })

  it('历史抽屉只保留打开快照与打开报告入口，不重复渲染查看按钮', async () => {
    const calls = callsOf()
    await renderDetail(ROW, calls)

    expect(container.querySelector('[data-testid="requirement-history-report-toggle"]')).toBeNull()
    expect(container.querySelector('[data-testid="requirement-history-version-toggle"]')).toBeNull()

    await pressSelector('[data-testid="requirement-open-report"][data-path=".spec/requirements/REQ-01/reviews/R1.md"]')
    expect(calls.readers).toEqual(['.spec/requirements/REQ-01/reviews/R1.md'])

    await pressSelector('[data-testid="requirement-open-version"][data-version="1"]')
    expect(calls.readers[1]).toBe('.spec/requirements/REQ-01/versions/v1.md')

    await pressSelector('[data-testid="requirement-open-version"][data-version="2"]')
    expect(calls.readers[2]).toBe('.spec/requirements/REQ-01/versions/v2.md')
  })

  it('右上角历史入口打开抽屉：打开快照与对比上一版', async () => {
    const calls = callsOf()
    await renderDetail(ROW, calls)

    expect(element('requirement-history-layer')?.hasAttribute('hidden')).toBe(true)
    await pressSelector('[data-testid="requirement-history-trigger"]')
    expect(element('requirement-history-layer')?.hasAttribute('hidden')).toBe(false)
    expect(element('requirement-version-badge')?.textContent).toBe('v2')
    expect(element('requirement-history-trigger')?.getAttribute('aria-label')).toContain('v2')
    expect(element('requirement-history-trigger')?.getAttribute('aria-label')).toContain('R1')

    await pressSelector('[data-testid="requirement-open-version"][data-version="2"]')
    expect(calls.readers).toContain('.spec/requirements/REQ-01/versions/v2.md')

    await pressSelector('[data-testid="requirement-compare-version"][data-version="2"]')
    expect(element('requirement-version-compare')?.getAttribute('data-version')).toBe('2')

    await pressSelector('[data-testid="requirement-history-close"]')
    expect(element('requirement-history-layer')?.hasAttribute('hidden')).toBe(true)
  })

  it('有关联任务时查看任务进入任务页', async () => {
    const opened = vi.fn()
    await renderDetail(ROW, { readers: [], tasksOpened: opened, split: async () => ({ ok: true, message: 'ok' }) })
    await pressSelector('[data-testid="requirement-view-tasks"]')
    expect(opened).toHaveBeenCalledTimes(1)
  })
})

describe('工作面切换', () => {
  it('待处置评审默认进入评审处理面，切到正文面才看到草稿动作，版本快照在历史抽屉展开', async () => {
    const calls = callsOf()
    await renderDetail(ROW, calls)

    // 最新一轮待处置：默认落在评审处理面，评审决策栏可见，顶部操作栏也保持统一位置。
    expect(element('requirement-review-decision')).not.toBeNull()
    expect(element('requirement-actions')?.hasAttribute('hidden')).toBe(false)
    expect(element('requirement-review-report')?.hasAttribute('hidden')).toBe(false)
    expect(element('requirement-workface-review')?.getAttribute('data-active')).toBe('true')

    await pressSelector('[data-testid="requirement-workface-body"]')
    expect(element('requirement-review-decision')).toBeNull()
    expect(element('requirement-actions')?.hasAttribute('hidden')).toBe(true)
    expect(element('requirement-global-actions')?.querySelector('[data-testid="requirement-detail-review"]')).not.toBeNull()
    expect(element('requirement-document-body')?.textContent).toContain('需求正文')
    expect(element('requirement-review-report')?.hasAttribute('hidden')).toBe(true)

    expect(container.querySelectorAll('[data-testid="requirement-timeline-version"]')).toHaveLength(2)
  })
})

describe('确认需求的评审门槛', () => {
  it('没有评审时禁用确认并说明原因', async () => {
    await renderDetail(UNREVIEWED, callsOf())
    const approve = element('requirement-approve') as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(approve.title).toContain('至少完成一轮评审')
    expect(element('requirement-approve-hint')).toBeNull()
  })

  it('有一轮已处置的评审后可以确认', async () => {
    const resolved: RequirementDocRow = {
      ...ROW,
      reviews: ROW.reviews.map(review => ({ ...review, decision: 'accepted' as const })),
    }
    await renderDetail(resolved, callsOf())
    const approve = element('requirement-approve') as HTMLButtonElement
    expect(approve.disabled).toBe(false)
    expect(element('requirement-approve-hint')).toBeNull()
  })
})
