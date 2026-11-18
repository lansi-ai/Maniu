// @vitest-environment node
/** 需求详情纯函数：时间戳展示格式与评审报告三段解析。 */
import { describe, expect, it } from 'vitest'
import { formatTimestamp, parseReviewReport } from '../src/pages/requirement-report.ts'

describe('formatTimestamp', () => {
  it('带时区的 ISO 时刻按原文截成日期加时分', () => {
    expect(formatTimestamp('2026-11-17T13:24:09+08:00')).toBe('2026-11-17 13:24')
    expect(formatTimestamp('2026-11-17T13:24Z')).toBe('2026-11-17 13:24')
    expect(formatTimestamp('2026-11-17 13:24')).toBe('2026-11-17 13:24')
  })

  it('非法值与空值回退原文', () => {
    expect(formatTimestamp('昨天')).toBe('昨天')
    expect(formatTimestamp('')).toBe('')
    expect(formatTimestamp('—')).toBe('—')
    expect(formatTimestamp('2026-99-99T99:99:00+08:00')).toBe('2026-99-99T99:99:00+08:00')
  })
})

describe('parseReviewReport', () => {
  const REPORT = `# 评审报告

## 摘要

整体判断：需求基本可用，但边界没写清。

## 结论

需要修改。

## 待改项

- 位置：正文「范围」一节。建议写清代发订单不参与。优先级：高
- 位置：验收口径。建议补一条异常返回码。
  续行：说明重试次数。【中】
1. 位置：背景。建议删掉无关的竞品对比。优先级：低

## 其他

这一段不应进入卡片。`

  it('抽出摘要与待改项，逐条取优先级并保留续行', () => {
    const parsed = parseReviewReport(REPORT)
    expect(parsed.summary).toBe('整体判断：需求基本可用，但边界没写清。')
    expect(parsed.todos).toHaveLength(3)
    expect(parsed.todos[0]?.priority).toBe('high')
    expect(parsed.todos[0]?.text).toContain('正文「范围」一节')
    expect(parsed.todos[1]?.priority).toBe('medium')
    expect(parsed.todos[1]?.text).toContain('续行：说明重试次数')
    expect(parsed.todos[2]?.priority).toBe('low')
    expect(parsed.todos[2]?.text).not.toContain('1. ')
  })

  it('没有固定小节时两段都为空，不走卡片渲染', () => {
    expect(parseReviewReport('普通报告\n\n只是一段文字。')).toEqual({ summary: '', todos: [] })
  })

  it('待改项缺优先级标注时保留条目但不给徽标', () => {
    const parsed = parseReviewReport('## 待改项\n\n- 位置：标题。建议换短一点。')
    expect(parsed.todos).toHaveLength(1)
    expect(parsed.todos[0]?.priority).toBeUndefined()
  })
})
