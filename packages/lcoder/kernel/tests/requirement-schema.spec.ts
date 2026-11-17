/**
 * 需求 schema 的行为测：形状对就放行，语义是否合规留给命令。
 *
 * 钉四件事：REQ 编号形态、四个状态枚举、候选的必填项、四个时刻都可缺省。
 */
import { describe, expect, it } from 'vitest'

import { Requirement, Task } from '../src/schema/index.js'

const VALID = {
  id: 'REQ-01',
  title: '支持自营与代发两种佣金',
  opened_at: '2026-11-13T09:00:00+08:00',
}

const TASK_BASE = {
  id: 'T-01',
  title: '佣金支持 0',
  grade: 'B' as const,
  state: 'drafting' as const,
  opened_at: '2026-11-13T09:00:00+08:00',
}

describe('需求 schema', () => {
  it('合法需求通过，状态默认 draft，候选与四个时刻可缺省', () => {
    const requirement = Requirement.parse(VALID)
    expect(requirement.state).toBe('draft')
    expect(requirement.options).toEqual([])
    expect(requirement.recommendation).toBeUndefined()
    expect(requirement.confirmed_at).toBeUndefined()
    expect(requirement.released_at).toBeUndefined()
    expect(requirement.closed_at).toBeUndefined()
  })

  it('旧 YAML 没有版本、评审与过审字段时照常解析，读侧给空数组与未定义', () => {
    const requirement = Requirement.parse(VALID)
    expect(requirement.versions).toEqual([])
    expect(requirement.reviews).toEqual([])
    expect(requirement.approved_at).toBeUndefined()
    expect(requirement.approved_version).toBeUndefined()
  })

  it('版本快照与评审轮次按形状校验，过审字段可省', () => {
    const withHistory = Requirement.parse({
      ...VALID,
      versions: [{ n: 1, at: '2026-11-13T10:00:00+08:00', note: '初稿' }, { n: 2, at: '2026-11-13T11:00:00+08:00' }],
      reviews: [{ round: 1, at: '2026-11-13T10:30:00+08:00', report: 'requirements/REQ-01/reviews/R1.md', sessionId: 'session-1' }],
      approved_at: '2026-11-13T12:00:00+08:00',
      approved_version: 2,
    })
    expect(withHistory.versions).toHaveLength(2)
    expect(withHistory.reviews[0]).toMatchObject({ round: 1, report: 'requirements/REQ-01/reviews/R1.md' })
    expect(withHistory.approved_version).toBe(2)
    expect(Requirement.safeParse({ ...VALID, versions: [{ n: 0, at: '2026-11-13T10:00:00+08:00' }] }).success).toBe(false)
    expect(Requirement.safeParse({ ...VALID, reviews: [{ round: 1, at: '昨天', report: 'x.md' }] }).success).toBe(false)
    expect(Requirement.safeParse({ ...VALID, approved_version: 0 }).success).toBe(false)
  })

  it('编号必须是 REQ- 加两位以上数字', () => {
    expect(Requirement.safeParse({ ...VALID, id: 'REQ-02' }).success).toBe(true)
    expect(Requirement.safeParse({ ...VALID, id: 'REQ-100' }).success).toBe(true)
    expect(Requirement.safeParse({ ...VALID, id: 'REQ-1' }).success).toBe(false)
    expect(Requirement.safeParse({ ...VALID, id: 'REQ01' }).success).toBe(false)
    expect(Requirement.safeParse({ ...VALID, id: 'P-01' }).success).toBe(false)
  })

  it('状态只接受 draft / confirmed / released / closed', () => {
    for (const state of ['draft', 'confirmed', 'released', 'closed'] as const) {
      expect(Requirement.safeParse({ ...VALID, state }).success).toBe(true)
    }
    expect(Requirement.safeParse({ ...VALID, state: 'approved' }).success).toBe(false)
  })

  it('候选的名字与做法必填，代价可省', () => {
    const option = { name: '加参数', summary: 'calculateCommission 增加可选第三参数' }
    expect(Requirement.parse({ ...VALID, options: [option] }).options).toEqual([option])
    expect(Requirement.parse({ ...VALID, options: [{ ...option, cost: '调用点要传参' }] }).options)
      .toEqual([{ ...option, cost: '调用点要传参' }])
    expect(Requirement.safeParse({ ...VALID, options: [{ name: '', summary: '做法' }] }).success).toBe(false)
    expect(Requirement.safeParse({ ...VALID, options: [{ name: '加参数', summary: '' }] }).success).toBe(false)
    expect(Requirement.safeParse({ ...VALID, options: [{ name: '加参数' }] }).success).toBe(false)
  })

  it('时间戳可缺省，写了就必须可解析', () => {
    expect(Requirement.safeParse({ ...VALID, confirmed_at: '2026-11-13T10:00:00+08:00' }).success).toBe(true)
    expect(Requirement.safeParse({ ...VALID, released_at: '昨天' }).success).toBe(false)
    expect(Requirement.safeParse({ ...VALID, closed_at: '' }).success).toBe(false)
    const { opened_at: _drop, ...withoutOpened } = VALID
    expect(Requirement.safeParse(withoutOpened).success).toBe(false)
  })

  it('任务可以回指需求，形态不对被拒；proposal 仍可并存', () => {
    const task = Task.parse({ ...TASK_BASE, requirement: 'REQ-01', proposal: 'P-01' })
    expect(task.requirement).toBe('REQ-01')
    expect(task.proposal).toBe('P-01')
    expect(Task.parse(TASK_BASE).requirement).toBeUndefined()
    expect(Task.safeParse({ ...TASK_BASE, requirement: 'REQ-1' }).success).toBe(false)
    expect(Task.safeParse({ ...TASK_BASE, requirement: 'P-01' }).success).toBe(false)
  })
})
