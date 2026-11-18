// @vitest-environment jsdom
/** T-242 内联评审报告（T-250 起默认折叠摘要卡）：取数通道、展开渲染、失败退回阅读器；确认与改稿在顶部操作栏。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { RequirementDetail } from '../src/pages/requirement-detail.tsx'
import type { RequirementDocRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const REVIEWED: RequirementDocRow = {
  id: 'REQ-01',
  title: '评审需求',
  text: '需求正文',
  state: 'draft',
  options: [],
  versions: [{ n: 1, at: '2026-11-17T09:00:00+08:00' }],
  reviews: [
    { round: 2, at: '2026-11-17T11:00:00+08:00', report: 'requirements/REQ-01/reviews/R2.md' },
    { round: 1, at: '2026-11-17T10:00:00+08:00', report: 'requirements/REQ-01/reviews/R1.md' },
  ],
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

function projectionOf(row: RequirementDocRow): SpecProjection {
  return {
    tasks: [],
    rules: [],
    contracts: [],
    proposals: [],
    requirements: [row],
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
let reads: { readonly scope: string; readonly path: string }[]
let commands: string[]
let failRead = false

async function fakeCall(namespace: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  if (namespace === 'workspaceFiles' && method === 'read') {
    const path = typeof args.path === 'string' ? args.path : ''
    reads.push({ scope: String(args.workspaceFileScopeId), path })
    if (failRead) return { ok: false, error: { code: 'ENOENT', message: '文件不存在' } }
    return { ok: true, value: { text: `# 评审结论 ${path}` } }
  }
  if (namespace === 'commands' && method === 'execute') {
    commands.push(String(args.line))
    return { ok: true, value: { result: { kind: 'success', text: 'REQ-01 已过审' } } }
  }
  throw new Error(`未预期调用 ${namespace}/${method}`)
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  reads = []
  commands = []
  failRead = false
  Object.defineProperty(window, 'lcoder', { configurable: true, value: { call: vi.fn(fakeCall) } })
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
  readonly revise: Mock<() => Promise<{ readonly ok: boolean; readonly message: string }>>
}

function callsOf(): DetailCalls {
  return { readers: [], revise: vi.fn(async () => ({ ok: true, message: '改稿指令已发送' })) }
}

async function renderDetail(row: RequirementDocRow, calls: DetailCalls): Promise<void> {
  act(() => {
    root.render(
      <RequirementDetail
        row={row}
        project={PROJECT}
        projection={projectionOf(row)}
        sessions={[]}
        onClose={() => {}}
        onOpenTask={() => {}}
        onOpenReader={(path) => { calls.readers.push(path) }}
        onReload={() => {}}
        onSplit={async () => ({ ok: true, message: 'ok' })}
        onReview={async () => ({ ok: true, message: 'ok' })}
        onRevise={calls.revise}
        onCreateBased={async () => ({ ok: true, message: 'ok' })}
        onOpenTasks={() => {}}
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

async function pressSelector(selector: string): Promise<void> {
  const node = container.querySelector(selector)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('内联评审报告', () => {
  it('默认折叠成摘要卡，展开后才渲染全文；取数走作用域会话与 .spec 相对路径', async () => {
    await renderDetail(REVIEWED, callsOf())
    const section = element('requirement-review-report')
    expect(section?.getAttribute('data-round')).toBe('2')
    expect(reads).toEqual([{ scope: 'session-scope', path: '.spec/requirements/REQ-01/reviews/R2.md' }])
    expect(element('requirement-report-summary')?.textContent).toContain('2026-11-17 11:00')
    expect(element('requirement-report-excerpt')?.textContent).toContain('评审结论 .spec/requirements/REQ-01/reviews/R2.md')
    expect(element('requirement-report-body')).toBeNull()

    await press('requirement-report-toggle')
    expect(element('requirement-report-body')?.textContent).toContain('评审结论 .spec/requirements/REQ-01/reviews/R2.md')
    expect(element('requirement-report-body')?.querySelector('h1')).not.toBeNull()

    await press('requirement-report-toggle')
    expect(element('requirement-report-body')).toBeNull()
  })

  it('轮次增加后重读新报告，摘要与展开正文都换新', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    const next: RequirementDocRow = {
      ...REVIEWED,
      reviews: [...REVIEWED.reviews, { round: 3, at: '2026-11-17T12:00:00+08:00', report: 'requirements/REQ-01/reviews/R3.md' }],
    }
    await renderDetail(next, calls)
    expect(element('requirement-review-report')?.getAttribute('data-round')).toBe('3')
    expect(reads[reads.length - 1]?.path).toBe('.spec/requirements/REQ-01/reviews/R3.md')
    expect(element('requirement-report-excerpt')?.textContent).toContain('R3.md')
    await press('requirement-report-toggle')
    expect(element('requirement-report-body')?.textContent).toContain('R3.md')
  })

  it('历史轮次逐轮可打开报告，时刻按可读格式展示', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    expect(element('requirement-report-history-toggle')).toBeNull()
    const items = container.querySelectorAll('[data-testid="requirement-review-history-item"]')
    expect(items).toHaveLength(1)
    expect(items[0]?.getAttribute('data-round')).toBe('1')
    expect(items[0]?.textContent).toContain('2026-11-17 10:00')
    await pressSelector('[data-testid="requirement-review-history-item"][data-round="1"] [data-testid="requirement-open-report"]')
    expect(calls.readers).toEqual(['.spec/requirements/REQ-01/reviews/R1.md'])
  })

  it('读取失败给可读错误，并保留阅读器打开入口', async () => {
    failRead = true
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    expect(element('requirement-report-failed')?.textContent).toContain('评审报告读取失败')
    expect(element('requirement-report-failed')?.textContent).toContain('ENOENT')
    expect(element('requirement-report-body')).toBeNull()

    await press('requirement-report-open')
    expect(calls.readers).toEqual(['.spec/requirements/REQ-01/reviews/R2.md'])
  })

  it('未评审时给空态文案，也不发读取请求', async () => {
    await renderDetail(UNREVIEWED, callsOf())
    expect(element('requirement-report-empty')?.textContent).toContain('还没有评审报告')
    expect(element('requirement-report-summary')).toBeNull()
    expect(reads).toHaveLength(0)
  })
})

describe('顶部操作栏的确认与改稿', () => {
  it('确认需求仍走人机命令，成功后展示回执', async () => {
    await renderDetail(REVIEWED, callsOf())
    const approve = element('requirement-approve') as HTMLButtonElement
    expect(approve.disabled).toBe(false)
    await press('requirement-approve')
    expect(commands).toEqual(['/requirement_approve REQ-01'])
    expect(element('requirement-action-result')?.textContent).toContain('REQ-01 已过审')
  })

  it('已确认状态不再渲染确认与改稿按钮，改动走基于此版本新建', async () => {
    const confirmed: RequirementDocRow = { ...REVIEWED, state: 'confirmed' }
    await renderDetail(confirmed, callsOf())
    expect(element('requirement-approve')).toBeNull()
    expect(element('requirement-detail-revise')).toBeNull()
    expect(element('requirement-detail-create-based')).not.toBeNull()
  })

  it('修改需求交给页面级改稿发起', async () => {
    const calls = callsOf()
    await renderDetail(REVIEWED, calls)
    await press('requirement-detail-revise')
    expect(calls.revise).toHaveBeenCalledTimes(1)
    expect(element('requirement-action-result')?.textContent).toContain('改稿指令已发送')
  })
})
