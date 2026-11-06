/**
 * 调度判定的纯函数测：硬闸先于打分，候选与理由都要留下来给人看。
 */
import { describe, expect, it } from 'vitest'

import { decideScheduling, sameWorkspace } from '../src/client/scheduling.ts'
import type { SchedulingSession, SchedulingTask } from '../src/client/scheduling.ts'

const REPO = 'E:/Projects/demo'

const TASK: SchedulingTask = {
  id: 'T-02',
  state: 'drafting',
  dependsOn: [],
  proposal: 'P-01',
  modules: ['order'],
  paths: ['src/order'],
  repoPath: REPO,
}

function session(overrides: Partial<SchedulingSession> = {}): SchedulingSession {
  return {
    sessionId: 'session-a',
    role: 'dev',
    running: false,
    awaitingInteraction: false,
    pending: 0,
    workspacePath: REPO,
    claims: [{ id: 'T-01', state: 'implementing', proposal: 'P-01', modules: ['order'], paths: ['src/order'], dependsOn: [] }],
    groupTasks: [],
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
    expect(decision.candidates[0]?.signals).toEqual(expect.arrayContaining([
      '同一 worktree', '同一方案 P-01', '同一规格模块 order',
    ]))
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
    const stranger = session({ claims: [{ id: 'T-09', state: 'closed', modules: ['salary'], paths: ['src/salary'], dependsOn: [] }] })
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
    const overlap = session({ claims: [{ id: 'T-03', state: 'idle', modules: [], paths: ['src/order/a.ts'], dependsOn: [] }] })
    const decision = decideScheduling(
      { id: TASK.id, state: TASK.state, dependsOn: [], modules: [], paths: TASK.paths, repoPath: REPO },
      [overlap],
      { 'T-03': 'idle' },
    )

    expect(decision.candidates[0]?.signals).toContain('改动落点重叠')
    expect(decision.verdict).toBe('reuse')
  })

  it('同一 worktree 的关联会话出现在命中信号里', () => {
    const decision = decideScheduling(TASK, [session()], { 'T-01': 'implementing' })

    expect(decision.candidates[0]?.signals).toContain('同一 worktree')
    expect(decision.candidates[0]?.rejected).toBeUndefined()
  })

  it('别的 worktree 的会话一律被否，关联再像也不复用', () => {
    const elsewhere = session({ workspacePath: 'E:/Projects/demo-other' })
    const decision = decideScheduling(TASK, [elsewhere], { 'T-01': 'implementing' })

    expect(decision.verdict).toBe('new')
    expect(decision.candidates[0]?.rejected).toContain('worktree 不同')
    expect(decision.candidates[0]?.signals).not.toContain('同一 worktree')
  })

  it('工作区路径读不到时按不同处理，不猜同一条线', () => {
    expect(sameWorkspace('', REPO)).toBe(false)
    expect(sameWorkspace(REPO, '')).toBe(false)
  })

  it('worktree 比较忽略盘符大小写与斜杠方向', () => {
    expect(sameWorkspace('e:\\projects\\DEMO\\', 'E:/Projects/demo')).toBe(true)
    expect(sameWorkspace('E:/Projects/demo', 'E:/Projects/demo2')).toBe(false)
  })

  it('会话里已有收口任务就不再入队，空闲时仍可复用', () => {
    const claim = { id: 'T-01', state: 'closed', proposal: 'P-01', modules: ['order'], paths: ['src/order'], dependsOn: [] }
    const busy = decideScheduling(TASK, [session({ claims: [claim], running: true })], { 'T-01': 'closed' })

    expect(busy.verdict).toBe('new')
    expect(busy.candidates[0]?.rejected).toContain('已收口')
    expect(decideScheduling(TASK, [session({ claims: [claim] })], { 'T-01': 'closed' }).verdict).toBe('reuse')
  })

  it('本任务已认领的会话即使在跑也只切回，不再入队', () => {
    const own = { id: TASK.id, state: 'implementing', proposal: 'P-01', modules: ['order'], paths: ['src/order'], dependsOn: [] }
    const decision = decideScheduling(TASK, [session({ claims: [own], running: true })], { [TASK.id]: 'implementing' })

    expect(decision.verdict).toBe('reuse')
    expect(decision.chosen).toBe('session-a')
    expect(decision.candidates[0]?.signals).toContain('本任务已认领')
    expect(decision.candidates[0]?.score).toBe(10)
  })

  it('本任务已认领的会话正在等审批也不再被否，点开始只是切回去', () => {
    const own = { id: TASK.id, state: 'implementing', proposal: 'P-01', modules: ['order'], paths: ['src/order'], dependsOn: [] }
    const decision = decideScheduling(TASK, [session({ claims: [own], awaitingInteraction: true })], { [TASK.id]: 'implementing' })

    expect(decision.verdict).toBe('reuse')
    expect(decision.candidates[0]?.rejected).toBeUndefined()
  })

  it('两条任务之间还有未完成依赖时不能并入同一组', () => {
    const claim = {
      id: 'T-03', state: 'implementing', proposal: 'P-01', modules: ['order'], paths: ['src/order'], dependsOn: ['T-02'],
    }
    const decision = decideScheduling(TASK, [session({ claims: [claim], running: true })], { 'T-03': 'implementing' })

    expect(decision.verdict).toBe('new')
    expect(decision.candidates[0]?.rejected).toContain('未完成依赖')
  })

  it('联调组里的任务也参与依赖与收口准入', () => {
    const grouped = { id: 'T-09', state: 'implementing', dependsOn: ['T-02'] }
    const serial = decideScheduling(TASK, [session({ groupTasks: [grouped], running: true })], { 'T-09': 'implementing' })

    expect(serial.verdict).toBe('new')
    expect(serial.candidates[0]?.rejected).toContain('未完成依赖')

    const closedInGroup = decideScheduling(
      TASK,
      [session({ groupTasks: [{ id: 'T-08', state: 'closed', dependsOn: [] }], running: true })],
      { 'T-08': 'closed' },
    )
    expect(closedInGroup.verdict).toBe('new')
    expect(closedInGroup.candidates[0]?.rejected).toContain('已收口')
  })

  it('三道准入都满足时判入队，并给出联调组成员', () => {
    const decision = decideScheduling(TASK, [session({ running: true })], { 'T-01': 'implementing' })

    expect(decision.verdict).toBe('enqueue')
    expect(decision.joint?.members).toEqual(['T-01'])
  })

  it('已经并进联调组但没写 session 时判复用，不重复入队', () => {
    const decision = decideScheduling(
      TASK,
      [session({ running: true, claims: [], groupTasks: [{ id: TASK.id, state: 'drafting', dependsOn: [] }] })],
      { [TASK.id]: 'drafting' },
    )

    expect(decision.verdict).toBe('reuse')
    expect(decision.candidates[0]?.signals).toContain('已在本会话联调组')
    expect(decision.joint).toBeUndefined()
  })
})
