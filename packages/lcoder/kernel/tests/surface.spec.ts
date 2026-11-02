import { describe, expect, it, vi } from 'vitest'

import { SURFACE, SurfaceSwitcher, allToolNames, checkSurface } from '../src/kernel/surface.js'
import type { TaskState } from '../src/schema/spec.js'

const STATES: TaskState[] = ['drafting', 'contracted', 'implementing', 'verifying', 'closed']

function makeGate() {
  const lifts: Array<ReturnType<typeof vi.fn>> = []
  const restrict = vi.fn(() => {
    const lift = vi.fn()
    lifts.push(lift)
    return lift
  })
  return { gate: { restrict }, restrict, lifts }
}

describe('工具面', () => {
  it('起草态没有写代码与跑命令的能力', () => {
    const t = SURFACE.drafting
    expect(t).toContain('contract_draft')
    expect(t).not.toContain('file_edit')
    expect(t).not.toContain('cmd_run')
    expect(t).not.toContain('task_close')
  })

  it('签约后解锁编辑与命令，但还不能收口', () => {
    expect(SURFACE.contracted).toContain('file_edit')
    expect(SURFACE.contracted).toContain('cmd_run')
    expect(SURFACE.contracted).not.toContain('task_close')
  })

  it('验证态才多出收口', () => {
    expect(SURFACE.verifying).toContain('task_close')
  })

  it('终态只读', () => {
    expect(SURFACE.closed).toEqual(['file_read', 'spec_query', 'task_read'])
    expect(SURFACE.closed).not.toContain('file_edit')
    expect(SURFACE.closed).not.toContain('task_close')
  })

  it('能力只增不减：每往后一个状态都包含前一个的全部工具', () => {
    const chain: TaskState[] = ['drafting', 'contracted', 'implementing', 'verifying']
    for (let i = 1; i < chain.length; i++) {
      const prev = new Set(SURFACE[chain[i - 1]!])
      const cur = SURFACE[chain[i]!]
      for (const tool of prev) expect(cur).toContain(tool)
    }
  })
})

describe('SurfaceSwitcher', () => {
  it('切状态时先解除旧掩码，再挂新掩码', () => {
    const { gate, restrict, lifts } = makeGate()
    const sw = new SurfaceSwitcher(gate)

    sw.apply('drafting')
    expect(restrict).toHaveBeenCalledTimes(1)
    expect(restrict).toHaveBeenLastCalledWith({ allow: SURFACE.drafting })

    sw.apply('contracted')
    expect(restrict).toHaveBeenCalledTimes(2)
    expect(lifts[0]).toHaveBeenCalledTimes(1)
    expect(sw.current).toBe('contracted')
  })

  it('同状态重复 apply 是空操作（换掩码要付缓存代价）', () => {
    const { gate, restrict } = makeGate()
    const sw = new SurfaceSwitcher(gate)

    sw.apply('implementing')
    sw.apply('implementing')
    sw.apply('implementing')

    expect(restrict).toHaveBeenCalledTimes(1)
  })

  it('dispose 解除当前掩码，之后不能再切', () => {
    const { gate, lifts } = makeGate()
    const sw = new SurfaceSwitcher(gate)

    sw.apply('verifying')
    sw.dispose()

    expect(lifts[0]).toHaveBeenCalledTimes(1)
    expect(() => sw.apply('closed')).toThrow(/已销毁/)
  })

  it('没挂过掩码时 dispose 不炸', () => {
    const { gate } = makeGate()
    expect(() => new SurfaceSwitcher(gate).dispose()).not.toThrow()
  })
})

describe('掩码自检', () => {
  it('清单齐全时无告警', () => {
    const check = checkSurface(allToolNames())
    expect(check).toEqual({ missing: [], orphan: [] })
  })

  it('掩码里写了但没注册 → missing；注册了但哪都看不到 → orphan', () => {
    const registered = allToolNames().filter(n => n !== 'file_edit').concat('debug_dump')
    const check = checkSurface(registered)
    expect(check.missing).toEqual(['file_edit'])
    expect(check.orphan).toEqual(['debug_dump'])
  })

  it('每个状态至少提供一个工具（空掩码会被 DSH 拒绝）', () => {
    for (const s of STATES) expect(SURFACE[s].length).toBeGreaterThan(0)
  })
})
