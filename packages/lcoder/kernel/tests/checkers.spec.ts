import { describe, expect, it } from 'vitest'

import { checkDeliverable, checkP1, checkP3, checkP4 } from '../src/checkers/index.js'
import { contractHash } from '../src/kernel/contract.js'
import type { ContractFact } from '../src/kernel/contract.js'
import { textCodeIndex } from '../src/kernel/spec-store.js'
import type { SpecSnapshot } from '../src/kernel/spec-store.js'
import { AutomationPolicy, Contract, RuleEntry, Task } from '../src/schema/spec.js'
import { Deliverable } from '../src/schema/deliverable.js'

const AT = '2026-11-02T15:00:00+08:00'

function snap(rules: Record<string, unknown>[]): SpecSnapshot {
  return {
    root: '/virtual',
    rules: rules.map(r =>
      RuleEntry.parse({
        id: 'R-01',
        module: 'order',
        kind: 'rule',
        text: '下单需登录',
        source: { doc: 'prd.md#4.2' },
        status: 'confirmed',
        ...r,
      }),
    ),
    states: [],
  }
}

function task(over: Record<string, unknown> = {}): Task {
  return Task.parse({
    id: 'T-014',
    title: '佣金支持 0',
    grade: 'B',
    state: 'verifying',
    opened_at: AT,
    ...over,
  })
}

function contract(over: Record<string, unknown> = {}): Contract {
  return Contract.parse({
    id: 'T-014',
    change: ['x'],
    acceptance: ['y'],
    ...over,
  })
}

/** 正文哈希按同一份正文算一次即可；`sig` 不参与计算。 */
const BODY_HASH = contractHash(contract())

/** 一份契约事实：正文固定，签名可控——签名里的哈希与正文复算值不符就是「签完又改」。 */
function fact(sig: Record<string, unknown> | null): ContractFact {
  const body = contract({ sig })
  return { contract: body, bodyHash: contractHash(body) }
}

/** 结构合法的 AI 自签：actor 与授权依据齐全，是否放行由 P3 的三补偿闸判。 */
function agentSig(hash: string): Record<string, unknown> {
  return {
    by: 'agent',
    at: AT,
    hash,
    actor: 'lcoder-flow',
    authorization: { policy: 'automation.yaml', hash: 'sha256:策略', at: AT },
  }
}

/** 三补偿闸本可成立（策略 auto + 评审证据）时的策略事实。 */
const GATES_OPEN = {
  policy: AutomationPolicy.parse({ actions: { sign: 'auto' } }),
  evidence: { review: 10 },
}

describe('P1 条目有落点', () => {
  it('落点存在且指向真实符号 → 通过', () => {
    const s = snap([{ found_at: [{ file: 'a.ts', symbol: 'createOrder' }] }])
    const r = checkP1(s, textCodeIndex({ 'a.ts': 'export function createOrder() {}' }))
    expect(r.ok).toBe(true)
  })

  it('没有落点 → 违规，并提示下一步', () => {
    const r = checkP1(snap([{}]), textCodeIndex({}))
    expect(r.ok).toBe(false)
    expect(r.violations[0]).toMatchObject({ checker: 'P1', subject: 'R-01' })
    expect(r.violations[0]?.hint).toContain('spec_bind')
  })

  it('落点文件或符号失效 → 分别报出', () => {
    const s = snap([
      { id: 'R-01', found_at: [{ file: 'gone.ts' }] },
      { id: 'R-02', found_at: [{ file: 'a.ts', symbol: 'renamed' }] },
    ])
    const r = checkP1(s, textCodeIndex({ 'a.ts': 'const other = 1;' }))
    expect(r.violations.map(v => v.subject)).toEqual(['R-01', 'R-02'])
    expect(r.violations[0]?.detail).toContain('文件不存在')
    expect(r.violations[1]?.detail).toContain('符号')
  })

  it('draft 条目不参与判定', () => {
    expect(checkP1(snap([{ status: 'draft' }]), textCodeIndex({})).ok).toBe(true)
  })
})

describe('P3 不可逆项需人签署', () => {
  it('没触及不可逆项 → 不需要契约', () => {
    expect(checkP3(task(), null).ok).toBe(true)
  })

  it('触及不可逆项却没有契约 → 违规', () => {
    const r = checkP3(task({ scope: { irreversible: ['settlement_formula'] } }), null)
    expect(r.ok).toBe(false)
    expect(r.violations[0]?.detail).toContain('还没有契约')
  })

  it('契约未签署 → 违规', () => {
    const r = checkP3(task({ scope: { irreversible: ['settlement_formula'] } }), fact(null))
    expect(r.ok).toBe(false)
    expect(r.violations[0]?.detail).toContain('未签署')
  })

  it('agent 自签但任务触及不可逆项 → 三闸不成立，判违规', () => {
    const r = checkP3(
      task({ scope: { irreversible: ['settlement_formula'] } }),
      fact(agentSig(BODY_HASH)),
      GATES_OPEN,
    )
    expect(r.ok).toBe(false)
    expect(r.violations[0]?.detail).toContain('agent 自签')
    expect(r.violations[0]?.detail).toContain('不可逆项')
  })

  it('agent 自签且没给策略事实 → 按手动与无复核证据判违规', () => {
    const r = checkP3(
      task({ scope: { irreversible: ['settlement_formula'] } }),
      fact(agentSig(BODY_HASH)),
    )
    expect(r.ok).toBe(false)
    expect(r.violations[0]?.detail).toContain('策略')
  })

  it('人签署且签名覆盖当前正文 → 通过', () => {
    const r = checkP3(
      task({ scope: { irreversible: ['settlement_formula'] } }),
      fact({ by: 'human', at: AT, hash: BODY_HASH }),
    )
    expect(r.ok).toBe(true)
  })

  it('签完又改正文 → 签名作废', () => {
    const r = checkP3(
      task({ scope: { irreversible: ['settlement_formula'] } }),
      fact({ by: 'human', at: AT, hash: 'sha256:签的那一版' }),
    )
    expect(r.ok).toBe(false)
    expect(r.violations[0]?.detail).toContain('签署后正文被改过')
    expect(r.violations[0]?.hint).toContain('重签')
  })

  it('没触及不可逆项时不查签名', () => {
    expect(checkP3(task(), fact({ by: 'human', at: AT, hash: 'sha256:无关' })).ok).toBe(true)
  })
})

describe('P4 条目有证据', () => {
  const t = task({ evidence_required: ['build', 'test'] })

  it('证据齐备且非空 → 通过', () => {
    expect(checkP4(t, { build: 120, test: 800 }).ok).toBe(true)
  })

  it('缺一项 → 违规并指出缺哪个', () => {
    const r = checkP4(t, { build: 120 })
    expect(r.ok).toBe(false)
    expect(r.violations[0]?.detail).toContain('test')
  })

  it('存在但空白的证据不算证据', () => {
    const r = checkP4(t, { build: 0, test: 800 })
    expect(r.ok).toBe(false)
    expect(r.violations[0]?.detail).toContain('空')
  })

  it('没有任何必需证据的任务直接通过', () => {
    expect(checkP4(task(), {}).ok).toBe(true)
  })
})

describe('D1 必须交付的任务有交付索引', () => {
  const deliverable = (over: Record<string, unknown> = {}): Deliverable => Deliverable.parse({
    task: 'T-014',
    summary: '补齐基础框架说明',
    docs: ['README.md'],
    created_at: AT,
    updated_at: AT,
    ...over,
  })

  it('A 级任务缺索引 → 违规并给出目标路径', () => {
    const r = checkDeliverable(task({ grade: 'A' }), { kind: 'missing' })
    expect(r.ok).toBe(false)
    expect(r.violations[0]).toMatchObject({ checker: 'D1', subject: 'T-014' })
    expect(r.violations[0]?.detail).toContain('还没有交付索引')
    expect(r.violations[0]?.hint).toContain('.spec/deliverables/T-014.yaml')
    expect(r.violations[0]?.hint).toContain('deliverable_draft')
  })

  it('通用轨与基础/架构关键词同样触发', () => {
    expect(checkDeliverable(task({ track: 'general' }), { kind: 'missing' }).ok).toBe(false)
    expect(checkDeliverable(task({ title: '搭建基础框架' }), { kind: 'missing' }).ok).toBe(false)
    expect(checkDeliverable(task({ description: '这次做架构调整' }), { kind: 'missing' }).ok).toBe(false)
  })

  it('完整索引 → 通过；读不懂 → 违规带原文', () => {
    expect(checkDeliverable(task({ grade: 'A' }), { kind: 'ok', value: deliverable() }).ok).toBe(true)

    const broken = checkDeliverable(task({ grade: 'A' }), { kind: 'invalid', problem: 'summary 不能为空' })
    expect(broken.ok).toBe(false)
    expect(broken.violations[0]?.detail).toContain('summary 不能为空')
  })

  it('普通 B 级非通用轨任务不看交付索引', () => {
    expect(checkDeliverable(task({ grade: 'B', title: '导出结算记录' }), { kind: 'missing' }).ok).toBe(true)
  })
})
