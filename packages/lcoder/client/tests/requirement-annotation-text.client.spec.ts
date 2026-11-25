// @vitest-environment jsdom
/** 批注卡显示层：Markdown 标记清理与按字数折叠片段。 */
import { describe, expect, it } from 'vitest'
import { cleanDiffSegments, foldSegmentsByChars } from '../src/pages/requirement-annotations.tsx'
import type { DiffSegment } from '../src/spec/revision-annotations.ts'

function textOf(segments: readonly DiffSegment[]): string {
  return segments.map(segment => segment.text).join('')
}

describe('批注片段 Markdown 清理', () => {
  it('粗体标记被拆到相邻片段时仍清理，正文片段保持原变更类型', () => {
    const cleaned = cleanDiffSegments([
      { kind: 'equal', text: '**' },
      { kind: 'added', text: '新增粗体' },
      { kind: 'equal', text: '**' },
    ])
    expect(cleaned).toEqual([{ kind: 'added', text: '新增粗体' }])
  })

  it('整段是列表时，无序列表换成圆点、缩进保留，有序列表原样', () => {
    const cleaned = cleanDiffSegments([{ kind: 'equal', text: '- 一项\n  - 子项\n1. 一步' }])
    expect(textOf(cleaned)).toBe('• 一项\n  • 子项\n1. 一步')
    expect(cleaned).toEqual([{ kind: 'equal', text: '• 一项\n  • 子项\n1. 一步' }])
  })

  it('整段只有删除片段时保留 removed 与删除线语义', () => {
    const cleaned = cleanDiffSegments([{ kind: 'removed', text: '**旧内容**' }])
    expect(cleaned).toEqual([{ kind: 'removed', text: '旧内容' }])
  })

  it('行首标题、反引号与链接只去掉标记，正文一字不少', () => {
    expect(textOf(cleanDiffSegments([{ kind: 'modified', text: '## 适用角色' }]))).toBe('适用角色')
    expect(textOf(cleanDiffSegments([{ kind: 'equal', text: '`REQ-01` 正文' }]))).toBe('REQ-01 正文')
    expect(textOf(cleanDiffSegments([{ kind: 'equal', text: '参见[设计稿](https://example.com/a)说明' }])))
      .toBe('参见设计稿说明')
  })

  it('标识符里的下划线不当强调标记吃掉', () => {
    const source = '字段 applied_version 与 pending_count 保持不变'
    const cleaned = cleanDiffSegments([{ kind: 'equal', text: source }])
    expect(textOf(cleaned)).toBe(source)
  })

  it('成对单星号强调清理内容保留，落单星号原样', () => {
    expect(textOf(cleanDiffSegments([{ kind: 'equal', text: '这是 *重点* 内容' }]))).toBe('这是 重点 内容')
    expect(textOf(cleanDiffSegments([{ kind: 'equal', text: '10 * 3 保持原样' }]))).toBe('10 * 3 保持原样')
  })

  it('相邻同类型片段合并，空片段不进入结果', () => {
    const cleaned = cleanDiffSegments([
      { kind: 'equal', text: '前' },
      { kind: 'equal', text: '后' },
      { kind: 'added', text: '' },
      { kind: 'added', text: '增' },
    ])
    expect(cleaned).toEqual([
      { kind: 'equal', text: '前后' },
      { kind: 'added', text: '增' },
    ])
  })

  it('表情等代理对字符不被标记清理切断', () => {
    expect(textOf(cleanDiffSegments([{ kind: 'added', text: '发布 🚀 后 **上线**' }])))
      .toBe('发布 🚀 后 上线')
  })
})

describe('批注片段按字数折叠', () => {
  it('字数正好等于上限时不隐藏、不出折叠', () => {
    const segments: readonly DiffSegment[] = [
      { kind: 'added', text: 'abcdef' },
      { kind: 'equal', text: 'ghij' },
    ]
    expect(foldSegmentsByChars(segments, 10)).toEqual({ shown: segments, hidden: false })
  })

  it('超出上限时在片段中间截断，被截断片段保持原类型', () => {
    const segments: readonly DiffSegment[] = [
      { kind: 'added', text: 'abcdef' },
      { kind: 'removed', text: 'ghij' },
    ]
    expect(foldSegmentsByChars(segments, 8)).toEqual({
      shown: [
        { kind: 'added', text: 'abcdef' },
        { kind: 'removed', text: 'gh' },
      ],
      hidden: true,
    })
  })

  it('上限为零或负数时不展示内容并标记隐藏', () => {
    expect(foldSegmentsByChars([{ kind: 'equal', text: '内容' }], 0)).toEqual({ shown: [], hidden: true })
    expect(foldSegmentsByChars([{ kind: 'equal', text: '内容' }], -5)).toEqual({ shown: [], hidden: true })
  })

  it('空片段与空输入都不产生折叠按钮', () => {
    expect(foldSegmentsByChars([], 10)).toEqual({ shown: [], hidden: false })
    expect(foldSegmentsByChars([{ kind: 'equal', text: '' }], 10)).toEqual({ shown: [], hidden: false })
  })
})
