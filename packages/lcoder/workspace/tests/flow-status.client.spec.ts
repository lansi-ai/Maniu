/**
 * `/flow_status` 输出的形状校验：读得懂就画，读不懂就报错。
 *
 * 判定本身属于 kernel；这里只钉住边界——旧 kernel 的回执、缺字段、非法动作
 * 都不能被当成一份正常计划。
 */
import { describe, expect, it } from 'vitest'
import { parseFlowStatus } from '../src/client/flow-status.ts'

const VALID = JSON.stringify({
  policy: {
    source: 'file',
    path: 'E:/demo/.spec/automation.yaml',
    hash: 'sha256:abcdef',
    at: '2026-11-06T12:00:00.000Z',
    actions: {
      draft: 'manual', contract: 'manual', sign: 'auto',
      implement: 'auto', verify: 'manual', close: 'manual', commit: 'manual',
    },
    limits: { token_budget: 100000, max_parallel: 2 },
    tasks: [],
  },
  decision: {
    action: 'sign',
    taskId: 'T-01',
    mode: 'auto',
    reason: 'AI 自签',
    blockers: [],
  },
  tasks: [
    {
      id: 'T-01',
      state: 'drafting',
      dependsOn: [],
      decision: { action: 'sign', taskId: 'T-01', mode: 'auto', reason: 'AI 自签', blockers: [] },
      startable: false,
    },
    {
      id: 'T-02',
      state: 'drafting',
      dependsOn: ['T-01'],
      decision: {
        action: 'stop', taskId: 'T-02', mode: 'none', reason: '前置未收口',
        blockers: [{ kind: 'dependency', detail: '等这些任务收口：T-01' }],
      },
      startable: false,
    },
  ],
  known: ['T-01', 'T-02'],
})

describe('流程判定输出', () => {
  it('合法的 JSON 折成策略、整体判定与逐任务计划', () => {
    const parsed = parseFlowStatus(VALID)
    expect(parsed).not.toBeNull()
    expect(parsed?.policy.source).toBe('file')
    expect(parsed?.policy.actions.sign).toBe('auto')
    expect(parsed?.policy.limits).toEqual({
      tokenBudget: 100000, maxMinutes: null, maxConsecutiveFailures: null, maxParallel: 2,
    })
    expect(parsed?.decision).toMatchObject({ action: 'sign', taskId: 'T-01', mode: 'auto' })
    expect(parsed?.tasks).toHaveLength(2)
    expect(parsed?.tasks[1]?.decision.blockers[0]).toMatchObject({ kind: 'dependency' })
    expect(parsed?.tasks[1]?.startable).toBe(false)
    expect(parsed?.known).toEqual(['T-01', 'T-02'])
  })

  it('不是 JSON 的输出读成 null', () => {
    expect(parseFlowStatus('命令不存在')).toBeNull()
    expect(parseFlowStatus('')).toBeNull()
    expect(parseFlowStatus('{}')).toBeNull()
  })

  it('动作、模式或挡住原因不在词表里就读成 null 或丢掉那一条', () => {
    const badDecision = JSON.parse(VALID) as Record<string, unknown>
    badDecision.decision = { action: 'deploy', taskId: 'T-01', mode: 'auto', reason: 'x', blockers: [] }
    expect(parseFlowStatus(JSON.stringify(badDecision))).toBeNull()

    const badBlocker = JSON.parse(VALID) as Record<string, unknown>
    badBlocker.decision = {
      action: 'stop', taskId: 'T-01', mode: 'none', reason: 'x',
      blockers: [{ kind: 'network', detail: 'x' }, { kind: 'budget', detail: 'token 用尽' }],
    }
    expect(parseFlowStatus(JSON.stringify(badBlocker))?.decision.blockers).toEqual([
      { kind: 'budget', detail: 'token 用尽' },
    ])
  })

  it('策略动作缺一项就读成 null，不拿缺省值补成「手动」', () => {
    const partial = JSON.parse(VALID) as Record<string, unknown>
    partial.policy = {
      source: 'file', path: 'x', hash: null, at: null,
      actions: { draft: 'manual' }, limits: {}, tasks: [],
    }
    expect(parseFlowStatus(JSON.stringify(partial))).toBeNull()
  })
})
