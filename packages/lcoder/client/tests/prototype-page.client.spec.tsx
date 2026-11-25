// @vitest-environment jsdom
/**
 * T-323：左侧「原型」菜单、项目级活原型页（预览 / 四个操作区 / 暂存提示 / 历史快照），
 * 以及需求详情快捷入口带 REQ-xx 打开工作室。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/app.tsx'
import { PrototypePage, type PrototypePageProps } from '../src/pages/prototype-page.tsx'
import { PrototypePanel, type PrototypePanelProps } from '../src/pages/prototype-panel.tsx'
import type { UnaryCall } from '../src/prototype/remote.ts'
import { withOfflineInteractiveCsp } from '../src/prototype/sandbox-html.ts'
import type { RequirementDocRow } from '../src/spec/rows.ts'
import { translate, type Translate } from '../src/locale.ts'

const HTML = '<!doctype html><html><head><title>项目原型</title></head><body><nav>导航</nav><h1>项目原型</h1><section><ul><li>内容</li></ul></section><footer>页脚</footer></body></html>'
const STAGED_HTML = HTML.replace('页脚', '暂存页脚')
const SNAPSHOT_HTML = HTML.replace('页脚', '历史页脚')

const zh: Translate = (key, params) => translate('zh', key, params)

const STAGED = {
  requirementId: '__project__',
  html: STAGED_HTML,
  changeKind: 'visual' as const,
  summary: ['页脚换个颜色', '补一条列表项'],
  changedDomPaths: ['body:nth-child(2) > footer:nth-child(4)'],
  createdAt: '2026-11-23T00:00:00.000Z',
}

const SNAPSHOT = { snapshotId: '1769000000000-0', createdAt: '2026-11-23T00:00:00.000Z', bytes: 128 }

const ROW: RequirementDocRow = {
  id: 'REQ-01',
  title: '登录改造',
  text: '# 登录改造\n\n邮箱登录与验证码入口。',
  state: 'draft',
  options: [],
  versions: [],
  reviews: [],
}

interface ViewState {
  readonly staged: typeof STAGED | null
  readonly committedHtml: string | null
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  // HeroUI Modal 的 react-aria 依赖在 jsdom 里调用 CSS.escape，需补最小实现。
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { escape: (value: string) => value.replace(/[^\w-]/g, '\\$&') } })
  if (typeof globalThis.ResizeObserver === 'undefined') {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    })
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  Reflect.deleteProperty(window, 'lcoder')
  localStorage.clear()
})

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}

async function pressElement(node: Element | null): Promise<void> {
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await flush()
}

/** 只回答原型页需要的 Remote；支持按快照编号回传历史 HTML。 */
function pageCall(view: ViewState, snapshots: readonly typeof SNAPSHOT[] = [SNAPSHOT]) {
  return vi.fn(async (namespace: string, method: string, args: Record<string, unknown>) => {
    if (namespace === 'prototype' && method === 'getStaged') {
      return { ok: true as const, value: { staged: view.staged, committedHtml: view.committedHtml } }
    }
    if (namespace === 'prototype' && method === 'listSnapshots') {
      return { ok: true as const, value: { snapshots } }
    }
    if (namespace === 'prototype' && method === 'getSnapshot') {
      const input = args.input as { readonly snapshotId?: string } | undefined
      return { ok: true as const, value: { html: `${SNAPSHOT_HTML}<!--${input?.snapshotId ?? ''}-->` } }
    }
    if (namespace === 'prototype' && method === 'commitStaged') {
      return { ok: true as const, value: { committedAt: '2026-11-24T00:00:00.000Z', requirementSync: 'none' } }
    }
    if (namespace === 'prototype' && method === 'discardStaged') {
      return { ok: true as const, value: { ok: true } }
    }
    if (namespace === 'prototype' && method === 'restoreSnapshot') {
      return { ok: true as const, value: { restoredAt: '2026-11-24T00:00:00.000Z', html: SNAPSHOT_HTML } }
    }
    return { ok: true as const, value: {} }
  })
}

function pageProps(call: UnaryCall, overrides: Partial<PrototypePageProps> = {}): PrototypePageProps {
  return {
    t: zh,
    scopeSessionId: 'session-1',
    requirementIds: ['REQ-02', 'REQ-01'],
    onOpenRequirements: vi.fn(),
    call,
    ...overrides,
  }
}

/** 主窗 preload 替身：只装原型页用到的两个打开入口。 */
function installWindowApi(): {
  readonly studio: ReturnType<typeof vi.fn>
  readonly preview: ReturnType<typeof vi.fn>
} {
  const studio = vi.fn(async (_request: unknown): Promise<void> => {})
  const preview = vi.fn(async (_html: string): Promise<void> => {})
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: { openPrototypeStudio: studio, openPrototypePreview: preview },
  })
  return { studio, preview }
}

/** 工作台 App 需要的窄宿主面；原型页之外的方法一律返回空回执。 */
function installMinimalWindowApi(): void {
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: {
      call: vi.fn(async (namespace: string, method: string) => {
        if (namespace === 'lcoderCloud' && method === 'state') {
          return {
            ok: true,
            value: { ok: true, value: { signedIn: true, needsLogin: false, user: null, quota: null, estimate: null, lastError: null } },
          }
        }
        if (namespace === 'session' && method === 'list') return { ok: true, value: { items: [] } }
        return { ok: true, value: {} }
      }),
      hostState: () => () => {},
      hostStateNow: async () => ({ kind: 'ready', url: 'http://127.0.0.1:1' }),
      openStream: async () => 'stream-1',
      cancelStream: async () => {},
      onStreamFrame: () => () => {},
      onEvent: () => () => {},
      onWaterfall: () => () => {},
      onWaterfallCancel: () => () => {},
      eventResult: async () => {},
      window: async () => {},
      onCloseRequest: () => () => {},
      confirmClose: async () => {},
      windowState: () => () => {},
      windowStateNow: async () => ({ maximized: false, fullscreen: false }),
      appInfo: async () => ({ version: '0.0.0' }),
      update: async () => ({ kind: 'unavailable', version: '0.0.0', reason: 'no-feed' }),
      setLocale: async () => {},
      readPreferences: async () => ({ skin: 'dark', font: 'system', locale: 'zh', lastPickedDirectory: null }),
      writePreferences: async () => ({ skin: 'dark', font: 'system', locale: 'zh', lastPickedDirectory: null }),
      pickDirectory: async () => null,
    },
  })
}

describe('左侧「原型」菜单', () => {
  it('位于需求之后、任务之前，点击后打开项目原型页', async () => {
    installMinimalWindowApi()
    await act(async () => { root.render(<App />) })
    await flush()

    const navIds = [...container.querySelectorAll('[data-testid^="nav-"]')]
      .map(node => node.getAttribute('data-testid'))
    const requirementsIndex = navIds.indexOf('nav-requirements')
    const prototypeIndex = navIds.indexOf('nav-prototype')
    const tasksIndex = navIds.indexOf('nav-tasks')

    expect(requirementsIndex).toBeGreaterThanOrEqual(0)
    expect(prototypeIndex).toBe(requirementsIndex + 1)
    expect(tasksIndex).toBe(prototypeIndex + 1)

    await pressElement(container.querySelector('[data-testid="nav-prototype"]'))
    expect(container.querySelector('[data-testid="page-prototype"]')).not.toBeNull()
  })

  it('素材库菜单显示新名称', async () => {
    installMinimalWindowApi()
    await act(async () => { root.render(<App />) })
    await flush()

    expect(container.querySelector('[data-testid="nav-prototype-library"]')?.textContent).toBe('素材库')
  })
})

describe('PrototypePage', () => {
  it('展示左窄版本列表与右宽实时画布，清理多余顶栏按钮与机理文案', async () => {
    const api = installWindowApi()
    const call = pageCall({ staged: null, committedHtml: HTML }, [])
    await act(async () => { root.render(<PrototypePage {...pageProps(call)} />) })
    await flush()

    expect(call).toHaveBeenCalledWith('prototype', 'getStaged', { input: { sessionId: 'session-1' } })
    expect(container.querySelector('[data-testid="prototype-page-refresh"]')).toBeNull()
    expect(container.querySelector('[data-testid="prototype-page-open-window"]')).toBeNull()
    expect(container.querySelector('[data-testid="prototype-page-snapshots-toggle"]')).toBeNull()
    expect(container.querySelector('[data-testid="prototype-page-studio-context"]')).toBeNull()
    expect(container.querySelector('[data-testid="prototype-page-preview-note"]')).toBeNull()

    expect(container.querySelector('[data-testid="prototype-version-list"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="prototype-version-committed"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="prototype-version-history-empty"]')?.textContent).toContain('确认修改后会自动保留上一版')

    const frame = container.querySelector('iframe[data-testid="prototype-page-iframe"]')
    expect(frame).not.toBeNull()
    const sandboxAttr = frame?.getAttribute('sandbox') ?? ''
    expect(sandboxAttr).toBe('allow-scripts allow-forms')
    expect(sandboxAttr).not.toContain('allow-same-origin')
    const srcdoc = frame?.getAttribute('srcdoc') ?? ''
    expect(srcdoc).toContain('http-equiv="Content-Security-Policy"')
    expect(srcdoc).toContain("default-src 'none'")
    expect(srcdoc).toContain("connect-src 'none'")
    expect(srcdoc).toBe(withOfflineInteractiveCsp(HTML))
    expect(container.querySelector('[data-testid="prototype-canvas-title"]')?.textContent).toBe('当前正式版')

    await pressElement(container.querySelector('[data-testid="prototype-action-edit"]'))
    expect(api.studio).toHaveBeenCalledWith({
      requirementId: 'REQ-02',
      sessionId: 'session-1',
      html: HTML,
      beforeHtml: HTML,
      mode: 'split',
    })
  })

  it('有待确认修改时置顶并默认选中，点当前正式版可原地秒切对比，支持确认采用与放弃修改', async () => {
    const api = installWindowApi()
    const call = pageCall({ staged: STAGED, committedHtml: HTML })
    await act(async () => { root.render(<PrototypePage {...pageProps(call, { initialRequirementId: 'REQ-01' })} />) })
    await flush()

    const stagedBtn = container.querySelector('[data-testid="prototype-version-staged"]')
    expect(stagedBtn?.getAttribute('aria-current')).toBe('true')
    expect(container.querySelector('iframe[data-testid="prototype-page-iframe"]')?.getAttribute('srcdoc')).toBe(
      withOfflineInteractiveCsp(STAGED_HTML),
    )
    expect(container.querySelector('[data-testid="prototype-action-continue"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="prototype-action-commit"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="prototype-action-discard"]')).not.toBeNull()

    // 点击「当前正式版」，右侧大画布原地切换为正式版 HTML；有待确认修改时收口编辑入口并提示前往处理。
    await pressElement(container.querySelector('[data-testid="prototype-version-committed"]'))
    expect(container.querySelector('iframe[data-testid="prototype-page-iframe"]')?.getAttribute('srcdoc')).toBe(
      withOfflineInteractiveCsp(HTML),
    )
    expect(container.querySelector('[data-testid="prototype-action-edit"]')).toBeNull()
    expect(container.querySelector('[data-testid="prototype-pending-hint"]')?.textContent).toBe('有待确认修改尚未处理')
    expect(container.querySelector('[data-testid="prototype-action-go-pending"]')).not.toBeNull()

    // 有待确认修改时切到历史版本，同样隐藏「恢复此版」并提示前往处理。
    await pressElement(container.querySelector('[data-testid="prototype-version-snapshot"]'))
    expect(container.querySelector('[data-testid="prototype-action-restore"]')).toBeNull()
    expect(container.querySelector('[data-testid="prototype-action-go-pending"]')).not.toBeNull()

    // 点「前往处理」直接切回「待确认修改」，再点「继续修改」打开协作窗。
    await pressElement(container.querySelector('[data-testid="prototype-action-go-pending"]'))
    expect(container.querySelector('[data-testid="prototype-version-staged"]')?.getAttribute('aria-current')).toBe('true')
    await pressElement(container.querySelector('[data-testid="prototype-action-continue"]'))
    expect(api.studio).toHaveBeenCalledWith(expect.objectContaining({
      requirementId: 'REQ-01',
      html: STAGED_HTML,
      beforeHtml: HTML,
    }))

    // 点「确认采用」调用 commitStaged。
    await pressElement(container.querySelector('[data-testid="prototype-action-commit"]'))
    expect(call).toHaveBeenCalledWith('prototype', 'commitStaged', { input: { sessionId: 'session-1' } })

    // 重新渲染有暂存，点「放弃修改」调用 discardStaged。
    await act(async () => { root.render(<PrototypePage {...pageProps(call)} />) })
    await flush()
    await pressElement(container.querySelector('[data-testid="prototype-version-staged"]'))
    await pressElement(container.querySelector('[data-testid="prototype-action-discard"]'))
    expect(call).toHaveBeenCalledWith('prototype', 'discardStaged', { input: { sessionId: 'session-1' } })
  })

  it('点击历史版本只读预览（不显示字节数），点恢复此版恢复并切回当前正式版', async () => {
    const call = pageCall({ staged: null, committedHtml: HTML })
    await act(async () => { root.render(<PrototypePage {...pageProps(call)} />) })
    await flush()

    const snapshotItem = container.querySelector('[data-testid="prototype-version-snapshot"]')
    expect(snapshotItem).not.toBeNull()
    expect(snapshotItem?.textContent).not.toContain('字节')

    await pressElement(snapshotItem)
    expect(call).toHaveBeenCalledWith('prototype', 'getSnapshot', {
      input: { sessionId: 'session-1', snapshotId: SNAPSHOT.snapshotId },
    })
    expect(container.querySelector('iframe[data-testid="prototype-page-iframe"]')?.getAttribute('srcdoc')).toContain('历史页脚')

    await pressElement(container.querySelector('[data-testid="prototype-action-restore"]'))
    expect(call).toHaveBeenCalledWith('prototype', 'restoreSnapshot', {
      input: { sessionId: 'session-1', snapshotId: SNAPSHOT.snapshotId },
    })
    expect(container.querySelector('[data-testid="prototype-page-notice"]')?.textContent).toContain('已恢复')
    expect(container.querySelector('[data-testid="prototype-version-committed"]')?.getAttribute('aria-current')).toBe('true')
  })

  it('没有原型时隐藏左侧列表与顶栏按钮，仅展示居中空态与需求页入口', async () => {
    const onOpenRequirements = vi.fn()
    const call = pageCall({ staged: null, committedHtml: null }, [])
    await act(async () => { root.render(<PrototypePage {...pageProps(call, { onOpenRequirements })} />) })
    await flush()

    expect(container.querySelector('[data-testid="prototype-version-list"]')).toBeNull()
    expect(container.querySelector('[data-testid="prototype-page-empty"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="prototype-page-iframe"]')).toBeNull()
    await pressElement(container.querySelector('[data-testid="prototype-page-empty-action"]'))
    expect(onOpenRequirements).toHaveBeenCalledTimes(1)
  })

  it('withOfflineInteractiveCsp 在 <head> 注入离线 CSP，无 <head> 时兜底包裹', () => {
    const withHead = withOfflineInteractiveCsp('<!doctype html><html><head><title>x</title></head><body>ok</body></html>')
    expect(withHead).toMatch(
      /<head><meta http-equiv="Content-Security-Policy" content="[^"]*default-src 'none'[^"]*"><title>x<\/title><\/head>/,
    )

    const withoutHead = withOfflineInteractiveCsp('<div>fragment</div>')
    expect(withoutHead).toMatch(
      /^<head><meta http-equiv="Content-Security-Policy" content="[^"]*connect-src 'none'[^"]*"><\/head><div>fragment<\/div>$/,
    )
  })
})

describe('需求详情的原型快捷入口', () => {
  function panelCall() {
    return vi.fn(async (namespace: string, method: string, _args: object) => {
      if (namespace === 'workspaceFiles' && method === 'read') return { ok: true as const, value: { text: HTML } }
      if (namespace === 'prototype' && method === 'getStaged') {
        return { ok: true as const, value: { staged: null, committedHtml: HTML } }
      }
      return { ok: true as const, value: { ok: true } }
    })
  }

  it('预览同一份项目活原型，并带 REQ-xx 打开工作室', async () => {
    const api = installWindowApi()
    const call = panelCall()
    const onOpenProjectPrototype = vi.fn()
    const props: PrototypePanelProps = {
      row: ROW,
      scopeSessionId: 'session-scope',
      running: false,
      onGenerate: vi.fn(async () => ({ ok: true, message: 'ok' })),
      onReload: vi.fn(),
      onOpenProjectPrototype,
      call,
    }
    await act(async () => { root.render(<PrototypePanel {...props} />) })
    await flush()

    expect(container.querySelector('iframe[data-testid="prototype-iframe"]')?.getAttribute('srcdoc')).toBe(HTML)

    await pressElement(container.querySelector('[data-testid="prototype-open-studio"]'))
    expect(api.studio).toHaveBeenCalledWith(expect.objectContaining({ requirementId: 'REQ-01', html: HTML }))

    await pressElement(container.querySelector('[data-testid="prototype-open-project"]'))
    expect(onOpenProjectPrototype).toHaveBeenCalledTimes(1)
  })
})

describe('原型页重新生成与增量补充', () => {
  const REQUIREMENTS: readonly RequirementDocRow[] = [
    { ...ROW, id: 'REQ-01', title: '登录改造', text: '# 登录改造\n\n支持邮箱登录。', state: 'confirmed' },
    { ...ROW, id: 'REQ-02', title: '报销审批', text: '# 报销审批\n\n支持差旅报销提交与审批。', state: 'draft' },
    { ...ROW, id: 'REQ-03', title: '已作废模块', text: '# 作废\n\n不再使用。', state: 'closed' },
  ]

  it('全部有效需求重生成：排除 closed，支持切换是否包含草稿需求', async () => {
    const call = pageCall({ staged: null, committedHtml: HTML })
    const onOpenSession = vi.fn()
    const onStartSession = vi.fn(async () => ({ ok: true, message: 'started', sessionId: 'gen-1' }))
    await act(async () => {
      root.render(
        <PrototypePage
          {...pageProps(call, {
            requirements: REQUIREMENTS,
            onStartSession,
            onOpenSession,
          })}
        />,
      )
    })
    await flush()

    await pressElement(container.querySelector('[data-testid="prototype-action-regenerate"]'))
    expect(document.body.querySelector('[data-testid="prototype-regen-modal"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="prototype-regen-matched"]')?.textContent).toContain('REQ-01, REQ-02')
    expect(document.body.querySelector('[data-testid="prototype-regen-matched"]')?.textContent).not.toContain('REQ-03')

    const includeDraft = document.body.querySelector('[data-testid="prototype-regen-include-draft"]') as HTMLInputElement
    expect(includeDraft.checked).toBe(true)
    await act(async () => {
      includeDraft.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await flush()
    expect(document.body.querySelector('[data-testid="prototype-regen-matched"]')?.textContent).toContain('REQ-01')
    expect(document.body.querySelector('[data-testid="prototype-regen-matched"]')?.textContent).not.toContain('REQ-02')

    const libSelect = document.body.querySelector('[data-testid="prototype-regen-library-select"]') as HTMLSelectElement
    await act(async () => {
      libSelect.value = 'enterprise-admin'
      libSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await flush()

    await pressElement(document.body.querySelector('[data-testid="prototype-regen-submit"]'))
    // 第一步只是确认框：真正发起前 onStartSession 一次都不能调。
    expect(onStartSession).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-testid="prototype-regen-confirm-text"]')?.textContent)
      .toContain('当前正式版不会丢失')

    await pressElement(document.body.querySelector('[data-testid="prototype-regen-confirm"]'))
    expect(onStartSession).toHaveBeenCalledTimes(1)
    const [prompt, preset] = onStartSession.mock.calls[0] ?? []
    expect(preset).toBe('maniu-prototype')
    expect(prompt).toContain('REQ-01')
    expect(prompt).not.toContain('REQ-02')
    expect(prompt).not.toContain('REQ-03')
    expect(prompt).toContain('企业级中后台')
    expect(prompt).toContain('prototype_stage')

    // 发起后悬浮任务卡挂到 body，切页也不会被页面宿主隐藏。
    const card = document.body.querySelector('[data-testid="operation-cards"]')
    expect(card).not.toBeNull()
    expect(card?.querySelector('h3')?.textContent).toBe('重新生成原型')
    const progress = card?.querySelector('[data-testid="op-step-progress"]')?.textContent ?? ''
    expect(progress).toContain('第 2 步 / 共 3 步')
    expect(progress).toContain('AI 编写原型')
    expect(card?.querySelector('[data-testid="op-progress-bar"]')?.getAttribute('aria-valuemax')).toBe('3')
    await pressElement(card?.querySelector('[data-testid="op-view-session"]') ?? null)
    expect(onOpenSession).toHaveBeenCalledWith('gen-1')
  })

  it('增量补充指定需求：把当前正式版 HTML 与目标需求正文一起发给后台，并在结束后自动切到待确认修改', async () => {
    const view: { staged: typeof STAGED | null; committedHtml: string | null } = { staged: null, committedHtml: HTML }
    const call = pageCall(view)
    const onStartSession = vi.fn(async () => ({ ok: true, message: 'started', sessionId: 'gen-2' }))
    const onOpenSession = vi.fn()
    const baseProps = pageProps(call, {
      requirements: REQUIREMENTS,
      sessions: [],
      onStartSession,
      onOpenSession,
    })
    await act(async () => { root.render(<PrototypePage {...baseProps} />) })
    await flush()

    await pressElement(container.querySelector('[data-testid="prototype-action-regenerate"]'))
    await pressElement(document.body.querySelector('[data-testid="prototype-regen-mode-incremental"]'))

    const select = document.body.querySelector('[data-testid="prototype-regen-target-select"]') as HTMLSelectElement
    await act(async () => {
      select.value = 'REQ-02'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await flush()

    await pressElement(document.body.querySelector('[data-testid="prototype-regen-submit"]'))
    await pressElement(document.body.querySelector('[data-testid="prototype-regen-confirm"]'))
    expect(onStartSession).toHaveBeenCalledTimes(1)
    const [prompt] = onStartSession.mock.calls[0] ?? []
    expect(prompt).toContain('增量补充')
    expect(prompt).toContain('REQ-02')
    expect(prompt).toContain('支持差旅报销提交与审批')
    expect(prompt).toContain(HTML)

    await act(async () => {
      root.render(
        <PrototypePage
          {...baseProps}
          sessions={[{
            sessionId: 'gen-2',
            title: '原型生成',
            running: true,
            updatedAt: '2026-11-24T00:00:00.000Z',
          }]}
        />,
      )
    })
    await flush()
    expect(container.querySelector('[data-testid="prototype-action-regenerate"] .prototype-spin')).not.toBeNull()
    expect(container.querySelector('[data-testid="prototype-generating-bar"]')).not.toBeNull()

    // 模拟后台产出暂存原型，会话结束时应自动从「当前正式版」切换到「待确认修改」。
    view.staged = STAGED
    await act(async () => {
      root.render(
        <PrototypePage
          {...baseProps}
          sessions={[{
            sessionId: 'gen-2',
            title: '原型生成',
            running: false,
            updatedAt: '2026-11-24T00:00:01.000Z',
          }]}
        />,
      )
    })
    await flush()
    expect(container.querySelector('[data-testid="prototype-version-staged"]')?.getAttribute('aria-current')).toBe('true')
    expect(container.querySelector('iframe[data-testid="prototype-page-iframe"]')?.getAttribute('srcdoc')).toContain('暂存页脚')
    expect(container.querySelector('[data-testid="prototype-page-notice"]')?.textContent).toContain('待确认修改')
    // 暂存落盘后浮卡从运行中收口为完成，不再显示实时过程。
    expect(document.body.querySelector('[data-testid="requirement-op-success"]')).not.toBeNull()
  })

  it('生成会话结束但未产出暂存原型时，提示并可点击查看生成过程', async () => {
    const call = pageCall({ staged: null, committedHtml: HTML })
    const onStartSession = vi.fn(async () => ({ ok: true, message: 'started', sessionId: 'gen-empty' }))
    const onOpenSession = vi.fn()
    const baseProps = pageProps(call, {
      requirements: REQUIREMENTS,
      sessions: [],
      onStartSession,
      onOpenSession,
    })
    await act(async () => { root.render(<PrototypePage {...baseProps} />) })
    await flush()

    await pressElement(container.querySelector('[data-testid="prototype-action-regenerate"]'))
    await pressElement(document.body.querySelector('[data-testid="prototype-regen-submit"]'))
    await pressElement(document.body.querySelector('[data-testid="prototype-regen-confirm"]'))

    await act(async () => {
      root.render(
        <PrototypePage
          {...baseProps}
          sessions={[{ sessionId: 'gen-empty', title: '原型生成', running: true, updatedAt: '2026-11-24T00:00:00.000Z' }]}
        />,
      )
    })
    await flush()

    await act(async () => {
      root.render(
        <PrototypePage
          {...baseProps}
          sessions={[{ sessionId: 'gen-empty', title: '原型生成', running: false, updatedAt: '2026-11-24T00:00:01.000Z' }]}
        />,
      )
    })
    await flush()

    expect(container.querySelector('[data-testid="prototype-page-notice"]')?.textContent).toContain('尚未产出待确认原型')
    await pressElement(container.querySelector('[data-testid="prototype-no-result-view-session"]'))
    expect(onOpenSession).toHaveBeenCalledWith('gen-empty')
  })
})
