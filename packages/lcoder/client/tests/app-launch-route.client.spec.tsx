// @vitest-environment jsdom
/** T-242：评审后台发起不跳对话、会话仍登记进列表；立项保持原有跳转。 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app.tsx'

const PROJECT_KEY = 'lcoder.m2.project'
const SESSION_KEY = 'lcoder.s1.session'

const PROJECT = {
  workspaceId: 'workspace-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

const REQUIREMENT_YAML = [
  'id: REQ-01',
  'title: 草稿需求',
  'state: draft',
  'options: []',
].join('\n')

interface CallRecord {
  readonly namespace: string
  readonly method: string
  readonly args: Record<string, unknown>
}

let container: HTMLDivElement
let root: Root
let calls: CallRecord[]
let streamOpens: CallRecord[]
let sessionItems: Record<string, unknown>[]
let createdSessions: string[]
let withRequirement = true

async function fakeCall(namespace: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  calls.push({ namespace, method, args })
  if (namespace === 'lcoderCloud' && method === 'state') {
    const state = { signedIn: true, needsLogin: false, user: null, quota: null, estimate: null, lastError: null }
    return { ok: true, value: { ok: true, value: state } }
  }
  if (namespace === 'session' && method === 'list') return { ok: true, value: { items: sessionItems } }
  if (namespace === 'session' && method === 'create') {
    const request = args.request as Record<string, unknown>
    const sessionId = `session-new-${String(createdSessions.length + 1)}`
    createdSessions.push(sessionId)
    const agentPreset = typeof request.agentPreset === 'string' ? request.agentPreset : 'maniu-workbench'
    sessionItems = [...sessionItems, { sessionId, updatedAt: Date.now(), running: false, agentPreset }]
    return { ok: true, value: { sessionId, agentPreset } }
  }
  if (namespace === 'session' && (method === 'prompt' || method === 'rename' || method === 'selectModel')) {
    return { ok: true, value: {} }
  }
  if (namespace === 'workspaceFiles' && method === 'list') {
    const path = typeof args.path === 'string' ? args.path : ''
    if (path === '.spec/requirements' && withRequirement) {
      return { ok: true, value: { entries: [{ name: 'REQ-01.yaml', type: 'file' }, { name: 'REQ-01.md', type: 'file' }] } }
    }
    return { ok: true, value: { entries: [] } }
  }
  if (namespace === 'workspaceFiles' && method === 'read') {
    const path = typeof args.path === 'string' ? args.path : ''
    if (path === '.spec/requirements/REQ-01.yaml') return { ok: true, value: { text: REQUIREMENT_YAML } }
    if (path === '.spec/requirements/REQ-01.md') return { ok: true, value: { text: '草稿正文' } }
    return { ok: false, error: { code: 'ENOENT', message: 'ENOENT: 文件不存在' } }
  }
  return { ok: true, value: {} }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  calls = []
  streamOpens = []
  sessionItems = []
  createdSessions = []
  withRequirement = true
  localStorage.clear()
  localStorage.setItem(PROJECT_KEY, JSON.stringify(PROJECT))
  let streamSeq = 0
  Object.defineProperty(window, 'lcoder', {
    configurable: true,
    value: {
      call: vi.fn(fakeCall),
      hostState: () => () => {},
      hostStateNow: async () => ({ kind: 'ready', url: 'http://127.0.0.1:1' }),
      openStream: vi.fn(async (namespace: string, method: string, args: Record<string, unknown>) => {
        streamOpens.push({ namespace, method, args })
        streamSeq += 1
        return `stream-${String(streamSeq)}`
      }),
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
      readPreferences: async () => ({ skin: 'liquid-glass', font: 'system', locale: 'zh', lastPickedDirectory: null }),
      writePreferences: async () => ({ skin: 'liquid-glass', font: 'system', locale: 'zh', lastPickedDirectory: null }),
      pickDirectory: async () => null,
    },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  Reflect.deleteProperty(window, 'lcoder')
  localStorage.clear()
})

function element(testId: string): Element | null {
  return container.querySelector(`[data-testid="${testId}"]`)
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}

async function press(testId: string): Promise<void> {
  const node = element(testId)
  expect(node).not.toBeNull()
  await act(async () => {
    ;(node as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await flush()
}

async function renderApp(): Promise<void> {
  await act(async () => { root.render(<App />) })
  await flush()
}

function followOpens(): CallRecord[] {
  return streamOpens.filter(item => item.namespace === 'session' && item.method === 'follow')
}

describe('评审后台发起', () => {
  it('不选中会话、不跳对话页，会话仍登记进列表', async () => {
    await renderApp()
    await press('nav-requirements')
    expect(element('page-requirements')).not.toBeNull()
    expect(element('requirement-op-review')).not.toBeNull()

    await press('requirement-op-review')

    const create = calls.find(item => item.namespace === 'session' && item.method === 'create')
    expect((create?.args.request as Record<string, unknown>).agentPreset).toBe('maniu-pm')
    expect(calls.some(item => item.namespace === 'session' && item.method === 'prompt')).toBe(true)
    expect(followOpens()).toHaveLength(0)
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(element('page-requirements')).not.toBeNull()
    expect(element('session-list')).toBeNull()
    expect(element('requirement-op-running')?.textContent).toContain('评审进行中')

    await press('nav-chat')
    const items = [...container.querySelectorAll('[data-testid="session-item"]')]
    expect(items.map(node => node.getAttribute('data-session-id'))).toEqual(createdSessions)
    expect(followOpens()).toHaveLength(0)
  })
})

describe('立项后台发起不跳转', () => {
  it('立项发起后留在需求页，浮卡接管进度且会话只登记进列表', async () => {
    withRequirement = false
    await renderApp()
    await press('nav-requirements')
    await press('intake-open')
    await press('intake-start')

    expect(element('page-requirements')).not.toBeNull()
    expect(element('session-list')).toBeNull()
    expect(createdSessions).toHaveLength(1)
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(followOpens()).toHaveLength(0)
    expect(element('intake-wizard')).toBeNull()
    expect(element('requirement-op-running')?.textContent).toContain('需求调研进行中')
  })
})
