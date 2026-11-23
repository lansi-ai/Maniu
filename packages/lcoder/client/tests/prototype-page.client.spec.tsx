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
import type { RequirementDocRow } from '../src/spec/rows.ts'
import { translate, type Translate } from '../src/locale.ts'

const HTML = '<!doctype html><html><head><title>项目原型</title></head><body><nav>导航</nav><h1>项目原型</h1><section><ul><li>内容</li></ul></section><footer>页脚</footer></body></html>'
const STAGED_HTML = HTML.replace('页脚', '暂存页脚')

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

/** 只回答原型页需要的三条 Remote；其余返回空对象。 */
function pageCall(view: ViewState) {
  return vi.fn(async (namespace: string, method: string, _args: object) => {
    if (namespace === 'prototype' && method === 'getStaged') {
      return { ok: true as const, value: { staged: view.staged, committedHtml: view.committedHtml } }
    }
    if (namespace === 'prototype' && method === 'listSnapshots') {
      return { ok: true as const, value: { snapshots: [SNAPSHOT] } }
    }
    if (namespace === 'prototype' && method === 'restoreSnapshot') {
      return { ok: true as const, value: { restoredAt: '2026-11-24T00:00:00.000Z', html: view.committedHtml ?? HTML } }
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
  it('展示项目活原型预览与四个操作区，工作室带需求上下文', async () => {
    const api = installWindowApi()
    const call = pageCall({ staged: null, committedHtml: HTML })
    await act(async () => { root.render(<PrototypePage {...pageProps(call)} />) })
    await flush()

    expect(call).toHaveBeenCalledWith('prototype', 'getStaged', { input: { sessionId: 'session-1' } })
    const frame = container.querySelector('iframe[data-testid="prototype-page-iframe"]')
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('sandbox')).toBe('')
    expect(frame?.getAttribute('srcdoc')).toBe(HTML)

    expect(container.querySelector('[data-testid="prototype-page-refresh"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="prototype-page-snapshots-toggle"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="prototype-page-open-window"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="prototype-page-open-studio"]')).not.toBeNull()

    // 缺省上下文取最新一条需求。
    expect(container.querySelector('[data-testid="prototype-page-studio-context"]')?.textContent).toContain('REQ-02')

    await pressElement(container.querySelector('[data-testid="prototype-page-open-studio"]'))
    expect(api.studio).toHaveBeenCalledWith({
      requirementId: 'REQ-02',
      sessionId: 'session-1',
      html: HTML,
      beforeHtml: HTML,
      mode: 'split',
    })

    await pressElement(container.querySelector('[data-testid="prototype-page-open-window"]'))
    expect(api.preview).toHaveBeenCalledWith(HTML)
  })

  it('有暂存时高亮提示，确认入口打开工作室', async () => {
    const api = installWindowApi()
    const call = pageCall({ staged: STAGED, committedHtml: HTML })
    await act(async () => { root.render(<PrototypePage {...pageProps(call, { initialRequirementId: 'REQ-01' })} />) })
    await flush()

    const notice = container.querySelector('[data-testid="prototype-page-staged-notice"]')
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain('有暂存的修改待确认')
    expect(notice?.textContent).toContain('2')
    expect(container.querySelector('iframe[data-testid="prototype-page-iframe"]')?.getAttribute('srcdoc')).toBe(STAGED_HTML)

    await pressElement(container.querySelector('[data-testid="prototype-page-staged-confirm"]'))
    expect(api.studio).toHaveBeenCalledWith(expect.objectContaining({
      requirementId: 'REQ-01',
      html: STAGED_HTML,
      beforeHtml: HTML,
    }))
  })

  it('历史快照可展开并按项目级作用域恢复', async () => {
    const call = pageCall({ staged: null, committedHtml: HTML })
    await act(async () => { root.render(<PrototypePage {...pageProps(call)} />) })
    await flush()

    await pressElement(container.querySelector('[data-testid="prototype-page-snapshots-toggle"]'))
    const items = container.querySelectorAll('[data-testid="prototype-page-snapshot"]')
    expect(items).toHaveLength(1)

    await pressElement(container.querySelector('[data-testid="prototype-page-snapshot-restore"]'))
    expect(call).toHaveBeenCalledWith('prototype', 'restoreSnapshot', {
      input: { sessionId: 'session-1', snapshotId: SNAPSHOT.snapshotId },
    })
    expect(container.querySelector('[data-testid="prototype-page-notice"]')?.textContent).toContain('已恢复')
  })

  it('没有原型时画空态并给出需求页入口', async () => {
    const onOpenRequirements = vi.fn()
    const call = pageCall({ staged: null, committedHtml: null })
    await act(async () => { root.render(<PrototypePage {...pageProps(call, { onOpenRequirements })} />) })
    await flush()

    expect(container.querySelector('[data-testid="prototype-page-empty"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="prototype-page-iframe"]')).toBeNull()
    await pressElement(container.querySelector('[data-testid="prototype-page-empty-action"]'))
    expect(onOpenRequirements).toHaveBeenCalledTimes(1)
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
