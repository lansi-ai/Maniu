/**
 * 本地建议纯函数的行为测：能力过滤先于语义、无命中显式兜底、阈值与不可逆任务转人工，
 * 以及同一输入下候选顺序固定。
 */
import { describe, expect, it } from 'vitest'

import { LOCAL_ROLE_POLICY, suggestRole } from '../src/client/role-suggest.ts'
import type {
  RoleCeiling,
  RoleSuggestionCandidate,
  SuggestRosterJob,
  SuggestRoleRequest,
  SuggestTask,
} from '../src/client/role-suggest.ts'
import type { RoleSignals } from '@maniu/kernel/src/schema/spec.ts'

/** 只保留判定需要的能力位：函数只检查 `file_edit`，其余工具名不参与。 */
const CEILING: RoleCeiling = {
  intake: ['file_read'],
  architect: ['file_read'],
  pm: ['file_read'],
  dev: ['file_read', 'file_edit'],
  git: ['file_read'],
  ops: ['file_read', 'file_edit'],
  review: ['file_read'],
  scheduler: ['file_read'],
  flow: ['file_read'],
  manager: ['file_read'],
  'requirement-editor': ['file_read'],
}

function signals(strong: string[], medium: string[] = [], preferredPaths: string[] = []): RoleSignals {
  return { strong, medium, preferredPaths }
}

const ROSTER: readonly SuggestRosterJob[] = [
  {
    id: 'dotnet-engineer',
    name: '.NET 工程师',
    inherits: 'dev',
    signals: signals(['c#', 'dotnet', 'asp.net core'], ['接口'], ['src/Server/']),
  },
  {
    id: 'vue-engineer',
    name: 'Vue 工程师',
    inherits: 'dev',
    signals: signals(['vue', 'vue-router', 'pinia'], ['页面'], ['src/views/']),
  },
  {
    id: 'api-architect',
    name: '接口架构师',
    inherits: 'review',
    signals: signals(['openapi', 'ddl', 'adr'], ['架构'], ['docs/']),
  },
]

const TASK: SuggestTask = {
  id: 'T-91',
  title: '结算改造',
  description: '',
  type: '开发',
  state: 'drafting',
  dependsOn: [],
  allowedPaths: [],
}

function request(overrides: Partial<SuggestRoleRequest> = {}): SuggestRoleRequest {
  return { task: TASK, roster: { jobs: ROSTER }, ceiling: CEILING, ...overrides }
}

function byId(candidates: readonly RoleSuggestionCandidate[], roleId: string): RoleSuggestionCandidate {
  const candidate = candidates.find(entry => entry.roleId === roleId)
  if (candidate === undefined) throw new Error(`候选里没有 ${roleId}`)
  return candidate
}

describe('本地岗位建议', () => {
  it('强特征命中标题与落点偏好时给出建议', () => {
    const result = suggestRole(request({
      task: { ...TASK, title: '修复 C# 结算接口', allowedPaths: ['src/Server/Api.cs'] },
    }))

    expect(result.decision).toBe('suggest')
    expect(result.recommended?.roleId).toBe('dotnet-engineer')
    expect(result.recommended?.confidence).toBe(1)
    expect(result.humanAction).toBe('assign_via_task_assign')
    expect(result.offline).toEqual({ mode: 'local_rules' })
    expect(result.policy).toEqual({ accept: LOCAL_ROLE_POLICY.accept, margin: LOCAL_ROLE_POLICY.margin, source: 'default' })
    expect(result.recommended?.margin).toBeGreaterThanOrEqual(1)
    expect(byId(result.candidates, 'dotnet-engineer').reasons).toEqual(expect.arrayContaining([
      { code: 'strong_signal', term: 'c#', field: 'title', delta: 5 },
      { code: 'preferred_path', preferred: 'src/Server/', matched: 'src/Server/Api.cs', delta: 4 },
    ]))
  })

  it('弱特征权重低于强特征：强特征岗位排在弱特征岗位前', () => {
    const result = suggestRole(request({
      task: { ...TASK, title: 'vue 接口 改造' },
    }))

    expect(result.candidates[0]?.roleId).toBe('vue-engineer')
    expect(byId(result.candidates, 'vue-engineer').score).toBe(5)
    expect(byId(result.candidates, 'dotnet-engineer').score).toBe(3)
    expect(byId(result.candidates, 'vue-engineer').reasons).toEqual([
      { code: 'strong_signal', term: 'vue', field: 'title', delta: 5 },
    ])
    expect(byId(result.candidates, 'dotnet-engineer').reasons).toEqual([
      { code: 'medium_signal', term: '接口', field: 'title', delta: 3 },
    ])
  })

  it('写盘任务把只读角色排除，并写明缺 file_edit', () => {
    const result = suggestRole(request({
      task: { ...TASK, title: 'OpenAPI 契约与 c# 接口一起改' },
    }))

    expect(byId(result.candidates, 'api-architect').disqualified)
      .toEqual({ code: 'write_requires_file_edit', inherits: 'review' })
    expect(result.recommended?.roleId).toBe('dotnet-engineer')
    expect(result.decision).toBe('suggest')
  })

  it('只读复核任务允许只读角色', () => {
    const result = suggestRole(request({
      task: { ...TASK, type: '复核', title: 'OpenAPI 审计报告' },
    }))

    expect(result.decision).toBe('suggest')
    expect(result.recommended?.roleId).toBe('api-architect')
    expect(byId(result.candidates, 'api-architect').disqualified).toBeUndefined()
  })

  it('没有任何信号命中时回 dev 兜底，置信度 0 且转人工', () => {
    const result = suggestRole(request({
      task: { ...TASK, title: '整理桌面图标' },
    }))

    expect(result.candidates[0]?.roleId).toBe('dev')
    expect(result.candidates[0]?.confidence).toBe(0)
    expect(result.candidates[0]?.reasons).toEqual([{ code: 'fallback_no_match' }])
    expect(result.decision).toBe('needs_human')
    expect(result.humanAction).toBe('leave_unassigned')
    expect(result.recommended).toBeUndefined()
  })

  it('第二名逼近时不给建议，交人挑', () => {
    const result = suggestRole(request({
      task: { ...TASK, type: '变更', title: 'c# 与 vue 两端改造' },
    }))

    expect(result.candidates[0]?.score).toBe(5)
    expect(result.candidates[1]?.score).toBe(5)
    expect(result.decision).toBe('needs_human')
    expect(result.humanAction).toBe('pick_role')
    expect(result.recommended).toBeUndefined()
  })

  it('不可逆任务即使信号很强也恒转人工', () => {
    const result = suggestRole(request({
      task: { ...TASK, title: 'c# 结算公式改造' },
      contract: { summary: '', irreversible: ['settlement_formula'], acceptance: [] },
    }))

    expect(result.candidates[0]?.roleId).toBe('dotnet-engineer')
    expect(result.candidates[0]?.confidence).toBe(1)
    expect(result.decision).toBe('needs_human')
    expect(result.humanAction).toBe('pick_role')
    expect(result.recommended).toBeUndefined()
  })

  it('名册为空时只回内置 dev', () => {
    const result = suggestRole(request({ roster: { jobs: [] } }))

    expect(result.candidates.map(candidate => candidate.roleId)).toEqual(['dev'])
    expect(result.candidates[0]?.confidence).toBe(0)
    expect(result.candidates[0]?.reasons).toEqual([{ code: 'fallback_no_match' }])
    expect(result.decision).toBe('needs_human')
  })

  it('继承角色未知的岗位被否决，不参与推荐', () => {
    const result = suggestRole(request({
      task: { ...TASK, title: 'c# 结算改造' },
      roster: {
        jobs: [{
          id: 'wizard',
          name: '法师',
          inherits: 'wizard',
          signals: signals(['c#']),
        }],
      },
    }))

    expect(byId(result.candidates, 'wizard').disqualified)
      .toEqual({ code: 'inherits_unknown', inherits: 'wizard' })
    expect(result.candidates[0]?.roleId).toBe('dev')
    expect(result.decision).toBe('needs_human')
  })

  it('同一输入下候选顺序固定，与名册顺序无关', () => {
    const forward = suggestRole(request({
      task: { ...TASK, title: 'c# 与 vue 两端改造' },
      roster: { jobs: [ROSTER[0]!, ROSTER[1]!] },
    }))
    const backward = suggestRole(request({
      task: { ...TASK, title: 'c# 与 vue 两端改造' },
      roster: { jobs: [ROSTER[1]!, ROSTER[0]!] },
    }))

    expect(forward.candidates.map(candidate => candidate.roleId))
      .toEqual(backward.candidates.map(candidate => candidate.roleId))
    expect(suggestRole(request({ task: { ...TASK, title: 'c# 与 vue 两端改造' } })))
      .toEqual(suggestRole(request({ task: { ...TASK, title: 'c# 与 vue 两端改造' } })))
  })

  it('历史保留只给已有信号命中的岗位加分', () => {
    const result = suggestRole(request({
      task: { ...TASK, title: 'c# 结算改造' },
      history: [
        { taskId: 'T-80', roleId: 'dotnet-engineer', verdict: 'kept' },
        { taskId: 'T-81', roleId: 'dotnet-engineer', verdict: 'kept' },
        { taskId: 'T-82', roleId: 'vue-engineer', verdict: 'kept' },
      ],
    }))

    expect(byId(result.candidates, 'dotnet-engineer').score).toBe(7)
    expect(byId(result.candidates, 'dotnet-engineer').reasons).toEqual(expect.arrayContaining([
      { code: 'history_kept', count: 2, bonus: 2 },
    ]))
    expect(byId(result.candidates, 'vue-engineer').score).toBe(0)
  })

  it('显式 writeRequired=false 时，没有类型声明的只读任务允许只读角色', () => {
    const result = suggestRole(request({
      task: { ...TASK, type: '', title: 'OpenAPI 审计报告', allowedPaths: [] },
      writeRequired: false,
    }))

    expect(byId(result.candidates, 'api-architect').disqualified).toBeUndefined()
    expect(result.decision).toBe('suggest')
    expect(result.recommended?.roleId).toBe('api-architect')
  })

  it('显式 writeRequired=true 时，只读角色被能力天花板排除', () => {
    const result = suggestRole(request({
      task: { ...TASK, type: '', title: 'OpenAPI 审计报告', allowedPaths: [] },
      writeRequired: true,
    }))

    expect(byId(result.candidates, 'api-architect').disqualified)
      .toEqual({ code: 'write_requires_file_edit', inherits: 'review' })
    expect(result.decision).toBe('needs_human')
  })
})
