import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { contractHash, createSpecTools } from '../src/tools/spec-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const RULES = `rules:
  - id: R-01
    module: order
    kind: rule
    text: 下单需登录
    source: { doc: prd.md#4.2 }
    status: confirmed
  - id: R-02
    module: settlement
    kind: formula
    text: 佣金 = max(round(实付 × 费率, 2), 1.00)
    source: { doc: prd.md#6.3 }
    status: draft
`

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lcoder-tools-'))
  dirs.push(root)
  const p = join(root, 'spec', 'rules.yaml')
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, RULES, 'utf8')
  return root
}

/** 工具定义里的 execute 只吃 args；exec 上下文在本模块内未使用。 */
function call(toolName: string, root: string, args: Record<string, unknown>) {
  const tool = createSpecTools(root).find(t => t.name === toolName)
  if (!tool) throw new Error(`没有这个工具：${toolName}`)
  const exec = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> })
    .execute
  return exec(args, {}) as Promise<Record<string, unknown>>
}

describe('起草态工具集', () => {
  it('只提供三个工具，且不含 contract_sign（模型不能给自己签字）', () => {
    const names = createSpecTools(makeRoot()).map(t => t.name)
    expect(names).toEqual(['spec_query', 'spec_bind', 'contract_draft'])
    expect(names).not.toContain('contract_sign')
  })

  it('spec_query 返回条目与落点，按需附带状态机', async () => {
    const root = makeRoot()
    const all = await call('spec_query', root, {})
    expect(all.count).toBe(2)

    const byModule = await call('spec_query', root, { module: 'settlement' })
    expect((byModule.rules as { id: string }[]).map(r => r.id)).toEqual(['R-02'])

    const byKeyword = await call('spec_query', root, { keyword: '佣金' })
    expect((byKeyword.rules as { id: string }[]).map(r => r.id)).toEqual(['R-02'])

    expect(all.states).toBeUndefined()
    const withStates = await call('spec_query', root, { include_states: true })
    expect(withStates.states).toEqual([])
  })

  it('spec_bind 写入落点并落盘；重复绑定不重复添加', async () => {
    const root = makeRoot()

    const first = await call('spec_bind', root, {
      rule_id: 'R-01',
      file: 'src/order.ts',
      symbol: 'createOrder',
    })
    expect(first.added).toBe(true)
    expect(first.found_at).toEqual(['src/order.ts#createOrder'])

    const again = await call('spec_bind', root, {
      rule_id: 'R-01',
      file: 'src/order.ts',
      symbol: 'createOrder',
    })
    expect(again.added).toBe(false)

    const onDisk = readFileSync(join(root, 'spec', 'rules.yaml'), 'utf8')
    expect(onDisk).toContain('src/order.ts')
  })

  it('spec_bind 对不存在的条目明确报错', async () => {
    await expect(call('spec_bind', makeRoot(), { rule_id: 'R-99', file: 'a.ts' })).rejects.toThrow(
      /找不到规格条目 R-99/,
    )
  })

  it('contract_draft 落盘但 signed 为 false，并给出内容哈希', async () => {
    const root = makeRoot()
    const r = await call('contract_draft', root, {
      task_id: 'T-014',
      change: ['R-02 下限改为可配置'],
      acceptance: ['费率为 0 且下限为 0 时不生成结算记录'],
    })

    expect(r.signed).toBe(false)
    expect(String(r.hash)).toMatch(/^sha256:[0-9a-f]{64}$/)
    const text = readFileSync(join(root, 'contracts', 'T-014.contract.yaml'), 'utf8')
    expect(text).toContain('T-014')
  })

  it('哈希只覆盖契约正文，与字段书写顺序无关', () => {
    const a = {
      id: 'T-014',
      change: ['x'],
      not_change: [],
      acceptance: ['y'],
      affected_tests: [],
      fail_if: [],
    }
    expect(contractHash(a)).toBe(contractHash({ ...a }))
  })

  it('contract_draft 缺验收条款被 schema 拒绝', async () => {
    await expect(
      call('contract_draft', makeRoot(), { task_id: 'T-014', change: ['x'], acceptance: [] }),
    ).rejects.toThrow()
  })
})

describe('还没有 .spec 的仓库', () => {
  it('spec_query 给空规格库加下一步，而不是 ENOENT', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'lcoder-nospec-'))
    dirs.push(parent)
    const root = join(parent, '.spec')

    const empty = await call('spec_query', root, {})
    expect(empty).toMatchObject({ count: 0, rules: [] })
    expect(empty.states).toBeUndefined()
    expect(String(empty.note)).toContain('task_draft')

    const withStates = await call('spec_query', root, { include_states: true })
    expect(withStates).toMatchObject({ count: 0, rules: [], states: [] })
  })
})
