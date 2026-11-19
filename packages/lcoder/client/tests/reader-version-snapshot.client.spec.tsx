// @vitest-environment jsdom
/** T-242：版本快照经阅读器打开时，取数路径与渲染内容都对应该版。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderOverlay } from '../src/pages/reader.tsx'

const SNAPSHOTS: Readonly<Record<string, string>> = {
  '.spec/requirements/REQ-01/versions/v1.md': '# 版本一\n初稿正文',
  '.spec/requirements/REQ-01/versions/v2.md': '# 版本二\n改稿后正文',
  '.spec/requirements/REQ-01/versions/v3.md': '# 版本三\n再次改稿正文',
}

let container: HTMLDivElement
let root: Root
let reads: { readonly scope: string; readonly path: string }[]

async function fakeCall(namespace: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  if (namespace !== 'workspaceFiles' || method !== 'read') throw new Error(`未预期调用 ${namespace}/${method}`)
  const path = typeof args.path === 'string' ? args.path : ''
  reads.push({ scope: String(args.workspaceFileScopeId), path })
  const text = SNAPSHOTS[path]
  if (text === undefined) return { ok: false, error: { code: 'ENOENT', message: '文件不存在' } }
  return { ok: true, value: { text } }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  reads = []
  Object.defineProperty(window, 'lcoder', { configurable: true, value: { call: vi.fn(fakeCall) } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  Reflect.deleteProperty(window, 'lcoder')
})

async function open(path: string): Promise<void> {
  act(() => {
    root.render(<ReaderOverlay scopeSessionId="session-scope" path={path} onClose={() => {}} />)
  })
  await act(async () => { await Promise.resolve() })
}

describe('版本快照阅读', () => {
  it('每一版按自己的路径取数并渲染对应内容', async () => {
    for (const [path, text] of Object.entries(SNAPSHOTS)) {
      await open(path)
      const doc = container.querySelector('[data-testid="reader-doc"]')
      expect(doc?.textContent).toContain(text.split('\n')[1])
      expect(container.querySelector('[data-testid="markdown-reader"]')?.getAttribute('data-reader-path')).toBe(path)
    }
    expect(reads).toEqual(Object.keys(SNAPSHOTS).map(path => ({ scope: 'session-scope', path })))
  })

  it('阅读器正文复用 markdown-body 语义排版与不透明表面类', async () => {
    await open('.spec/requirements/REQ-01/versions/v2.md')
    const doc = container.querySelector('[data-testid="reader-doc"]') as HTMLElement
    expect(doc.className).toContain('markdown-body')
    expect(doc.className).toContain('reader-doc')
    expect(doc.querySelector('h1')?.textContent).toContain('版本二')
    expect((container.querySelector('.reader-panel') as HTMLElement).className).toContain('reader-panel')
  })

  it('输入框聚焦时键入 + - = 0 不触发阅读器缩放', async () => {
    await open('.spec/requirements/REQ-01/versions/v2.md')
    const input = document.createElement('textarea')
    container.append(input)
    input.focus()
    for (const key of ['+', '=', '-', '0']) {
      act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
    }
    expect(container.querySelector('[data-testid="reader-zoom"]')?.textContent).toBe('100%')
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '+' })) })
    expect(container.querySelector('[data-testid="reader-zoom"]')?.textContent).toBe('110%')
  })
})
