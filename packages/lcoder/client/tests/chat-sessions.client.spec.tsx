// @vitest-environment jsdom
/** 对话页会话分组、后台种子收起与新会话项目绑定。 */
import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/app.tsx'
import { ChatView, type ChatViewProps } from '../src/shell/chat-view.tsx'
import { translate, type Translate } from '../src/locale.ts'
import { emptyChat, type ChatRow, type ChatState, type SessionSummary } from '../src/store.ts'

const t: Translate = (key, params) => translate('zh', key, params)
const PROJECT_KEY = 'lcoder.m2.project'

const PROJECT = {
  workspaceId: 'ws-1',
  path: 'E:/repo',
  title: 'Repo',
  scopeSessionId: 'session-scope',
}

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
})

function query(testId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
}

function element(testId: string): HTMLElement {
  const node = query(testId)
  expect(node).not.toBeNull()
  return node as HTMLElement
}

function items(): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="session-item"]')]
}

function row(sessionId: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return { sessionId, updatedAt: 1, running: false, blank: false, ...extra }
}

function chatWith(rows: readonly ChatRow[]): ChatState {
  return { ...emptyChat, rows }
}

function viewProps(overrides: Partial<ChatViewProps> = {}): ChatViewProps {
  return {
    t,
    sessions: [],
    titles: {},
    active: null,
    chat: emptyChat,
    notice: null,
    sending: false,
    running: false,
    limits: {
      maxImageBytes: 1,
      maxImagesPerMessage: 1,
      maxMessageImageBytes: 1,
      maxImagePixels: 1,
      maxImageDimension: 1,
      mediaTypes: [],
    },
    models: [],
    selection: undefined,
    availability: { kind: 'ready' },
    usage: {},
    composerRef: { current: null },
    talentNames: {},
    pending: [],
    onAnswer: vi.fn(async () => ({ ok: true as const })),
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onSend: vi.fn(async () => true),
    onStop: vi.fn(),
    onRename: vi.fn(async () => true),
    ensureSession: vi.fn(async () => 's1'),
    onSelectModel: vi.fn(async () => true),
    ...overrides,
  }
}

function render(tree: ReactElement): void {
  act(() => { root.render(tree) })
}

describe('对话页会话分组', () => {
  const sessions = [
    row('chat-1', { updatedAt: 3 }),
    row('flow-1', { updatedAt: 2, agentPreset: 'maniu-pm' }),
    row('flow-2', { updatedAt: 1, agentPreset: 'maniu-intake', running: true }),
  ]

  it('单容器下两组都默认展开，保留 session-list 与每个 session-item 选择器', () => {
    render(<ChatView {...viewProps({
      sessions,
      active: 'chat-1',
      titles: { 'chat-1': '普通对话', 'flow-1': '需求评审' },
      talentNames: { 'maniu-pm': '项目经理' },
    })} />)
    expect(element('session-list')).not.toBeNull()
    expect(element('session-group-chat')).not.toBeNull()
    expect(element('session-group-flow')).not.toBeNull()
    expect(query('session-group-chat-head')?.getAttribute('aria-expanded')).toBe('true')
    expect(query('session-group-flow-head')?.getAttribute('aria-expanded')).toBe('true')
    expect(items().map(node => node.getAttribute('data-session-id'))).toEqual(['chat-1', 'flow-1', 'flow-2'])
    expect(items()[2]?.getAttribute('data-running')).toBe('true')
    expect(container.querySelectorAll('[data-testid="session-talent"]')).toHaveLength(1)
    expect(element('new-session')).not.toBeNull()
    expect(element('active-session').textContent).toBe('普通对话')
    expect(element('messages')).not.toBeNull()
    expect(query('session-group-chat')?.textContent).toContain('对话')
    expect(query('session-group-flow')?.textContent).toContain('流程执行记录')
  })

  it('点分组标题可折叠与展开，另一组不受影响', () => {
    render(<ChatView {...viewProps({ sessions, active: 'chat-1' })} />)
    act(() => { element('session-group-chat-head').click() })
    expect(query('session-group-chat-head')?.getAttribute('aria-expanded')).toBe('false')
    expect(items().map(node => node.getAttribute('data-session-id'))).toEqual(['flow-1', 'flow-2'])
    act(() => { element('session-group-chat-head').click() })
    expect(query('session-group-chat-head')?.getAttribute('aria-expanded')).toBe('true')
    expect(items()).toHaveLength(3)
  })

  it('空组显示简短空态', () => {
    render(<ChatView {...viewProps({ sessions: [row('chat-1')] })} />)
    expect(query('session-group-flow')?.textContent).toContain('暂无流程记录')
  })
})

const SEED_TEXT = '需求评审：请对需求 REQ-01 做一轮独立评审，把报告落盘。'
const seedRows: readonly ChatRow[] = [
  { kind: 'user', id: 'u-1', text: SEED_TEXT, attachments: [] },
  { kind: 'process', id: 'p-1', items: [{ kind: 'reasoning', text: '先读需求' }] },
  { kind: 'assistant', id: 'a-1', text: '结论：需求描述不清，建议补充验收标准。' },
]

describe('后台流程首条种子收起', () => {
  it('流程角色的系统指令整行隐藏，助手结论、过程组与 messages 仍在', () => {
    render(<ChatView {...viewProps({
      sessions: [row('flow-1', { agentPreset: 'maniu-pm' })],
      active: 'flow-1',
      chat: chatWith(seedRows),
    })} />)
    expect(query('message-user')).toBeNull()
    expect(container.textContent).not.toContain('把报告落盘')
    expect(element('messages')).not.toBeNull()
    expect(element('message-assistant').textContent).toContain('需求描述不清')
    expect(element('process-group')).not.toBeNull()
  })

  it('立项会话仍整行隐藏，普通聊天照常显示正文', () => {
    render(<ChatView {...viewProps({
      sessions: [row('intake', { agentPreset: 'maniu-intake' })],
      active: 'intake',
      chat: chatWith(seedRows),
    })} />)
    expect(query('message-user')).toBeNull()
    expect(container.textContent).not.toContain(SEED_TEXT)

    render(<ChatView {...viewProps({
      sessions: [row('chat-1')],
      active: 'chat-1',
      chat: chatWith([{ kind: 'user', id: 'u-1', text: '你好，帮我看下代码', attachments: [] }]),
    })} />)
    expect(element('message-user').textContent).toContain('你好，帮我看下代码')
  })
})

interface CallRecord {
  readonly namespace: string
  readonly method: string
  readonly args: Record<string, unknown>
}

describe('新会话绑定当前项目', () => {
  let calls: CallRecord[]

  beforeEach(() => {
    calls = []
    localStorage.clear()
    localStorage.setItem(PROJECT_KEY, JSON.stringify(PROJECT))
    Object.defineProperty(window, 'lcoder', {
      configurable: true,
      value: {
        call: vi.fn(async (namespace: string, method: string, args: Record<string, unknown>) => {
          calls.push({ namespace, method, args })
          if (namespace === 'lcoderCloud' && method === 'state') {
            const state = { signedIn: true, needsLogin: false, user: null, quota: null, estimate: null, lastError: null }
            return { ok: true, value: { ok: true, value: state } }
          }
          if (namespace === 'session' && method === 'list') {
            return {
              ok: true,
              value: { items: [{ sessionId: 's1', updatedAt: 1, running: false, cwd: 'E:/repo', agentPreset: 'maniu-workbench' }] },
            }
          }
          if (namespace === 'session' && method === 'create') return { ok: true, value: { sessionId: 'new-1', agentPreset: 'maniu-workbench' } }
          return { ok: true, value: {} }
        }),
        hostState: () => () => {},
        hostStateNow: async () => ({ kind: 'ready', url: 'http://127.0.0.1:1' }),
        openStream: vi.fn(async () => 'stream-1'),
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
  })

  afterEach(() => { localStorage.clear() })

  async function flush(): Promise<void> {
    for (let index = 0; index < 6; index += 1) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    }
  }

  it('点击新会话携带当前项目 workspaceId', async () => {
    await act(async () => { root.render(<App />) })
    await flush()
    expect(element('nav-chat')).not.toBeNull()
    await act(async () => { element('nav-chat').click() })
    await flush()
    expect(element('session-list')).not.toBeNull()

    await act(async () => {
      element('new-session').click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await flush()

    const create = calls.find(item => item.namespace === 'session' && item.method === 'create')
    expect(create).toBeDefined()
    expect(create?.args.request).toEqual({ workspaceId: 'ws-1' })
  })
})
