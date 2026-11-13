/**
 * 任务详情摘要派生的纯函数测：只取第一段有效文字，剥掉 Markdown 与来源前缀，
 * 压成单行并按码点截断；没有正文时交回空串由界面给占位。
 */
import { describe, expect, it } from 'vitest'
import { TASK_SUMMARY_LIMIT, taskDescriptionSummary } from '../src/client/shell/task-detail-view.ts'

describe('任务描述摘要', () => {
  it('取第一段有效文字，后面的段落不进摘要', () => {
    const description = '先给登录加限流。\n先给登录加限流第二句。\n\n第二段：这是背景。\n\n第三段：这是验收。'
    expect(taskDescriptionSummary(description)).toBe('先给登录加限流。先给登录加限流第二句。')
  })

  it('跳过只有标题或符号的前导段', () => {
    const description = '## 背景\n\n### 目标\n\n- 给登录加限流\n\n需求依据：REQ-01'
    expect(taskDescriptionSummary(description)).toBe('给登录加限流')
  })

  it('只有标题时退回标题文字，不把整段丢掉', () => {
    expect(taskDescriptionSummary('## 实现登录限流')).toBe('实现登录限流')
    expect(taskDescriptionSummary('## 背景\n\n### 目标')).toBe('背景')
  })

  it('剥掉标题、清单、引用与任务框符号', () => {
    const description = [
      '## 实现登录限流',
      '- 五分钟五次失败锁定',
      '- [ ] 记录审计日志',
      '> 出处：安全基线',
    ].join('\n')
    expect(taskDescriptionSummary(description)).toBe('实现登录限流五分钟五次失败锁定记录审计日志出处：安全基线')
  })

  it('剥掉来源前缀；只剩编号的引用行整行丢弃', () => {
    const description = '需求背景：登录接口需要限流，防止撞库。\n需求依据：REQ-01\n来源: docs/security.md'
    expect(taskDescriptionSummary(description)).toBe('登录接口需要限流，防止撞库。')
  })

  it('去掉加粗、行内代码与链接语法', () => {
    const description = '**重点**：把 `lockout` 时间写进 [安全文档](docs/security.md)。'
    expect(taskDescriptionSummary(description)).toBe('重点：把 lockout 时间写进 安全文档。')
  })

  it('英文软换行保留空格，中文软换行不插空格', () => {
    expect(taskDescriptionSummary('Limit login\nfailures.')).toBe('Limit login failures.')
    expect(taskDescriptionSummary('给登录加限流\n并记录审计日志')).toBe('给登录加限流并记录审计日志')
  })

  it('兼容 CRLF 段落分隔', () => {
    expect(taskDescriptionSummary('第一段。\r\n\r\n第二段。')).toBe('第一段。')
  })

  it('超过上限按码点截断并加省略号', () => {
    const description = '限'.repeat(TASK_SUMMARY_LIMIT + 20)
    const summary = taskDescriptionSummary(description)
    expect(Array.from(summary)).toHaveLength(TASK_SUMMARY_LIMIT + 1)
    expect(summary.endsWith('…')).toBe(true)
    expect(summary.startsWith('限'.repeat(TASK_SUMMARY_LIMIT))).toBe(true)
  })

  it('上限之内原样保留，不加省略号', () => {
    const description = '限'.repeat(TASK_SUMMARY_LIMIT)
    expect(taskDescriptionSummary(description)).toBe(description)
  })

  it('空描述、纯空白与只有符号时返回空串', () => {
    expect(taskDescriptionSummary('')).toBe('')
    expect(taskDescriptionSummary('  \n\n  ')).toBe('')
    expect(taskDescriptionSummary('## \n\n- \n\n> ')).toBe('')
  })
})
