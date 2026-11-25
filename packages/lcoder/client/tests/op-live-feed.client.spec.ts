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
    expect(feed.reasoning).toContain('先拆分概览与报销列表两个视图')
    expect(feed.snippet).toBe('')

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
    expect(feed.reasoning).toContain('先拆分概览与报销列表两个视图')

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

  it('assistant/message 分别写入 reasoning 与 snippet，turn/start 与 snapshot 清空 reasoning', () => {
    let feed = emptyOpLiveFeed(4000)
    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: {
        type: 'assistant/message',
        seq: 1,
        time: 4100,
        data: {
          message: {
            content: [
              { type: 'reasoning', text: '先检查需求边界条件。' },
              { type: 'text', text: '需求边界已确认。' },
            ],
          },
        },
      },
    }, 4100)
    expect(feed.reasoning).toBe('先检查需求边界条件。')
    expect(feed.snippet).toBe('需求边界已确认。')

    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: {
        type: 'assistant/message',
        seq: 2,
        time: 4200,
        data: { message: { content: [] } },
      },
    }, 4200)
    expect(feed.reasoning).toBe('先检查需求边界条件。')
    expect(feed.snippet).toBe('需求边界已确认。')

    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: { type: 'turn/start', seq: 3, time: 4300, data: { turn: 2 } },
    }, 4300)
    expect(feed.reasoning).toBeUndefined()

    feed = foldOpLiveFrame(feed, {
      type: 'assistant-stream',
      frame: {
        type: 'chunk',
        attemptId: 'a3',
        revision: 1,
        index: 0,
        chunk: { type: 'reasoning-delta', index: 0, text: '新一轮思考' },
      },
    }, 4400)
    expect(feed.reasoning).toBe('新一轮思考')

    feed = foldOpLiveFrame(feed, { type: 'snapshot', cursor: 4, records: [] }, 4500)
    expect(feed.reasoning).toBeUndefined()
  })

  it('toolDetailOf 不透传原始 JSON，且从 questions 提取 header；tool/result 清洗 JSON 摘要', () => {
    let feed = emptyOpLiveFeed(5000)
    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 1,
        time: 5100,
        data: {
          name: 'ask_user_question',
          arguments: JSON.stringify({ questions: [{ id: 'q1', header: '确认部署环境' }] }),
        },
      },
    }, 5100)
    expect(feed.toolDetail).toBe('确认部署环境')

    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 2,
        time: 5200,
        data: { name: 'ask_user_question', arguments: '{"questions":[{"id":"q1"}]}' },
      },
    }, 5200)
    expect(feed.toolDetail).toBeUndefined()

    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: {
        type: 'tool/call',
        seq: 3,
        time: 5300,
        data: { name: 'custom_tool', arguments: '{"foo":"bar","nested":[1,2]}' },
      },
    }, 5300)
    expect(feed.toolDetail).toBeUndefined()

    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: {
        type: 'tool/result',
        seq: 4,
        time: 5400,
        data: { message: { content: [{ type: 'text', text: '{"message":"已保存原型"}' }] } },
      },
    }, 5400)
    expect(feed.lastToolNote).toBe('已保存原型')

    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: {
        type: 'tool/result',
        seq: 5,
        time: 5500,
        data: { message: { content: [{ type: 'text', text: '{"ok":true,"count":3}' }] } },
      },
    }, 5500)
    expect(feed.lastToolNote).toBe('已保存原型')
  })

  it('试探路径的 ENOENT 报错不污染浮卡摘要，且 step/start 清空上一步工具提示', () => {
    let feed = emptyOpLiveFeed(6000)
    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: {
        type: 'tool/result',
        seq: 1,
        time: 6100,
        data: {
          message: {
            isError: true,
            content: [{ type: 'text', text: "Error: ENOENT: no such file or directory, open 'E:\\a\\REQ-01\\requirement.yaml'" }],
          },
        },
      },
    }, 6100)
    expect(feed.lastToolNote).toBeUndefined()

    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: {
        type: 'tool/result',
        seq: 2,
        time: 6200,
        data: { message: { content: [{ type: 'text', text: '{"message":"已读取需求"}' }] } },
      },
    }, 6200)
    expect(feed.lastToolNote).toBe('已读取需求')

    feed = foldOpLiveFrame(feed, {
      type: 'event',
      event: { type: 'step/start', seq: 3, time: 6300, data: { step: 5 } },
    }, 6300)
    expect(feed.lastToolNote).toBeUndefined()
  })

  it('正文摘要自动过滤前置 Markdown 表格碎片，只保留最新核心说明段落', () => {
    const feed = foldOpLiveFrame(emptyOpLiveFeed(7000), {
      type: 'event',
      event: {
        type: 'assistant/message',
        seq: 1,
        time: 7100,
        data: {
          message: {
            content: [{
              type: 'text',
              text: [
                '| 条目 | 检查点 | 结果 |',
                '| --- | --- | --- |',
                '| 3 (低) | 空态文案 | ✓ |',
                '',
                '只剩一处需要你拍板：spec_query 查到 R-02 与 v2 口径互斥。',
              ].join('\n'),
            }],
          },
        },
      },
    }, 7100)
    expect(feed.snippet).toBe('只剩一处需要你拍板：spec_query 查到 R-02 与 v2 口径互斥。')
    expect(feed.snippet).not.toContain('空态文案')
  })
})
