// @vitest-environment jsdom
/** T-243：四类操作按 flow 配置逐岗推进——auto 自动衔接、manual 下一岗位按钮、署名匹配与岗位步骤。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequirementsPage } from '../src/pages/requirements.tsx'
import type { RequirementDocRow, RequirementReviewRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

function review(round: number, role?: string): RequirementReviewRow {
  return {
    round,
    at: '2026-11-17T10:00:00+08:00',
    report: `requirements/REQ-01/reviews/R${String(round)}.md`,
    ...(role === undefined ? {} : { role }),
  }
}

function draftOf(reviews: readonly RequirementReviewRow[]): RequirementDocRow {
  return {
    id: 'REQ-01',
    title: '草稿需求',
    text: '草稿正文',
    state: 'draft',
    options: [],
    versions: [{ n: 1, at: '2026-11-17T09:00:00+08:00' }],
    reviews,
  }
}

function projectionOf(reviews: readonly RequirementReviewRow[], flow?: SpecProjection['flow']): SpecProjection {
  return {
    tasks: [],
    rules: [],
    contracts: [],
    proposals: [],
    requirements: [draftOf(reviews)],
    groups: [],
    roles: [{ id: 'dotnet-eng', name: '.NET 工程师', inherits: 'dev' }],
    project: null,
    secrets: {},
    automation: null,
    agents: null,
    ...(flow === undefined ? {} : { flow }),
    problems: [],
  }
}

const TWO_ROLES_AUTO = { nodes: [{ node: 'review' as const, roles: ['maniu-pm', 'maniu-review'], auto: true }] }
const TWO_ROLES_MANUAL = { nodes: [{ node: 'review' as const, roles: ['maniu-pm', 'maniu-review'], auto: false }] }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
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
  vi.useRealTimers()
})

function element(testId: string): Element | null {
  return container.querySelector(`[data-testid="${testId}"]`)
}

async function press(testId: string): Promise<void> {
  const node = element(testId)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function settle(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

interface Harness {
  readonly started: { readonly prompt: string; readonly preset?: string }[]
  readonly reload: ReturnType<typeof vi.fn>
  render(projection: SpecProjection): void
}

function harness(): Harness {
  const started: { readonly prompt: string; readonly preset?: string }[] = []
  const reload = vi.fn()
  let seq = 0
  return {
    started,
    reload,
    render(projection) {
      act(() => {
        root.render(
          <RequirementsPage
            project={PROJECT}
            projection={projection}
            sessions={[]}
            loading={false}
            error={null}
            intakeResult={null}
            onClearIntakeResult={() => {}}
            onReload={reload}
            onStartIntake={async () => ({ ok: true, message: 'ok' })}
            onStartSession={async (prompt, preset) => {
              started.push(preset === undefined ? { prompt } : { prompt, preset })
              seq += 1
              return { ok: true, message: 'ok', sessionId: `session-op-${String(seq)}` }
            }}
            onOpenSession={() => {}}
            onOpenTasks={() => {}}
          />,
        )
      })
    },
  }
}

describe('auto 节点内自动衔接', () => {
  it('前一岗署名评审落盘后自动发起下一岗，一节点始终一张卡', async () => {
    const h = harness()
    h.render(projectionOf([review(1)], TWO_ROLES_AUTO))
    await press('requirement-op-review')
    expect(h.started).toHaveLength(1)
    expect(h.started[0]?.preset).toBe('maniu-pm')
    expect(container.querySelectorAll('.op-card')).toHaveLength(1)
    // 多岗卡按岗位列步骤。
    expect(element('requirement-op-running')?.textContent).toContain('项目经理')
    expect(element('requirement-op-running')?.textContent).toContain('评审')

    h.render(projectionOf([review(1), review(2, 'maniu-pm')], TWO_ROLES_AUTO))
    await settle()
    expect(h.started).toHaveLength(2)
    expect(h.started[1]?.preset).toBe('maniu-review')
    expect(container.querySelectorAll('.op-card')).toHaveLength(1)
    expect(element('requirement-op-running')).not.toBeNull()
    expect(element('op-next-role')).toBeNull()
    const steps = [...(element('requirement-op-running')?.querySelectorAll('li') ?? [])]
    expect(steps[0]?.className).toContain('op-step-done')
    expect(steps[1]?.className).toContain('op-step-active')

    h.render(projectionOf([review(1), review(2, 'maniu-pm'), review(3, 'maniu-review')], TWO_ROLES_AUTO))
    await settle()
    expect(element('requirement-op-running')).toBeNull()
    expect(element('requirement-op-success')?.textContent).toContain('评审完成')
    expect(h.started).toHaveLength(2)
  })

  it('增轮但署名不匹配当前岗时不算完成，不发起下一岗', async () => {
    const h = harness()
    h.render(projectionOf([review(1)], TWO_ROLES_AUTO))
    await press('requirement-op-review')

    h.render(projectionOf([review(1), review(2, 'maniu-intake')], TWO_ROLES_AUTO))
    await settle()
    expect(h.started).toHaveLength(1)
    expect(element('requirement-op-running')).not.toBeNull()
    expect(element('requirement-op-success')).toBeNull()
  })
})

describe('manual 节点内等人点下一岗位', () => {
  it('前一岗落盘后停下给按钮，点后才发起下一岗', async () => {
    const h = harness()
    h.render(projectionOf([review(1)], TWO_ROLES_MANUAL))
    await press('requirement-op-review')
    expect(h.started).toHaveLength(1)

    h.render(projectionOf([review(1), review(2, 'maniu-pm')], TWO_ROLES_MANUAL))
    await settle()
    expect(h.started).toHaveLength(1)
    expect(element('op-next-role')).not.toBeNull()
    expect(element('requirement-op-running')?.textContent).toContain('下一岗位')
    expect((element('requirement-op-review') as HTMLButtonElement).disabled).toBe(true)

    await press('op-next-role')
    expect(h.started).toHaveLength(2)
    expect(h.started[1]?.preset).toBe('maniu-review')
    expect(element('op-next-role')).toBeNull()

    h.render(projectionOf([review(1), review(2, 'maniu-pm'), review(3, 'maniu-review')], TWO_ROLES_MANUAL))
    await settle()
    expect(element('requirement-op-success')?.textContent).toContain('评审完成')
    expect((element('requirement-op-review') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('岗位到 preset 的折算', () => {
  it('名册岗位按继承角色发起会话', async () => {
    const h = harness()
    const flow = { nodes: [{ node: 'review' as const, roles: ['dotnet-eng'], auto: false }] }
    h.render(projectionOf([review(1)], flow))
    await press('requirement-op-review')
    expect(h.started).toHaveLength(1)
    expect(h.started[0]?.preset).toBe('maniu-dev')
    expect(element('requirement-op-running')?.textContent).toContain('.NET 工程师')
    expect(element('requirement-op-running')?.textContent).toContain('自定义岗位')
  })

  it('无 flow.yaml 时评审仍走预制 maniu-pm，无署名增轮即完成', async () => {
    const h = harness()
    h.render(projectionOf([review(1)]))
    await press('requirement-op-review')
    expect(h.started[0]?.preset).toBe('maniu-pm')

    h.render(projectionOf([review(1), review(2)]))
    await settle()
    expect(element('requirement-op-success')?.textContent).toContain('评审完成')
  })
})
