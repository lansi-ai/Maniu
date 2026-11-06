/**
 * 流程引擎的行为测：每条状态边的下一动作、策略开关、四种挡住原因与停止条件。
 *
 * 引擎是纯函数，这里不写盘：所有事实由测试直接喂进来，一条断言对应一条规则。
 */
import { describe, expect, it } from 'vitest'

import { decideFlow } from '../src/kernel/flow.js'
import type { FlowDecision, FlowTaskFacts, FlowUsage } from '../src/kernel/flow.js'
import { AutomationPolicy } from '../src/schema/spec.js'
import type { AutomationActionName, AutomationMode } from '../src/schema/spec.js'

const BASE: FlowTaskFacts = {
  id: 'T-01',
  state: 'drafting',
  dependsOn: [],
  irreversible: [],
  contractExists: false,
  signatureValid: false,
  reviewEvidence: false,
  evidenceComplete: false,
  committed: false,
  externalActions: [],
}

function task(over: Partial<FlowTaskFacts> = {}): FlowTaskFacts {
  return { ...BASE, ...over }
}

function policy(
  actions: Partial<Record<AutomationActionName, AutomationMode>> = {},
  limits: Record<string, number> = {},
  tasks: string[] = [],
): AutomationPolicy {
  return AutomationPolicy.parse({ actions, limits, tasks })
}

function decide(tasks: FlowTaskFacts[], over: AutomationPolicy = policy(), usage?: Partial<FlowUsage>): FlowDecision {
  return decideFlow({
    tasks,
    policy: over,
    ...(usage === undefined ? {} : { usage }),
  })
}

const CLOSED: FlowTaskFacts = task({ state: 'closed', contractExists: true, signatureValid: true, committed: true })

describe('空范围与终局', () => {
  it('没有任务 → 起草任务，按策略开关决定手动或自动', () => {
    expect(decide([])).toMatchObject({ action: 'draft', taskId: null, mode: 'manual' })
    expect(decide([], policy({ draft: 'auto' })).mode).toBe('auto')
  })

  it('策略范围里没有任务 → 仍是起草，而不是去驱动范围外的任务', () => {
    const r = decide([task({ state: 'contracted' })], policy({}, {}, ['T-99']))
    expect(r.action).toBe('draft')
  })

  it('全部收口但未提交 → 本地提交', () => {
    const r = decide([CLOSED, task({ id: 'T-02', state: 'closed', contractExists: true, signatureValid: true })])
    expect(r).toMatchObject({ action: 'commit', taskId: 'T-02', mode: 'manual' })
  })

  it('全部收口、已提交且有外部动作 → 交还给人，不自动执行', () => {
    const r = decide([task({ ...CLOSED, externalActions: ['push', 'deploy'] })])
    expect(r.action).toBe('external')
    expect(r.mode).toBe('none')
    expect(r.blockers[0]).toMatchObject({ kind: 'external' })
    expect(r.blockers[0]?.detail).toContain('push')
    expect(r.blockers[0]?.detail).toContain('deploy')
  })

  it('全部收口、已提交、无外部动作 → 停止', () => {
    expect(decide([CLOSED])).toMatchObject({ action: 'stop', mode: 'none' })
  })
})

describe('状态边', () => {
  it('起草态没有契约 → 起草契约', () => {
    expect(decide([task()])).toMatchObject({ action: 'contract', taskId: 'T-01', mode: 'manual' })
    expect(decide([task()], policy({ contract: 'auto' })).mode).toBe('auto')
  })

  it('契约已签且覆盖当前正文 → 确认推进到已签约', () => {
    const r = decide([task({ contractExists: true, signatureValid: true })])
    expect(r).toMatchObject({ action: 'sign', taskId: 'T-01', mode: 'manual' })
    expect(r.blockers).toEqual([])
  })

  it('已签约 → 实施；实施中 → 验证', () => {
    expect(decide([task({ state: 'contracted', contractExists: true, signatureValid: true })])).toMatchObject({
      action: 'implement',
    })
    expect(decide([task({ state: 'implementing', contractExists: true, signatureValid: true })])).toMatchObject({
      action: 'verify',
    })
  })

  it('验证中证据未齐 → 继续验证；证据齐 → 收口', () => {
    expect(decide([task({ state: 'verifying', evidenceComplete: false })])).toMatchObject({ action: 'verify' })
    expect(decide([task({ state: 'verifying', evidenceComplete: true })])).toMatchObject({ action: 'close' })
  })
})

describe('AI 自签三闸', () => {
  const gated = policy({ sign: 'auto' }, {}, [])

  it('三闸成立 → sign 为自动，并说明可由 AI 自签', () => {
    const r = decide([task({ contractExists: true, reviewEvidence: true })], gated)
    expect(r).toMatchObject({ action: 'sign', mode: 'auto' })
    expect(r.reason).toContain('AI 自签')
  })

  it('缺评审证据 → 仍要人签，挡住原因是等人签', () => {
    const r = decide([task({ contractExists: true })], gated)
    expect(r).toMatchObject({ action: 'sign', mode: 'manual' })
    expect(r.blockers[0]).toMatchObject({ kind: 'signature' })
    expect(r.blockers[0]?.detail).toContain('评审')
  })

  it('任务触及不可逆项 → 策略再自动也不许自签', () => {
    const r = decide([task({ contractExists: true, reviewEvidence: true, irreversible: ['settlement_formula'] })], gated)
    expect(r.mode).toBe('manual')
    expect(r.blockers[0]?.detail).toContain('不可逆项')
  })

  it('策略签署为手动 → 不许自签', () => {
    const r = decide([task({ contractExists: true, reviewEvidence: true })], policy())
    expect(r.mode).toBe('manual')
    expect(r.blockers[0]?.detail).toContain('auto')
  })
})

describe('挡住原因与停止条件', () => {
  it('前置任务未收口且不在策略范围 → 等依赖，动作是 stop', () => {
    // T-00 开着但不在自动化范围里：范围只决定驱动谁，T-01 的依赖仍然按住它。
    const r = decide(
      [task({ dependsOn: ['T-00'] }), task({ id: 'T-00', state: 'implementing' })],
      policy({}, {}, ['T-01']),
    )
    expect(r.action).toBe('stop')
    expect(r.blockers[0]).toMatchObject({ kind: 'dependency' })
    expect(r.blockers[0]?.detail).toContain('T-00')
  })

  it('依赖已收口 → 正常往下走', () => {
    const r = decide([task({ dependsOn: ['T-00'] }), task({ ...CLOSED, id: 'T-00' })])
    expect(r.action).toBe('contract')
  })

  it('一条被依赖按住时，仍挑得出另一条可做的任务', () => {
    const r = decide([
      task({ id: 'T-01', dependsOn: ['T-09'] }),
      task({ id: 'T-02', state: 'contracted', contractExists: true, signatureValid: true }),
      task({ id: 'T-09', state: 'implementing' }),
    ])
    expect(r).toMatchObject({ action: 'implement', taskId: 'T-02' })
  })

  it('token 预算用尽 → 停止', () => {
    const r = decide([task()], policy({}, { token_budget: 100 }), { tokens: 100 })
    expect(r.action).toBe('stop')
    expect(r.blockers[0]).toMatchObject({ kind: 'budget' })
    expect(r.blockers[0]?.detail).toContain('token')
  })

  it('时长用尽 → 停止', () => {
    const r = decide([task()], policy({}, { max_minutes: 30 }), { minutes: 31 })
    expect(r.action).toBe('stop')
    expect(r.blockers[0]?.detail).toContain('分钟')
  })

  it('连续失败达到上限 → 停止', () => {
    const r = decide([task()], policy({}, { max_consecutive_failures: 2 }), { consecutiveFailures: 2 })
    expect(r.action).toBe('stop')
    expect(r.blockers[0]?.detail).toContain('连续失败')
  })

  it('并发已满 → 停止', () => {
    const r = decide([task()], policy({}, { max_parallel: 1 }), { running: 1 })
    expect(r.action).toBe('stop')
    expect(r.blockers[0]?.detail).toContain('并发')
  })

  it('停止条件先于任务检查：预算用尽时不再挑任务', () => {
    const r = decide([task({ state: 'contracted' })], policy({ implement: 'auto' }, { token_budget: 5 }), { tokens: 9 })
    expect(r.action).toBe('stop')
  })
})
