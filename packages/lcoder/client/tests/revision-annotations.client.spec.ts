// @vitest-environment node
/** 修改批注的语义分块、多版血缘、删除锚定、词级片段与版本筛选。 */
import { describe, expect, it } from 'vitest'
import {
  deriveRevisionAnnotations,
  diffSegments,
  splitMarkdownBlocks,
  visibleAnnotationBlockIds,
  visibleAnnotationCards,
  type VersionSnapshot,
} from '../src/spec/revision-annotations.ts'

const V1 = `# 需求标题

## 背景
初版说明，将表单退回率降低 30% 以上。

## 范围
- 项目 A
- 项目 B

## 验收
满足基本流程。
`

const V2 = `# 需求标题

## 背景
初版说明，将表单退回率降低 50% 以上。

## 范围
- 项目 A
- 项目 B
- 项目 C

## 验收
满足基本流程。

## 安全
需要记录操作人。
`

const V3 = `# 需求标题

## 背景
轻量说明，将表单退回率降低 50% 以上。

## 范围
- 项目 A
- 项目 B
- 项目 C

## 安全
需要记录操作人。
`

const SNAPSHOTS: readonly VersionSnapshot[] = [
  { version: 1, at: '2026-11-18T09:00:00+08:00', note: '初稿', text: V1 },
  { version: 2, at: '2026-11-19T10:00:00+08:00', note: '补充项目 C 与安全边界', text: V2 },
  { version: 3, at: '2026-11-23T14:20:00+08:00', note: '细化背景描述并移除验收章节', text: V3 },
]

describe('语义分块', () => {
  it('按标题、段落、列表与代码块切分并保留原文顺序', () => {
    const text = '# 标题\n\n一段说明。\n\n- 甲\n- 乙\n\n| 列 | 值 |\n| --- | --- |\n| a | b |\n\n\`\`\`js\nconst x = 1\n\`\`\`\n'
    const blocks = splitMarkdownBlocks(text)
    expect(blocks.map(block => block.kind)).toEqual(['heading', 'paragraph', 'list', 'table', 'code'])
    expect(blocks.map(block => block.text)).toEqual([
      '# 标题',
      '一段说明。',
      '- 甲\n- 乙',
      '| 列 | 值 |\n| --- | --- |\n| a | b |',
      '```js\nconst x = 1\n```',
    ])
    expect(blocks.map(block => block.id)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4'])
  })
})

describe('词级 diff', () => {
  it('中英混排按词与字切成 equal/removed/added 片段', () => {
    const segments = diffSegments('将表单退回率降低 30% 以上。', '将表单退回率降低 50% 以上。')
    expect(segments.find(segment => segment.kind === 'removed')?.text).toBe('30')
    expect(segments.find(segment => segment.kind === 'added')?.text).toBe('50')
    expect(segments.filter(segment => segment.kind === 'equal').map(segment => segment.text).join('')).toBe('将表单退回率降低 % 以上。')
  })

  it('相同文本只有一段 equal', () => {
    expect(diffSegments('同一段', '同一段')).toEqual([{ kind: 'equal', text: '同一段' }])
  })
})

describe('多版本血缘与批注派生', () => {
  const data = deriveRevisionAnnotations(SNAPSHOTS, V3)

  it('同一段跨 v2、v3 连续修改，卡内按时间倒序列出每次记录', () => {
    const card = data.cards.find(entry => entry.kind === 'modified' && entry.entries.length === 2)
    expect(card).toBeDefined()
    expect(card?.entries.map(entry => entry.version)).toEqual([3, 2])
    expect(card?.entries[0]?.segments.some(segment => segment.kind === 'removed')).toBe(true)
    expect(card?.latestVersion).toBe(3)
    expect(card?.reason).toBe('细化背景描述并移除验收章节')
  })

  it('新增块在 v2 落卡，修改原因来自版本备注', () => {
    const added = data.cards.filter(entry => entry.kind === 'added')
    expect(added).toHaveLength(2)
    expect(added.every(entry => entry.latestVersion === 2)).toBe(true)
    expect(added[0]?.reason).toBe('补充项目 C 与安全边界')
  })

  it('v3 删除的整块锚定到当前正文最邻近的存活块并保留原文', () => {
    const removed = data.cards.filter(entry => entry.kind === 'removed')
    expect(removed).toHaveLength(1)
    expect(removed[0]?.deletions.map(entry => entry.segments[0]?.text).sort()).toEqual(['## 验收', '满足基本流程。'])
    const safeBlock = data.blocks.find(block => block.text === '## 安全')
    expect(safeBlock).toBeDefined()
    expect(removed.every(entry => entry.anchor?.blockId === safeBlock?.id && entry.anchor.side === 'before')).toBe(true)
    expect(removed.every(entry => entry.latestVersion === 3)).toBe(true)
  })

  it('当前正文块沿用最新快照的血缘编号', () => {
    expect(data.blocks.map(block => block.id)).toHaveLength(7)
    expect(new Set(data.blocks.map(block => block.id)).size).toBe(7)
    expect(data.blocks.find(block => block.text === '轻量说明，将表单退回率降低 50% 以上。')?.id)
      .toBe(data.cards.find(entry => entry.kind === 'modified' && entry.entries.length === 2)?.blockId)
  })
})

describe('版本筛选', () => {
  const data = deriveRevisionAnnotations(SNAPSHOTS, V3)

  it('all 不过滤，v2 只留 v2 留下的批注与高亮块', () => {
    expect(visibleAnnotationCards(data.cards, 'all')).toHaveLength(data.changeCount)
    const v2Cards = visibleAnnotationCards(data.cards, 2)
    expect(v2Cards.length).toBeGreaterThan(0)
    expect(v2Cards.every(card => card.entries.some(entry => entry.version === 2))).toBe(true)
    const ids = visibleAnnotationBlockIds(data.cards, 2)
    expect([...ids]).toEqual(v2Cards.filter(card => card.kind !== 'removed').map(card => card.blockId))
  })

  it('v3 包含删除卡但不包含只在 v2 改过的块', () => {
    const v3Cards = visibleAnnotationCards(data.cards, 3)
    expect(v3Cards.some(card => card.kind === 'removed')).toBe(true)
    expect(v3Cards.every(card =>
      !card.entries.some(entry => entry.version === 2)
      || card.entries.some(entry => entry.version === 3))).toBe(true)
  })
})

describe('单版本', () => {
  it('只有一份快照且正文未变时不产生批注', () => {
    const data = deriveRevisionAnnotations(
      [{ version: 1, at: '2026-11-18T09:00:00+08:00', note: '初稿', text: V1 }],
      V1,
    )
    expect(data.cards).toEqual([])
    expect(data.changeCount).toBe(0)
    expect(data.versions).toEqual([1])
  })

  it('单版快照与当前正文不同时按同版派生修改', () => {
    const data = deriveRevisionAnnotations(
      [{ version: 1, at: '2026-11-18T09:00:00+08:00', note: '初稿', text: V1 }],
      V2,
    )
    expect(data.cards.length).toBeGreaterThan(0)
    expect(data.cards.every(card => card.entries.every(entry => entry.version === 1))).toBe(true)
  })
})
