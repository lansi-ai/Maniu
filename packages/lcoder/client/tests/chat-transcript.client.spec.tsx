// @vitest-environment jsdom
/** 聊天正文：思考态只在正文前出现，过程组默认折叠，玻璃只留在已提交行。 */
import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatTranscript } from '../src/shell/chat-transcript.tsx'
import { translate, type Translate } from '../src/locale.ts'
import { emptyChat, type ChatRow, type ChatState } from '../src/store.ts'

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

function render(chat: ChatState): void {
  const tree: ReactElement = <ChatTranscript t={t} sessionId="s1" chat={chat} />
  act(() => { root.render(tree) })
}

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

describe('ChatTranscript 思考态', () => {
  it('思考期显示思考中与实时思考原文，正文还不画', () => {
    render({
      ...emptyChat,
      attempt: { attemptId: 'a1', revision: 1, nextIndex: 3 },
      liveReasoning: '第一步先看目录，第二步再读文件，第三步核对契约……',
    })
    expect(element('chat-thinking').textContent).toContain('思考中')
    expect(element('chat-thinking-reasoning').textContent).toContain('第一步先看目录')
    expect(query('message-assistant')).toBeNull()
  })

  it('没有思考增量时只留提示，不留空的原文块', () => {
    render({
      ...emptyChat,
      attempt: { attemptId: 'a1', revision: 1, nextIndex: 3 },
    })
    expect(element('chat-thinking').textContent).toContain('思考中')
    expect(query('chat-thinking-reasoning')).toBeNull()
  })

  it('正文一到就换成流式草稿，草稿不带玻璃卡', () => {
    render({
      ...emptyChat,
      attempt: { attemptId: 'a1', revision: 1, nextIndex: 4 },
      liveText: '结论：先读文件再改。',
    })
    expect(query('chat-thinking')).toBeNull()
    const live = element('message-assistant')
    expect(live.getAttribute('data-live')).toBe('true')
    expect(live.className.includes('lg-glass-card')).toBe(false)
    expect(live.textContent).toContain('结论')
  })

  it('已提交正文用静态磨砂，不再挂玻璃卡', () => {
    render(chatWith([{ kind: 'assistant', id: 'a-1', text: '读完了' }]))
    const message = element('message-assistant')
    expect(message.getAttribute('data-live')).toBeNull()
    expect(message.className.includes('lg-frost')).toBe(true)
    expect(message.className.includes('lg-glass-card')).toBe(false)
  })
})

describe('ChatTranscript 复制按钮', () => {
  it('只有有文本的消息才给按钮，点击写入剪贴板并给出成功反馈', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(chatWith([
      { kind: 'user', id: 'u-1', text: '用户问题', attachments: [] },
      { kind: 'assistant', id: 'a-1', text: '助手回答' },
      { kind: 'user', id: 'u-2', text: '', attachments: [] },
    ]))
    expect(container.querySelectorAll('[data-testid="copy-user"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-testid="copy-assistant"]')).toHaveLength(1)

    await act(async () => {
      element('copy-assistant').click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(writeText).toHaveBeenCalledWith('助手回答')
    expect(element('copy-assistant').getAttribute('data-copied')).toBe('true')
    expect(element('copy-assistant').getAttribute('aria-label')).toBe('已复制')
  })
})

describe('ProcessGroup', () => {
  const rows: readonly ChatRow[] = [{
    kind: 'process',
    id: 'p-1',
    items: [{ kind: 'reasoning', text: '先读文件' }],
  }]

  it('默认折叠，收起时条目仍在 DOM 里但不可见', () => {
    render(chatWith(rows))
    const group = element('process-group')
    expect(group.getAttribute('data-open')).toBe('false')
    expect(group.className.includes('lg-frost')).toBe(true)
    expect(group.className.includes('lg-glass-card')).toBe(false)
    const list = group.querySelector<HTMLElement>('.process-list')
    expect(list?.hidden).toBe(true)
    expect(element('process-reasoning').textContent).toContain('先读文件')
  })

  it('点组头可展开，testid 与折叠时一致', () => {
    render(chatWith(rows))
    act(() => { element('process-group').querySelector<HTMLButtonElement>('.process-head')?.click() })
    const group = element('process-group')
    expect(group.getAttribute('data-open')).toBe('true')
    expect(group.querySelector<HTMLElement>('.process-list')?.hidden).toBe(false)
    expect(element('process-reasoning').textContent).toContain('先读文件')
  })
})

describe('ChatTranscript 模型失败', () => {
  it('重试期显示第几次与上限', () => {
    render({ ...emptyChat, retry: { attempt: 2, max: 5 } })
    expect(element('chat-retry').textContent).toContain('正在重试 2/5')
  })

  it('最终失败显示文案与请求号', () => {
    render({
      ...emptyChat,
      failure: { message: 'The model upstream is unavailable.', code: 'SERVER', requestId: 'req_abc123' },
    })
    const node = element('chat-failure')
    expect(node.textContent).toContain('The model upstream is unavailable.')
    expect(node.textContent).toContain('req_abc123')
    expect(node.getAttribute('data-request-id')).toBe('req_abc123')
  })

  it('没有请求号时仍显示错误文案', () => {
    render({ ...emptyChat, failure: { message: '', code: 'SERVER', requestId: null } })
    const node = element('chat-failure')
    expect(node.textContent).toContain('模型请求失败')
    expect(node.getAttribute('data-request-id')).toBeNull()
  })
})
