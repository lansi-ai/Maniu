// @vitest-environment jsdom
/** T-249：新建需求入口不受禁立项影响、描述随首条消息、提案等待态与去对比、待确认卡、完成与超时。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequirementsPage } from '../src/pages/requirements.tsx'
import type { ProposalRow, RequirementDocRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { SessionSummary } from '../src/store.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const REQ: RequirementDocRow = {
  id: 'REQ-01',
  title: '佣金改造',
  text: '# 佣金改造\n\n- 自营订单按下限兜底',
  state: 'draft',
  options: [],
  versions: [{ n: 1, at: '2026-11-17T09:00:00+08:00' }],
  reviews: [],
}

const NEW_PROPOSAL: ProposalRow = {
  id: 'P-01',
  title: '订单导出',
  problem: '分析结论',
  options: [],
  recommendation: '建议采纳。',
  decision: 'draft',
  decidedAt: null,
  requirementChange: { mode: 'new', content: '# 订单导出\n\n- 支持 CSV', analysis: '与现有需求不冲突；影响面小。' },
}

const REVISE_PROPOSAL: ProposalRow = {
  id: 'P-02',
  title: '佣金改造改稿',
  problem: '分析结论',
  options: [],
  recommendation: '建议采纳。',
  decision: 'draft',
  decidedAt: null,
  requirementChange: { mode: 'revise', target: 'REQ-01', baseVersion: 1, content: '# 佣金改造\n\n- 自营免佣', analysis: '按评审意见改稿。' },
}

const PATCH_PROPOSAL: ProposalRow = {
  id: 'P-03',
  title: '佣金改造修改',
  problem: '按用户说明修改',
  options: [],
  recommendation: '建议采纳。',
  decision: 'draft',
  decidedAt: null,
  requirementChange: {
    mode: 'patch',
    target: 'REQ-01',
    baseContent: REQ.text,
    content: '# 佣金改造\n\n- 自营免佣',
    analysis: '按用户说明改了佣金口径。',
  },
}

function projectionOf(requirements: readonly RequirementDocRow[], proposals: readonly ProposalRow[] = []): SpecProjection {
  return {
    tasks: [],
    rules: [],
    contracts: [],
    proposals,
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
  vi.useFakeTimers()
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: { call: vi.fn(async () => ({ ok: true, value: { result: { kind: 'success', text: 'ok' } } })) },
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

async function tick(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

function typeDescription(value: string): void {
  const node = element('requirement-new-description') as HTMLTextAreaElement
  expect(node).not.toBeNull()
  // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(node, value)
  node.dispatchEvent(new Event('input', { bubbles: true }))
}

async function startModify(note: string): Promise<void> {
  await press('requirement-op-revise')
  const node = element('requirement-modify-note') as HTMLTextAreaElement
  expect(node).not.toBeNull()
  // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(node, note)
  node.dispatchEvent(new Event('input', { bubbles: true }))
  await press('requirement-modify-start')
}

interface Harness {
  readonly started: { prompt: string; preset?: string }[]
  readonly reload: () => void
  render(projection: SpecProjection, sessions?: readonly SessionSummary[]): void
}

function harness(): Harness {
  const started: { prompt: string; preset?: string }[] = []
  const reload = vi.fn(() => {})
  return {
    started,
    reload,
    render(projection, sessions = []) {
      act(() => {
        root.render(
          <RequirementsPage
            project={PROJECT}
            projection={projection}
            sessions={sessions}
            loading={false}
            error={null}
            intakeResult={null}
            onClearIntakeResult={() => {}}
            onReload={reload}
            onStartIntake={async () => ({ ok: true, message: 'ok' })}
            onStartSession={async (prompt, preset) => {
              started.push({ prompt, ...(preset === undefined ? {} : { preset }) })
              return { ok: true, message: 'ok', sessionId: 'session-create-1' }
            }}
            onOpenSession={() => {}}
            onOpenTasks={() => {}}
          />,
        )
      })
    },
  }
}

describe('新建需求入口', () => {
  it('项目已有需求时立项被禁，但新建需求仍可用', () => {
    const h = harness()
    h.render(projectionOf([REQ]))
    expect((element('intake-open') as HTMLButtonElement).disabled).toBe(true)
    expect((element('requirement-new-open') as HTMLButtonElement).disabled).toBe(false)
  })

  it('描述随首条消息发给需求分析师，后台发起不跳转，限定指令齐全', async () => {
    const h = harness()
    h.render(projectionOf([REQ]))
    await press('requirement-new-open')
    expect(element('requirement-new-drawer')).not.toBeNull()
    await act(async () => { typeDescription('希望支持订单导出') })
    await press('requirement-new-start')

    expect(h.started).toHaveLength(1)
    expect(h.started[0]?.preset).toBe('maniu-intake')
    expect(h.started[0]?.prompt).toContain('希望支持订单导出')
    expect(h.started[0]?.prompt).toContain('requirement_propose')
    expect(h.started[0]?.prompt).toContain('明确禁止代码层判断')
    expect(h.started[0]?.prompt).toContain('不做整项目立项')
    expect(element('requirement-new-drawer')).toBeNull()
    expect(element('requirement-op-running')).not.toBeNull()
    expect(element('requirement-op-running')?.textContent).toContain('新建需求')
  })

  it('描述可留空：提示词先问用户，仍发起分析', async () => {
    const h = harness()
    h.render(projectionOf([REQ]))
    await press('requirement-new-open')
    await press('requirement-new-start')
    expect(h.started).toHaveLength(1)
    expect(h.started[0]?.prompt).toContain('用户没有提供描述')
  })

  it('提案写出后浮卡进入等待态：文案与去对比入口，点击打开对比视图不跳对话', async () => {
    const h = harness()
    h.render(projectionOf([REQ]))
    await press('requirement-new-open')
    await press('requirement-new-start')

    h.render(projectionOf([REQ], [NEW_PROPOSAL]))
    const card = element('requirement-op-running')
    expect(card?.textContent).toContain('提案待你对比确认')
    expect(element('op-go-compare')).not.toBeNull()

    await press('op-go-compare')
    expect(element('proposal-compare')).not.toBeNull()
    expect(element('compare-new-body')?.textContent).toContain('支持 CSV')
  })

  it('需求条数增加后转完成卡；等待期间超时口径不变', async () => {
    const h = harness()
    h.render(projectionOf([REQ]))
    await press('requirement-new-open')
    await press('requirement-new-start')
    h.render(projectionOf([REQ], [NEW_PROPOSAL]))
    expect(element('op-go-compare')).not.toBeNull()

    const landed: RequirementDocRow = { ...REQ, id: 'REQ-02', title: '订单导出' }
    h.render(projectionOf([REQ, landed], [{ ...NEW_PROPOSAL, decision: 'approved' }]))
    expect(element('requirement-op-success')).not.toBeNull()
    expect(element('requirement-op-running')).toBeNull()
  })

  it('未落盘也未确认时按既有超时转失败卡', async () => {
    const h = harness()
    h.render(projectionOf([REQ]))
    await press('requirement-new-open')
    await press('requirement-new-start')
    await tick(5 * 60 * 1000)
    expect(element('requirement-op-timeout')).not.toBeNull()
  })
})

describe('改稿提案等待态', () => {
  it('顶部入口先要修改说明，空说明不发起；提交后 patch 提案出现即等待对比，应用后转完成', async () => {
    const h = harness()
    h.render(projectionOf([REQ]))
    await press('requirement-op-revise')
    expect(element('requirement-modify-drawer')).not.toBeNull()
    expect(h.started).toHaveLength(0)
    await press('requirement-modify-start')
    expect(h.started).toHaveLength(0)

    await startModify('把佣金口径改成按实付金额计算')
    expect(h.started).toHaveLength(1)
    expect(h.started[0]?.preset).toBe('maniu-requirement-editor')
    expect(h.started[0]?.prompt).toContain('requirement_patch_propose')
    expect(h.started[0]?.prompt).toContain('把佣金口径改成按实付金额计算')
    expect(h.started[0]?.prompt).toContain('不要调用 requirement_revise')
    expect(element('requirement-modify-drawer')).toBeNull()

    h.render(projectionOf([REQ], [PATCH_PROPOSAL]))
    expect(element('requirement-op-running')?.textContent).toContain('提案待你对比确认')
    await press('op-go-compare')
    expect(element('proposal-compare')).not.toBeNull()
    expect(element('compare-entries')).not.toBeNull()
    expect(element('compare-approve')?.textContent).toContain('应用修改')

    // 应用只改正文，版本表不变；提案 approved 即这次操作完成。
    const applied: RequirementDocRow = { ...REQ, text: '# 佣金改造\n\n- 自营免佣' }
    h.render(projectionOf([applied], [{ ...PATCH_PROPOSAL, decision: 'approved' }]))
    expect(element('requirement-op-success')).not.toBeNull()
  })
})

describe('待确认的需求变更卡', () => {
  it('起草态需求变更提案出卡：标题、目标与分析摘要，入口打开对比', async () => {
    const h = harness()
    h.render(projectionOf([REQ], [REVISE_PROPOSAL, { ...NEW_PROPOSAL, decision: 'approved' }]))
    const section = element('requirement-pending-proposals')
    expect(section).not.toBeNull()
    const cards = [...container.querySelectorAll('[data-testid="requirement-pending-proposal"]')]
    expect(cards).toHaveLength(1)
    expect(cards[0]?.textContent).toContain('佣金改造改稿')
    expect(cards[0]?.textContent).toContain('REQ-01')
    expect(cards[0]?.textContent).toContain('按评审意见改稿')

    await press('requirement-pending-open')
    expect(element('proposal-compare')).not.toBeNull()
  })

  it('没有待确认提案时不出卡', () => {
    const h = harness()
    h.render(projectionOf([REQ]))
    expect(element('requirement-pending-proposals')).toBeNull()
  })
})

describe('提案被拒绝即收口浮卡', () => {
  it('新建提案变 rejected 时立即收口完成卡，不等需求落盘或超时', async () => {
    const h = harness()
    h.render(projectionOf([REQ]))
    await press('requirement-new-open')
    await press('requirement-new-start')
    expect(element('requirement-op-running')).not.toBeNull()

    h.render(projectionOf([REQ], [{ ...NEW_PROPOSAL, decision: 'rejected', decidedAt: '2026-11-17T12:00:00+08:00' }]))
    expect(element('requirement-op-running')).toBeNull()
    expect(element('requirement-op-success')?.textContent).toContain('提案已被拒绝')
    expect(element('requirement-op-timeout')).toBeNull()
    expect(h.reload).toHaveBeenCalled()
  })

  it('修改提案变 rejected 时同样收口，不空转等版本增量', async () => {
    const h = harness()
    h.render(projectionOf([REQ]))
    await startModify('按说明改')
    expect(element('requirement-op-running')).not.toBeNull()

    h.render(projectionOf([REQ], [{ ...PATCH_PROPOSAL, decision: 'rejected', decidedAt: '2026-11-17T12:00:00+08:00' }]))
    expect(element('requirement-op-running')).toBeNull()
    expect(element('requirement-op-success')?.textContent).toContain('提案已被拒绝')
    expect(element('requirement-op-timeout')).toBeNull()
  })
})
