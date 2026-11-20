// @vitest-environment jsdom
/** T-238：需求表的创建时间与操作列，按状态给评审、改稿、拆分与查看任务。 */
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

function task(overrides: Partial<TaskRow> & { readonly id: string; readonly title: string }): TaskRow {
  return {
    description: '',
    attachments: [],
    state: 'drafting',
    grade: 'B',
    rules: [],
    evidence: [],
    dependsOn: [],
    paths: [],
    irreversible: [],
    ...overrides,
  }
}

const DRAFT: RequirementDocRow = {
  id: 'REQ-01',
  title: '草稿需求',
  text: '草稿正文',
  state: 'draft',
  options: [],
  versions: [],
  reviews: [],
  openedAt: '2026-11-16T09:00:00+08:00',
}

const CONFIRMED_EMPTY: RequirementDocRow = {
  id: 'REQ-02',
  title: '待拆分需求',
  text: '已确认正文',
  state: 'confirmed',
  options: [],
  versions: [],
  reviews: [],
  openedAt: '2026-11-15T09:00:00+08:00',
}

const CONFIRMED_TASKED: RequirementDocRow = {
  id: 'REQ-03',
  title: '已拆需求',
  text: '已拆正文',
  state: 'confirmed',
  options: [],
  versions: [],
  reviews: [],
}

function projectionOf(requirements: readonly RequirementDocRow[], tasks: readonly TaskRow[]): SpecProjection {
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
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  // HeroUI Modal 的 react-aria 依赖在 jsdom 里调用 CSS.escape，需补最小实现。
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { escape: (value: string) => value.replace(/[^\w-]/g, '\\$&') } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
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
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function typeNote(value: string): Promise<void> {
  const node = element('requirement-modify-note') as HTMLTextAreaElement
  expect(node).not.toBeNull()
  // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(node, value)
  node.dispatchEvent(new Event('input', { bubbles: true }))
}

interface StartCall {
  readonly prompt: string
  readonly preset?: string
}

function renderPage(
  projection: SpecProjection,
  calls: StartCall[],
  onOpenTasks: (id: string) => void = () => {},
  sessions: readonly SessionSummary[] = [],
  onOpenSession: (id: string) => void = () => {},
): void {
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
        onReload={() => {}}
        onStartIntake={async () => ({ ok: true, message: 'ok' })}
        onStartSession={async (prompt, preset) => {
          calls.push(preset === undefined ? { prompt } : { prompt, preset })
          return { ok: true, message: 'ok' }
        }}
        onOpenSession={onOpenSession}
        onOpenTasks={onOpenTasks}
      />,
    )
  })
}

describe('需求表列', () => {
  it('去掉候选与推荐列，补创建时间与操作列', () => {
    renderPage(projectionOf([DRAFT, CONFIRMED_TASKED], []), [])
    const heads = [...container.querySelectorAll('thead th')].map(node => node.textContent)
    expect(heads).toEqual(['编号', '标题', '状态', '创建时间', '操作'])
    const opened = [...container.querySelectorAll('tbody tr')]
      .map(row => row.children[3]?.textContent)
    expect(opened).toEqual(['2026-11-16', '—'])
  })
})

describe('需求表操作分支', () => {
  it('草稿行给评审与修改需求，点击评审不打开详情', async () => {
    const calls: StartCall[] = []
    renderPage(projectionOf([DRAFT], []), calls)

    expect(element('requirement-op-review')).not.toBeNull()
    expect(element('requirement-op-revise')).not.toBeNull()
    expect(element('requirement-op-split')).toBeNull()

    await press('requirement-op-review')
    expect(element('requirement-detail')).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.preset).toBe('maniu-pm')
    expect(calls[0]?.prompt).toContain('需求评审：请对需求 REQ-01（草稿需求）')
    expect(calls[0]?.prompt).toContain('文档完备性')
    expect(calls[0]?.prompt).toContain('合理性')
    expect(calls[0]?.prompt).toContain('需求角度')
    expect(calls[0]?.prompt).toContain('技术实现角度')
    expect(calls[0]?.prompt).toContain('requirement_review_draft')
    expect(calls[0]?.prompt).toContain('不改需求正文')
  })

  it('修改需求先打开说明输入框，提交非空说明后交给窄角色生成提案，不直接改正文', async () => {
    const calls: StartCall[] = []
    renderPage(projectionOf([DRAFT], []), calls)

    await press('requirement-op-revise')
    expect(element('requirement-detail')).not.toBeNull()
    expect(element('requirement-modify-pane')).not.toBeNull()
    expect(element('requirement-modify-drawer')).toBeNull()
    expect(calls).toHaveLength(0)
    await typeNote('把验收口径改成按实付金额计算')
    await press('requirement-modify-start')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.preset).toBe('maniu-requirement-editor')
    expect(calls[0]?.prompt).toContain('修改需求：请按用户说明修改需求 REQ-01（草稿需求）')
    expect(calls[0]?.prompt).toContain('草稿正文')
    expect(calls[0]?.prompt).toContain('把验收口径改成按实付金额计算')
    expect(calls[0]?.prompt).toContain('requirement_patch_propose')
    expect(calls[0]?.prompt).toContain('不要调用 requirement_revise')
  })

  it('取消修改说明只收起说明栏，详情保留、不启动会话不写数据', async () => {
    const calls: StartCall[] = []
    renderPage(projectionOf([DRAFT], []), calls)
    await press('requirement-op-revise')
    await typeNote('要改的点')
    await press('requirement-modify-cancel')
    expect(element('requirement-modify-pane')).toBeNull()
    expect(element('requirement-detail')).not.toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('关闭详情后焦点返回打开前的触发入口', async () => {
    renderPage(projectionOf([DRAFT], []), [])
    // jsdom 中聚焦表格行内元素会触发 react-aria 的选择焦点缺陷，用表外哨兵入口代替。
    const trigger = document.createElement('button')
    trigger.textContent = '入口'
    container.append(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    await press('requirement-row')
    expect(element('requirement-detail')).not.toBeNull()

    await press('requirement-detail-close')
    expect(element('requirement-detail')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('已过审且没有关联任务时给拆分，交给研发经理', async () => {
    const calls: StartCall[] = []
    renderPage(projectionOf([CONFIRMED_EMPTY], []), calls)

    expect(element('requirement-op-tasks')).toBeNull()
    await press('requirement-op-split')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.preset).toBe('maniu-manager')
    expect(calls[0]?.prompt).toContain('需求拆分：请把需求 REQ-02（待拆分需求）')
    expect(calls[0]?.prompt).toContain('requirement_split_plan')
    expect(calls[0]?.prompt).toContain('不分配岗位')
  })

  it('已有关联任务时给查看任务，不改发会话', async () => {
    const calls: StartCall[] = []
    const opened: string[] = []
    renderPage(
      projectionOf([CONFIRMED_TASKED], [task({ id: 'T-01', title: '实施任务', requirement: 'REQ-03' })]),
      calls,
      (id) => { opened.push(id) },
    )

    expect(element('requirement-op-split')).toBeNull()
    await press('requirement-op-tasks')
    expect(opened).toEqual(['REQ-03'])
    expect(calls).toHaveLength(0)
    expect(element('requirement-detail')).toBeNull()
  })
})

describe('交互期不误杀超时', () => {
  it('立项等待确认概要期间到点不转失败卡，确认入口保留', async () => {
    vi.useFakeTimers()
    try {
      const sessions: readonly SessionSummary[] = [
        { sessionId: 'session-intake-1', updatedAt: 1, running: false, blank: false },
      ]
      const renderWith = (list: readonly SessionSummary[]): void => {
        act(() => {
          root.render(
            <RequirementsPage
              project={PROJECT}
              projection={projectionOf([], [])}
              sessions={list}
              loading={false}
              error={null}
              intakeResult={null}
              onClearIntakeResult={() => {}}
              onReload={() => {}}
              onStartIntake={async () => ({ ok: true, message: 'ok', sessionId: 'session-intake-1' })}
              onStartSession={async () => ({ ok: true, message: 'ok' })}
              onConfirmIntake={async () => ({ ok: true, message: 'ok' })}
              onOpenSession={() => {}}
              onOpenTasks={() => {}}
            />,
          )
        })
      }
      renderWith([])
      await act(async () => {
        ;(element('intake-open') as HTMLElement).click()
        await vi.advanceTimersByTimeAsync(0)
      })
      await act(async () => {
        const idea = element('intake-idea-input') as HTMLTextAreaElement
        // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(idea, '做一个团队人员名单维护工具')
        idea.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        ;(element('intake-start') as HTMLElement).click()
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(element('requirement-op-running')).not.toBeNull()

      renderWith([{ ...sessions[0]!, running: true }])
      renderWith(sessions)
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000) })

      expect(element('requirement-op-running')).not.toBeNull()
      expect(element('requirement-op-timeout')).toBeNull()
      expect(element('op-confirm-intake')?.textContent).toBe('确认需求')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('后台会话恢复入口', () => {
  it('在跑的游离会话给出提示与查看对话入口，未跟踪会话不提示', async () => {
    const opened: string[] = []
    renderPage(
      projectionOf([DRAFT], []),
      [],
      () => {},
      [{ sessionId: 'session-orphan', updatedAt: 1, running: true, blank: false }],
      (id) => { opened.push(id) },
    )
    expect(element('requirement-background-recovery')?.textContent).toContain('有后台任务正在运行')
    const entry = element('requirement-background-recovery-open')
    expect(entry?.getAttribute('data-session-id')).toBe('session-orphan')
    expect(entry?.textContent).toContain('查看对话')
    await press('requirement-background-recovery-open')
    expect(opened).toEqual(['session-orphan'])

    renderPage(
      projectionOf([DRAFT], []),
      [],
      () => {},
      [{ sessionId: 'session-idle', updatedAt: 1, running: false, blank: false }],
    )
    expect(element('requirement-background-recovery')).toBeNull()
  })
})
