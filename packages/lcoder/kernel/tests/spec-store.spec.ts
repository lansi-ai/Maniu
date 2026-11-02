import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  bindingMap,
  diffSpec,
  findBindingIssues,
  loadSpec,
  textCodeIndex,
} from '../src/kernel/spec-store.js'
import type { SpecSnapshot } from '../src/kernel/spec-store.js'
import { RuleEntry } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function makeSpec(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'lcoder-store-'))
  dirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf8')
  }
  return root
}

const DEFAULTS = {
  id: 'R-01',
  module: 'order',
  kind: 'rule' as const,
  text: '下单需登录',
  source: { doc: 'prd.md#4.2' },
  status: 'confirmed' as const,
}

function snap(rules: Record<string, unknown>[]): SpecSnapshot {
  return {
    root: '/virtual',
    rules: rules.map(r => RuleEntry.parse({ ...DEFAULTS, ...r })),
    states: [],
  }
}

describe('规格库', () => {
  it('从 .spec 读出规则与状态机', () => {
    const root = makeSpec({
      'spec/rules.yaml': `rules:
  - id: R-01
    module: order
    kind: rule
    text: 下单需登录
    source: { doc: prd.md#4.2 }
    status: confirmed
`,
      'spec/states/order.yaml': `id: order
statuses: [PendingPayment, Shipped]
transitions:
  - { from: PendingPayment, to: Shipped }
`,
    })

    const s = loadSpec(root)
    expect(s.rules.map(r => r.id)).toEqual(['R-01'])
    expect(s.states.map(m => m.id)).toEqual(['order'])
  })

  it('落点清单用 file#symbol 表示', () => {
    const s = snap([{ id: 'R-01', found_at: [{ file: 'a.ts', symbol: 'calc' }, { file: 'b.sql' }] }])
    expect(bindingMap(s).get('R-01')).toEqual(['a.ts#calc', 'b.sql'])
  })

  it('文本索引按词边界命中，不误伤前缀相同的名字', () => {
    const idx = textCodeIndex({ 'a.ts': 'export function calcTotal() {}' })
    expect(idx.hasFile('a.ts')).toBe(true)
    expect(idx.hasSymbol('a.ts', 'calcTotal')).toBe(true)
    expect(idx.hasSymbol('a.ts', 'calc')).toBe(false)
    expect(idx.hasSymbol('nope.ts', 'calcTotal')).toBe(false)
  })

  it('已知局限：注释里提到同名标识符也算命中（此处固定行为，换 AST 前要人工复核）', () => {
    const idx = textCodeIndex({ 'a.ts': '// 以后这里要调用 calcTotal\n' })
    expect(idx.hasSymbol('a.ts', 'calcTotal')).toBe(true)
  })

  it('confirmed 条目无落点 → missing-binding', () => {
    const issues = findBindingIssues(snap([{ id: 'R-01' }]), textCodeIndex({}))
    expect(issues).toEqual([{ ruleId: 'R-01', kind: 'missing-binding', detail: '' }])
  })

  it('落点文件或符号不存在分别报出，并带定位', () => {
    const s = snap([
      { id: 'R-01', found_at: [{ file: 'gone.ts', symbol: 'x' }] },
      { id: 'R-02', module: 'm', found_at: [{ file: 'a.ts', symbol: 'missing' }] },
    ])
    const issues = findBindingIssues(s, textCodeIndex({ 'a.ts': 'const other = 1;' }))
    expect(issues).toContainEqual({ ruleId: 'R-01', kind: 'missing-file', detail: 'gone.ts#x' })
    expect(issues).toContainEqual({
      ruleId: 'R-02',
      kind: 'missing-symbol',
      detail: 'a.ts#missing',
    })
  })

  it('draft 条目不参与判定', () => {
    const s = snap([{ id: 'R-01', status: 'draft' }])
    expect(findBindingIssues(s, textCodeIndex({}))).toEqual([])
  })

  it('差异汇总的计数口径', () => {
    const s = snap([
      { id: 'R-01', found_at: [{ file: 'a.ts', symbol: 'ok' }] },
      { id: 'R-02', module: 'm' },
      { id: 'R-03', module: 'm', found_at: [{ file: 'gone.ts' }] },
      { id: 'R-04', module: 'm', status: 'draft' },
    ])
    const d = diffSpec(s, textCodeIndex({ 'a.ts': 'function ok() {}' }))

    expect(d.confirmed).toBe(3)
    expect(d.bound).toBe(1)
    expect(d.unbound.map(r => r.id)).toEqual(['R-02'])
    expect(d.broken.map(b => b.ruleId)).toEqual(['R-03'])
    expect(d.ok).toBe(false)
  })
})
