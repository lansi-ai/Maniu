// @vitest-environment jsdom
/** T-315：原型工作室协作界面的锚点、改动卡、暂存条与全屏胶囊。T-318：拖拽、实时进度与发送时序。 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { JSX } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostEvent, StreamFrame } from '@maniu/desktop/contract'
import { translate, type Translate } from '../src/locale.ts'
import type { StagedPrototype } from '../src/prototype/remote.ts'
import type { StudioBridge, StudioSelectionInfo } from '../src/prototype-studio/bridge.ts'
import { AnchorComposer, type StudioAnchorDraft } from '../src/prototype-studio/anchor-composer.tsx'
import { buildStudioCoDesignPrompt } from '../src/prototype/prompt.ts'
import { ChangeCard } from '../src/prototype-studio/change-card.tsx'
import { CoDesignThread, TURN_PROBE_INTERVAL_MS, type StudioTurnEcho } from '../src/prototype-studio/co-design-thread.tsx'
import { PrototypeStudioApp, resolveRemoteSessionIds, resolveStudioSessionId } from '../src/prototype-studio/studio-app.tsx'
import { StudioDock } from '../src/prototype-studio/studio-dock.tsx'

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

/**
 * 会话作用域开关：`stagedIn` 里的会话才看得到暂存，`missing` 里的会话按没有工作区失败，
 * `denied` 里的会话按普通失败返回；为 null 时不区分会话，所有会话都看得到暂存。
 */
interface SessionGate {
  readonly stagedIn: readonly string[]
  readonly missing: readonly string[]
  readonly denied: readonly string[]
}

let container: HTMLDivElement
let root: Root
let state: HarnessState
let sessionGate: SessionGate | null
let calls: CallRecord[]
let loadCalls: Record<string, unknown>[]
let highlightCalls: string[][]
let modeCalls: string[]
let boundsCalls: Record<string, unknown>[]
let interactionCalls: string[]
let selectionListeners: Array<(info: StudioSelectionInfo) => void>
let frameListeners: Array<(streamId: string, frame: StreamFrame) => void>
let eventListeners: Array<(event: HostEvent) => void>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 一元调用替身：原型 Remote 改 state，会话发消息只记账。 */
async function fakeCall(namespace: string, method: string, args: object): Promise<unknown> {
  calls.push({ namespace, method, args: isRecord(args) ? args : {} })
  const input = isRecord(args) && isRecord(args.input) ? args.input : undefined
  const sessionId = typeof input?.sessionId === 'string' ? input.sessionId : ''
  // 重启后旧协作会话尚未激活时，宿主就是这么回报的；只有这类失败允许换会话号重试。
  if (namespace === 'prototype' && sessionGate !== null) {
    if (sessionGate.missing.includes(sessionId)) {
      return { ok: false, error: { code: 'PROTOTYPE/NO_WORKSPACE', message: '会话不存在或没有工作区' } }
    }
    if (sessionGate.denied.includes(sessionId)) {
      return { ok: false, error: { code: 'PROTOTYPE/BAD_REQUEST', message: '参数不合法' } }
    }
  }
  if (namespace === 'prototype' && method === 'getStaged') {
    const visible = sessionGate === null || sessionGate.stagedIn.includes(sessionId)
    return { ok: true, value: { staged: visible ? state.staged : null, committedHtml: state.committedHtml } }
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
  if (namespace === 'session' && method === 'create') return { ok: true, value: { sessionId: 'chat-1' } }
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
  sessionGate = null
  loadCalls = []
  highlightCalls = []
  modeCalls = []
  boundsCalls = []
  interactionCalls = []
  selectionListeners = []
  frameListeners = []
  eventListeners = []
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
  it('点选挂多锚点、按 DOM 路径去重、单项移除与清空，输入区不再切换画布交互模式', async () => {
    const bridge = makeBridge()
    const onSend = vi.fn(async () => true)
    await render(<AnchorComposer t={t} bridge={bridge} running={false} onSend={onSend} />)

    // 没选锚点时只留一行 Alt 点选提示；试玩 / 点选按钮已移除。
    expect(element('studio-anchor-empty')?.textContent).toContain('按住 Alt')
    expect(element('studio-interaction-toggle')).toBeNull()
    expect(element('studio-interaction-interact')).toBeNull()
    expect(element('studio-interaction-select')).toBeNull()

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
    expect(elements('studio-anchor-chip').map(node => node.textContent).join(' ')).toContain('登录')
    // 名称胶囊给出全称，超宽时靠 CSS 省略。
    expect(elements('studio-anchor-chip')[0]?.getAttribute('title')).toBe('登录')
    expect(element('studio-anchors-count')?.textContent).toContain('2')
    expect(element('studio-anchor-empty')).toBeNull()

    const removeButtons = elements('studio-anchor-remove')
    await act(async () => { removeButtons[0]?.click() })
    expect(elements('studio-anchor-chip')).toHaveLength(1)
    await click('studio-anchors-clear')
    expect(elements('studio-anchor-chip')).toHaveLength(0)
    expect(interactionCalls).toEqual([])

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

  it('每个锚点渲染独立输入框，只填逐锚点意见也能发送并绑定到提示词', async () => {
    const onSend = vi.fn(async () => true)
    await render(<AnchorComposer t={t} bridge={makeBridge()} running={false} onSend={onSend} />)

    const emit = (domPath: string, label: string): void => {
      act(() => {
        for (const listener of [...selectionListeners]) {
          listener({ domPath, html: '<div />', css: 'color: #333', label })
        }
      })
    }
    emit('body > div.mini:nth-child(1)', '本月已提交报销总额')
    emit('body > section.card:nth-child(2)', '待审批列表')

    const notes = elements('studio-anchor-note') as HTMLInputElement[]
    expect(notes).toHaveLength(2)
    expect(notes.map(note => note.getAttribute('data-dom-path'))).toEqual([
      'body > div.mini:nth-child(1)', 'body > section.card:nth-child(2)',
    ])
    expect(notes[0]?.placeholder).toContain('针对此元素怎么改')
    expect((element('studio-instruction-input') as HTMLInputElement).placeholder).toContain('补充整体修改意见（可选）')

    const type = async (input: HTMLInputElement, value: string): Promise<void> => {
      await act(async () => {
        // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await type(notes[0] as HTMLInputElement, '改成主色按钮')
    await type(notes[1] as HTMLInputElement, '按提交时间倒序')

    // 全局意见留空也能发送：判定只看逐锚点意见。
    expect((element('studio-send-instruction') as HTMLButtonElement).disabled).toBe(false)
    await click('studio-send-instruction')
    expect(onSend).toHaveBeenCalledTimes(1)
    const [, sent] = onSend.mock.calls[0] as [string, readonly StudioAnchorDraft[]]
    expect(sent.map(anchor => anchor.note)).toEqual(['改成主色按钮', '按提交时间倒序'])

    const prompt = buildStudioCoDesignPrompt({
      requirementId: 'REQ-01',
      requirementTitle: 'REQ-01',
      baselineNote: '当前基准：本轮暂存版 HTML。',
      instruction: '',
      anchors: sent,
    })
    expect(prompt).toContain('用户对该元素的修改指令：改成主色按钮')
    expect(prompt).toContain('用户对该元素的修改指令：按提交时间倒序')
    expect(prompt).toContain('#1 本月已提交报销总额：改成主色按钮')
    expect(prompt).toContain('#2 待审批列表：按提交时间倒序')
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

    // 打开即高亮本轮改动区域；第一次点击取消，再点一次恢复。
    expect(highlightCalls.at(-1)).toEqual([...VISUAL.changedDomPaths])
    await click('studio-highlight-toggle')
    expect(highlightCalls.at(-1)).toEqual([])
    await click('studio-highlight-toggle')
    expect(highlightCalls.at(-1)).toEqual([...VISUAL.changedDomPaths])
  })

  it('没有暂存时顶部不渲染占位操作条，对比图标禁用并说明原因', async () => {
    state.staged = null
    const bridge = makeBridge()
    await renderApp(bridge)
    expect(element('studio-staged-bar')).toBeNull()
    expect(container.textContent).not.toContain('暂无未落盘的修改')
    const compare = element('studio-quick-compare') as HTMLButtonElement
    expect(compare.disabled).toBe(true)
    expect(compare.getAttribute('title')).toBe('暂无可对比的修改')
    expect(compare.getAttribute('aria-label')).toBe('暂无可对比的修改')
    // 没有暂存也不影响历史快照与全屏切换入口。
    expect(element('studio-snapshots-trigger')).not.toBeNull()
    expect(element('studio-mode-toggle')).not.toBeNull()
  })

  it('顶部对比图标在暂存版与原版间一键瞬切，原版态高亮', async () => {
    const bridge = makeBridge()
    await renderApp(bridge)
    const compare = (): HTMLElement | null => element('studio-quick-compare')
    expect(compare()?.getAttribute('title')).toBe('点击查看原版')
    expect(compare()?.getAttribute('aria-label')).toBe('点击查看原版')
    expect(compare()?.getAttribute('data-active')).toBe('false')

    await click('studio-quick-compare')
    expect(loadCalls.at(-1)).toMatchObject({ html: COMMITTED, beforeHtml: COMMITTED })
    expect(compare()?.getAttribute('data-active')).toBe('true')
    expect(compare()?.getAttribute('aria-pressed')).toBe('true')
    expect(compare()?.getAttribute('title')).toBe('点击切回修改后')

    await click('studio-quick-compare')
    expect(loadCalls.at(-1)).toMatchObject({ html: VISUAL.html, beforeHtml: COMMITTED })
    expect(compare()?.getAttribute('data-active')).toBe('false')
    expect(compare()?.getAttribute('title')).toBe('点击查看原版')
  })

  it('确认落盘刷新正式版、放弃回退、快照恢复重载画布，线上入参都包 input', async () => {
    const bridge = makeBridge()
    await renderApp(bridge)
    await click('studio-commit-staged')
    expect(calls.some(call => call.namespace === 'prototype' && call.method === 'commitStaged'
      && isRecord(call.args.input) && call.args.input.requirementId === 'REQ-01')).toBe(true)
    expect(loadCalls.at(-1)).toMatchObject({ html: COMMITTED })
    expect(element('studio-staged-bar')).toBeNull()

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

  it('回合完成后自动切到修改后、高亮改动区域，并在该轮回复后紧跟改动卡', async () => {
    state.staged = null
    const bridge = makeStreamBridge()
    await renderApp(bridge)
    expect(element('studio-change-card-visual')).toBeNull()

    const input = element('studio-instruction-input') as HTMLInputElement
    await act(async () => {
      // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '把主按钮改成主色')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('studio-send-instruction')
    expect(element('studio-turn-running')).not.toBeNull()

    // 这一轮宿主暂存出结果：回合结束后画布自动切到修改后，并高亮改动区域。
    state.staged = VISUAL
    emitEvent('api-session/status', 'chat-1', true)
    await flush()
    emitEvent('api-session/status', 'chat-1', false)
    await flush()

    expect(loadCalls.at(-1)).toMatchObject({ html: VISUAL.html, beforeHtml: COMMITTED })
    expect(highlightCalls.at(-1)).toEqual([...VISUAL.changedDomPaths])
    expect(element('studio-view-after')?.getAttribute('aria-pressed')).toBe('true')
    const card = element('studio-change-card-visual')
    expect(card).not.toBeNull()
    expect(element('studio-round-card')?.contains(card)).toBe(true)

    // 卡片自带前后瞬切与并排对比，不用再回顶部暂存条操作。
    expect(element('studio-card-view-before')).not.toBeNull()
    expect(element('studio-card-compare')).not.toBeNull()
    await click('studio-card-view-before')
    expect(loadCalls.at(-1)).toMatchObject({ html: COMMITTED, beforeHtml: COMMITTED })
    expect(element('studio-card-view-after')?.getAttribute('aria-pressed')).toBe('false')
    await click('studio-card-compare')
    expect(modeCalls).toContain('compare-side-by-side')
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

  it('prototype/* 先问协作会话、再用作用域会话兜底，同一会话号只问一次', () => {
    expect(resolveRemoteSessionIds('chat-1', 'scope-1')).toEqual(['chat-1', 'scope-1'])
    expect(resolveRemoteSessionIds('chat-1', 'chat-1')).toEqual(['chat-1'])
    expect(resolveRemoteSessionIds(null, 'scope-1')).toEqual(['scope-1'])
    expect(resolveRemoteSessionIds('', 'scope-1')).toEqual(['scope-1'])
    expect(resolveRemoteSessionIds(null, null)).toEqual([])
  })
})

/** 取 prototype/* 某方法依次用过的会话号。 */
function prototypeSessions(method: string): readonly string[] {
  return calls
    .filter(call => call.namespace === 'prototype' && call.method === method)
    .map(call => isRecord(call.args.input) && typeof call.args.input.sessionId === 'string' ? call.args.input.sessionId : '')
}

/** 取 prototype/* 某方法最后一次的 input 字段。 */
function lastPrototypeInput(method: string): Record<string, unknown> | undefined {
  const found = calls.filter(call => call.namespace === 'prototype' && call.method === method).at(-1)
  return found !== undefined && isRecord(found.args.input) ? found.args.input : undefined
}

describe('暂存会话作用域', () => {
  /** 本需求上次用过协作会话 chat-1；URL 带来的作用域会话号只作兜底。 */
  const openScoped = async (): Promise<void> => {
    localStorage.setItem('lcoder.studio.session.REQ-01', 'chat-1')
    await renderApp(makeBridge(), 'scope-url')
  }

  it('协作会话有暂存时打开即显示修改后、高亮改动区域，对比图标可点', async () => {
    sessionGate = { stagedIn: ['chat-1'], missing: [], denied: [] }
    await openScoped()

    // 暂存落在协作会话名下：prototype/* 先问它，作用域会话看不到暂存也不该被用来请求。
    expect(prototypeSessions('getStaged')[0]).toBe('chat-1')
    expect(prototypeSessions('listSnapshots')[0]).toBe('chat-1')
    expect(loadCalls.at(-1)).toMatchObject({ html: VISUAL.html, beforeHtml: COMMITTED })
    expect(highlightCalls.at(-1)).toEqual([...VISUAL.changedDomPaths])
    expect(element('studio-staged-bar')?.getAttribute('data-staged')).toBe('true')
    expect(element('studio-view-after')?.getAttribute('aria-pressed')).toBe('true')
    const compare = element('studio-quick-compare') as HTMLButtonElement
    expect(compare.disabled).toBe(false)
    expect(compare.getAttribute('data-active')).toBe('false')

    // 落盘与快照恢复同样走协作会话，不回到作用域会话。
    await click('studio-commit-staged')
    expect(lastPrototypeInput('commitStaged')?.sessionId).toBe('chat-1')
    await click('studio-snapshots-trigger')
    await click('studio-snapshot-restore')
    expect(lastPrototypeInput('restoreSnapshot')?.sessionId).toBe('chat-1')
  })

  it('协作会话报没有工作区时回退作用域会话重试一次并拿到暂存', async () => {
    sessionGate = { stagedIn: ['scope-url'], missing: ['chat-1'], denied: [] }
    await openScoped()

    expect(prototypeSessions('getStaged').slice(0, 2)).toEqual(['chat-1', 'scope-url'])
    expect(element('studio-notice')).toBeNull()
    expect(loadCalls.at(-1)).toMatchObject({ html: VISUAL.html, beforeHtml: COMMITTED })
    expect(highlightCalls.at(-1)).toEqual([...VISUAL.changedDomPaths])
    expect((element('studio-quick-compare') as HTMLButtonElement).disabled).toBe(false)

    // 回退后的会话号同样用于写操作：放弃不该再撞上没有工作区。
    await click('studio-discard-staged')
    expect(lastPrototypeInput('discardStaged')?.sessionId).toBe('scope-url')
    expect(loadCalls.at(-1)).toMatchObject({ html: COMMITTED })
  })

  it('对比图标在协作会话的暂存版与原版间瞬切', async () => {
    sessionGate = { stagedIn: ['chat-1'], missing: [], denied: [] }
    await openScoped()

    await click('studio-quick-compare')
    expect(loadCalls.at(-1)).toMatchObject({ html: COMMITTED, beforeHtml: COMMITTED })
    expect(element('studio-quick-compare')?.getAttribute('data-active')).toBe('true')
    expect(element('studio-view-before')?.getAttribute('aria-pressed')).toBe('true')

    await click('studio-quick-compare')
    expect(loadCalls.at(-1)).toMatchObject({ html: VISUAL.html, beforeHtml: COMMITTED })
    expect(element('studio-quick-compare')?.getAttribute('data-active')).toBe('false')
    expect(element('studio-view-after')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('两个会话都报没有工作区时不再重试，直接报错', async () => {
    sessionGate = { stagedIn: [], missing: ['chat-1', 'scope-url'], denied: [] }
    await openScoped()

    // 每类候选只问一次：没有第三个会话号可以再试。
    expect(prototypeSessions('getStaged')).toEqual(['chat-1', 'scope-url'])
    expect(element('studio-notice')?.textContent).toContain('会话不存在或没有工作区')
    expect((element('studio-quick-compare') as HTMLButtonElement).disabled).toBe(true)
  })

  it('其它失败不换会话重试，直接把错误交给界面', async () => {
    sessionGate = { stagedIn: ['chat-1'], missing: [], denied: ['chat-1'] }
    await openScoped()

    expect(prototypeSessions('getStaged')).toEqual(['chat-1'])
    expect(element('studio-notice')?.textContent).toContain('参数不合法')
  })
})

describe('协作对话会话隔离', () => {
  it('发送后立即回显用户回合；聊天会话号独立于 URL 的作用域会话号', async () => {
    localStorage.setItem('lcoder.m2.project', JSON.stringify({ workspaceId: 'ws-1', scopeSessionId: 'scope-stored' }))
    const bridge = makeBridge()
    await renderApp(bridge, 'scope-url')

    // 作用域会话号只服务 prototype/*：URL 显式值优先于本机项目档。
    const staged = calls.find(call => call.namespace === 'prototype' && call.method === 'getStaged')
    expect(isRecord(staged?.args.input) && staged?.args.input.sessionId).toBe('scope-url')

    act(() => {
      for (const listener of [...selectionListeners]) {
        listener({ domPath: 'body > div.mini:nth-child(1)', html: '<div />', css: 'color: #333', label: '本月已提交报销总额' })
      }
    })
    const note = element('studio-anchor-note') as HTMLInputElement
    await act(async () => {
      // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(note, '改成主色按钮')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('studio-send-instruction')

    const created = calls.find(call => call.namespace === 'session' && call.method === 'create')
    expect(created).toBeDefined()
    expect(isRecord(created?.args.request) && created?.args.request.agentPreset).toBe('maniu-prototype')
    expect(localStorage.getItem('lcoder.studio.session.REQ-01')).toBe('chat-1')

    const promptCall = calls.find(call => call.namespace === 'session' && call.method === 'prompt')
    const request = isRecord(promptCall?.args.request) ? promptCall?.args.request : undefined
    expect(request?.sessionId).toBe('chat-1')
    expect(request?.sessionId).not.toBe('scope-url')
    const content = Array.isArray(request?.content) ? request.content : []
    const text = isRecord(content[0]) && typeof content[0].text === 'string' ? content[0].text : ''
    expect(text).toContain('用户对该元素的修改指令：改成主色按钮')
    expect(text).toContain('#1 本月已提交报销总额：改成主色按钮')

    // 对话流立刻回显本轮锚点与要求，并进入运行进度。
    const turn = element('studio-user-turn')
    expect(turn).not.toBeNull()
    expect(turn?.textContent).toContain('本月已提交报销总额')
    expect(turn?.textContent).toContain('改成主色按钮')
    expect(element('studio-turn-running')?.textContent).toContain('正在根据你的意见调整原型')
  })
})

/** 带跟随流的宿主替身：开流顺序进 order，帧与事件交给测试触发。 */
function makeStreamBridge(order?: string[]): StudioBridge {
  return {
    ...makeBridge(),
    openStream: vi.fn(async () => {
      order?.push('openStream')
      return 'stream-1'
    }),
    cancelStream: vi.fn(async () => {}),
    onStreamFrame: (listener) => {
      frameListeners.push(listener)
      return () => {
        const index = frameListeners.indexOf(listener)
        if (index >= 0) frameListeners.splice(index, 1)
      }
    },
    onEvent: (listener) => {
      eventListeners.push(listener)
      return () => {
        const index = eventListeners.indexOf(listener)
        if (index >= 0) eventListeners.splice(index, 1)
      }
    },
  }
}

/** 把一条跟随流帧送给当前挂载的订阅者。 */
function emitFrame(value: unknown, streamId = 'stream-1'): void {
  act(() => {
    for (const listener of [...frameListeners]) listener(streamId, { kind: 'item', value })
  })
}

/** 把一条宿主事件送给当前挂载的订阅者。 */
function emitEvent(name: string, ...args: readonly unknown[]): void {
  act(() => {
    for (const listener of [...eventListeners]) listener({ name, args })
  })
}

describe('发送时序', () => {
  it('先建会话、再打开跟随流、回显本轮，最后才发消息', async () => {
    const order: string[] = []
    const bridge = makeStreamBridge(order)
    const call = async (namespace: string, method: string, args: object) => {
      if (namespace === 'session') order.push(`${namespace}/${method}`)
      return fakeCall(namespace, method, args)
    }
    await render(<PrototypeStudioApp requirementId="REQ-01" t={t} bridge={bridge} call={call} />)

    const input = element('studio-instruction-input') as HTMLInputElement
    await act(async () => {
      // oxlint-disable-next-line typescript/unbound-method -- 原生 value setter 要用 call 绑定到该输入框。
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '把主按钮改成主色')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('studio-send-instruction')

    // 会话与跟随流都先于 prompt 就绪，宿主那次 running=true 才不会被漏掉。
    expect(order).toEqual(['session/create', 'openStream', 'session/prompt'])
    expect(element('studio-turn-running')).not.toBeNull()
  })
})

describe('全屏浮窗拖拽', () => {
  const pointer = (node: HTMLElement | null, type: string, screenX: number, screenY: number): void => {
    act(() => {
      node?.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, screenX, screenY }))
    })
  }

  it('按住顶栏拖动按指针位移更新浮窗坐标，样式不加 app-region', async () => {
    const bridge = makeStreamBridge()
    await renderApp(bridge)
    await click('studio-mode-toggle')
    const head = element('studio-head')
    expect(head).not.toBeNull()

    pointer(head, 'pointerdown', 900, 60)
    // 自动贴位时先向宿主核对一次真实矩形；核对完成后才开始按位移写入坐标。
    await flush()
    pointer(head, 'pointermove', 700, 160)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    // 默认贴右上：x = 1024 - 380 - 24，y = 24；位移 (-200, +100) 直接加到起点上。
    expect(boundsCalls.at(-1)).toMatchObject({
      x: 1024 - 380 - 24 - 200,
      y: 24 + 100,
      width: 380,
      height: 520,
      collapsed: false,
    })
    pointer(head, 'pointerup', 700, 160)

    // 浮窗拖拽只用指针事件：样式里不能出现 app-region 或背景滤镜（拖拽区红线）。
    const css = readFileSync(resolve(process.cwd(), 'packages/lcoder/client/src/prototype-studio/studio.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
    expect(css).not.toContain('-webkit-app-region')
    expect(css).not.toContain('backdrop-filter')
  })

  it('折叠胶囊也能拖；拖过的松手不再当作展开点击', async () => {
    const bridge = makeStreamBridge()
    await renderApp(bridge)
    await click('studio-mode-toggle')
    await click('studio-floating-collapse')
    expect(element('studio-body')?.hidden).toBe(true)

    const capsule = element('studio-floating-collapse')
    pointer(capsule, 'pointerdown', 800, 40)
    await flush()
    pointer(capsule, 'pointermove', 760, 140)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    expect(boundsCalls.at(-1)).toMatchObject({ width: 260, height: 48, collapsed: true })
    expect(boundsCalls.at(-1)?.y).toBe(24 + 100)
    pointer(capsule, 'pointerup', 760, 140)

    // 拖拽尾巴上那一次 click 不该展开面板。
    await act(async () => { capsule?.click() })
    await flush()
    expect(element('studio-body')?.hidden).toBe(true)
  })
})

describe('协作流实时进度', () => {
  const turn = (): StudioTurnEcho => ({ instruction: '把主按钮改成主色', anchors: [], sentAt: Date.now() })

  it('运行期展示工具步骤与人话正文，回合结束帧一到就退出等待', async () => {
    const onStageComplete = vi.fn()
    const bridge = makeStreamBridge()
    await render(
      <CoDesignThread t={t} bridge={bridge} sessionId="chat-1" streamId="stream-1" turn={turn()} onStageComplete={onStageComplete} />,
    )
    expect(element('studio-turn-running')).not.toBeNull()

    // 本回合的 turn/start 先到，后面的 turn/end 才能算到这一轮头上。
    emitFrame({ type: 'event', event: { type: 'turn/start', seq: 1, time: 1, data: {} } })
    emitFrame({
      type: 'event',
      event: {
        type: 'tool/call', seq: 2, time: 1,
        data: { name: 'prototype_stage', arguments: '{"requirement":"REQ-01"}' },
      },
    })
    await flush()
    expect(element('studio-turn-activity')?.textContent).toContain('prototype_stage')
    expect(element('studio-turn-activity')?.textContent).toContain('REQ-01')

    emitFrame({
      type: 'assistant-stream',
      frame: {
        type: 'chunk', attemptId: 'a1', revision: 2, index: 0,
        chunk: { type: 'text-delta', text: '已把主按钮改成主色 ```html<div class="x"></div>``` 其余保持不动' },
      },
    })
    await flush()
    const live = element('studio-turn-live-text')
    expect(live?.textContent).toContain('已把主按钮改成主色')
    expect(live?.textContent).not.toContain('class="x"')

    emitFrame({ type: 'event', event: { type: 'turn/end', seq: 3, time: 2, data: { reason: { kind: 'completed' } } } })
    await flush()
    expect(onStageComplete).toHaveBeenCalledTimes(1)
    expect(element('studio-turn-running')).toBeNull()
    expect(element('studio-turn-done')).not.toBeNull()
    // 助手回复默认可见：耗时只作角标，不再靠折叠按钮才能看到正文。
    expect(element('studio-turn-brief')?.textContent).toContain('已把主按钮改成主色')
    expect(element('studio-turn-done')?.querySelector('button')).toBeNull()
  })

  it('多轮回合累积成历史列表，每轮都有用户气泡、助手回复与耗时角标', async () => {
    const bridge = makeStreamBridge()
    const first: StudioTurnEcho = { instruction: '把主按钮改成主色', anchors: [], sentAt: Date.now() }
    await render(
      <CoDesignThread t={t} bridge={bridge} sessionId="chat-1" streamId="stream-1" turn={first} onStageComplete={vi.fn()} />,
    )
    emitFrame({ type: 'event', event: { type: 'turn/start', seq: 1, time: 1, data: {} } })
    emitFrame({
      type: 'assistant-stream',
      frame: {
        type: 'chunk', attemptId: 'a1', revision: 1, index: 0,
        chunk: { type: 'text-delta', text: '已经把主按钮改成主色' },
      },
    })
    emitFrame({ type: 'event', event: { type: 'turn/end', seq: 2, time: 2, data: { reason: { kind: 'completed' } } } })
    await flush()
    expect(elements('studio-round')).toHaveLength(1)

    const second: StudioTurnEcho = {
      instruction: '把卡片间距调大', anchors: [], sentAt: Math.max(Date.now(), first.sentAt + 1),
    }
    await act(async () => {
      root.render(
        <CoDesignThread t={t} bridge={bridge} sessionId="chat-1" streamId="stream-1" turn={second} onStageComplete={vi.fn()} />,
      )
    })
    await flush()
    emitFrame({ type: 'event', event: { type: 'turn/start', seq: 3, time: 3, data: {} } })
    emitFrame({
      type: 'assistant-stream',
      frame: {
        type: 'chunk', attemptId: 'a2', revision: 1, index: 0,
        chunk: { type: 'text-delta', text: '卡片间距已调大' },
      },
    })
    emitFrame({ type: 'event', event: { type: 'turn/end', seq: 4, time: 4, data: { reason: { kind: 'completed' } } } })
    await flush()

    expect(elements('studio-round')).toHaveLength(2)
    expect(elements('studio-user-turn')).toHaveLength(2)
    const replies = elements('studio-turn-brief').map(node => node.textContent).join(' | ')
    expect(replies).toContain('已经把主按钮改成主色')
    expect(replies).toContain('卡片间距已调大')
  })

  it('宿主运行态由 true 变 false 也立刻结束等待', async () => {
    const onStageComplete = vi.fn()
    const bridge = makeStreamBridge()
    await render(
      <CoDesignThread t={t} bridge={bridge} sessionId="chat-1" streamId="stream-1" turn={turn()} onStageComplete={onStageComplete} />,
    )
    emitEvent('api-session/status', 'chat-1', true)
    await flush()
    emitEvent('api-session/status', 'chat-1', false)
    await flush()
    expect(onStageComplete).toHaveBeenCalledTimes(1)
    expect(element('studio-turn-running')).toBeNull()
  })

  it('等待期每两秒探测一次，暂存更新后退出等待', async () => {
    vi.useFakeTimers()
    try {
      const onStageComplete = vi.fn()
      const onProbeComplete = vi.fn(async () => true)
      const bridge = makeStreamBridge()
      await act(async () => {
        root.render(
          <CoDesignThread
            t={t}
            bridge={bridge}
            sessionId="chat-1"
            streamId="stream-1"
            turn={turn()}
            onStageComplete={onStageComplete}
            onProbeComplete={onProbeComplete}
          />,
        )
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(TURN_PROBE_INTERVAL_MS) })
      expect(onProbeComplete).toHaveBeenCalledTimes(1)
      expect(onStageComplete).toHaveBeenCalledTimes(1)
      expect(element('studio-turn-running')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('工作台停靠胶囊', () => {
  it('显示需求编号，恢复与关闭各自回主进程', async () => {
    const onRestore = vi.fn()
    const onClose = vi.fn()
    await render(<StudioDock t={t} requirementId="REQ-01" onRestore={onRestore} onClose={onClose} />)
    expect(element('studio-minimized-dock')?.textContent).toContain('REQ-01')
    expect(element('studio-dock-restore')?.textContent).toContain('恢复窗口')
    await click('studio-dock-restore')
    expect(onRestore).toHaveBeenCalledTimes(1)
    await click('studio-dock-close')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
