/** 原型质量门禁：可解析、区块、零脚本零外链、体积、关键词命中与结构化失败项。 */
import { describe, expect, it } from 'vitest'

import { extractKeywords, isParseableHtml, keywordCoverage, MIN_KEYWORD_HIT_RATE, validatePrototypeHtml } from '../src/prototype/quality.js'

const REQ = '# 登录页改造\n\n## 功能\n用户需要邮箱登录与验证码入口，支持记住登录状态。\n'

const GOOD = `<!doctype html><html><head><meta charset="utf-8"><title>登录页改造</title>
<style>body{font-family:Inter;color:#123456}</style></head><body>
<nav>导航</nav><h1>登录页改造</h1>
<section class="features"><ul><li>邮箱登录与验证码入口</li><li>记住登录状态</li></ul></section>
<footer>页脚</footer></body></html>`

describe('isParseableHtml', () => {
  it('接受结构完整的 HTML', () => {
    expect(isParseableHtml(GOOD)).toBe(true)
  })
  it('拒绝缺少根元素或标签未闭合的 HTML', () => {
    expect(isParseableHtml('<div>no root</div>')).toBe(false)
    expect(isParseableHtml('<!doctype html><html><body><div>x</body></html>')).toBe(false)
  })
})

describe('关键词提取与命中', () => {
  it('从需求正文提取中文词块并统计命中', () => {
    const keywords = extractKeywords(REQ)
    expect(keywords.length).toBeGreaterThan(0)
    const coverage = keywordCoverage(GOOD, keywords)
    expect(coverage.hitRate).toBeGreaterThanOrEqual(MIN_KEYWORD_HIT_RATE)
    expect(coverage.hits.length + coverage.misses.length).toBe(keywords.length)
  })
  it('没有关键词时不判失败', () => {
    expect(keywordCoverage(GOOD, []).hitRate).toBe(1)
  })
})

describe('validatePrototypeHtml', () => {
  it('合格的玻璃卡片骨架通过全部校验', () => {
    const report = validatePrototypeHtml(GOOD, REQ)
    expect(report.failed).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.passed).toContain('no-unsafe-markup')
    expect(report.bytes).toBe(Buffer.byteLength(GOOD, 'utf8'))
  })

  it('脚本、iframe 与 http(s) 外链给出 UNSAFE_MARKUP 失败项', () => {
    const withScript = GOOD.replace('<nav>', '<script>alert(1)</script><nav>')
    const report = validatePrototypeHtml(withScript, REQ)
    expect(report.ok).toBe(false)
    expect(report.failed.some(issue => issue.code === 'UNSAFE_MARKUP')).toBe(true)

    const withIframe = GOOD.replace('<nav>', '<iframe src="https://example.com"></iframe><nav>')
    expect(validatePrototypeHtml(withIframe, REQ).failed.map(issue => issue.code)).toContain('UNSAFE_MARKUP')

    const withLink = GOOD.replace('<nav>', '<a href="https://example.com">外链</a><nav>')
    expect(validatePrototypeHtml(withLink, REQ).failed.map(issue => issue.code)).toContain('UNSAFE_MARKUP')
  })

  it('缺区块给出 MISSING_SECTIONS，含具体缺项', () => {
    const bare = '<!doctype html><html><head><title>登录页改造</title></head><body><h1>登录页改造</h1><p>邮箱登录与验证码入口，记住登录状态</p></body></html>'
    const report = validatePrototypeHtml(bare, REQ)
    const issue = report.failed.find(item => item.code === 'MISSING_SECTIONS')
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('顶部导航')
    expect(issue?.message).toContain('页脚')
  })

  it('超大 HTML 给出 HTML_TOO_LARGE', () => {
    const huge = GOOD.replace('</body>', `${'x'.repeat(512 * 1024)}</body>`)
    const report = validatePrototypeHtml(huge, REQ)
    expect(report.failed.map(issue => issue.code)).toContain('HTML_TOO_LARGE')
  })

  it('关键词命中过低给出 LOW_KEYWORD_COVERAGE，含未命中词', () => {
    const offTopic = GOOD.replaceAll('登录', '游戏').replaceAll('邮箱', '道具').replaceAll('验证码', '金币').replaceAll('记住登录状态', '购买装备')
    const report = validatePrototypeHtml(offTopic, REQ)
    const issue = report.failed.find(item => item.code === 'LOW_KEYWORD_COVERAGE')
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('命中率')
  })
})
