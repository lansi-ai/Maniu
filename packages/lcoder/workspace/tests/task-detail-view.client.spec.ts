/**
 * 任务详情摘要派生的纯函数测：只取第一段人话，剥掉 Markdown 与来源前缀，跳过
 * 交代技术引用的句子，压成单行并按码点截断；没有正文时交回空串由界面给占位。
 *
 * 约定要点另测：冒号前主旨、首句截断、技术条过滤与回退、空数组。
 */
import { describe, expect, it } from 'vitest'
import {
  CONTRACT_HIGHLIGHT_LIMIT,
  CONTRACT_HIGHLIGHT_TEXT_LIMIT,
  contractHighlights,
  TASK_SUMMARY_LIMIT,
  taskDescriptionSummary,
} from '../src/client/shell/task-detail-view.ts'

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

  it('跳过只在交代技术引用的段落，取下一段人话', () => {
    const description = '需求依据：.spec/requirements/REQ-01.md 第四节【已确认】\n\n给登录接口加限流，防止撞库。'
    expect(taskDescriptionSummary(description)).toBe('给登录接口加限流，防止撞库。')
  })

  it('同一段里按句丢弃技术引用，保留人话', () => {
    const description = '.spec/requirements/REQ-01.md 第四节【已确认】；给登录加限流。'
    expect(taskDescriptionSummary(description)).toBe('给登录加限流。')
  })

  it('全部段落都在交代技术引用时返回空串', () => {
    const description = [
      '.spec/requirements/REQ-01.md 第四节【已确认】',
      '需求依据：.spec/requirements/REQ-02.md',
      '契约与规格见 docs/tasks.yaml，README 有登记',
      'R-12 为已确认条目',
    ].join('\n\n')
    expect(taskDescriptionSummary(description)).toBe('')
  })

  it('空描述、纯空白与只有符号时返回空串', () => {
    expect(taskDescriptionSummary('')).toBe('')
    expect(taskDescriptionSummary('  \n\n  ')).toBe('')
    expect(taskDescriptionSummary('## \n\n- \n\n> ')).toBe('')
  })
})

describe('约定要点', () => {
  const LABELS = { change: '要交付什么', acceptance: '怎么验收' }

  it('冒号前主旨优先：去掉冒号后的细节', () => {
    const highlights = contractHighlights({
      change: ['加登录限流：五分钟五次失败锁定'],
      acceptance: [],
    }, LABELS)
    expect(highlights).toEqual([{ label: '要交付什么', text: '加登录限流' }])
  })

  it('没有冒号时取首句，句末标点不进要点', () => {
    const highlights = contractHighlights({
      change: ['给登录接口加限流。同时记录审计日志。'],
      acceptance: ['Limit logins. Record audits.'],
    }, LABELS)
    expect(highlights).toEqual([
      { label: '要交付什么', text: '给登录接口加限流' },
      { label: '怎么验收', text: 'Limit logins' },
    ])
  })

  it('冒号前太短时退回首句，避免只剩标签', () => {
    const highlights = contractHighlights({ change: ['注意：锁定时间写十分钟'], acceptance: [] }, LABELS)
    expect(highlights).toEqual([{ label: '要交付什么', text: '注意：锁定时间写十分钟' }])
  })

  it('剥掉 Markdown、行内代码与清单符号', () => {
    const highlights = contractHighlights({
      change: ['- **加登录限流**：把 `lockout` 时间写进配置'],
      acceptance: [],
    }, LABELS)
    expect(highlights).toEqual([{ label: '要交付什么', text: '加登录限流' }])
  })

  it('技术条目排在后面：人话条目先占要点位', () => {
    const highlights = contractHighlights({
      change: ['给 better-sqlite3 加索引', '把登录失败次数写进审计日志', '调整 schema 校验'],
      acceptance: [],
    }, LABELS)
    expect(highlights.map(row => row.text)).toEqual([
      '把登录失败次数写进审计日志',
      '给 better-sqlite3 加索引',
      '调整 schema 校验',
    ])
  })

  it('人话条目不够时回退到技术条目，顺序按原文', () => {
    const highlights = contractHighlights({
      change: ['执行 pnpm 门禁', 'ALTER TABLE users ADD UNIQUE 索引', '记录审计日志'],
      acceptance: [],
    }, LABELS)
    expect(highlights.map(row => row.text)).toEqual(['记录审计日志', '执行 pnpm 门禁', 'ALTER TABLE users ADD UNIQUE 索引'])
  })

  it('两栏各最多三条，先要交付后怎么验收', () => {
    const change = ['一', '二', '三', '四'].map(text => `${text}：细节`)
    const acceptance = ['甲', '乙', '丙', '丁'].map(text => `${text}：细节`)
    const highlights = contractHighlights({ change, acceptance }, LABELS)
    expect(highlights).toHaveLength(CONTRACT_HIGHLIGHT_LIMIT * 2)
    expect(highlights.slice(0, CONTRACT_HIGHLIGHT_LIMIT).every(row => row.label === '要交付什么')).toBe(true)
    expect(highlights.slice(CONTRACT_HIGHLIGHT_LIMIT).every(row => row.label === '怎么验收')).toBe(true)
  })

  it('同一栏重复主旨只留第一条', () => {
    const highlights = contractHighlights({
      change: ['加登录限流：第一处', '加登录限流：第二处', '记录审计日志'],
      acceptance: [],
    }, LABELS)
    expect(highlights.map(row => row.text)).toEqual(['加登录限流', '记录审计日志'])
  })

  it('超长主旨按码点截断到上限并加省略号', () => {
    const highlights = contractHighlights({
      change: [`限${'制'.repeat(CONTRACT_HIGHLIGHT_TEXT_LIMIT + 20)}`],
      acceptance: [],
    }, LABELS)
    const text = highlights[0]?.text ?? ''
    expect(Array.from(text)).toHaveLength(CONTRACT_HIGHLIGHT_TEXT_LIMIT + 1)
    expect(text.endsWith('…')).toBe(true)
  })

  it('空数组与空白条目都不产要点', () => {
    expect(contractHighlights({ change: [], acceptance: [] }, LABELS)).toEqual([])
    expect(contractHighlights({ change: [' ', '## ', '- '], acceptance: [] }, LABELS)).toEqual([])
  })
})
