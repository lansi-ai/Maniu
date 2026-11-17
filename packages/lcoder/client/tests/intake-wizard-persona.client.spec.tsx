// @vitest-environment jsdom
/** 立项向导只读展示 maniu-intake 人设，读不到时如实报错。 */
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

const DOCUMENT = `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: |-
      You are 需求分析师.
      七个问题依次覆盖：
      1. 你想做一个什么软件？
`

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

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      <IntakeWizard
        project={PROJECT}
        projection={PROJECTION}
        result={null}
        onClearResult={() => {}}
        onClose={() => {}}
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

describe('立项向导的角色人设', () => {
  it('从人才库读回需求分析师人设并只读展示，指令预览不再重复纪律', async () => {
    const call = stub({ ok: true, value: { agentPreset: 'maniu-intake', content: DOCUMENT } })
    await render()
    expect(call).toHaveBeenCalledWith('agentPresets', 'read', { agentPreset: 'maniu-intake' })
    expect(element('intake-persona-section')?.textContent).toContain('角色人设')
    expect(element('intake-persona')?.textContent).toContain('七个问题依次覆盖')
    expect(element('intake-persona')?.textContent).toContain('You are 需求分析师')
    expect(element('intake-prompt')?.textContent).not.toContain('七个问题依次覆盖')
  })

  it('读不到人设时如实显示失败，不静默', async () => {
    stub({ ok: false, error: { code: 'agent-preset/not-found', message: 'Unknown agent preset' } })
    await render()
    const failure = element('intake-persona-error')
    expect(failure?.textContent).toContain('读取角色人设失败')
    expect(failure?.textContent).toContain('agent-preset/not-found')
    expect(element('intake-persona')).toBeNull()
  })

  it('人设行缺失时说明这个角色没有声明人设', async () => {
    stub({ ok: true, value: { agentPreset: 'maniu-intake', content: "- id: ask-user\n  name: '@deepseek-ai/dsh-tool-ask-user'\n" } })
    await render()
    expect(element('intake-persona-error')?.textContent).toContain('没有声明人设行')
  })
})
