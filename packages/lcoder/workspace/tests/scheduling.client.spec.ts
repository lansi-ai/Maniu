/**
 * 调度判定的纯函数测：硬闸先于打分，候选与理由都要留下来给人看。
 */
import { describe, expect, it } from 'vitest'

import { builtinRoleOfPreset, decideScheduling, effectiveSessionRole, sameWorkspace } from '../src/client/scheduling.ts'
import type { SchedulingRole, SchedulingSession, SchedulingTask } from '../src/client/scheduling.ts'

const REPO = 'E:/Projects/demo'

/** 项目岗位名册：两个实施岗位与一个评审岗位。 */
const ROLES: readonly SchedulingRole[] = [
  { id: 'dotnet-engineer', name: '.NET 工程师', inherits: 'dev' },
  { id: 'vue-engineer', name: 'Vue 工程师', inherits: 'dev' },
  { id: 'api-architect', name: '接口架构师', inherits: 'review' },
]

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

  it('任务分配了岗位而会话角色不同：否决复用，理由里带任务要求的岗位名', () => {
    const decision = decideScheduling({ ...TASK, role: 'vue-engineer' }, [session({ role: 'review' })], { 'T-01': 'implementing' }, ROLES)

    expect(decision.verdict).toBe('new')
    expect(decision.candidates[0]?.rejected).toContain('Vue 工程师')
    expect(decision.candidates[0]?.rejected).toContain('review')
    expect(decision.candidates[0]?.rejected).toContain('岗位不匹配')
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

/**
 * 用户 2026-11-08 拍板的语义：严格岗位，允许实施兜底。
 * 任务岗位为 R、会话有效岗位为 S，两侧先归一成（岗位 id，继承的内置角色）。
 */
describe('岗位硬闸：严格岗位 + 实施兜底', () => {
  const JOB_TASK: SchedulingTask = { ...TASK, role: 'dotnet-engineer' }

  it('R 与 S 是同一个名册岗位：允许复用', () => {
    const decision = decideScheduling(
      JOB_TASK,
      [session({ role: 'dotnet-engineer' })],
      { 'T-01': 'implementing' },
      ROLES,
    )

    expect(decision.verdict).toBe('reuse')
    expect(decision.chosen).toBe('session-a')
    expect(decision.candidates[0]?.rejected).toBeUndefined()
  })

  it('R 与 S 是两个不同名册岗位：否决，理由带两侧岗位名', () => {
    const decision = decideScheduling(
      JOB_TASK,
      [session({ role: 'vue-engineer' })],
      { 'T-01': 'implementing' },
      ROLES,
    )

    expect(decision.verdict).toBe('new')
    expect(decision.candidates[0]?.rejected).toContain('.NET 工程师')
    expect(decision.candidates[0]?.rejected).toContain('Vue 工程师')
  })

  it('R 是名册岗位、S 是内置 dev：按实施兜底允许复用', () => {
    const decision = decideScheduling(
      JOB_TASK,
      [session({ role: 'dev' })],
      { 'T-01': 'implementing' },
      ROLES,
    )

    expect(decision.verdict).toBe('reuse')
    expect(decision.candidates[0]?.rejected).toBeUndefined()
  })

  it('R 是名册岗位、S 是内置 review：不是实施，否决', () => {
    const decision = decideScheduling(
      JOB_TASK,
      [session({ role: 'review' })],
      { 'T-01': 'implementing' },
      ROLES,
    )

    expect(decision.verdict).toBe('new')
    expect(decision.candidates[0]?.rejected).toContain('.NET 工程师')
    expect(decision.candidates[0]?.rejected).toContain('review')
    expect(decision.candidates[0]?.rejected).toContain('兜底')
  })

  it('两侧都缺岗位信息时闸不生效，不误拦存量会话', () => {
    const decision = decideScheduling(
      { ...TASK },
      [session({ role: '' })],
      { 'T-01': 'implementing' },
      ROLES,
    )

    expect(decision.verdict).toBe('reuse')
    expect(decision.candidates[0]?.rejected).toBeUndefined()
  })
})

describe('会话有效岗位的推导', () => {
  it('认领任务优先于建会话时的选择与 preset，后者依次兜底', () => {
    expect(effectiveSessionRole({ claimed: ['dotnet-engineer'], chosen: 'maniu-review', preset: 'maniu-review' }))
      .toBe('dotnet-engineer')
    expect(effectiveSessionRole({ claimed: [undefined], chosen: 'vue-engineer', preset: 'maniu-review' }))
      .toBe('vue-engineer')
    expect(effectiveSessionRole({ claimed: [], chosen: undefined, preset: 'maniu-manager' }))
      .toBe('maniu-manager')
    expect(effectiveSessionRole({ claimed: [], chosen: undefined, preset: undefined })).toBeUndefined()
  })

  it('认领任务岗位不一致时整组忽略，不把会话归给任何一条', () => {
    expect(effectiveSessionRole({
      claimed: ['dotnet-engineer', 'vue-engineer'],
      chosen: 'maniu-review',
      preset: 'maniu-review',
    })).toBe('maniu-review')
  })

  it('preset 反推：maniu 是实施，maniu-manager 是研发经理，改名前 lcoder 前缀同样认，上游 preset 不映射', () => {
    expect(builtinRoleOfPreset('maniu')).toBe('dev')
    expect(builtinRoleOfPreset('maniu-manager')).toBe('manager')
    expect(builtinRoleOfPreset('lcoder')).toBe('dev')
    expect(builtinRoleOfPreset('lcoder-review')).toBe('review')
    expect(builtinRoleOfPreset('standard')).toBeUndefined()
    expect(builtinRoleOfPreset(undefined)).toBeUndefined()
  })
})
