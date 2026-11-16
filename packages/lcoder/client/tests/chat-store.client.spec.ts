/** store 的折叠：三帧、补洞、过程组、结果摘要与标题。 */
import { describe, expect, it } from 'vitest'
import { actionOfFrame, chatReducer, emptyChat, type HistoryRecord } from '../src/store.ts'

function record(type: string, seq: number, data: unknown): HistoryRecord {
  return { type: 'event', event: { type, seq, time: seq, data } }
}

function snapshot(records: readonly HistoryRecord[], cursor: number, extra: {
  readonly projections?: unknown
  readonly assistantStream?: unknown
} = {}): ReturnType<typeof chatReducer> {
  return chatReducer(emptyChat, {
    type: 'snapshot',
    records,
    cursor,
    baseline: extra.assistantStream,
    projections: extra.projections,
  })
}

const user = record('user/message', 1, { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] })
const toolCall = record('assistant/message', 2, {
  turn: 1,
  step: 1,
  message: {
    content: [
      { type: 'reasoning', text: '先读文件' },
      { type: 'tool-call', id: 'c1', name: 'file_read', arguments: '{"path":"a.ts"}' },
    ],
  },
})
const toolResult = record('tool/result', 3, {
  turn: 1,
  step: 1,
  message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'export const a = 1' }] },
})
const finalText = record('assistant/message', 4, {
  turn: 1,
  step: 2,
  message: { content: [{ type: 'text', text: '读完了' }] },
})

describe('chatReducer snapshot', () => {
  it('把用户发言、过程组与正文按回合分开', () => {
    const state = snapshot([user, toolCall, toolResult, finalText], 4)
    expect(state.rows.map(row => row.kind)).toEqual(['user', 'process', 'assistant'])
    const process = state.rows[1]
    expect(process?.kind === 'process' ? process.items.map(item => item.kind) : []).toEqual(['reasoning', 'tool'])
    expect(state.toolResults.c1).toEqual({ ok: true, summary: 'export const a = 1' })
    expect(state.cursor).toBe(4)
    expect(state.nextSeq).toBe(5)
  })

  it('读标题与投影水位', () => {
    const state = snapshot(
      [record('session/title', 5, { title: '仓库结构', source: { kind: 'user' }, messageSeqs: [] })],
      5,
      { projections: { asOfSeq: 5, values: { contextPressure: { projectedTokens: 12 } } } },
    )
    expect(state.title).toBe('仓库结构')
    expect(state.projectionSeq).toBe(5)
    expect(state.projections.contextPressure).toEqual({ projectedTokens: 12 })
  })

  it('展开重连基线里的流式正文与下一个块序号', () => {
    const state = snapshot([], 9, {
      assistantStream: {
        revision: 3,
        activeAttempt: { attemptId: 'a1', revision: 3, nextIndex: 2, stream: [{ type: 'text-chunks', texts: ['你', '好'] }] },
      },
    })
    expect(state.liveText).toBe('你好')
    expect(state.attempt?.nextIndex).toBe(2)
  })
})

describe('chatReducer event', () => {
  it('seq 出现缺口时要求重开快照，而不是把缺口画成完整历史', () => {
    const state = snapshot([], 4)
    const next = chatReducer(state, { type: 'event', record: record('user/message', 6, { source: { kind: 'user' }, content: [] }) })
    expect(next.rebaseline).toBe(1)
    expect(next.rows).toEqual([])
  })

  it('重复送达的事件被忽略', () => {
    const state = snapshot([user], 4)
    const next = chatReducer(state, { type: 'event', record: user })
    expect(next).toBe(state)
  })

  it('表面替换要求重开快照', () => {
    const state = snapshot([], 0)
    const replacement = record('assistant/message', 1, { turn: 1, step: 1, message: { content: [] } })
    const withOp: HistoryRecord = {
      ...replacement,
      event: { ...replacement.event, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } },
    }
    expect(chatReducer(state, { type: 'event', record: withOp }).rebaseline).toBe(1)
  })
})

describe('chatReducer assistant-stream', () => {
  it('start/chunk/end 落定后清掉流式草稿并留下正文', () => {
    let state = snapshot([], 0)
    state = chatReducer(state, { type: 'assistant-start', attemptId: 'a1', revision: 1 })
    state = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 0, chunk: { type: 'text-delta', text: '你' } })
    state = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 1, chunk: { type: 'text-delta', text: '好' } })
    expect(state.liveText).toBe('你好')
    state = chatReducer(state, { type: 'assistant-end', attemptId: 'a1', revision: 1, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 1 } })
    state = chatReducer(state, { type: 'event', record: record('assistant/message', 1, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '你好' }] } }) })
    expect(state.liveText).toBe('')
    expect(state.attempt).toBeNull()
    expect(state.rows).toEqual([{ kind: 'assistant', id: 'a-1', text: '你好' }])
  })

  it('块序号不对时要求重开快照', () => {
    let state = snapshot([], 0)
    state = chatReducer(state, { type: 'assistant-start', attemptId: 'a1', revision: 1 })
    const next = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 3, chunk: { type: 'text-delta', text: 'x' } })
    expect(next.rebaseline).toBe(1)
  })

  it('思考增量进入实时缓冲，正文一开始就清掉', () => {
    let state = snapshot([], 0)
    state = chatReducer(state, { type: 'assistant-start', attemptId: 'a1', revision: 1 })
    state = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 0, chunk: { type: 'reasoning-delta', index: 0, text: '先读' } })
    state = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 1, chunk: { type: 'reasoning-delta', index: 0, text: '文件' } })
    expect(state.liveReasoning).toBe('先读文件')
    expect(state.liveText).toBe('')
    expect(state.attempt).not.toBeNull()
    state = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 2, chunk: { type: 'text-delta', index: 1, text: '结论' } })
    expect(state.liveText).toBe('结论')
    expect(state.liveReasoning).toBe('')
  })

  it('思考增量不打断块序号，也不把正文当思考', () => {
    let state = snapshot([], 0)
    state = chatReducer(state, { type: 'assistant-start', attemptId: 'a1', revision: 1 })
    state = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 0, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } })
    state = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 1, chunk: { type: 'reasoning-delta', index: 0, text: '思考' } })
    expect(state.rebaseline).toBe(0)
    expect(state.liveReasoning).toBe('思考')
    expect(state.attempt?.nextIndex).toBe(2)
  })

  it('回合结束清掉实时思考，重连基线只认思考增量', () => {
    let state = snapshot([], 0)
    state = chatReducer(state, { type: 'assistant-start', attemptId: 'a1', revision: 1 })
    state = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 0, chunk: { type: 'reasoning-delta', index: 0, text: '想想' } })
    const ended = chatReducer(state, {
      type: 'assistant-end',
      attemptId: 'a1',
      revision: 1,
      outcome: { kind: 'abandoned' },
    })
    expect(ended.liveReasoning).toBe('')

    const reconnected = snapshot([], 0, {
      assistantStream: {
        revision: 2,
        activeAttempt: {
          attemptId: 'a2',
          revision: 2,
          nextIndex: 1,
          stream: [{ type: 'reasoning-chunks', time0: 1, index: 0, dt: [], texts: ['想', '想'] }],
        },
      },
    })
    expect(reconnected.liveReasoning).toBe('想想')
    expect(reconnected.liveText).toBe('')
  })

  it('传输错误保留已提交正文与流式草稿', () => {
    let state = snapshot([user], 1)
    state = chatReducer(state, { type: 'assistant-start', attemptId: 'a1', revision: 1 })
    state = chatReducer(state, { type: 'assistant-chunk', attemptId: 'a1', revision: 1, index: 0, chunk: { type: 'text-delta', text: '半句' } })
    const errored = chatReducer(state, { type: 'stream-error', message: 'transport-closed' })
    expect(errored.rows).toEqual(state.rows)
    expect(errored.liveText).toBe('半句')
    expect(errored.streamError).toBe('transport-closed')
    expect(errored.attempt).toBeNull()
  })
})

describe('模型失败可见', () => {
  const retry = record('llm/retry', 2, {
    retryId: 'r1',
    turn: 1,
    step: 1,
    provider: 'deepseek',
    mode: 'normal',
    policyKey: 'default',
    retry: 2,
    maxRetries: 5,
    delayMs: 1_000,
    failure: { message: 'bad gateway', code: 'SERVER', status: 502 },
  })

  it('重试事件给出第几次与上限，正文到达后清除', () => {
    let state = snapshot([user], 1)
    expect(state.retry).toBeNull()
    state = chatReducer(state, { type: 'event', record: retry })
    expect(state.retry).toEqual({ attempt: 2, max: 5 })
    state = chatReducer(state, {
      type: 'event',
      record: record('assistant/message', 3, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '好了' }] } }),
    })
    expect(state.retry).toBeNull()
  })

  it('无限重试不带上限', () => {
    const state = chatReducer(snapshot([user], 1), {
      type: 'event',
      record: record('llm/retry', 2, {
        retryId: 'r2', turn: 1, step: 1, provider: 'deepseek', mode: 'always',
        policyKey: 'default', retry: 3, delayMs: 1_000, failure: { message: 'bad', code: 'SERVER' },
      }),
    })
    expect(state.retry).toEqual({ attempt: 3, max: null })
  })

  it('回合最终失败给出文案与请求号，新回合开始时清除', () => {
    let state = snapshot([user], 1)
    state = chatReducer(state, { type: 'event', record: retry })
    state = chatReducer(state, {
      type: 'event',
      record: record('turn/end', 3, {
        turn: 1,
        reason: {
          kind: 'error',
          error: { message: 'The model upstream is unavailable.', code: 'SERVER', status: 502, requestId: 'req_abc123' },
        },
      }),
    })
    expect(state.retry).toBeNull()
    expect(state.failure).toEqual({
      message: 'The model upstream is unavailable.',
      code: 'SERVER',
      requestId: 'req_abc123',
    })
    state = chatReducer(state, { type: 'event', record: record('turn/start', 4, { turn: 2 }) })
    expect(state.failure).toBeNull()
  })

  it('请求号也能从 502 JSON 文案里提取', () => {
    const state = chatReducer(snapshot([user], 1), {
      type: 'event',
      record: record('turn/end', 2, {
        turn: 1,
        reason: {
          kind: 'error',
          error: { message: 'bad gateway {"error":{"message":"upstream","requestId":"req_json9"}}', code: 'SERVER' },
        },
      }),
    })
    expect(state.failure?.requestId).toBe('req_json9')
    expect(state.failure?.message).toContain('bad gateway')
  })

  it('云端错误体文案收成简短错误，请求号单独保留', () => {
    const state = chatReducer(snapshot([user], 1), {
      type: 'event',
      record: record('turn/end', 2, {
        turn: 1,
        reason: {
          kind: 'error',
          error: {
            message: '502: {"code":"upstream_unavailable","message":"The model upstream is unavailable.","type":"upstream_error","requestId":"req_abc123","param":null,"details":null}',
            code: 'SERVER',
          },
        },
      }),
    })
    expect(state.failure).toEqual({
      message: 'The model upstream is unavailable.',
      code: 'upstream_unavailable',
      requestId: 'req_abc123',
    })
  })

  it('快照折叠能恢复等待中的重试提示', () => {
    const state = snapshot([user, retry], 2)
    expect(state.retry).toEqual({ attempt: 2, max: 5 })
  })
})

describe('actionOfFrame', () => {
  it('把三帧转成折叠动作', () => {
    expect(actionOfFrame({ type: 'snapshot', records: [], cursor: 2, projections: { asOfSeq: 2, values: {} } }))
      .toMatchObject({ type: 'snapshot', cursor: 2 })
    expect(actionOfFrame({ type: 'event', event: { type: 'turn/end', seq: 3, time: 0, data: {} } }))
      .toMatchObject({ type: 'event' })
    expect(actionOfFrame({
      type: 'assistant-stream',
      frame: { type: 'start', attemptId: 'a', revision: 1, startedAfterSeq: 2, turn: 1, step: 1 },
    })).toEqual({ type: 'assistant-start', attemptId: 'a', revision: 1 })
  })

  it('无法识别的帧不产生动作', () => {
    expect(actionOfFrame({ type: 'unknown' })).toBeUndefined()
    expect(actionOfFrame('nope')).toBeUndefined()
  })
})
