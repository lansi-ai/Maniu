import { describe, expect, it } from 'vitest'

import { checkP1, checkP3, checkP4 } from '../src/checkers/index.js'
import { textCodeIndex } from '../src/kernel/spec-store.js'
import type { SpecSnapshot } from '../src/kernel/spec-store.js'
import { Contract, RuleEntry, Task } from '../src/schema/spec.js'

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
    const r = checkP3(
      task({ scope: { irreversible: ['settlement_formula'] } }),
      contract({ sig: null }),
    )
    expect(r.ok).toBe(false)
    expect(r.violations[0]?.detail).toContain('未签署')
  })

  it('agent 自己签的字不算数', () => {
    const r = checkP3(
      task({ scope: { irreversible: ['settlement_formula'] } }),
      contract({ sig: { by: 'agent', at: AT, hash: 'sha256:x' } }),
    )
    expect(r.ok).toBe(false)
    expect(r.violations[0]?.detail).toContain('agent')
  })

  it('人签署后通过', () => {
    const r = checkP3(
      task({ scope: { irreversible: ['settlement_formula'] } }),
      contract({ sig: { by: 'human', at: AT, hash: 'sha256:x' } }),
    )
    expect(r.ok).toBe(true)
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
