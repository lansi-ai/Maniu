// @vitest-environment jsdom
/** 立项结果提升到 App 级后的渲染事实：重挂回看、清除回到起始表单、需求页入口。 */
import { act, useState } from 'react'
import type { JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntakeWizard, type IntakeResult } from '../src/pages/intake-wizard.tsx'
import { RequirementsPage } from '../src/pages/requirements.tsx'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const PROJECTION: SpecProjection = {
  tasks: [],
  rules: [],
  contracts: [],
  proposals: [],
  requirements: [],
  groups: [],
  roles: [],
  project: null,
  secrets: {},
  automation: null,
  agents: null,
  problems: [],
}

const CONFIRMED_REQUIREMENT = {
  id: 'REQ-01',
  text: '探针需求正文',
  title: '探针需求',
  state: 'confirmed' as const,
  options: [],
  versions: [],
  reviews: [],
}

const WITH_REQUIREMENT: SpecProjection = { ...PROJECTION, requirements: [CONFIRMED_REQUIREMENT] }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

/** 点一个 testid，并让异步状态更新落定。 */
async function press(testId: string): Promise<void> {
  const node = container.querySelector(`[data-testid="${testId}"]`)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function element(testId: string): Element | null {
  return container.querySelector(`[data-testid="${testId}"]`)
}

/** 在全新项目档的想法输入框里填一句，解锁开始按钮。 */
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

function Harness(): JSX.Element {
  const [result, setResult] = useState<IntakeResult | null>(null)
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" data-testid="toggle" onClick={() => { setOpen(value => !value) }}>toggle</button>
      {open ? (
        <IntakeWizard
          project={PROJECT}
          projection={PROJECTION}
          result={result}
          onClearResult={() => { setResult(null) }}
          onClose={() => {}}
          onStart={async () => {
            const message = '指令已发送到会话 session-1；模型会先访谈，确认需求后才落盘。'
            setResult({ message, sessionId: 'session-1' })
            return { ok: true, message }
          }}
          onOpenRequirement={() => {}}
          onReload={() => {}}
        />
      ) : null}
    </>
  )
}

describe('立项结果视图文案', () => {
  it('结果视图用后台口径词典文案，不再说已切到对话页', async () => {
    await act(async () => {
      root.render(
        <Harness />,
      )
    })
    await fillIdea()
    await press('intake-start')
    const note = element('intake-result')?.textContent ?? ''
    expect(note).toContain('后台运行')
    expect(note).toContain('浮卡')
    expect(note).not.toContain('已切到')
  })
})

describe('立项结果提升到 App 级', () => {
  it('发送后显示结果，向导重挂仍可回看，清除后回到起始表单', async () => {
    await act(async () => { root.render(<Harness />) })
    expect(element('intake-start')).not.toBeNull()

    await fillIdea()
    await press('intake-start')
    expect(element('intake-result')).not.toBeNull()
    expect(element('intake-result-message')?.textContent).toContain('session-1')
    expect(element('intake-start')).toBeNull()

    // 模拟离开需求页再回来：结果状态在 App 级，向导重挂后仍显示结果页。
    await press('toggle')
    expect(element('intake-wizard')).toBeNull()
    await press('toggle')
    expect(element('intake-result')).not.toBeNull()

    await press('intake-restart')
    expect(element('intake-result')).toBeNull()
    expect(element('intake-start')).not.toBeNull()
  })

  it('需求页入口在有结果时显示为立项结果并可打开结果页', async () => {
    await act(async () => {
      root.render(
        <RequirementsPage
          project={PROJECT}
          projection={PROJECTION}
          sessions={[]}
          loading={false}
          error={null}
          intakeResult={{ message: '指令已发送到会话 session-1', sessionId: 'session-1' }}
          onClearIntakeResult={() => {}}
          onReload={() => {}}
          onStartIntake={async () => ({ ok: true, message: 'ok' })}
          onStartSession={async () => ({ ok: true, message: 'ok' })}
          onOpenSession={() => {}}
          onOpenTasks={() => {}}
        />,
      )
    })
    expect(element('intake-open')?.textContent).toBe('立项结果')
    await press('intake-open')
    expect(element('intake-result-message')?.textContent).toContain('session-1')
  })

  it('拆分任务只走普通发送，不写立项结果', async () => {
    const onStartIntake = vi.fn(async () => ({ ok: true, message: 'intake' }))
    const onStartSession = vi.fn(async () => ({ ok: true, message: '已发送拆分指令' }))
    await act(async () => {
      root.render(
        <RequirementsPage
          project={PROJECT}
          projection={WITH_REQUIREMENT}
          sessions={[]}
          loading={false}
          error={null}
          intakeResult={null}
          onClearIntakeResult={() => {}}
          onReload={() => {}}
          onStartIntake={onStartIntake}
          onStartSession={onStartSession}
          onOpenSession={() => {}}
          onOpenTasks={() => {}}
        />,
      )
    })
    await press('requirement-row')
    await press('requirement-split')
    expect(onStartSession).toHaveBeenCalledTimes(1)
    expect(onStartIntake).not.toHaveBeenCalled()
  })
})

describe('非空项目的立项准入', () => {
  function renderPage(projection: SpecProjection, intakeResult: IntakeResult | null): void {
    act(() => {
      root.render(
        <RequirementsPage
          project={PROJECT}
          projection={projection}
          sessions={[]}
          loading={false}
          error={null}
          intakeResult={intakeResult}
          onClearIntakeResult={() => {}}
          onReload={() => {}}
          onStartIntake={async () => ({ ok: true, message: 'ok' })}
          onStartSession={async () => ({ ok: true, message: 'ok' })}
          onOpenSession={() => {}}
          onOpenTasks={() => {}}
        />,
      )
    })
  }

  it('非空项目禁用立项入口，给出原因并可打开已有需求', async () => {
    renderPage(WITH_REQUIREMENT, null)
    const open = element('intake-open') as HTMLButtonElement
    expect(open.disabled).toBe(true)
    expect(open.parentElement?.getAttribute('title')).toContain('不能再做立项分析')
    expect(element('requirement-intake-blocked')).toBeNull()
    expect(element('intake-wizard')).toBeNull()
  })

  it('已有结果时仍可打开结果页回看，但不允许开新立项', async () => {
    renderPage(WITH_REQUIREMENT, { message: '指令已发送到会话 session-1', sessionId: 'session-1' })
    const open = element('intake-open') as HTMLButtonElement
    expect(open.disabled).toBe(false)
    expect(open.textContent).toBe('立项结果')
    await press('intake-open')
    expect(element('intake-result-message')?.textContent).toContain('session-1')
    expect(element('intake-restart')).toBeNull()
  })

  it('空项目可正常立项', async () => {
    renderPage(PROJECTION, null)
    const open = element('intake-open') as HTMLButtonElement
    expect(open.disabled).toBe(false)
    expect(element('requirement-intake-blocked')).toBeNull()
    await press('intake-open')
    expect(element('intake-start')).not.toBeNull()
  })
})
