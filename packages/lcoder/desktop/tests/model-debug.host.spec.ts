/** 模型调试日志：只记边界事件、请求号与状态，并脱敏密钥。 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StreamFrame } from '../src/contract.ts'
import { createModelDebugLog, modelDebugLine } from '../src/model-debug.ts'

const now = new Date('2026-11-16T05:00:00.000Z')

function eventFrame(type: string, data: unknown): StreamFrame {
  return { kind: 'item', value: { type: 'event', event: { type, seq: 1, time: 0, data } } }
}

const temporary: string[] = []

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('modelDebugLine', () => {
  it('重试事件记次数、请求号与上游状态', () => {
    const line = modelDebugLine('s1', eventFrame('llm/retry', {
      retry: 2,
      maxRetries: 5,
      failure: { message: 'bad gateway', code: 'SERVER', status: 502, requestId: 'req_abc' },
    }), now)
    expect(line).toBe('2026-11-16T05:00:00.000Z stream=s1 event=llm/retry attempt=2/5 requestId=req_abc status=502 detail=bad gateway')
  })

  it('回合失败记原因与错误文案', () => {
    const line = modelDebugLine('s1', eventFrame('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { message: 'The model upstream is unavailable.', code: 'SERVER', status: 502 } },
    }), now)
    expect(line).toContain('event=turn/end')
    expect(line).toContain('status=502')
    expect(line).toContain('detail=error The model upstream is unavailable.')
  })

  it('从 502 文案兜底提取请求号与状态', () => {
    const line = modelDebugLine('s1', eventFrame('turn/end', {
      turn: 1,
      reason: {
        kind: 'error',
        error: { message: '502: {"code":"upstream_unavailable","requestId":"req_json9"}', code: 'SERVER' },
      },
    }), now)
    expect(line).toContain('requestId=req_json9')
    expect(line).toContain('status=502')
  })

  it('正文与思考增量不落盘', () => {
    expect(modelDebugLine('s1', eventFrame('assistant/message', {}), now)).toBeNull()
    expect(modelDebugLine('s1', { kind: 'item', value: { type: 'assistant-stream' } }, now)).toBeNull()
  })

  it('脱敏密钥并截断长文案', () => {
    const line = modelDebugLine('s1', eventFrame('llm/retry', {
      retry: 1,
      maxRetries: 1,
      failure: { message: `sk-live-abcdef123456 ${'x'.repeat(400)}`, code: 'SERVER' },
    }), now)
    expect(line).not.toContain('sk-live-abcdef123456')
    expect(line).toContain('<redacted>')
    expect((line ?? '').length).toBeLessThan(400)
  })
})

describe('createModelDebugLog', () => {
  it('关闭时不写文件', () => {
    expect(createModelDebugLog(false)).toBeNull()
  })

  it('开启时逐帧追加，可读回内容', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lcoder-model-debug-'))
    temporary.push(dir)
    const file = join(dir, 'model-debug.log')
    const log = createModelDebugLog(true, file)
    expect(log).not.toBeNull()
    log?.record('s1', eventFrame('turn/start', { turn: 1 }))
    log?.record('s1', eventFrame('assistant/message', {}))
    const text = readFileSync(file, 'utf8')
    expect(text.trim().split('\n')).toHaveLength(1)
    expect(text).toContain('event=turn/start')
  })
})
