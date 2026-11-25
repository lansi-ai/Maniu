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
    decision: 'rejected',
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
    roles: [{ id: 'deputy-pm', name: '副项目经理', inherits: 'pm' }],
    project: null,
    secrets: {},
    automation: null,
    agents: null,
    ...(flow === undefined ? {} : { flow }),
    problems: [],
  }
}

const TWO_ROLES_AUTO = { nodes: [{ node: 'review' as const, roles: ['maniu-pm', 'deputy-pm'], auto: true }] }
const TWO_ROLES_MANUAL = { nodes: [{ node: 'review' as const, roles: ['maniu-pm', 'deputy-pm'], auto: false }] }

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
    // 多岗卡按配置条目显示名列步骤。
    expect(element('requirement-op-running')?.textContent).toContain('项目经理')
    expect(element('requirement-op-running')?.textContent).toContain('副项目经理')

    h.render(projectionOf([review(1), review(2, 'maniu-pm')], TWO_ROLES_AUTO))
    await settle()
    expect(h.started).toHaveLength(2)
    // 名册岗位条目折算成继承角色的 preset 发起。
    expect(h.started[1]?.preset).toBe('maniu-pm')
    expect(container.querySelectorAll('.op-card')).toHaveLength(1)
    expect(element('requirement-op-running')).not.toBeNull()
    expect(element('op-next-role')).toBeNull()
    const steps = [...(element('requirement-op-running')?.querySelectorAll('li') ?? [])]
    expect(steps[0]?.className).toContain('op-step-done')
    expect(steps[1]?.className).toContain('op-step-active')

    h.render(projectionOf([review(1), review(2, 'maniu-pm'), review(3, 'maniu-pm')], TWO_ROLES_AUTO))
    await settle()
    expect(element('requirement-op-running')).toBeNull()
    expect(element('requirement-op-success')?.textContent).toContain('评审完成')
    expect(h.started).toHaveLength(2)
  })

  it('增轮但最新一轮署名根不匹配当前条目时不算完成，不发起下一岗', async () => {
    const h = harness()
    h.render(projectionOf([review(1)], TWO_ROLES_AUTO))
    await press('requirement-op-review')

    h.render(projectionOf([review(1), review(2, 'maniu-intake')], TWO_ROLES_AUTO))
    await settle()
    expect(h.started).toHaveLength(1)
    expect(element('requirement-op-running')).not.toBeNull()
    expect(element('requirement-op-success')).toBeNull()
  })

  it('有配置时增轮但最新一轮无署名不算完成', async () => {
    const h = harness()
    h.render(projectionOf([review(1)], TWO_ROLES_AUTO))
    await press('requirement-op-review')

    h.render(projectionOf([review(1), review(2)], TWO_ROLES_AUTO))
    await settle()
    expect(h.started).toHaveLength(1)
    expect(element('requirement-op-running')).not.toBeNull()
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
    expect(h.started[1]?.preset).toBe('maniu-pm')
    expect(element('op-next-role')).toBeNull()

    h.render(projectionOf([review(1), review(2, 'maniu-pm'), review(3, 'maniu-pm')], TWO_ROLES_MANUAL))
    await settle()
    expect(element('requirement-op-success')?.textContent).toContain('评审完成')
    expect((element('requirement-op-review') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('岗位到 preset 的折算', () => {
  it('名册岗位按继承角色发起会话，浮卡显示岗位名与自定义来源', async () => {
    const h = harness()
    const flow = { nodes: [{ node: 'review' as const, roles: ['deputy-pm'], auto: false }] }
    h.render(projectionOf([review(1)], flow))
    await press('requirement-op-review')
    expect(h.started).toHaveLength(1)
    expect(h.started[0]?.preset).toBe('maniu-pm')
    expect(element('requirement-op-running')?.textContent).toContain('副项目经理')
    expect(element('op-step-role')?.getAttribute('title')).toContain('自定义岗位')
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

describe('表格行内评审按钮接入共享门禁', () => {
  const pending = (round: number, role?: string): RequirementReviewRow => ({
    round,
    at: '2026-11-17T10:00:00+08:00',
    report: `requirements/REQ-01/reviews/R${String(round)}.md`,
    ...(role === undefined ? {} : { role }),
  })

  it('多岗会审只到一岗时行内评审可用；评齐且有未决轮次时禁用并给原因', () => {
    const h = harness()
    h.render(projectionOf([pending(1, 'maniu-pm')], TWO_ROLES_AUTO))
    expect((element('requirement-op-review') as HTMLButtonElement).disabled).toBe(false)

    h.render(projectionOf([pending(1, 'maniu-pm'), pending(2, 'maniu-pm')], TWO_ROLES_AUTO))
    const blocked = element('requirement-op-review') as HTMLButtonElement
    expect(blocked.disabled).toBe(true)
    expect(blocked.title).toContain('R2 评审尚未处理')
    expect(h.started).toHaveLength(0)
  })

  it('无流程配置时未决评审恒拦重复发起：送审即锁定，正文改过也不放行', () => {
    const h = harness()
    h.render(projectionOf([pending(1)]))
    const blocked = element('requirement-op-review') as HTMLButtonElement
    expect(blocked.disabled).toBe(true)
    expect(blocked.title).toContain('R1 评审尚未处理')

    // 即便正文已改稿（新增晚于评审的版本），未决轮次仍无条件锁定，不放行新一轮。
    const revised: RequirementDocRow = {
      ...draftOf([pending(1)]),
      versions: [
        { n: 1, at: '2026-11-17T09:00:00+08:00' },
        { n: 2, at: '2026-11-17T12:00:00+08:00' },
      ],
    }
    h.render({ ...projectionOf([]), requirements: [revised] })
    const stillBlocked = element('requirement-op-review') as HTMLButtonElement
    expect(stillBlocked.disabled).toBe(true)
    expect(stillBlocked.title).toContain('R1 评审尚未处理')
    expect(h.started).toHaveLength(0)
  })
})
