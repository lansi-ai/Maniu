/** 网页样式摘要：URL 白名单、结构化字段、长度上限与不可信内容隔离。 */
import { describe, expect, it } from 'vitest'

import { assertFetchableUrl, MAX_SUMMARY_CHARS, PrototypeError, summarizeHtml } from '../src/prototype/summary.js'

describe('assertFetchableUrl', () => {
  it('放行 http 与 https', () => {
    expect(assertFetchableUrl('https://example.com/a?b=1').href).toBe('https://example.com/a?b=1')
    expect(assertFetchableUrl('http://example.org').protocol).toBe('http:')
  })

  it.each([
    'file:///etc/passwd',
    'data:text/html,<h1>x</h1>',
    'javascript:alert(1)',
    'http://localhost:8080',
    'http://127.0.0.1',
    'http://[::1]/',
    'http://192.168.1.10',
    'http://10.0.0.5',
    'http://172.16.0.1',
    'http://169.254.169.254/latest/meta-data',
    'http://user:pass@example.com',
    'not a url',
  ])('拒绝 %s', (url) => {
    expect(() => assertFetchableUrl(url)).toThrow(PrototypeError)
  })
})

describe('summarizeHtml', () => {
  const PAGE = `<!doctype html><html><head>
    <title>示例商城</title>
    <style>body{font-family:Inter,Arial;color:#1a2b3c} .btn{border-radius:12px;background:#ff6600;display:flex}</style>
    <script>window.secret='do-not-leak'</script>
    </head><body><h1>欢迎</h1><h2>新品上架</h2><p>这是一段给模型看的正文。</p>
    <button class="btn">立即购买</button></body></html>`

  it('只回结构化摘要，不回传脚本或样式表原文', () => {
    const summary = summarizeHtml('https://example.com', PAGE)
    expect(summary.title).toBe('示例商城')
    expect(summary.headings).toContain('欢迎')
    expect(summary.text).toContain('这是一段给模型看的正文')
    expect(summary.colors).toContain('#ff6600')
    expect(summary.font).toContain('Inter')
    expect(summary.layout).toContain('flex')
    expect(summary.buttonStyle).toContain('圆角')
    expect(JSON.stringify(summary)).not.toContain('do-not-leak')
    expect(JSON.stringify(summary)).not.toContain('font-family:Inter')
  })

  it('总长受上限约束，超长页面标出 truncated', () => {
    const huge = `<html><head><title>${'标'.repeat(600)}</title></head><body>${'正文'.repeat(20000)}</body></html>`
    const summary = summarizeHtml('https://example.com', huge)
    expect(JSON.stringify(summary).length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS + 200)
    expect(summary.text.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS)
    expect(summary.truncated).toBe(true)
  })

  it('没有样式信息时给出空字段，不编造', () => {
    const summary = summarizeHtml('https://example.com', '<html><body>plain</body></html>')
    expect(summary.colors).toEqual([])
    expect(summary.font).toBe('')
    expect(summary.layout).toBe('')
    expect(summary.buttonStyle).toBe('')
    expect(summary.text).toBe('plain')
  })
})
