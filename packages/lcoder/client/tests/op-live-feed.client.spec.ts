/** 后台操作浮卡实时过程折叠单测：思考/正文/工具流、工具结果与回合异常终止原因。 */

import { describe, expect, it } from 'vitest'
import { emptyOpLiveFeed, foldOpLiveFrame } from '../src/shell/op-live-feed.ts'

describe('foldOpLiveFrame', () => {
  it('折叠思考增量、正文增量与工具流字符计数', () => {
    let feed = emptyOpLiveFeed(1000)
    feed = foldOpLiveFrame(feed, {
      type: 'assistant-stream',
      frame: { type: 'start', attemptId: 'a1', revision: 1, step: 2 },
    }, 1100)
    expect(feed.step).toBe(2)
    expect(feed.phase).toBe('thinking')

    feed = foldOpLiveFrame(feed, {
      type: 'assistant-stream',
      frame: {
        type: 'chunk',
        attemptId: 'a1',
        revision: 2,
        index: 0,
        chunk: { type: 'reasoning-delta', index: 0, text: '先拆分概览与报销列表两个视图。' },
      },
    }, 1200)
    expect(feed.phase).toBe('thinking')
    expect(feed.snippet).toContain('先拆分概览与报销列表两个视图')

    feed = foldOpLiveFrame(feed, {
      type: 'assistant-stream',
      frame: {
        type: 'chunk',
        attemptId: 'a1',
        revision: 3,
        index: 1,
        chunk: { type: 'text-delta', index: 1, text: '现在生成 REQ-01 多页 SPA 原型。' },
      },
    }, 1300)
    expect(feed.phase).toBe('streaming')
    expect(feed.snippet).toBe('现在生成 REQ-01 多页 SPA 原型。')

    feed = foldOpLiveFrame(feed, {
      type: 'assistant-stream',
      frame: {
        type: 'chunk',
        attemptId: 'a1',
        revision: 4,
        index: 2,
        chunk: { type: 'tool-call-delta', index: 2, id: 'c1', name: 'prototype_draft', argumentsDelta: '<html>' },
      },
    }, 1400)
    feed = foldOpLiveFrame(feed, {
      type: 'assistant-stream',
      frame: {
        type: 'chunk',
        attemptId: 'a1',
        revision: 5,
        index: 3,
        chunk: { type: 'tool-call-delta', index: 2, id: 'c1', argumentsDelta: '<body>ok</body></html>' },
      },
    }, 1500)
    expect(feed.phase).toBe('tool-streaming')
    expect(feed.toolName).toBe('prototype_draft')
    expect(feed.toolChars).toBe(28)
  })

  it('折叠 durable 工具调用、错误工具结果、模型重试与 max-tokens 终止', () => {
    let feed = emptyOpLiveFeed(2000)
    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 1,
        time: 2100,
        data: { name: 'file_read', arguments: '{"path":".spec/requirements/REQ-01.md"}' },
      },
    }, 2100)
    expect(feed.phase).toBe('tool-running')
    expect(feed.toolName).toBe('file_read')
    expect(feed.toolDetail).toBe('.spec/requirements/REQ-01.md')

    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: {
        type: 'tool/result',
        seq: 2,
        time: 2200,
        data: { message: { isError: true, content: [{ type: 'text', text: 'SCRIPT_SYNTAX_ERROR: Unexpected token' }] } },
      },
    }, 2200)
    expect(feed.lastToolNote).toContain('SCRIPT_SYNTAX_ERROR')

    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: { type: 'llm/retry', seq: 3, time: 2300, data: { retry: 2, maxRetries: 5 } },
    }, 2300)
    expect(feed.phase).toBe('retrying')
    expect(feed.retryAttempt).toBe(2)
    expect(feed.retryMax).toBe(5)

    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: { type: 'turn/end', seq: 4, time: 2400, data: { turn: 1, reason: { kind: 'max-tokens' } } },
    }, 2400)
    expect(feed.phase).toBe('idle')
    expect(feed.turnEnd).toEqual({ kind: 'max-tokens' })

    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: {
        type: 'user/message',
        seq: 5,
        time: 2500,
        data: { source: { kind: 'maniu-max-tokens-recovery' }, content: [{ type: 'text', text: 'continue' }] },
      },
    }, 2500)
    expect(feed.phase).toBe('auto-continuing')
    expect(feed.turnEnd).toBeUndefined()
  })

  it('开场 snapshot 能还原历史事件与正在进行中的流式片段', () => {
    const feed = foldOpLiveFrame(emptyOpLiveFeed(3000), {
      type: 'snapshot',
      cursor: 5,
      records: [
        {
          type: 'event',
          event: {
            type: 'assistant/message',
            seq: 4,
            time: 2900,
            data: { message: { content: [{ type: 'text', text: '已读取需求正文。' }] } },
          },
        },
      ],
      assistantStream: {
        revision: 3,
        activeAttempt: {
          attemptId: 'a2',
          revision: 3,
          step: 3,
          nextIndex: 1,
          stream: [{ type: 'text-chunks', texts: ['正在写入原型页面。'] }],
        },
      },
    }, 3100)
    expect(feed.step).toBe(3)
    expect(feed.phase).toBe('streaming')
    expect(feed.snippet).toBe('正在写入原型页面。')
  })
})
