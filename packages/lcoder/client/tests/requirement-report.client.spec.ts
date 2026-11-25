// @vitest-environment node
/** 需求详情纯函数：时间戳展示格式与评审报告三段解析。 */
import { describe, expect, it } from 'vitest'
import { formatTimestamp, isConfirmableReviewReport, parseReviewReport } from '../src/pages/requirement-report.ts'

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
    expect(parsed.summary).toContain('整体判断：需求基本可用，但边界没写清。')
    // 「结论」也是摘要标题：该段文字并入摘要，但待改项条目不受影响。
    expect(parsed.summary).toContain('需要修改。')
    expect(parsed.todos).toHaveLength(3)
    expect(parsed.todos[0]?.priority).toBe('high')
    expect(parsed.todos[0]?.text).toContain('正文「范围」一节')
    expect(parsed.todos[1]?.priority).toBe('medium')
    expect(parsed.todos[1]?.text).toContain('续行：说明重试次数')
    expect(parsed.todos[2]?.priority).toBe('low')
    expect(parsed.todos[2]?.text).not.toContain('1. ')
  })

  it('每条待改项都有精简摘要，摘要去掉优先级标记但正文保留', () => {
    const parsed = parseReviewReport(REPORT)
    expect(parsed.todos.map(todo => todo.summary)).toEqual([
      '位置：正文「范围」一节。',
      '位置：验收口径。',
      '位置：背景。',
    ])
    for (const todo of parsed.todos) {
      expect(todo.summary).not.toContain('优先级')
      expect(todo.summary).not.toContain('【')
      expect(todo.summary.length).toBeGreaterThan(0)
      expect(todo.summary.length).toBeLessThanOrEqual(73)
    }
    expect(parsed.todos[0]?.text).toContain('优先级：高')
    expect(parsed.todos[1]?.text).toContain('【中】')
  })

  it('待改项按高、中、低、无优先级稳定排序，同级保持原报告顺序', () => {
    const parsed = parseReviewReport(`## 待改项

- 甲项待改。优先级：低
- 乙项待改。优先级：高
- 丙项待改。【中】
- 丁项待改。
- 戊项待改。优先级：中
- 己项待改。优先级：高
- 庚项待改。`)
    expect(parsed.todos.map(todo => todo.text)).toEqual([
      '乙项待改。优先级：高',
      '己项待改。优先级：高',
      '丙项待改。【中】',
      '戊项待改。优先级：中',
      '甲项待改。优先级：低',
      '丁项待改。',
      '庚项待改。',
    ])
    expect(parsed.todos.map(todo => todo.summary)).toEqual([
      '乙项待改。', '己项待改。', '丙项待改。', '戊项待改。', '甲项待改。', '丁项待改。', '庚项待改。',
    ])
  })

  it('摘要首句超过 72 字时按字数截断并补省略号', () => {
    const parsed = parseReviewReport(`## 待改项

- ${'很长的建议内容'.repeat(12)}。后续说明。优先级：高`)
    expect(parsed.todos[0]?.summary.endsWith('…')).toBe(true)
    expect(parsed.todos[0]?.summary.length).toBe(73)
    expect(parsed.todos[0]?.text).toContain('后续说明')
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

describe('parseReviewReport 四要素与分类', () => {
  const STRUCTURED = `## 摘要

整体需要改。

## 待改项

### 文档完备性

- **代发订单边界未写清**。位置：正文「范围」一节。问题：只写了普通订单的佣金规则。建议：补上代发订单不参与佣金。优先级：高

### 合理性

- 位置：验收口径。问题：异常返回码缺失。建议：补一条异常返回码。【中】

需求角度
- 位置：背景。建议：删掉无关的竞品对比。优先级：低`

  it('拆出标题、位置、问题与建议，标题取开头加粗并去掉星号与优先级标记', () => {
    const parsed = parseReviewReport(STRUCTURED)
    expect(parsed.todos).toHaveLength(3)
    const [first] = parsed.todos
    expect(first?.title).toBe('代发订单边界未写清')
    expect(first?.location).toBe('正文「范围」一节')
    expect(first?.problem).toBe('只写了普通订单的佣金规则')
    expect(first?.suggestion).toBe('补上代发订单不参与佣金')
    expect(first?.priority).toBe('high')
    expect(first?.text).toContain('优先级：高')
  })

  it('分类子标题写入 category 并延续到后续条目直到下一个分类', () => {
    const parsed = parseReviewReport(STRUCTURED)
    expect(parsed.todos.map(todo => todo.category)).toEqual(['文档完备性', '合理性', '需求角度'])
  })

  it('无加粗时用破折号前或第一句作标题，缺字段时留空串', () => {
    const parsed = parseReviewReport(`## 待改项

- 核心问题未点明——位置：标题。建议换短一点。优先级：中
- 位置：验收。建议补异常码。`)
    const [first, second] = parsed.todos
    expect(first?.title).toBe('核心问题未点明')
    expect(first?.location).toBe('标题')
    expect(first?.suggestion).toBe('换短一点')
    expect(first?.problem).toBe('')
    expect(second?.title).toBe('验收')
    expect(second?.category).toBeUndefined()
  })

  it('旧格式仍产出非空 title，并向后续条目延续分类', () => {
    const parsed = parseReviewReport(`## 待改项

文档完备性
- 位置：正文「范围」一节。建议写清代发订单不参与。优先级：高
- 位置：验收口径。建议补一条异常返回码。
  续行：说明重试次数。【中】`)
    expect(parsed.todos).toHaveLength(2)
    expect(parsed.todos.every(todo => todo.category === '文档完备性')).toBe(true)
    expect(parsed.todos[0]?.title).toBe('正文「范围」一节')
    expect(parsed.todos[0]?.text).not.toContain('续行：说明重试次数')
    expect(parsed.todos[1]?.text).toContain('续行：说明重试次数')
  })
})

describe('parseReviewReport Markdown 表格', () => {
  /** 与 lcoder/scripts/seed-sandbox.mjs 里 REQ-01 的 R1 报告同款。 */
  const SEED_TABLE_REPORT = `# REQ-01 评审报告 R1

## 评审结论
整体流程清晰，建议补充以下 3 项细节后再定稿：

| 编号 | 严重度 | 所在章节 | 问题说明 | 修改建议 |
| --- | --- | --- | --- | --- |
| 1 | 高 | 报销录入表单 | 未明确单笔报销金额上限及超限提示 | 补充单笔上限 5000 元校验，超限需拆单或备注审批说明 |
| 2 | 中 | 报销录入表单 | 缺少凭证/发票附件字段说明 | 明确支持上传图片或 PDF 发票，或勾选「无票说明」 |
| 3 | 低 | 近期报销记录列表 | 未定义空态展示文案 | 补充无记录时的空态引导文案与新建按钮 |
`

  it('混排章节：引导句进摘要，表格行产出 3 条待改项并拆出四要素', () => {
    const parsed = parseReviewReport(SEED_TABLE_REPORT)
    expect(parsed.summary).toBe('整体流程清晰，建议补充以下 3 项细节后再定稿：')
    expect(parsed.todos).toHaveLength(3)
    const [first, second, third] = parsed.todos
    expect(first?.priority).toBe('high')
    expect(first?.location).toBe('报销录入表单')
    expect(first?.title).toBe('未明确单笔报销金额上限及超限提示')
    expect(first?.problem).toBe('未明确单笔报销金额上限及超限提示')
    expect(first?.suggestion).toBe('补充单笔上限 5000 元校验，超限需拆单或备注审批说明')
    expect(first?.text).toContain('未明确单笔报销金额上限及超限提示')
    expect(first?.text).toContain('位置：报销录入表单')
    expect(first?.text).toContain('建议：补充单笔上限 5000 元校验')
    expect(first?.summary).toContain('未明确单笔报销金额上限及超限提示')
    expect(second?.priority).toBe('medium')
    expect(second?.location).toBe('报销录入表单')
    expect(second?.problem).toBe('缺少凭证/发票附件字段说明')
    expect(second?.suggestion).toBe('明确支持上传图片或 PDF 发票，或勾选「无票说明」')
    expect(third?.priority).toBe('low')
    expect(third?.location).toBe('近期报销记录列表')
    expect(third?.problem).toBe('未定义空态展示文案')
    expect(third?.suggestion).toBe('补充无记录时的空态引导文案与新建按钮')
  })

  it('表格待改项与列表解析保持同一字段契约，并按优先级稳定排序', () => {
    const parsed = parseReviewReport(SEED_TABLE_REPORT)
    expect(parsed.todos.map(todo => todo.priority)).toEqual(['high', 'medium', 'low'])
    for (const todo of parsed.todos) {
      expect(Object.keys(todo).sort()).toEqual([
        'location', 'priority', 'problem', 'suggestion', 'summary', 'text', 'title',
      ])
      expect(todo.title.length).toBeGreaterThan(0)
      expect(todo.location.length).toBeGreaterThan(0)
      expect(todo.problem.length).toBeGreaterThan(0)
      expect(todo.suggestion.length).toBeGreaterThan(0)
      expect(todo.summary.length).toBeGreaterThan(0)
      expect(todo.summary.length).toBeLessThanOrEqual(73)
    }
  })

  it('独立待改项标题下的表格同样解析，表头与分隔行不进入结果', () => {
    const parsed = parseReviewReport(`## 问题清单

| 优先级 | 位置 | 问题说明 | 修改建议 |
| --- | --- | --- | --- |
| 高 | 验收口径 | 异常返回码缺失 | 补一条异常返回码 |
| 低 | 背景 | 竞品对比无关 | 删掉竞品对比 |`)
    expect(parsed.todos).toHaveLength(2)
    expect(parsed.todos[0]?.priority).toBe('high')
    expect(parsed.todos[0]?.location).toBe('验收口径')
    expect(parsed.todos[0]?.problem).toBe('异常返回码缺失')
    expect(parsed.todos[1]?.priority).toBe('low')
    expect(parsed.todos.every(todo => !todo.text.includes('优先级') || todo.text.includes('优先级：'))).toBe(true)
  })
})

describe('parseReviewReport 兼容多种优先级前缀与 R2.md 格式', () => {
  it('解析标准结构化 Markdown：- [高] **一句话核心问题** —— 位置：...。问题：...。建议：...', () => {
    const parsed = parseReviewReport(`## 待改项

### 文档完备性

- [高] **代发订单未说明是否计入佣金** —— 位置：## 适用角色与范围边界。问题：仅写了自营订单规则。建议：补充代发订单不参与佣金分摊
- [中] **缺少空态提示** —— 位置：## 权限、空态与异常边界。问题：无记录时未说明展示内容。建议：补充空态引导文案
- [低] **验收标准缺少编号** —— 位置：## 验收标准。问题：使用了无序列表。建议：改为 AC-1、AC-2 编号`)

    expect(parsed.todos).toHaveLength(3)
    expect(parsed.todos[0]).toMatchObject({
      priority: 'high',
      category: '文档完备性',
      title: '代发订单未说明是否计入佣金',
      location: '## 适用角色与范围边界',
      problem: '仅写了自营订单规则',
      suggestion: '补充代发订单不参与佣金分摊',
    })
    expect(parsed.todos[1]?.priority).toBe('medium')
    expect(parsed.todos[2]?.priority).toBe('low')
  })

  it('解析 R2.md 真实格式（- **高**｜位置：`## ...`...。建议：...），title 不得为裸优先级词', () => {
    const parsed = parseReviewReport(`## 待改项

- **高**｜位置：\`## 核心用户流程\` 流程 2（审批流转）缺少驳回后重新提交的状态说明。建议：补充驳回后回到草稿态并允许重新提交的规则
- **中**｜位置：\`## 功能与业务规则\` 第 3 条使用了「合理提示」等模糊词。建议：改为明确提示文案「金额不能超过 5000 元」
- **低**｜位置：\`## 背景与目标\` 背景描述偏长。建议：精简为两句话`)

    expect(parsed.todos).toHaveLength(3)
    expect(parsed.todos.map(todo => todo.priority)).toEqual(['high', 'medium', 'low'])
    for (const todo of parsed.todos) {
      expect(['高', '中', '低']).not.toContain(todo.title)
      expect(todo.title.length).toBeGreaterThan(0)
      expect(todo.title).not.toContain('`')
      expect(todo.title).not.toContain('## ')
      expect(todo.location.length).toBeGreaterThan(0)
      expect(todo.suggestion.length).toBeGreaterThan(0)
    }
    expect(parsed.todos[0]?.title).toBe('核心用户流程 流程 2（审批流转）缺少驳回后重新提交的状态说明')
    expect(parsed.todos[0]?.suggestion).toBe('补充驳回后回到草稿态并允许重新提交的规则')
    expect(parsed.todos[1]?.title).toBe('功能与业务规则 第 3 条使用了「合理提示」等模糊词')
    expect(parsed.todos[2]?.title).toBe('背景与目标 背景描述偏长')
  })

  it('解析 [P0] / 【P1】 / 高｜... 等优先级变体', () => {
    const parsed = parseReviewReport(`## 待改项

- [P0] **登录超时未提示** —— 位置：第 5 章。问题：超时后直接跳转。建议：增加 Toast 提示
- 【P1】 验收标准缺少错误码 —— 位置：第 6 章。建议：补充 401/403 说明
- 高｜位置：背景与目标。问题：缺少量化指标。建议：补充转化率目标
- [P2] **字段命名不统一** —— 位置：第 4 章。问题：同一字段叫法不一致。建议：统一为「报销单号」`)

    expect(parsed.todos).toHaveLength(4)
    expect(parsed.todos.map(todo => todo.priority)).toEqual(['high', 'high', 'medium', 'low'])
    expect(parsed.todos[0]?.title).toBe('登录超时未提示')
    expect(parsed.todos[1]?.title).toBe('背景与目标')
    expect(parsed.todos[2]?.title).toBe('验收标准缺少错误码')
    expect(parsed.todos[3]?.title).toBe('字段命名不统一')
  })
})

describe('isConfirmableReviewReport', () => {
  it('结论为可以确认且无待改项时返回 true', () => {
    expect(isConfirmableReviewReport('## 结论\n可以确认\n\n## 待改项\n无')).toBe(true)
    expect(isConfirmableReviewReport('## 评审结论\n整体完备，可以确认。')).toBe(true)
  })

  it('结论含需要修改或存在待改项时返回 false', () => {
    expect(isConfirmableReviewReport('## 结论\n需要修改\n\n## 待改项\n无')).toBe(false)
    expect(isConfirmableReviewReport('## 结论\n可以确认，但仍需要修改部分边界\n\n## 待改项\n无')).toBe(false)
    expect(isConfirmableReviewReport('## 结论\n可以确认\n\n## 待改项\n- 位置：范围。建议：补充边界。')).toBe(false)
  })
})
