/**
 * 交付索引的形状与「必须交付」判定。
 *
 * 这一层只校形态：docs 必须是非空的仓库相对路径数组，绝对路径与 `..` 被拒；
 * 文件是否存在由 `deliverable_draft` 按仓库根复核，不在这里判。
 */
import { describe, expect, it } from 'vitest'

import { Deliverable, DELIVERY_KEYWORDS, mustDeliver } from '../src/schema/deliverable.js'
import { SpecLayout } from '../src/schema/spec.js'

const AT = '2026-11-13T10:00:00.000Z'

function valid(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task: 'T-01',
    summary: '补齐基础框架说明',
    docs: ['README.md', 'docs/architecture.md'],
    commands: ['pnpm typecheck'],
    created_at: AT,
    updated_at: AT,
    ...over,
  }
}

describe('交付索引 schema', () => {
  it('读得懂一份完整索引，commands 可省并默认空数组', () => {
    const parsed = Deliverable.parse(valid({ commands: undefined }))
    expect(parsed).toMatchObject({
      task: 'T-01',
      summary: '补齐基础框架说明',
      docs: ['README.md', 'docs/architecture.md'],
      commands: [],
    })
  })

  it('task 必须是形如 T-01 的编号', () => {
    expect(() => Deliverable.parse(valid({ task: 't1' }))).toThrow(/任务编号/)
  })

  it('summary 不能为空，docs 至少一条', () => {
    expect(() => Deliverable.parse(valid({ summary: '   ' }))).toThrow(/summary 不能为空/)
    expect(() => Deliverable.parse(valid({ docs: [] }))).toThrow(/至少登记一条/)
  })

  it('docs 拒绝空串、绝对路径与 .. 上跳', () => {
    expect(() => Deliverable.parse(valid({ docs: [''] }))).toThrow(/不能为空/)
    expect(() => Deliverable.parse(valid({ docs: ['C:/repo/README.md'] }))).toThrow(/不能是绝对路径/)
    expect(() => Deliverable.parse(valid({ docs: ['/README.md'] }))).toThrow(/不能是绝对路径/)
    expect(() => Deliverable.parse(valid({ docs: ['docs/../README.md'] }))).toThrow(/不能包含 \.\./)
    expect(() => Deliverable.parse(valid({ docs: ['..\\README.md'] }))).toThrow(/不能包含 \.\./)
  })

  it('commands 里的空字符串被拒，多余字段被 strict 拒', () => {
    expect(() => Deliverable.parse(valid({ commands: ['  '] }))).toThrow(/命令不能是空字符串/)
    expect(() => Deliverable.parse(valid({ extra: true }))).toThrow()
  })

  it('SpecLayout 把 deliverables/*.yaml 纳入校验', () => {
    const entry = SpecLayout.find(item => item.glob === 'deliverables/*.yaml')
    expect(entry).toBeDefined()
    expect(entry?.schema).toBe(Deliverable)
    expect(entry?.many).toBe(true)
  })
})

describe('必须交付判定', () => {
  const plain = { grade: 'B', title: '结算记录支持导出', description: '按日期导出 CSV。' }

  it('A 级、通用轨、基础或架构关键词都算必须交付', () => {
    expect(mustDeliver({ ...plain, grade: 'A' })).toBe(true)
    expect(mustDeliver({ ...plain, track: 'general' })).toBe(true)
    expect(mustDeliver({ ...plain, title: '搭建基础框架' })).toBe(true)
    expect(mustDeliver({ ...plain, title: '补脚手架' })).toBe(true)
    expect(mustDeliver({ ...plain, description: '这次要做架构调整。' })).toBe(true)
    expect(mustDeliver({ ...plain, description: '输出技术选型对比。' })).toBe(true)
  })

  it('普通 B/C 级非通用轨任务不必交付', () => {
    expect(mustDeliver(plain)).toBe(false)
    expect(mustDeliver({ ...plain, grade: 'C' })).toBe(false)
    expect(mustDeliver({ ...plain, track: 'h5' })).toBe(false)
  })

  it('关键词表只有四项：基础框架、脚手架、架构、技术选型', () => {
    expect(DELIVERY_KEYWORDS).toEqual(['基础框架', '脚手架', '架构', '技术选型'])
  })
})
