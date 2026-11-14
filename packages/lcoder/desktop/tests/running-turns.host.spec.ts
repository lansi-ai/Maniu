/** 运行中会话集合：按会话去重，结束后立刻不在计数里。 */
import { describe, expect, it } from 'vitest'
import { RunningTurns } from '../src/running-turns.ts'

describe('RunningTurns', () => {
  it('开始时计数，结束后移除', () => {
    const turns = new RunningTurns()
    expect(turns.count).toBe(0)
    turns.update('s-1', true)
    turns.update('s-2', true)
    expect(turns.count).toBe(2)
    turns.update('s-1', false)
    expect(turns.count).toBe(1)
  })

  it('同一会话重复上报只保留一个计数', () => {
    const turns = new RunningTurns()
    turns.update('s-1', true)
    turns.update('s-1', true)
    expect(turns.count).toBe(1)
  })

  it('未开始过的会话收到结束事件不会变成负数', () => {
    const turns = new RunningTurns()
    turns.update('s-9', false)
    expect(turns.count).toBe(0)
  })
})
