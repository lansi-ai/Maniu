/** 原型质量门禁：可解析、区块、安全内联脚本放行与外链/网络请求拦截、体积、关键词命中与结构化失败项。 */
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

  it('允许自包含内联交互脚本（含比较符与 DOM 事件），不误判 UNPARSEABLE_HTML 或 UNSAFE_MARKUP', () => {
    const interactive = GOOD.replace(
      '</body>',
      '<script>const rows=[1,2];for(let i=0;i<rows.length;i++){console.log(i)};document.addEventListener("click",()=>{});</script></body>',
    )
    const report = validatePrototypeHtml(interactive, REQ)
    expect(report.ok).toBe(true)
    expect(report.failed).toEqual([])
    expect(report.passed).toContain('parseable')
    expect(report.passed).toContain('no-unsafe-markup')
  })

  it('外部脚本、网络请求、eval、iframe 与 http(s) 外链给出 UNSAFE_MARKUP 失败项', () => {
    const withExternalScript = GOOD.replace('<nav>', '<script src="https://cdn.example.com/a.js"></script><nav>')
    const report = validatePrototypeHtml(withExternalScript, REQ)
    expect(report.ok).toBe(false)
    expect(report.failed.some(issue => issue.code === 'UNSAFE_MARKUP')).toBe(true)

    const withFetch = GOOD.replace('</body>', '<script>fetch("/api/x")</script></body>')
    expect(validatePrototypeHtml(withFetch, REQ).failed.map(issue => issue.code)).toContain('UNSAFE_MARKUP')

    const withEval = GOOD.replace('</body>', '<script>eval("1+1")</script></body>')
    expect(validatePrototypeHtml(withEval, REQ).failed.map(issue => issue.code)).toContain('UNSAFE_MARKUP')

    const withIframe = GOOD.replace('<nav>', '<iframe src="https://example.com"></iframe><nav>')
    expect(validatePrototypeHtml(withIframe, REQ).failed.map(issue => issue.code)).toContain('UNSAFE_MARKUP')

    const withLink = GOOD.replace('<nav>', '<a href="https://example.com">外链</a><nav>')
    expect(validatePrototypeHtml(withLink, REQ).failed.map(issue => issue.code)).toContain('UNSAFE_MARKUP')
  })

  it('缺应用骨架给出 MISSING_SECTIONS，含具体缺项；多页面真实应用无页脚也通过', () => {
    const bare = '<!doctype html><html><head><title>登录页改造</title></head><body><h1>登录页改造</h1><p>邮箱登录与验证码入口，记住登录状态</p></body></html>'
    const report = validatePrototypeHtml(bare, REQ)
    const issue = report.failed.find(item => item.code === 'MISSING_SECTIONS')
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('导航结构')

    const spa = `<!doctype html><html><head><meta charset="utf-8"><title>登录页改造</title></head><body>
      <aside class="sidebar"><nav><button id="nav-login">邮箱登录</button><button id="nav-security">安全设置</button></nav></aside>
      <main><section data-view="login"><form><input placeholder="邮箱登录与验证码入口" /><button type="submit">记住登录状态</button></form></section></main>
      <script>document.getElementById('nav-login')?.addEventListener('click', () => {})</script>
    </body></html>`
    const spaReport = validatePrototypeHtml(spa, REQ)
    expect(spaReport.ok).toBe(true)
    expect(spaReport.failed).toEqual([])
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

  it('内联脚本语法错误给出 SCRIPT_SYNTAX_ERROR，引用不存在的 DOM id 给出 MISSING_SCRIPT_TARGET', () => {
    const badSyntax = GOOD.replace('</body>', '<script>function broken( {</script></body>')
    const syntaxReport = validatePrototypeHtml(badSyntax, REQ)
    expect(syntaxReport.ok).toBe(false)
    expect(syntaxReport.failed.map(issue => issue.code)).toContain('SCRIPT_SYNTAX_ERROR')

    const missingTarget = GOOD.replace('</body>', '<script>document.getElementById("nonExistentBtn").click()</script></body>')
    const targetReport = validatePrototypeHtml(missingTarget, REQ)
    expect(targetReport.ok).toBe(false)
    expect(targetReport.failed.map(issue => issue.code)).toContain('MISSING_SCRIPT_TARGET')
    expect(targetReport.failed.find(issue => issue.code === 'MISSING_SCRIPT_TARGET')?.message).toContain('nonExistentBtn')

    const existingTarget = GOOD
      .replace('<nav>', '<nav><button id="loginBtn">登录</button>')
      .replace('</body>', '<script>document.getElementById("loginBtn").addEventListener("click",()=>{})</script></body>')
    expect(validatePrototypeHtml(existingTarget, REQ).ok).toBe(true)
  })
})
