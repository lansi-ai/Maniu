// @vitest-environment jsdom
/** T-315：原型工作室协作界面的锚点、改动卡、暂存条与全屏胶囊。 */
import type { JSX } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translate, type Translate } from '../src/locale.ts'
import type { StagedPrototype } from '../src/prototype/remote.ts'
import type { StudioBridge, StudioSelectionInfo } from '../src/prototype-studio/bridge.ts'
import { AnchorComposer } from '../src/prototype-studio/anchor-composer.tsx'
import { ChangeCard } from '../src/prototype-studio/change-card.tsx'
import { PrototypeStudioApp, resolveStudioSessionId } from '../src/prototype-studio/studio-app.tsx'

const t: Translate = (key, params) => translate('zh', key, params)
const COMMITTED = '<html><body>正式版</body></html>'

const VISUAL: StagedPrototype = {
  requirementId: 'REQ-01',
  html: '<html><body>视觉暂存</body></html>',
  changeKind: 'visual',
  summary: ['按钮改成主色', '加大卡片间距'],
  changedDomPaths: ['body > button', 'section.card'],
  createdAt: '2026-11-23T00:00:00.000Z',
}

const BUSINESS: StagedPrototype = {
  ...VISUAL,
  html: '<html><body>业务暂存</body></html>',
  changeKind: 'business',
  requirementDiff: {
    baseContent: '旧标题\n公共段落',
    proposedContent: '新标题\n公共段落\n新增验证码入口',
    summary: '新增验证码入口',
  },
}

interface CallRecord {
  readonly namespace: string
  readonly method: string
  readonly args: Record<string, unknown>
}

interface HarnessState {
  staged: StagedPrototype | null
  committedHtml: string
  snapshots: readonly { readonly snapshotId: string; readonly createdAt: string; readonly bytes: number }[]
}

let container: HTMLDivElement
let root: Root
let state: HarnessState
let calls: CallRecord[]
let loadCalls: Record<string, unknown>[]
let highlightCalls: string[][]
let modeCalls: string[]
let boundsCalls: Record<string, unknown>[]
let interactionCalls: string[]
let selectionListeners: Array<(info: StudioSelectionInfo) => void>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 一元调用替身：原型 Remote 改 state，会话发消息只记账。 */
async function fakeCall(namespace: string, method: string, args: object): Promise<unknown> {
  calls.push({ namespace, method, args: isRecord(args) ? args : {} })
  if (namespace === 'prototype' && method === 'getStaged') {
    return { ok: true, value: { staged: state.staged, committedHtml: state.committedHtml } }
  }
  if (namespace === 'prototype' && method === 'listSnapshots') {
    return { ok: true, value: { snapshots: state.snapshots } }
  }
  if (namespace === 'prototype' && method === 'commitStaged') {
    state.staged = null
    return { ok: true, value: { committedAt: '2026-11-23T01:00:00.000Z', requirementSync: 'patched' } }
  }
  if (namespace === 'prototype' && method === 'discardStaged') {
    state.staged = null
    return { ok: true, value: { ok: true } }
  }
  if (namespace === 'prototype' && method === 'restoreSnapshot') {
    state.committedHtml = '<html><body>恢复版</body></html>'
    return { ok: true, value: { restoredAt: '2026-11-23T02:00:00.000Z', html: state.committedHtml } }
  }
  if (namespace === 'session' && method === 'prompt') return { ok: true, value: {} }
  return { ok: true, value: {} }
}

function makeBridge(): StudioBridge {
  return {
    call: fakeCall,
    setPrototypeStudioInteraction: vi.fn(async (_mode: string) => { interactionCalls.push(_mode) }),
    setPrototypeStudioMode: vi.fn(async (mode: string) => { modeCalls.push(mode) }),
    loadPrototypeStudioHtml: vi.fn(async (payload: Record<string, unknown>) => { loadCalls.push(payload) }),
    highlightPrototypeStudioPaths: vi.fn(async (paths: readonly string[]) => { highlightCalls.push([...paths]) }),
    setPrototypeStudioFloatingBounds: vi.fn(async (bounds: Record<string, unknown>) => { boundsCalls.push(bounds) }),
    onPrototypeSelection: (listener: (info: StudioSelectionInfo) => void) => {
      selectionListeners.push(listener)
      return () => {
        const index = selectionListeners.indexOf(listener)
        if (index >= 0) selectionListeners.splice(index, 1)
      }
    },
    onStreamFrame: () => () => {},
    onEvent: () => () => {},
    onWaterfall: () => () => {},
    onWaterfallCancel: () => () => {},
    eventResult: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  state = {
    staged: VISUAL,
    committedHtml: COMMITTED,
    snapshots: [{ snapshotId: 'snap-1', createdAt: '2026-11-22T00:00:00.000Z', bytes: 128 }],
  }
  calls = []
  loadCalls = []
  highlightCalls = []
  modeCalls = []
  boundsCalls = []
  interactionCalls = []
  selectionListeners = []
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  Reflect.deleteProperty(window, 'lcoder')
})

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}

function element(testId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
}

function elements(testId: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)]
}

async function click(testId: string): Promise<void> {
  const node = element(testId)
  expect(node).not.toBeNull()
  await act(async () => { node?.click() })
  await flush()
}

async function render(node: JSX.Element): Promise<void> {
  await act(async () => { root.render(node) })
  await flush()
}

let renderSeq = 0

function renderApp(bridge: StudioBridge, initialSessionId = 'session-1'): Promise<void> {
  renderSeq += 1
  return render(
    <PrototypeStudioApp
      key={renderSeq}
      requirementId="REQ-01"
      initialSessionId={initialSessionId}
      t={t}
      bridge={bridge}
      call={fakeCall}
    />,
  )
}

describe('锚点输入区', () => {
  it('点选挂多锚点、按 DOM 路径去重、单项移除与清空，切换交互同步桥接', async () => {
    const bridge = makeBridge()
    const onSend = vi.fn(async () => true)
    await render(<AnchorComposer t={t} bridge={bridge} running={false} onSend={onSend} />)

    const emit = (domPath: string, label: string): void => {
      act(() => {
        for (const listener of [...selectionListeners]) {
          listener({ domPath, html: '<button />', css: 'color: #333', label })
        }
      })
    }
    emit('body > button', '登录')
    emit('body > button', '重复点选')
    emit('form > input', '邮箱')
    expect(elements('studio-anchor-chip')).toHaveLength(2)
    expect(elements('studio-anchor-chip').map(node => node.textContent).join(' ')).toContain('📍 登录')

    await click('studio-interaction-select')
    expect(interactionCalls).toContain('select')

    const removeButtons = elements('studio-anchor-remove')
    await act(async () => { removeButtons[0]?.click() })
    expect(elements('studio-anchor-chip')).toHaveLength(1)
    await click('studio-anchors-clear')
    expect(elements('studio-anchor-chip')).toHaveLength(0)

    const input = element('studio-instruction-input') as HTMLInputElement
    await act(async () => {
      // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '把按钮改成主色')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('studio-send-instruction')
    expect(onSend).toHaveBeenCalledWith('把按钮改成主色', [])
    expect(input.value).toBe('')
  })

  it('运行中锁住发送入口', async () => {
    await render(<AnchorComposer t={t} bridge={makeBridge()} running onSend={vi.fn(async () => true)} />)
    expect((element('studio-send-instruction') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('暂存改动卡', () => {
  it('视觉卡列摘要与 DOM 区域数并给出确认/放弃', async () => {
    await render(<ChangeCard t={t} staged={VISUAL} busy={false} onCommit={vi.fn()} onDiscard={vi.fn()} />)
    expect(element('studio-change-card-visual')).not.toBeNull()
    expect(element('studio-change-summary')?.textContent).toContain('按钮改成主色')
    expect(element('studio-change-dom-count')?.textContent).toContain('2')
    expect(element('studio-change-card-confirm')).not.toBeNull()
    expect(element('studio-change-card-discard')).not.toBeNull()
  })

  it('需求变更卡展开 Diff 显示增删行并区分同步与仅落盘', async () => {
    const onCommit = vi.fn()
    await render(<ChangeCard t={t} staged={BUSINESS} busy={false} syncStatus="skipped_pending" onCommit={onCommit} onDiscard={vi.fn()} />)
    expect(element('studio-change-card-business')).not.toBeNull()
    expect(element('studio-change-requirement-summary')?.textContent).toContain('新增验证码入口')
    expect(element('studio-change-sync')?.getAttribute('data-sync')).toBe('skipped_pending')

    await click('studio-diff-toggle')
    expect(elements('studio-diff-line').some(node => node.getAttribute('data-kind') === 'added')).toBe(true)
    expect(elements('studio-diff-line').some(node => node.getAttribute('data-kind') === 'removed')).toBe(true)

    await act(async () => { (element('studio-amend-toggle') as HTMLInputElement).click() })
    await click('studio-change-card-confirm-sync')
    expect(onCommit).toHaveBeenCalledWith(true, true)
    await click('studio-change-card-commit-only')
    expect(onCommit).toHaveBeenCalledWith(false, false)
  })
})

describe('暂存控制条', () => {
  it('修改前后瞬切、并排对比与高亮都走宿主画布面', async () => {
    const bridge = makeBridge()
    await renderApp(bridge)
    expect(element('studio-staged-bar')?.getAttribute('data-staged')).toBe('true')
    expect(element('studio-staged-state')?.textContent).toContain('未落盘')

    await click('studio-view-before')
    expect(loadCalls.at(-1)).toMatchObject({ html: COMMITTED, beforeHtml: COMMITTED })
    await click('studio-view-after')
    expect(loadCalls.at(-1)).toMatchObject({ html: VISUAL.html, beforeHtml: COMMITTED })

    await click('studio-compare-side-by-side')
    expect(modeCalls).toContain('compare-side-by-side')
    expect(loadCalls.at(-1)).toMatchObject({ html: VISUAL.html })

    await click('studio-highlight-toggle')
    expect(highlightCalls.at(-1)).toEqual([...VISUAL.changedDomPaths])
    await click('studio-highlight-toggle')
    expect(highlightCalls.at(-1)).toEqual([])
  })

  it('确认落盘刷新正式版、放弃回退、快照恢复重载画布，线上入参都包 input', async () => {
    const bridge = makeBridge()
    await renderApp(bridge)
    await click('studio-commit-staged')
    expect(calls.some(call => call.namespace === 'prototype' && call.method === 'commitStaged'
      && isRecord(call.args.input) && call.args.input.requirementId === 'REQ-01')).toBe(true)
    expect(loadCalls.at(-1)).toMatchObject({ html: COMMITTED })
    expect(element('studio-staged-bar')?.getAttribute('data-staged')).toBe('false')

    state.staged = BUSINESS
    await renderApp(bridge)
    await click('studio-discard-staged')
    expect(calls.some(call => call.namespace === 'prototype' && call.method === 'discardStaged'
      && isRecord(call.args.input) && call.args.input.requirementId === 'REQ-01')).toBe(true)
    expect(loadCalls.at(-1)).toMatchObject({ html: COMMITTED })

    await click('studio-snapshots-trigger')
    expect(elements('studio-snapshot')).toHaveLength(1)
    await click('studio-snapshot-restore')
    const restore = calls.find(call => call.namespace === 'prototype' && call.method === 'restoreSnapshot')
    expect(isRecord(restore?.args.input) && restore?.args.input.snapshotId).toBe('snap-1')
    expect(loadCalls.at(-1)).toMatchObject({ html: '<html><body>恢复版</body></html>' })
  })

  it('全屏折叠为胶囊再展开不丢暂存态与会话', async () => {
    const bridge = makeBridge()
    await renderApp(bridge)
    await click('studio-mode-toggle')
    expect(modeCalls).toContain('fullscreen-pinned')
    expect(element('studio-floating-collapse')).not.toBeNull()

    await click('studio-floating-collapse')
    expect(boundsCalls.at(-1)).toMatchObject({ x: -1, y: -1, width: 260, height: 48, collapsed: true })
    expect(element('studio-body')?.hidden).toBe(true)
    expect(element('studio-staged-state')?.textContent).toContain('未落盘')

    await click('studio-floating-collapse')
    expect(boundsCalls.at(-1)).toMatchObject({ x: -1, y: -1, width: 380, height: 520, collapsed: false })
    expect(element('studio-body')?.hidden).toBe(false)
    expect(element('studio-anchor-composer')).not.toBeNull()
  })
})

describe('会话兜底', () => {
  it('优先用显式会话号，其次本需求上次用过的工作室会话', () => {
    expect(resolveStudioSessionId('REQ-01', 'url-session')).toBe('url-session')
    localStorage.setItem('lcoder.studio.session.REQ-01', 'stored-session')
    expect(resolveStudioSessionId('REQ-01')).toBe('stored-session')
  })
})
