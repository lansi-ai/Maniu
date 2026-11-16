// @vitest-environment jsdom
/** 聊天正文：思考态只在正文前出现，过程组默认折叠，玻璃只留在已提交行。 */
import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
  it('思考期只显示思考中，不铺思维链也不画正文', () => {
    render({
      ...emptyChat,
      attempt: { attemptId: 'a1', revision: 1, nextIndex: 3 },
      liveReasoning: '第一步先看目录，第二步再读文件，第三步核对契约……',
    })
    expect(element('chat-thinking').textContent).toContain('思考中')
    expect(query('message-assistant')).toBeNull()
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
