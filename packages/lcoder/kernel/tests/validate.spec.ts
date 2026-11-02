import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { formatIssues, validateSpec } from '../src/schema/index.js'

const dirs: string[] = []

function makeSpec(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'lcoder-spec-'))
  dirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf8')
  }
  return root
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const ENV = `repo:
  url: https://example.com/r.git
  branch: main
  push_mode: branch
commands:
  - id: build
    cmd: pnpm build
`

const RULES = `rules:
  - id: R-01
    module: order
    kind: rule
    text: 下单需登录
    source:
      doc: prd.md#4.2
    status: confirmed
`

const STATE = `id: order
statuses: [PendingPayment, Shipped]
transitions:
  - {from: PendingPayment, to: Shipped, trigger: pay}
`

describe('.spec 校验器', () => {
  it('合法目录通过，并列出被校验过的文件', () => {
    const root = makeSpec({
      'env.yaml': ENV,
      'spec/rules.yaml': RULES,
      'spec/states/order.yaml': STATE,
    })
    const r = validateSpec(root)
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.loaded.map(l => l.file).sort()).toEqual([
      'env.yaml',
      'spec/rules.yaml',
      'spec/states/order.yaml',
    ])
  })

  it('缺必需文件报错', () => {
    const root = makeSpec({ 'spec/rules.yaml': RULES })
    const r = validateSpec(root)
    expect(r.ok).toBe(false)
    const miss = r.issues.find(i => i.file === 'env.yaml')
    expect(miss?.message).toBe('缺少必需文件')
    expect(miss?.severity).toBe('error')
  })

  it('结构不符时给出字段路径，不是笼统的"校验失败"', () => {
    const root = makeSpec({
      'env.yaml': ENV,
      'spec/rules.yaml': 'rules:\n  - id: R-01\n    module: order\n',
    })
    const r = validateSpec(root)
    expect(r.ok).toBe(false)
    const paths = r.issues.filter(i => i.file === 'spec/rules.yaml').map(i => i.path)
    expect(paths).toContain('rules[0].kind')
    expect(paths).toContain('rules[0].text')
    expect(paths).toContain('rules[0].source')
    expect(paths).toContain('rules[0].status')
  })

  it('YAML 语法错误不会让整个校验崩掉，其余文件照常报', () => {
    const root = makeSpec({
      'env.yaml': ENV,
      'spec/rules.yaml': RULES,
      'spec/states/order.yaml': 'id: order\nstatuses:\n\t- a\n',
    })
    const r = validateSpec(root)
    expect(r.ok).toBe(false)
    expect(r.issues.some(i => i.message.startsWith('YAML 解析失败'))).toBe(true)
    expect(r.loaded.map(l => l.file)).toContain('spec/rules.yaml')
  })

  it('未被覆盖的文件只警告，不阻断', () => {
    const root = makeSpec({
      'env.yaml': ENV,
      'spec/rules.yaml': RULES,
      'notes.md': '随手记',
    })
    const r = validateSpec(root)
    expect(r.ok).toBe(true)
    const warn = r.issues.find(i => i.file === 'notes.md')
    expect(warn?.severity).toBe('warn')
  })

  it('问题清单稳定排序，便于两次运行对比', () => {
    const root = makeSpec({
      'env.yaml': 'repo: {}\n',
      'spec/rules.yaml': 'rules: nope\n',
    })
    const r = validateSpec(root)
    const files = r.issues.map(i => i.file)
    expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b)))
    expect(formatIssues(r)).toContain('个错误')
  })
})
