// @vitest-environment jsdom
/** 立项向导的角色标识与准入阻塞：不再展示人设段落，非空项目只给阻塞提示。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntakeWizard } from '../src/pages/intake-wizard.tsx'
import type { SpecProjection } from '../src/spec/load.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const EMPTY: SpecProjection = {
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

const WITH_REQUIREMENT: SpecProjection = {
  ...EMPTY,
  requirements: [{ id: 'REQ-01', text: '正文', title: '探针需求', state: 'confirmed', options: [] }],
}

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
  Reflect.deleteProperty(window, 'lcoder')
})

function stub(answer: unknown): ReturnType<typeof vi.fn> {
  const call = vi.fn(async () => answer)
  Object.defineProperty(window, 'lcoder', { configurable: true, value: { call } })
  return call
}

async function render(props: {
  readonly projection?: SpecProjection
  readonly onClose?: () => void
} = {}): Promise<void> {
  await act(async () => {
    root.render(
      <IntakeWizard
        project={PROJECT}
        projection={props.projection ?? EMPTY}
        result={null}
        onClearResult={() => {}}
        onClose={props.onClose ?? (() => {})}
        onStart={async () => ({ ok: true, message: 'ok' })}
        onOpenRequirement={() => {}}
        onReload={() => {}}
      />,
    )
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function element(testId: string): Element | null {
  return container.querySelector(`[data-testid="${testId}"]`)
}

describe('立项向导的角色标识', () => {
  it('一行标识取人才库名册里的显示名，不再渲染角色人设段落', async () => {
    const call = stub({ ok: true, value: { presets: [{ id: 'maniu-intake', name: '产品需求分析', isDefault: false }] } })
    await render()
    expect(call).toHaveBeenCalledWith('agentPresets', 'list', {})
    expect(element('intake-role')?.textContent).toContain('产品需求分析')
    expect(element('intake-persona-section')).toBeNull()
    expect(element('intake-persona')).toBeNull()
    expect(container.textContent).not.toContain('角色人设')
  })

  it('名册读不到时回退词典里的角色名', async () => {
    stub({ ok: false, error: { code: 'lcoder/host-not-ready', message: '宿主尚未就绪' } })
    await render()
    expect(element('intake-role')?.textContent).toContain('需求分析师')
  })
})

describe('非空项目的立项阻塞', () => {
  it('已有需求时不给开始按钮，显示阻塞提示与回列表入口', async () => {
    stub({ ok: true, value: { presets: [] } })
    const onClose = vi.fn()
    await render({ projection: WITH_REQUIREMENT, onClose })
    expect(element('intake-blocked')?.textContent).toContain('只对空项目开放')
    expect(element('intake-start')).toBeNull()
    expect(element('intake-prompt')).toBeNull()
    act(() => { (element('intake-blocked-open') as HTMLElement).click() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
