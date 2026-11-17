// @vitest-environment jsdom
/** T-220：宿主就绪前不读；首读失败退避重试；进入需求页空/错时自动补读并给一行可重试提示。 */
import { act } from 'react'
import type { JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequirementsPage } from '../src/pages/requirements.tsx'
import { useProjection } from '../src/workspace/use-projection.ts'
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

const REQUIREMENT_YAML = [
  'id: REQ-99',
  'title: 探针需求',
  'state: confirmed',
  'options: []',
].join('\n')

interface RecordedCall {
  readonly method: string
  readonly path: string
}

let hostReady = false
let calls: RecordedCall[] = []
let container: HTMLDivElement
let root: Root

function requirementListCalls(): number {
  return calls.filter(call => call.method === 'list' && call.path === '.spec/requirements').length
}

/** 假宿主文件面：`hostReady` 为假时所有调用都回 `host-not-ready`。 */
async function fakeCall(namespace: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  if (namespace !== 'workspaceFiles') throw new Error(`未预期调用 ${namespace}/${method}`)
  const path = typeof args.path === 'string' ? args.path : ''
  calls.push({ method, path })
  if (!hostReady) return { ok: false, error: { code: 'lcoder/host-not-ready', message: '宿主尚未就绪' } }
  if (method === 'list') {
    return path === '.spec/requirements'
      ? { ok: true, value: { entries: [{ name: 'REQ-99.yaml', type: 'file' }, { name: 'REQ-99.md', type: 'file' }] } }
      : { ok: true, value: { entries: [] } }
  }
  if (path === '.spec/requirements/REQ-99.yaml') return { ok: true, value: { text: REQUIREMENT_YAML } }
  if (path === '.spec/requirements/REQ-99.md') return { ok: true, value: { text: '需求正文' } }
  return { ok: false, error: { code: 'ENOENT', message: 'ENOENT: 文件不存在' } }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  hostReady = false
  calls = []
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: { call: vi.fn(fakeCall) },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.useRealTimers()
})

function output(testId: string): string {
  return container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? ''
}

/** 把已排队的微任务与零延时链路跑完。 */
async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

function ProjectionHarness({ ready }: { readonly ready: boolean }): JSX.Element {
  const state = useProjection('session-scope', ready)
  return (
    <div>
      <output data-testid="projection-count">{String(state.projection.requirements.length)}</output>
      <output data-testid="projection-loading">{String(state.loading)}</output>
      <output data-testid="projection-error">{state.error ?? ''}</output>
      <button type="button" data-testid="projection-reload" onClick={state.reload}>reload</button>
    </div>
  )
}

describe('useProjection 加载时机', () => {
  it('宿主未就绪不发请求，就绪后自动读一次', async () => {
    await act(async () => { root.render(<ProjectionHarness ready={false} />) })
    await flush()
    expect(calls).toHaveLength(0)

    await act(async () => { root.render(<ProjectionHarness ready={true} />) })
    await flush()
    expect(requirementListCalls()).toBe(1)
    expect(output('projection-count')).toBe('0')
    expect(output('projection-error')).not.toBe('')
  })

  it('首读失败按退避自动重试，恢复后不重复并发', async () => {
    vi.useFakeTimers()
    await act(async () => { root.render(<ProjectionHarness ready={true} />) })
    await flush()
    expect(output('projection-error')).toContain('宿主尚未就绪')
    expect(output('projection-count')).toBe('0')
    expect(output('projection-loading')).toBe('true')

    hostReady = true
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    await flush()
    expect(output('projection-count')).toBe('1')
    expect(output('projection-error')).toBe('')
    expect(output('projection-loading')).toBe('false')
    expect(requirementListCalls()).toBe(2)

    // 同一个 ready 再渲染不触发第三次读取。
    await act(async () => { root.render(<ProjectionHarness ready={true} />) })
    await flush()
    expect(requirementListCalls()).toBe(2)
  })

  it('手动刷新仍能重读', async () => {
    hostReady = true
    await act(async () => { root.render(<ProjectionHarness ready={true} />) })
    await flush()
    expect(requirementListCalls()).toBe(1)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="projection-reload"]')?.click()
    })
    await flush()
    expect(requirementListCalls()).toBe(2)
    expect(output('projection-count')).toBe('1')
  })
})

describe('需求页进入补读与轻量提示', () => {
  function renderPage(props: {
    readonly loading?: boolean
    readonly error?: string | null
    readonly projection?: SpecProjection
    readonly onReload?: () => void
  }): void {
    act(() => {
      root.render(
        <RequirementsPage
          project={PROJECT}
          projection={props.projection ?? EMPTY}
          sessions={[]}
          loading={props.loading ?? false}
          error={props.error ?? null}
          intakeResult={null}
          onClearIntakeResult={() => {}}
          onReload={props.onReload ?? (() => {})}
          onStartIntake={async () => ({ ok: true, message: 'ok' })}
          onStartSession={async () => ({ ok: true, message: 'ok' })}
          onOpenTasks={() => {}}
        />,
      )
    })
  }

  it('数据为空时进入页面自动补读一次', () => {
    const onReload = vi.fn()
    renderPage({ onReload })
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('读取中进入页面不叠加请求', () => {
    const onReload = vi.fn()
    renderPage({ loading: true, onReload })
    expect(onReload).not.toHaveBeenCalled()
  })

  it('出错时给一行可重试提示，不恢复大诊断块', () => {
    const onReload = vi.fn()
    renderPage({ error: '.spec/requirements/: 宿主尚未就绪\n第二行不展示', onReload })
    expect(onReload).toHaveBeenCalledTimes(1)
    const line = container.querySelector('[data-testid="requirement-read-error"]')
    expect(line?.textContent).toContain('读取失败：.spec/requirements/: 宿主尚未就绪')
    expect(line?.textContent).not.toContain('第二行不展示')
    expect(container.querySelector('[data-testid="requirement-problems"]')).toBeNull()
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="requirement-retry"]')?.click()
    })
    expect(onReload).toHaveBeenCalledTimes(2)
  })

  it('读取中空态显示「读取中…」', () => {
    renderPage({ loading: true, onReload: vi.fn() })
    expect(container.querySelector('[data-testid="requirement-empty"]')?.textContent).toBe('读取中…')
  })
})
