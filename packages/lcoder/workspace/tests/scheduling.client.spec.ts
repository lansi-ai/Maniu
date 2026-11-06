/**
 * 调度判定的纯函数测：硬闸先于打分，候选与理由都要留下来给人看。
 */
import { describe, expect, it } from 'vitest'

import { decideScheduling } from '../src/client/scheduling.ts'
import type { SchedulingSession, SchedulingTask } from '../src/client/scheduling.ts'

const TASK: SchedulingTask = {
  id: 'T-02',
  state: 'drafting',
  dependsOn: [],
  proposal: 'P-01',
  modules: ['order'],
  paths: ['src/order'],
}

function session(overrides: Partial<SchedulingSession> = {}): SchedulingSession {
  return {
    sessionId: 'session-a',
    role: 'dev',
    running: false,
    awaitingInteraction: false,
    pending: 0,
    claims: [{ id: 'T-01', state: 'implementing', proposal: 'P-01', modules: ['order'], paths: ['src/order'] }],
    ...overrides,
  }
}

describe('调度判定', () => {
  it('依赖没完成就按住，且不进入会话比较', () => {
    const decision = decideScheduling({ ...TASK, dependsOn: ['T-00'] }, [session()], { 'T-00': 'implementing' })

    expect(decision.verdict).toBe('wait')
    expect(decision.blockedBy).toEqual(['T-00'])
    expect(decision.candidates).toEqual([])
    expect(decision.reasons[0]).toContain('前置未完成')
  })

  it('同方案且有模块交集时复用空闲会话', () => {
    const decision = decideScheduling(TASK, [session()], { 'T-01': 'implementing' })

    expect(decision.verdict).toBe('reuse')
    expect(decision.chosen).toBe('session-a')
    expect(decision.candidates[0]?.signals).toEqual(expect.arrayContaining(['同一方案 P-01', '同一规格模块 order']))
    expect(decision.candidates[0]?.score).toBe(6)
  })

  it('匹配的会话在跑就排队，不新开', () => {
    const decision = decideScheduling(TASK, [session({ running: true })], { 'T-01': 'implementing' })

    expect(decision.verdict).toBe('enqueue')
    expect(decision.chosen).toBe('session-a')
  })

  it('正在等人回答的会话被否，并说清原因', () => {
    const decision = decideScheduling(TASK, [session({ awaitingInteraction: true })], { 'T-01': 'implementing' })

    expect(decision.verdict).toBe('new')
    expect(decision.candidates[0]?.rejected).toContain('正在等人回答')
  })

  it('角色不匹配的会话不复用', () => {
    const decision = decideScheduling({ ...TASK, role: 'review' }, [session({ role: 'dev' })], { 'T-01': 'implementing' })

    expect(decision.verdict).toBe('new')
    expect(decision.candidates[0]?.rejected).toContain('角色不匹配')
  })

  it('没有关联信号就新开，理由写明', () => {
    const stranger = session({ claims: [{ id: 'T-09', state: 'closed', modules: ['salary'], paths: ['src/salary'] }] })
    const decision = decideScheduling(TASK, [stranger], { 'T-09': 'closed' })

    expect(decision.verdict).toBe('new')
    expect(decision.reasons.join('')).toContain('没有可复用的会话')
  })

  it('两条同分候选挑一个，但标记需要上层再取舍', () => {
    const decision = decideScheduling(TASK, [session(), session({ sessionId: 'session-b' })], { 'T-01': 'implementing' })

    expect(decision.verdict).toBe('reuse')
    expect(decision.needsChoice).toBe(true)
    expect(decision.candidates.filter(candidate => candidate.rejected === undefined)).toHaveLength(2)
  })

  it('落点按前缀判重叠：src/ 与 src/order/a.ts 算命中', () => {
    const overlap = session({ claims: [{ id: 'T-03', state: 'idle', modules: [], paths: ['src/order/a.ts'] }] })
    const decision = decideScheduling({ id: TASK.id, state: TASK.state, dependsOn: [], modules: [], paths: TASK.paths }, [overlap], { 'T-03': 'idle' })

    expect(decision.candidates[0]?.signals).toContain('改动落点重叠')
    expect(decision.verdict).toBe('reuse')
  })
})
