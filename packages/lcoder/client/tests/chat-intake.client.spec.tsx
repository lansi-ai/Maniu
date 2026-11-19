// @vitest-environment jsdom
/** 对话页的立项收起、固定标题与列内待处理卡。 */
import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatTranscript } from '../src/shell/chat-transcript.tsx'
import { ChatView, type ChatViewProps } from '../src/shell/chat-view.tsx'
import { PendingLayer } from '../src/shell/pending-cards.tsx'
import { interactionOf, type PendingInteraction } from '../src/chat/pending.ts'
import { translate, type Translate } from '../src/locale.ts'
import { emptyChat, type ChatRow, type ChatState, type SessionSummary } from '../src/store.ts'

const t: Translate = (key, params) => translate('zh', key, params)

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

function chatWith(rows: readonly ChatRow[]): ChatState {
  return { ...emptyChat, rows }
}

function render(tree: ReactElement): void {
  act(() => { root.render(tree) })
}

const SEED_TEXT = '项目：示例仓库；路径：E:/repo；分支：main。先读仓库再按七问访谈。'

function transcript(chat: ChatState, seedHidden?: boolean): ReactElement {
  return (
    <ChatTranscript
      t={t}
      sessionId="s1"
      chat={chat}
      {...seedHidden === undefined ? {} : { seedHidden }}
    />
  )
}

describe('立项首条指令', () => {
  it('整行不渲染：正文、角色胶囊与复制按钮都不出现', () => {
    render(transcript(chatWith([
      { kind: 'user', id: 'u-1', text: SEED_TEXT, attachments: [] },
    ]), true))
    expect(query('message-user')).toBeNull()
    expect(query('intake-seed-role')).toBeNull()
    expect(query('copy-user')).toBeNull()
    expect(container.textContent).not.toContain('七问访谈')
    expect(container.textContent).not.toContain('需求分析师')
  })

  it('第二条用户消息照常显示正文与复制按钮', () => {
    render(transcript(chatWith([
      { kind: 'user', id: 'u-1', text: SEED_TEXT, attachments: [] },
      { kind: 'user', id: 'u-2', text: '我想做一个任务看板', attachments: [] },
    ]), true))
    const messages = container.querySelectorAll<HTMLElement>('[data-testid="message-user"]')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.textContent).toBe('我想做一个任务看板')
    expect(query('copy-user')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="intake-seed-role"]')).toHaveLength(0)
  })

  it('非立项会话照常摊开正文', () => {
    render(transcript(chatWith([
      { kind: 'user', id: 'u-1', text: SEED_TEXT, attachments: [] },
    ])))
    expect(query('intake-seed-role')).toBeNull()
    expect(container.textContent).toContain('七问访谈')
  })
})

const INTAKE_SESSION: SessionSummary = {
  sessionId: 's1',
  updatedAt: 1,
  running: false,
  blank: false,
  agentPreset: 'maniu-intake',
}

function interaction(name: string, eventId: string, request: object): PendingInteraction {
  const value = interactionOf(name, 'client-1', eventId, request)
  expect(value).toBeDefined()
  if (value === undefined) throw new Error('水落事件没有被识别成交互')
  return value
}

const QUESTION = interaction('user-questions/request', 'q1', {
  questions: [{ id: 'q1', question: '要不要做看板？', options: [{ label: '要' }, { label: '不要' }] }],
})

const APPROVAL = interaction('approval/request', 'a1', { toolName: 'cmd_run' })

function viewProps(overrides: Partial<ChatViewProps> = {}): ChatViewProps {
  return {
    t,
    sessions: [INTAKE_SESSION],
    titles: { s1: t('intake.sessionTitle') },
    active: 's1',
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

describe('立项会话标题', () => {
  it('聊天头与会话列表都显示需求分析', () => {
    render(<ChatView {...viewProps()} />)
    expect(element('active-session').textContent).toBe('需求分析')
    expect(element('session-item').textContent).toContain('需求分析')
  })
})

describe('对话页待处理卡', () => {
  it('提问卡排在消息列里，页面没有右下浮层', () => {
    render(<ChatView {...viewProps({ pending: [QUESTION] })} />)
    const messages = element('messages')
    expect(messages.querySelector('[data-testid="question-card"]')).not.toBeNull()
    expect(element('pending-stack').closest('[data-testid="messages"]')).not.toBeNull()
    expect(container.querySelector('.pending-layer')).toBeNull()
  })

  it('审批回执仍按宿主原文提交', async () => {
    const onAnswer = vi.fn(async () => ({ ok: true as const }))
    render(<ChatView {...viewProps({ pending: [APPROVAL], onAnswer })} />)
    await act(async () => {
      element('approval-allow').click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(onAnswer).toHaveBeenCalledWith(APPROVAL, { kind: 'result', value: 'allowed-once' })
  })
})

describe('非对话页浮层', () => {
  it('显示时卡片在居中浮层', () => {
    render(<PendingLayer visible t={t} items={[QUESTION]} onAnswer={vi.fn(async () => ({ ok: true as const }))} />)
    expect(container.querySelector('.pending-layer')).not.toBeNull()
    expect(element('question-card')).not.toBeNull()
  })

  it('对话页传 false 时不渲染浮层', () => {
    render(<PendingLayer visible={false} t={t} items={[QUESTION]} onAnswer={vi.fn(async () => ({ ok: true as const }))} />)
    expect(container.querySelector('.pending-layer')).toBeNull()
    expect(query('question-card')).toBeNull()
  })
})
