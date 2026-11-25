// @vitest-environment jsdom
/** T-245：立项浮卡的等待确认态判定、确认指令发送、发送后恢复轮询、落盘转完成与查看概要自愿跳转。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequirementsPage } from '../src/pages/requirements.tsx'
import type { RequirementDocRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { SessionSummary } from '../src/store.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const LANDED: RequirementDocRow = {
  id: 'REQ-01',
  title: '立项需求',
  text: '概要正文',
  state: 'draft',
  options: [],
  versions: [{ n: 1, at: '2026-11-17T09:00:00+08:00' }],
  reviews: [],
}

function projectionOf(requirements: readonly RequirementDocRow[]): SpecProjection {
  return {
    tasks: [],
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

function sessionOf(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { sessionId: 'session-intake-1', updatedAt: 1, running: true, blank: false, ...overrides }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  // HeroUI Modal 的 react-aria 依赖在 jsdom 里调用 CSS.escape，需补最小实现。
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { escape: (value: string) => value.replace(/[^\w-]/g, '\\$&') } })
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: { call: vi.fn(async () => ({ ok: true, value: {} })) },
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
  // 立项向导的 HeroUI Modal 挂在 document.body 的 Portal 里，查询范围要覆盖整页。
  return document.querySelector(`[data-testid="${testId}"]`)
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

interface Harness {
  readonly reload: ReturnType<typeof vi.fn>
  readonly openSession: ReturnType<typeof vi.fn>
  readonly confirmed: string[]
  confirmAnswer: { readonly ok: boolean; readonly message: string }
  render(projection: SpecProjection, sessions: readonly SessionSummary[]): void
}

function harness(): Harness {
  const reload = vi.fn()
  const openSession = vi.fn()
  const confirmed: string[] = []
  const h: Harness = {
    reload,
    openSession,
    confirmed,
    confirmAnswer: { ok: true, message: 'ok' },
    render(projection, sessions) {
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
            onStartIntake={async () => ({ ok: true, message: 'ok', sessionId: 'session-intake-1' })}
            onStartSession={async () => ({ ok: true, message: 'ok' })}
            onConfirmIntake={async (sessionId) => {
              confirmed.push(sessionId)
              return h.confirmAnswer
            }}
            onOpenSession={openSession}
            onOpenTasks={() => {}}
          />,
        )
      })
    },
  }
  return h
}

/** 全新项目立项需要先填一句想法才能开始。 */
async function fillIdea(): Promise<void> {
  const node = element('intake-idea-input') as HTMLTextAreaElement
  expect(node).not.toBeNull()
  await act(async () => {
    // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(node, '做一个团队人员名单维护工具')
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** 走真实入口后台发起立项：向导收起，浮卡接管。 */
async function startIntake(h: Harness): Promise<void> {
  h.render(projectionOf([]), [])
  await press('intake-open')
  await fillIdea()
  await press('intake-start')
  expect(element('intake-wizard')).toBeNull()
  expect(element('requirement-op-running')).not.toBeNull()
}

/** 让立项会话跑过一个回合再结束：浮卡据此进入等待确认态。 */
function turnEnded(h: Harness): void {
  h.render(projectionOf([]), [sessionOf({ running: true })])
  h.render(projectionOf([]), [sessionOf({ running: false })])
}

/** 让会话事件端口返回一条助手正文，供就地概要预览读取。 */
function stubSummary(text: string): void {
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: { call: vi.fn(async () => ({
      ok: true,
      value: { records: [{
        type: 'event',
        event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } },
      }] },
    })) },
  })
}

describe('等待确认态判定', () => {
  it('回合结束且需求未落盘时进入等待确认态：蓝边框、确认与查看概要入口', async () => {
    const h = harness()
    await startIntake(h)
    h.render(projectionOf([]), [sessionOf({ running: true })])
    expect(element('op-confirm-intake')).toBeNull()
    expect(element('requirement-op-running')?.textContent).toContain('需求调研')

    h.render(projectionOf([]), [sessionOf({ running: false })])
    const card = element('requirement-op-running')
    expect(card?.className).toContain('op-running')
    expect(element('op-confirm-intake')?.textContent).toBe('确认需求')
    expect(element('op-view-session')?.textContent).toBe('查看概要')
    expect(element('op-step-progress')?.textContent).toBe('第 2 步 / 共 4 步 · 岗位工作中')
    expect(element('op-progress-bar')?.getAttribute('aria-valuenow')).toBe('2')
    expect(element('op-progress-bar')?.getAttribute('aria-valuemax')).toBe('4')
  })

  it('回合仍在跑或会话还是空白时不进入等待确认态', async () => {
    const h = harness()
    await startIntake(h)
    h.render(projectionOf([]), [sessionOf({ running: true })])
    expect(element('op-confirm-intake')).toBeNull()

    h.render(projectionOf([]), [sessionOf({ running: false, blank: true })])
    expect(element('op-confirm-intake')).toBeNull()
    expect(element('requirement-op-running')?.textContent).toContain('需求调研')
  })

  it('会话从未跑过回合时不算回合结束，不进入等待确认态', async () => {
    const h = harness()
    await startIntake(h)
    h.render(projectionOf([]), [sessionOf({ running: false })])
    expect(element('op-confirm-intake')).toBeNull()
    expect(element('requirement-op-running')?.textContent).toContain('需求调研')
  })

  it('回合结束但需求已落盘时直接转完成卡，不出现确认入口', async () => {
    const h = harness()
    await startIntake(h)
    h.render(projectionOf([LANDED]), [sessionOf({ running: false })])
    await act(async () => { await Promise.resolve() })
    expect(element('requirement-op-success')?.textContent).toContain('需求调研完成')
    expect(element('op-confirm-intake')).toBeNull()
  })
})

describe('确认入口与恢复轮询', () => {
  it('确认按钮向该会话发送指令，发送后恢复轮询，落盘转完成卡', async () => {
    const h = harness()
    await startIntake(h)
    turnEnded(h)
    await press('op-confirm-intake')
    expect(h.confirmed).toEqual(['session-intake-1'])
    expect(element('op-confirm-intake')).toBeNull()
    expect(element('op-step-progress')?.textContent).toBe('第 2 步 / 共 4 步 · 岗位工作中')

    const before = h.reload.mock.calls.length
    await tick(4000)
    expect(h.reload.mock.calls.length).toBe(before + 1)

    h.render(projectionOf([LANDED]), [sessionOf({ running: false })])
    await act(async () => { await Promise.resolve() })
    expect(element('requirement-op-success')?.textContent).toContain('需求调研完成')
    expect(element('op-confirm-intake')).toBeNull()
  })

  it('发送后回合再次跑起前不重复进入等待确认态；回合再结束仍未落盘则回到等待确认', async () => {
    const h = harness()
    await startIntake(h)
    turnEnded(h)
    await press('op-confirm-intake')

    h.render(projectionOf([]), [sessionOf({ running: false })])
    expect(element('op-confirm-intake')).toBeNull()
    expect(element('op-step-progress')?.textContent).toBe('第 2 步 / 共 4 步 · 岗位工作中')

    h.render(projectionOf([]), [sessionOf({ running: true })])
    h.render(projectionOf([]), [sessionOf({ running: false })])
    expect(element('op-confirm-intake')).not.toBeNull()
    await press('op-confirm-intake')
    expect(h.confirmed).toEqual(['session-intake-1', 'session-intake-1'])
  })

  it('发送失败给可读提示并回到等待确认态', async () => {
    const h = harness()
    await startIntake(h)
    turnEnded(h)
    h.confirmAnswer = { ok: false, message: '宿主尚未就绪' }
    await press('op-confirm-intake')
    expect(element('requirement-op-result')?.textContent).toContain('宿主尚未就绪')
    expect(element('op-confirm-intake')).not.toBeNull()
  })

  it('查看概要就地预览会话最后的助手正文，不切页', async () => {
    const h = harness()
    await startIntake(h)
    turnEnded(h)
    stubSummary('# 项目需求概要 V0.1\n\n范围：登录与需求登记。')
    await press('op-view-session')
    await act(async () => { await Promise.resolve() })

    expect(element('page-requirements')).not.toBeNull()
    expect(h.openSession).not.toHaveBeenCalled()
    expect(element('intake-summary')).not.toBeNull()
    expect(element('intake-summary-body')?.textContent).toContain('项目需求概要')
    expect(element('intake-summary-body')?.textContent).toContain('登录与需求登记')
  })

  it('概要抽屉底部确认落盘直接发确认指令并就地收起', async () => {
    const h = harness()
    await startIntake(h)
    turnEnded(h)
    stubSummary('概要正文')
    await press('op-view-session')
    await act(async () => { await Promise.resolve() })
    expect(element('intake-summary-confirm')?.textContent).toBe('确认落盘')

    await press('intake-summary-confirm')
    expect(h.confirmed).toEqual(['session-intake-1'])
    expect(element('intake-summary')).toBeNull()
    expect(element('page-requirements')).not.toBeNull()
  })

  it('概要抽屉里去对话修改仍自愿跳转', async () => {
    const h = harness()
    await startIntake(h)
    turnEnded(h)
    stubSummary('概要正文')
    await press('op-view-session')
    await act(async () => { await Promise.resolve() })
    await press('intake-summary-edit')
    expect(h.openSession).toHaveBeenCalledWith('session-intake-1')
    expect(element('intake-summary')).toBeNull()
  })

  it('等待确认期间到期不转失败卡，倒计时顺延且确认入口保留', async () => {
    const h = harness()
    await startIntake(h)
    turnEnded(h)
    await tick(5 * 60 * 1000)

    expect(element('requirement-op-running')).not.toBeNull()
    expect(element('requirement-op-timeout')).toBeNull()
    expect(element('op-confirm-intake')).not.toBeNull()
  })
})
