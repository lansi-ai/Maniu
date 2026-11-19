// @vitest-environment jsdom
/** T-242：评审/改稿/拆分后台发起，完成判定看磁盘事实增量，超时给入口，轮询可清理。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequirementsPage } from '../src/pages/requirements.tsx'
import type { RequirementDocRow, TaskRow } from '../src/spec/rows.ts'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'
import type { SessionSummary } from '../src/store.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const DRAFT: RequirementDocRow = {
  id: 'REQ-01',
  title: '草稿需求',
  text: '草稿正文',
  state: 'draft',
  options: [],
  versions: [{ n: 1, at: '2026-11-17T09:00:00+08:00' }],
  reviews: [{ round: 1, at: '2026-11-17T10:00:00+08:00', report: 'requirements/REQ-01/reviews/R1.md', decision: 'rejected' }],
}

const CONFIRMED: RequirementDocRow = {
  id: 'REQ-02',
  title: '待拆分需求',
  text: '已确认正文',
  state: 'confirmed',
  options: [],
  versions: [],
  reviews: [],
}

function task(id: string, requirement: string): TaskRow {
  return {
    id,
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
    requirement,
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

async function tick(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

interface StartAnswer {
  readonly ok: boolean
  readonly message: string
  readonly sessionId?: string
}

interface Harness {
  readonly reload: ReturnType<typeof vi.fn>
  readonly openSession: ReturnType<typeof vi.fn>
  readonly started: { readonly prompt: string; readonly preset?: string }[]
  render(projection: SpecProjection, loading?: boolean, opts?: {
    readonly awaitingAnswer?: boolean
    readonly sessions?: readonly SessionSummary[]
  }): void
}

function harness(
  answer: StartAnswer = { ok: true, message: 'ok', sessionId: 'session-op-1' },
  rejectWith?: Error,
): Harness {
  const reload = vi.fn()
  const openSession = vi.fn()
  const started: { readonly prompt: string; readonly preset?: string }[] = []
  return {
    reload,
    openSession,
    started,
    render(projection, loading = false, opts = {}) {
      act(() => {
        root.render(
          <RequirementsPage
            project={PROJECT}
            projection={projection}
            sessions={opts.sessions ?? []}
            loading={loading}
            error={null}
            intakeResult={null}
            onClearIntakeResult={() => {}}
            onReload={reload}
            onStartIntake={async () => ({ ok: true, message: 'ok' })}
            onStartSession={async (prompt, preset) => {
              started.push(preset === undefined ? { prompt } : { prompt, preset })
              if (rejectWith !== undefined) throw rejectWith
              return answer
            }}
            onOpenSession={openSession}
            onOpenTasks={() => {}}
            {...(opts.awaitingAnswer === undefined ? {} : { awaitingAnswer: opts.awaitingAnswer })}
          />,
        )
      })
    },
  }
}

describe('后台发起与完成判定', () => {
  it('评审发起后留在需求页并保持忙碌，按间隔轮询，见增轮即完成', async () => {
    const h = harness()
    h.render(projectionOf([DRAFT]))
    await press('requirement-op-review')

    expect(h.started).toHaveLength(1)
    expect(h.started[0]?.preset).toBe('maniu-pm')
    expect(element('requirement-op-running')?.textContent).toContain('评审进行中')
    expect((element('requirement-op-review') as HTMLButtonElement).disabled).toBe(true)
    expect(h.reload).not.toHaveBeenCalled()

    await tick(4000)
    expect(h.reload).toHaveBeenCalledTimes(1)

    const reviewed: RequirementDocRow = {
      ...DRAFT,
      reviews: [...DRAFT.reviews, { round: 2, at: '2026-11-17T11:00:00+08:00', report: 'requirements/REQ-01/reviews/R2.md', decision: 'rejected' }],
    }
    h.render(projectionOf([reviewed]))
    await act(async () => { await Promise.resolve() })

    expect(element('requirement-op-running')).toBeNull()
    expect(element('requirement-op-success')?.textContent).toContain('评审完成')
    expect((element('requirement-op-review') as HTMLButtonElement).disabled).toBe(false)
    expect(element('requirement-detail')?.getAttribute('data-requirement-id')).toBe('REQ-01')
    expect(h.reload).toHaveBeenCalledTimes(2)
  })

  it('改稿完成以版本增量为判据', async () => {
    const h = harness()
    h.render(projectionOf([DRAFT]))
    await press('requirement-op-revise')
    expect(element('requirement-op-running')?.textContent).toContain('改稿进行中')

    await tick(4000)
    const revised: RequirementDocRow = {
      ...DRAFT,
      versions: [...DRAFT.versions, { n: 2, at: '2026-11-17T11:00:00+08:00' }],
    }
    h.render(projectionOf([revised]))
    await act(async () => { await Promise.resolve() })
    expect(element('requirement-op-success')?.textContent).toContain('改稿完成')
  })

  it('拆分完成以拆分计划出现为判据', async () => {
    const h = harness()
    h.render(projectionOf([CONFIRMED]))
    await press('requirement-op-split')
    expect(element('requirement-op-running')?.textContent).toContain('拆分进行中')

    await tick(4000)
    const planned: RequirementDocRow = {
      ...CONFIRMED,
      splitPlan: { at: '2026-11-17T11:00:00+08:00', entries: [{ task: 'T-01', role: 'dev' }] },
    }
    h.render(projectionOf([planned]))
    await act(async () => { await Promise.resolve() })
    expect(element('requirement-op-success')?.textContent).toContain('拆分完成')
  })

  it('拆分完成也以会话回合结束后的关联任务增量为判据', async () => {
    const h = harness()
    h.render(projectionOf([CONFIRMED]))
    await press('requirement-op-split')

    await tick(4000)
    h.render(projectionOf([CONFIRMED], [task('T-01', 'REQ-02')]), false, {
      sessions: [{ sessionId: 'session-op-1', updatedAt: 1, running: false, blank: false }],
    })
    await act(async () => { await Promise.resolve() })
    expect(element('requirement-op-success')?.textContent).toContain('拆分完成')
  })

  it('会话仍在跑时第一条任务落盘不提前报拆分完成', async () => {
    const h = harness()
    h.render(projectionOf([CONFIRMED]))
    await press('requirement-op-split')

    await tick(4000)
    h.render(projectionOf([CONFIRMED], [task('T-01', 'REQ-02')]), false, {
      sessions: [{ sessionId: 'session-op-1', updatedAt: 1, running: true, blank: false }],
    })
    await act(async () => { await Promise.resolve() })
    expect(element('requirement-op-running')).not.toBeNull()
    expect(element('requirement-op-success')).toBeNull()
  })

  it('发起失败清忙碌并给可读提示，不启动轮询', async () => {
    const h = harness({ ok: false, message: '宿主尚未就绪' })
    h.render(projectionOf([DRAFT]))
    await press('requirement-op-review')

    expect(element('requirement-op-result')?.textContent).toContain('宿主尚未就绪')
    expect(element('requirement-op-running')).toBeNull()
    expect((element('requirement-op-review') as HTMLButtonElement).disabled).toBe(false)
    await tick(8000)
    expect(h.reload).not.toHaveBeenCalled()
  })

  it('发起抛错也清忙碌并给可读提示', async () => {
    const h = harness({ ok: true, message: 'ok' }, new Error('IPC 通道断开'))
    h.render(projectionOf([DRAFT]))
    await press('requirement-op-review')

    expect(element('requirement-op-result')?.textContent).toContain('IPC 通道断开')
    expect((element('requirement-op-review') as HTMLButtonElement).disabled).toBe(false)
    await tick(8000)
    expect(h.reload).not.toHaveBeenCalled()
  })
})

describe('轮询纪律', () => {
  it('读取中不叠加请求，读取结束后恢复轮询', async () => {
    const h = harness()
    h.render(projectionOf([DRAFT]))
    await press('requirement-op-review')

    h.render(projectionOf([DRAFT]), true)
    await tick(4000)
    expect(h.reload).not.toHaveBeenCalled()

    h.render(projectionOf([DRAFT]), false)
    await tick(4000)
    expect(h.reload).toHaveBeenCalledTimes(1)
  })

  it('卸载后轮询停止', async () => {
    const h = harness()
    h.render(projectionOf([DRAFT]))
    await press('requirement-op-review')
    await tick(4000)
    expect(h.reload).toHaveBeenCalledTimes(1)

    act(() => { root.unmount() })
    await tick(12000)
    expect(h.reload).toHaveBeenCalledTimes(1)
  })

  it('操作被替换时旧轮询清理，只按新操作计一次', async () => {
    const h = harness()
    h.render(projectionOf([DRAFT]))
    await press('requirement-op-review')
    await tick(5 * 60 * 1000)
    expect(element('requirement-op-timeout')).not.toBeNull()
    const before = h.reload.mock.calls.length

    await press('requirement-op-revise')
    await tick(4000)
    expect(h.reload.mock.calls.length).toBe(before + 1)
  })
})

describe('超时提示与入口', () => {
  it('超时给可读提示，保留打开会话与手动刷新入口，并停止轮询', async () => {
    const h = harness()
    h.render(projectionOf([DRAFT]))
    await press('requirement-op-review')

    await tick(5 * 60 * 1000)
    expect(element('requirement-op-running')).toBeNull()
    expect(element('requirement-op-timeout')?.textContent).toContain('等待超时')
    expect((element('requirement-op-review') as HTMLButtonElement).disabled).toBe(false)

    const afterTimeout = h.reload.mock.calls.length
    await tick(12000)
    expect(h.reload.mock.calls.length).toBe(afterTimeout)

    await press('requirement-op-timeout-session')
    expect(h.openSession).toHaveBeenCalledWith('session-op-1')

    await press('requirement-op-timeout-reload')
    expect(h.reload.mock.calls.length).toBe(afterTimeout + 1)
    expect(element('requirement-op-timeout')).toBeNull()
  })

  it('发起未带回会话号时超时提示只保留手动刷新', async () => {
    const h = harness({ ok: true, message: 'ok' })
    h.render(projectionOf([DRAFT]))
    await press('requirement-op-review')
    await tick(5 * 60 * 1000)

    expect(element('requirement-op-timeout')).not.toBeNull()
    expect(element('requirement-op-timeout-session')).toBeNull()
    expect(element('requirement-op-timeout-reload')).not.toBeNull()
  })

  it('有等待回答的交互时到点不误判超时，交互结束后才按原口径收口', async () => {
    const h = harness()
    h.render(projectionOf([DRAFT]))
    await press('requirement-op-review')

    // 全局待答交互非空：即便到点也保持进行中，并把 deadline 往后顺延。
    h.render(projectionOf([DRAFT]), false, { awaitingAnswer: true })
    await tick(5 * 60 * 1000 + 4000)
    expect(element('requirement-op-running')).not.toBeNull()
    expect(element('requirement-op-timeout')).toBeNull()

    // 交互结束后，顺延后的 deadline 再到期才转失败卡。
    h.render(projectionOf([DRAFT]), false, { awaitingAnswer: false })
    await tick(5 * 60 * 1000)
    expect(element('requirement-op-timeout')?.textContent).toContain('等待超时')
  })
})

describe('后台会话恢复提示', () => {
  it('刷新后有在跑但不在本地浮卡的会话时给查看对话入口', async () => {
    const h = harness()
    h.render(projectionOf([DRAFT]), false, {
      sessions: [{ sessionId: 'session-bg-1', updatedAt: 1, running: true, blank: false }],
    })
    const notice = element('requirement-background-recovery')
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain('有后台任务正在运行')
    await press('requirement-background-recovery-open')
    expect(h.openSession).toHaveBeenCalledWith('session-bg-1')
  })

  it('会话已经在本地浮卡里时不重复提示', async () => {
    const h = harness()
    h.render(projectionOf([DRAFT]))
    await press('requirement-op-review')
    h.render(projectionOf([DRAFT]), false, {
      sessions: [{ sessionId: 'session-op-1', updatedAt: 1, running: true, blank: false }],
    })
    expect(element('requirement-background-recovery')).toBeNull()
    expect(element('requirement-op-running')).not.toBeNull()
  })

  it('没有在跑的会话时不显示提示', () => {
    const h = harness()
    h.render(projectionOf([DRAFT]), false, {
      sessions: [{ sessionId: 'session-bg-1', updatedAt: 1, running: false, blank: false }],
    })
    expect(element('requirement-background-recovery')).toBeNull()
  })
})
