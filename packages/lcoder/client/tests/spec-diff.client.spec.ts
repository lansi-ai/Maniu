// @vitest-environment node
/** 行级差异与变更条目提取：提案对比视图的判定基础。 */
import { describe, expect, it } from 'vitest'
import { changedEntries, diffLines } from '../src/spec/diff.ts'

describe('行级差异', () => {
  it('相同正文全部 same', () => {
    const text = '# 标题\n\n- 条目一\n- 条目二'
    expect(diffLines(text, text).every(line => line.kind === 'same')).toBe(true)
  })

  it('新增与删除行各归其类，公共前后缀保持 same', () => {
    const oldText = '# 标题\n\n- 条目一\n- 条目二\n\n结尾'
    const newText = '# 标题\n\n- 条目一\n- 条目二改\n- 条目三\n\n结尾'
    const diff = diffLines(oldText, newText)
    expect(diff.filter(line => line.kind === 'removed').map(line => line.text)).toEqual(['- 条目二'])
    expect(diff.filter(line => line.kind === 'added').map(line => line.text)).toEqual(['- 条目二改', '- 条目三'])
    expect(diff[0]).toEqual({ kind: 'same', text: '# 标题' })
    expect(diff[diff.length - 1]).toEqual({ kind: 'same', text: '结尾' })
  })

  it('旧正文行只出现在 same/removed，新正文行只出现在 same/added', () => {
    const oldText = 'a\nb\nc'
    const newText = 'a\nx\nc\nd'
    const diff = diffLines(oldText, newText)
    expect(diff.filter(line => line.kind !== 'added').map(line => line.text)).toEqual(['a', 'b', 'c'])
    expect(diff.filter(line => line.kind !== 'removed').map(line => line.text)).toEqual(['a', 'x', 'c', 'd'])
  })

  it('空正文对非空正文：全部新增', () => {
    const diff = diffLines('', '# 新需求')
    expect(diff.filter(line => line.kind === 'added').map(line => line.text)).toEqual(['# 新需求'])
  })
})

describe('变更条目提取', () => {
  it('只收章节标题与清单条目，普通段落不算条目', () => {
    const diff = diffLines(
      '# 旧标题\n\n普通段落\n\n- 旧条目',
      '# 新标题\n\n普通段落改\n\n- 新条目\n\n## 新增章节',
    )
    const entries = changedEntries(diff)
    expect(entries).toEqual([
      { kind: 'removed', text: '# 旧标题' },
      { kind: 'added', text: '# 新标题' },
      { kind: 'removed', text: '- 旧条目' },
      { kind: 'added', text: '- 新条目' },
      { kind: 'added', text: '## 新增章节' },
    ])
  })

  it('有序清单与星号清单也认', () => {
    const diff = diffLines('1. 甲\n* 乙', '1. 甲改\n* 乙')
    expect(changedEntries(diff)).toEqual([
      { kind: 'removed', text: '1. 甲' },
      { kind: 'added', text: '1. 甲改' },
    ])
  })

  it('没有差异时条目为空', () => {
    expect(changedEntries(diffLines('# 标题', '# 标题'))).toEqual([])
  })
})
