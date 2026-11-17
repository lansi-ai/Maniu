/** summaryOf：宿主投影线形与旧顶层线形的 preset 读取。 */
import { describe, expect, it } from 'vitest'
import { summaryOf } from '../src/store.ts'

function row(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 'session-1',
    updatedAt: 1,
    running: false,
    blank: false,
    cwd: 'E:/repo',
    ...extra,
  }
}

function sequenced(agentPreset: unknown): Record<string, unknown> {
  return { projections: { kind: 'sequenced', asOfSeq: 3, values: { agentPreset } } }
}

describe('summaryOf agentPreset', () => {
  it('优先读宿主 projections.values.agentPreset', () => {
    const summary = summaryOf(row(sequenced('maniu-pm')))
    expect(summary?.agentPreset).toBe('maniu-pm')
    expect(summary?.cwd).toBe('E:/repo')
  })

  it('宿主值不是字符串时回退顶层 agentPreset', () => {
    const summary = summaryOf(row({ ...sequenced(7), agentPreset: 'maniu-architect' }))
    expect(summary?.agentPreset).toBe('maniu-architect')
  })

  it('旧载荷只有顶层 agentPreset 时仍能读出', () => {
    const summary = summaryOf(row({ agentPreset: 'lcoder' }))
    expect(summary?.agentPreset).toBe('lcoder')
  })

  it('projections 缺少 values 时回退顶层', () => {
    const summary = summaryOf(row({ projections: { kind: 'cached', asOfSeq: 2 }, agentPreset: 'maniu-manager' }))
    expect(summary?.agentPreset).toBe('maniu-manager')
  })

  it('两种线形都没有有效 preset 时为空', () => {
    expect(summaryOf(row(sequenced(undefined)))?.agentPreset).toBeUndefined()
    expect(summaryOf(row(sequenced(7)))?.agentPreset).toBeUndefined()
    expect(summaryOf(row({ projections: { values: {} } }))?.agentPreset).toBeUndefined()
    expect(summaryOf(row({ agentPreset: 42 }))?.agentPreset).toBeUndefined()
  })
})
