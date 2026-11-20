// @vitest-environment jsdom
/** 立项向导的角色名片、档位切换与准入阻塞：不再展示人设段落与内部指令预览。 */
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
  requirements: [{ id: 'REQ-01', text: '正文', title: '探针需求', state: 'confirmed', options: [], versions: [], reviews: [] }],
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
  readonly onStart?: (prompt: string) => Promise<{ readonly ok: boolean; readonly message: string }>
} = {}): Promise<void> {
  await act(async () => {
    root.render(
      <IntakeWizard
        isOpen
        project={PROJECT}
        projection={props.projection ?? EMPTY}
        result={null}
        onClearResult={() => {}}
        onClose={props.onClose ?? (() => {})}
        onStart={props.onStart ?? (async () => ({ ok: true, message: 'ok' }))}
        onOpenRequirement={() => {}}
        onReload={() => {}}
      />,
    )
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function element(testId: string): Element | null {
  // HeroUI Modal 通过 React Aria Portal 挂到 document.body，不能只查挂载容器。
  return document.querySelector(`[data-testid="${testId}"]`)
}

/** 在想法输入框里输入一句话，触发 React 的受控更新。 */
function typeIdea(value: string): void {
  const node = element('intake-idea-input') as HTMLTextAreaElement
  expect(node).not.toBeNull()
  // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(node, value)
  node.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('立项向导的角色名片', () => {
  it('显示人才库名册里的显示名与创建者，不重复两次角色名', async () => {
    const call = stub({ ok: true, value: { presets: [{ id: 'maniu-intake', name: '产品需求分析', isDefault: false }] } })
    await render()
    expect(call).toHaveBeenCalledWith('agentPresets', 'list', {})
    const role = element('intake-role')
    expect(role?.textContent).toContain('产品需求分析')
    expect(role?.textContent).toContain('慢牛 Maniu')
    expect(role?.textContent?.match(/产品需求分析/g)?.length).toBe(1)
    expect(element('intake-persona-section')).toBeNull()
    expect(element('intake-persona')).toBeNull()
    expect(document.body.textContent).not.toContain('角色人设')
  })

  it('名册读不到时回退词典里的角色名，仍显示内置创建者', async () => {
    stub({ ok: false, error: { code: 'lcoder/host-not-ready', message: '宿主尚未就绪' } })
    await render()
    expect(element('intake-role')?.textContent).toContain('需求分析师')
    expect(element('intake-role')?.textContent).toContain('慢牛 Maniu')
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
    expect(element('intake-idea-section')).toBeNull()
    act(() => { (element('intake-blocked-open') as HTMLElement).click() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('居中 Modal 的关闭入口', () => {
  it('关闭按钮经 overlay 状态回调通知父级收起', async () => {
    stub({ ok: true, value: { presets: [] } })
    const onClose = vi.fn()
    await render({ onClose })
    expect(element('intake-wizard')).not.toBeNull()
    expect(element('intake-close')).not.toBeNull()
    act(() => { (element('intake-close') as HTMLElement).click() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('内部指令预览已移除', () => {
  it('不再渲染折叠区与内部指令正文', async () => {
    stub({ ok: true, value: { presets: [] } })
    await render()
    expect(element('intake-prompt-details')).toBeNull()
    expect(element('intake-prompt')).toBeNull()
    expect(document.body.textContent).not.toContain('指令预览')
  })
})

describe('档位切换与立项发送', () => {
  it('默认全新项目档：想法未填时开始禁用，填一句后解锁并把想法送进提示词', async () => {
    stub({ ok: true, value: { presets: [] } })
    let sent = ''
    const onStart = vi.fn(async (prompt: string) => {
      sent = prompt
      return { ok: true, message: 'ok' }
    })
    await render({ onStart })
    expect((element('intake-mode-fresh') as HTMLElement).getAttribute('aria-checked')).toBe('true')
    expect((element('intake-mode-onboarding') as HTMLElement).getAttribute('aria-checked')).toBe('false')
    expect(element('intake-idea-section')).not.toBeNull()
    expect(element('intake-idea-input')).not.toBeNull()
    expect((element('intake-start') as HTMLButtonElement).disabled).toBe(true)
    act(() => { (element('intake-start') as HTMLElement).click() })
    expect(onStart).not.toHaveBeenCalled()
    act(() => { typeIdea('做一个团队人员名单维护工具') })
    expect((element('intake-start') as HTMLButtonElement).disabled).toBe(false)
    act(() => { (element('intake-start') as HTMLElement).click() })
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(sent).toContain('全新项目立项：')
    expect(sent).toContain('做一个团队人员名单维护工具')
  })

  it('切到已有资料档后想法可选填，点开始立项发送已有资料提示词', async () => {
    stub({ ok: true, value: { presets: [] } })
    let sent = ''
    const onStart = vi.fn(async (prompt: string) => {
      sent = prompt
      return { ok: true, message: 'ok' }
    })
    await render({ onStart })
    act(() => { (element('intake-mode-onboarding') as HTMLElement).click() })
    expect((element('intake-mode-onboarding') as HTMLElement).getAttribute('aria-checked')).toBe('true')
    expect((element('intake-mode-fresh') as HTMLElement).getAttribute('aria-checked')).toBe('false')
    expect(element('intake-idea-section')).toBeNull()
    expect((element('intake-start') as HTMLButtonElement).disabled).toBe(false)
    act(() => { (element('intake-start') as HTMLElement).click() })
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(sent).toContain('已有资料立项：')
  })
})
