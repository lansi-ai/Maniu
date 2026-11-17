// @vitest-environment node
/** 提案投影读 requirement_change 载荷：new/revise 各字段透传，形状不合时缺省，旧提案照常。 */
import { describe, expect, it } from 'vitest'
import { proposalTextToRow } from '../src/spec/rows.ts'

const BASE = [
  'id: P-01',
  'title: 佣金改造',
  'problem: 影响面集中在结算。',
  'options:',
  '  - name: 登记新需求',
  '    summary: 佣金改造',
  '    cost: 需人对比确认',
  'recommendation: 建议采纳。',
  'decision: draft',
  'opened_at: 2026-11-17T10:00:00+08:00',
]

function yamlOf(change: readonly string[]): string {
  return [...BASE, 'requirement_change:', ...change.map(line => `  ${line}`), ''].join('\n')
}

describe('提案的需求变更载荷投影', () => {
  it('revise 载荷透传目标、基线、正文与分析', () => {
    const row = proposalTextToRow('P-01.yaml', yamlOf([
      'mode: revise',
      'target: REQ-01',
      'base_version: 2',
      'content: |',
      '    # 新正文',
      'analysis: 与现有需求不冲突。',
    ]))
    expect(row?.requirementChange).toEqual({
      mode: 'revise',
      target: 'REQ-01',
      baseVersion: 2,
      content: '# 新正文\n',
      analysis: '与现有需求不冲突。',
    })
  })

  it('new 载荷可无依据，也可成对记录依据', () => {
    const plain = proposalTextToRow('P-01.yaml', yamlOf(['mode: new', 'content: 正文', 'analysis: 分析']))
    expect(plain?.requirementChange).toEqual({ mode: 'new', content: '正文', analysis: '分析' })
    const based = proposalTextToRow('P-01.yaml', yamlOf([
      'mode: new', 'target: REQ-02', 'base_version: 1', 'content: 正文', 'analysis: 分析',
    ]))
    expect(based?.requirementChange).toMatchObject({ mode: 'new', target: 'REQ-02', baseVersion: 1 })
  })

  it('形状不合时载荷缺省：revise 缺目标或基线、new 依据不成对、缺正文或分析', () => {
    expect(proposalTextToRow('P-01.yaml', yamlOf(['mode: revise', 'content: 正文', 'analysis: 分析']))?.requirementChange).toBeUndefined()
    expect(proposalTextToRow('P-01.yaml', yamlOf(['mode: revise', 'target: REQ-01', 'content: 正文', 'analysis: 分析']))?.requirementChange).toBeUndefined()
    expect(proposalTextToRow('P-01.yaml', yamlOf(['mode: new', 'target: REQ-01', 'content: 正文', 'analysis: 分析']))?.requirementChange).toBeUndefined()
    expect(proposalTextToRow('P-01.yaml', yamlOf(['mode: new', 'content: 正文']))?.requirementChange).toBeUndefined()
    expect(proposalTextToRow('P-01.yaml', yamlOf(['mode: unknown', 'content: 正文', 'analysis: 分析']))?.requirementChange).toBeUndefined()
  })

  it('旧提案没有载荷照常解析', () => {
    const row = proposalTextToRow('P-01.yaml', `${BASE.join('\n')}\n`)
    expect(row?.id).toBe('P-01')
    expect(row?.requirementChange).toBeUndefined()
  })
})
