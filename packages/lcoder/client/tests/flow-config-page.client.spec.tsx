// @vitest-environment jsdom
/** T-243：项目信息页流程配置节——节点岗位增删排序、auto 开关、保存与恢复预制走 /flow_save。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectInfoPage } from '../src/pages/project-info.tsx'
import type { SpecProjection } from '../src/spec/load.ts'
import type { FlowConfigRow } from '../src/spec/rows.ts'
import type { ProjectScope } from '../src/workspace/use-workspaces.ts'
import { translate, type Translate } from '../src/locale.ts'

const t: Translate = (key, params) => translate('zh', key, params)

const PROJECT: ProjectScope = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

function projectionOf(flow?: FlowConfigRow): SpecProjection {
  return {
    tasks: [],
    rules: [],
    contracts: [],
    proposals: [],
    requirements: [],
    groups: [],
    roles: [
      { id: 'deputy-pm', name: '副项目经理', inherits: 'pm' },
      { id: 'dotnet-eng', name: '.NET 工程师', inherits: 'dev' },
    ],
    project: null,
    secrets: {},
    automation: null,
    agents: null,
    ...(flow === undefined ? {} : { flow }),
    problems: [],
  }
}

const SUCCESS = { ok: true, value: { result: { kind: 'success', text: '流程配置已写入' } } }
const FAILURE = { ok: true, value: { result: { kind: 'error', text: '流程配置里的岗位解析不了：nobody' } } }

let call: ReturnType<typeof vi.fn>
let container: HTMLDivElement
let root: Root
let reload = vi.fn<() => void>()

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  call = vi.fn(async () => SUCCESS)
  Object.defineProperty(window, 'lcoder', { configurable: true, value: { call } })
  reload = vi.fn<() => void>()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  Reflect.deleteProperty(window, 'lcoder')
})

function render(projection: SpecProjection): void {
  act(() => {
    root.render(
      <ProjectInfoPage
        t={t}
        project={PROJECT}
        projection={projection}
        loading={false}
        error={null}
        onReload={reload}
      />,
    )
  })
}

function element(testId: string): Element | null {
  return container.querySelector(`[data-testid="${testId}"]`)
}

function nodeBlock(kind: string): Element {
  const node = container.querySelector(`[data-testid="flow-node"][data-node="${kind}"]`)
  if (node === null) throw new Error(`missing node ${kind}`)
  return node
}

async function press(testId: string, within: Element = container): Promise<void> {
  const node = within.querySelector(`[data-testid="${testId}"]`)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function choose(testId: string, value: string, within: Element = container): Promise<void> {
  // HeroUI Select 的根节点是 div，选中态由内部隐藏的原生 select 承载。
  const select = within.querySelector(`[data-testid="${testId}"] select`) as HTMLSelectElement | null
  expect(select).not.toBeNull()
  await act(async () => {
    if (select === null) return
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function autoInput(within: Element): HTMLInputElement {
  const input = within.querySelector('[data-testid="flow-auto"] input[type="checkbox"]') as HTMLInputElement | null
  if (input === null) throw new Error('missing flow-auto switch')
  return input
}

function commandLines(): string[] {
  return call.mock.calls
    .filter(entry => entry[0] === 'commands' && entry[1] === 'execute')
    .map(entry => (entry[2] as { line: string }).line)
}

describe('流程配置节渲染', () => {
  it('无 flow.yaml 时画四个预制节点并标明走预制', () => {
    render(projectionOf())
    expect(element('flow-config-section')).not.toBeNull()
    expect(element('flow-source')?.textContent).toBe('当前走内置预制流程')
    const kinds = [...container.querySelectorAll('[data-testid="flow-node"]')].map(node => node.getAttribute('data-node'))
    expect(kinds).toEqual(['intake', 'review', 'revise', 'split'])
    const reviewRoles = [...nodeBlock('review').querySelectorAll('[data-testid="flow-role-item"]')].map(node => node.getAttribute('data-role'))
    expect(reviewRoles).toEqual(['maniu-pm'])
    expect(autoInput(nodeBlock('review')).checked).toBe(true)
    expect(autoInput(nodeBlock('revise')).checked).toBe(false)
  })

  it('有 flow.yaml 时按配置渲染并标明使用项目配置', () => {
    render(projectionOf({ nodes: [{ node: 'review', roles: ['maniu-pm', 'deputy-pm'], auto: false }] }))
    expect(element('flow-source')?.textContent).toBe('当前使用项目配置')
    const reviewRoles = [...nodeBlock('review').querySelectorAll('[data-testid="flow-role-item"]')].map(node => node.getAttribute('data-role'))
    expect(reviewRoles).toEqual(['maniu-pm', 'deputy-pm'])
    expect(autoInput(nodeBlock('review')).checked).toBe(false)
    expect(nodeBlock('review').textContent).toContain('副项目经理')
  })

  it('岗位候选含内置 preset 与名册岗位，已选岗位不再出现在候选里', () => {
    render(projectionOf())
    const options = [...nodeBlock('review').querySelectorAll('[data-testid="flow-role-add"] select option')].map(node => node.getAttribute('value'))
    expect(options).toContain('maniu-review')
    expect(options).toContain('deputy-pm')
    expect(options).not.toContain('maniu-pm')
  })
})

describe('编辑与保存', () => {
  it('添加岗位、排序、移除与 auto 开关都进保存载荷', async () => {
    render(projectionOf())
    await choose('flow-role-add', 'deputy-pm', nodeBlock('review'))
    expect([...nodeBlock('review').querySelectorAll('[data-testid="flow-role-item"]')].map(node => node.getAttribute('data-role')))
      .toEqual(['maniu-pm', 'deputy-pm'])

    // 把新加的第二岗上移到第一位。
    const items = nodeBlock('review').querySelectorAll('[data-testid="flow-role-item"]')
    const second = items[1]
    expect(second).toBeDefined()
    await press('flow-role-up', second)
    expect([...nodeBlock('review').querySelectorAll('[data-testid="flow-role-item"]')].map(node => node.getAttribute('data-role')))
      .toEqual(['deputy-pm', 'maniu-pm'])

    // 关掉评审的自动衔接。
    const auto = autoInput(nodeBlock('review'))
    await act(async () => {
      auto.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(auto.checked).toBe(false)

    await press('flow-save')
    const lines = commandLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]?.startsWith('/flow_save ')).toBe(true)
    const payload = JSON.parse((lines[0] ?? '').slice('/flow_save '.length)) as { nodes: { node: string; roles: string[]; auto: boolean }[] }
    const review = payload.nodes.find(node => node.node === 'review')
    expect(review).toEqual({ node: 'review', roles: ['deputy-pm', 'maniu-pm'], auto: false })
    expect(payload.nodes.map(node => node.node)).toEqual(['intake', 'review', 'revise', 'split'])
    expect(reload).toHaveBeenCalledTimes(1)
    expect(element('flow-result')?.getAttribute('data-ok')).toBe('true')
  })

  it('移除岗位后保存载荷少一岗；移空时禁止保存并给提示', async () => {
    render(projectionOf())
    await press('flow-role-remove', nodeBlock('review'))
    expect(nodeBlock('review').querySelectorAll('[data-testid="flow-role-item"]')).toHaveLength(0)
    expect(element('flow-empty-roles')).not.toBeNull()
    expect((element('flow-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('保存失败显示命令回执，不刷新投影', async () => {
    call.mockResolvedValue(FAILURE)
    render(projectionOf())
    await press('flow-save')
    expect(element('flow-result')?.getAttribute('data-ok')).toBe('false')
    expect(element('flow-result')?.textContent).toContain('nobody')
    expect(reload).not.toHaveBeenCalled()
  })

  it('恢复预制发送 /flow_save preset', async () => {
    render(projectionOf({ nodes: [{ node: 'review', roles: ['deputy-pm'], auto: false }] }))
    await press('flow-reset')
    expect(commandLines()).toEqual(['/flow_save preset'])
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
