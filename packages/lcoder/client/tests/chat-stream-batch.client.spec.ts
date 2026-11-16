/** 流式帧合并：首帧立即提交、后续增量合批，重开会话丢弃排队。 */
import { describe, expect, it, vi } from 'vitest'
import { createFrameBatcher } from '../src/chat/stream-batch.ts'

describe('createFrameBatcher', () => {
  it('空闲后的首帧立即提交，其余增量合并成一次提交', () => {
    vi.useFakeTimers()
    try {
      const batches: number[][] = []
      const batcher = createFrameBatcher<number>((actions) => { batches.push([...actions]) }, 60)
      for (let index = 0; index < 50; index += 1) batcher.push(index)
      expect(batches).toEqual([[0]])
      vi.advanceTimersByTime(59)
      expect(batches).toHaveLength(1)
      vi.advanceTimersByTime(1)
      expect(batches).toHaveLength(2)
      expect(batches[1]).toHaveLength(49)
      expect(batches[1]?.[0]).toBe(1)
      expect(batches[1]?.[48]).toBe(49)
      batcher.push(50)
      expect(batches).toHaveLength(3)
      expect(batches[2]).toEqual([50])
      vi.advanceTimersByTime(60)
    } finally {
      vi.useRealTimers()
    }
  })

  it('一阵增量的提交次数远少于帧数，且顺序不变', () => {
    vi.useFakeTimers()
    try {
      const batches: number[][] = []
      const batcher = createFrameBatcher<number>((actions) => { batches.push([...actions]) }, 60)
      for (let tick = 0; tick < 200; tick += 1) {
        batcher.push(tick)
        vi.advanceTimersByTime(2)
      }
      vi.advanceTimersByTime(80)
      // 200 帧、400ms：提交次数比帧数少一个量级。
      expect(batches.length).toBeLessThanOrEqual(20)
      expect(batches.flat()).toEqual([...Array.from({ length: 200 }, (_, index) => index)])
    } finally {
      vi.useRealTimers()
    }
  })

  it('flush 立即提交，dispose 丢弃排队且不再提交', () => {
    vi.useFakeTimers()
    try {
      const batches: string[][] = []
      const batcher = createFrameBatcher<string>((actions) => { batches.push([...actions]) }, 60)
      batcher.push('a')
      expect(batches).toEqual([['a']])
      batcher.push('b')
      batcher.push('c')
      batcher.flush()
      expect(batches).toEqual([['a'], ['b', 'c']])
      batcher.push('d')
      batcher.push('e')
      batcher.dispose()
      vi.advanceTimersByTime(600)
      expect(batches).toEqual([['a'], ['b', 'c'], ['d']])
    } finally {
      vi.useRealTimers()
    }
  })
})
