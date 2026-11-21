/** T-299：原型 Remote 的窄调用与提示词拼装。 */
import { describe, expect, it, vi } from 'vitest'

import { buildPrototypePrompt, styleSummaryText } from '../src/prototype/prompt.ts'
import { prefetchStyle, uploadPrototypeRef, clearPrototype, adoptPrototype, readPrototypeHtml } from '../src/prototype/remote.ts'
import { WORKSPACE_READ_LINES } from '../src/spec/files.ts'
import { requirementTextToRow } from '../src/spec/rows.ts'

const YAML = [
  'id: REQ-01',
  'title: 登录改造',
  'state: draft',
  'opened_at: 2026-11-20T00:00:00.000Z',
  'prototype:',
  '  path: prototypes/REQ-01/index.html',
  '  generatedAt: 2026-11-20T01:00:00.000Z',
  '  quality:',
  '    passed:',
  '      - no-unsafe-markup',
  '    failed: []',
  '    keywordHitRate: 1',
  '    keywords:',
  '      - 登录改造',
  '    hits:',
  '      - 登录改造',
  '    misses: []',
  '  adoptedAt: 2026-11-20T02:00:00.000Z',
].join('\n')

describe('原型 Remote', () => {
  it('prefetch 只取结构化摘要字段', async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      value: {
        url: 'https://example.com', title: '示例', headings: ['标题'], text: '正文',
        colors: ['#123456'], font: 'Inter', layout: 'flex', buttonStyle: '圆角', truncated: false,
      },
    }))
    const result = await prefetchStyle('https://example.com', call)
    expect(result).toMatchObject({ title: '示例', colors: ['#123456'], font: 'Inter' })
    expect(call).toHaveBeenCalledWith('prototype', 'prefetch', { input: { url: 'https://example.com' } })
  })

  it('非法 URL 的失败回执抛带 code 的错误', async () => {
    const call = vi.fn(async () => ({ ok: false as const, error: { code: 'PROTOTYPE/INVALID_URL', message: '只允许 http 或 https' } }))
    await expect(prefetchStyle('file:///etc/passwd', call)).rejects.toMatchObject({ name: 'PROTOTYPE/INVALID_URL' })
  })

  it('上传、采纳与清除都走原型命名空间的窄方法', async () => {
    const call = vi.fn(async () => ({ ok: true as const, value: { path: 'prototypes/REQ-01/refs/a.png', bytes: 3 } }))
    expect(await uploadPrototypeRef('s1', 'REQ-01', 'a.png', 'YWJj', call)).toEqual({ path: 'prototypes/REQ-01/refs/a.png', bytes: 3 })
    expect(call).toHaveBeenCalledWith('prototype', 'uploadRef', {
      input: { sessionId: 's1', requirementId: 'REQ-01', name: 'a.png', data: 'YWJj' },
    })
    await adoptPrototype('s1', 'REQ-01', call)
    expect(call).toHaveBeenCalledWith('prototype', 'adopt', { input: { sessionId: 's1', requirementId: 'REQ-01' } })
    await clearPrototype('s1', 'REQ-01', call)
    expect(call).toHaveBeenCalledWith('prototype', 'clear', { input: { sessionId: 's1', requirementId: 'REQ-01' } })
  })

  it('原型 HTML 按宿主上限读取，不超过 maxLines', async () => {
    const call = vi.fn(async () => ({ ok: true as const, value: { text: '<html></html>' } }))
    const html = await readPrototypeHtml('s1', {
      path: 'prototypes/REQ-01/index.html',
      generatedAt: '2026-11-20T00:00:00.000Z',
      references: [],
    }, call)
    expect(html).toBe('<html></html>')
    expect(call).toHaveBeenCalledWith('workspaceFiles', 'read', {
      workspaceFileScopeId: 's1',
      path: '.spec/prototypes/REQ-01/index.html',
      range: { offset: 1, limit: WORKSPACE_READ_LINES },
    })
    expect(WORKSPACE_READ_LINES).toBeLessThanOrEqual(5000)
  })
})

describe('原型提示词', () => {
  it('把需求正文、样式摘要与参考图拼进提示词', () => {
    const prompt = buildPrototypePrompt({
      requirementId: 'REQ-01',
      requirementTitle: '登录改造',
      requirementText: '# 登录改造\n\n邮箱登录与验证码入口。',
      summary: {
        url: 'https://example.com', title: '示例', headings: [], text: '正文节选',
        colors: ['#123456'], font: 'Inter', layout: 'flex', buttonStyle: '圆角', truncated: false,
      },
      refs: [{ path: 'prototypes/REQ-01/refs/a.png', name: 'a.png' }],
    })
    expect(prompt).toContain('邮箱登录与验证码入口')
    expect(prompt).toContain('prototypes/REQ-01/refs/a.png')
    expect(prompt).toContain('零 JavaScript')
    expect(prompt).toContain('prototype_draft')
    expect(styleSummaryText(undefined)).toContain('没有网页样式参考')
  })

  it('区块重生成只改目标区块、复用同一路径', () => {
    const prompt = buildPrototypePrompt({
      requirementId: 'REQ-01',
      requirementTitle: '登录改造',
      requirementText: '正文',
      summary: undefined,
      refs: [],
      section: '主视觉区',
    })
    expect(prompt).toContain('只重做「主视觉区」区块')
    expect(prompt).toContain('其它区块的内容与结构保持不变')
  })

  it('元素修改模式带 domPath、元素 HTML/CSS 与指令，要求调用 prototype_patch', () => {
    const prompt = buildPrototypePrompt({
      requirementId: 'REQ-01',
      requirementTitle: '登录改造',
      requirementText: '邮箱登录与验证码入口。',
      summary: undefined,
      refs: [],
      patch: {
        domPath: 'body:nth-child(2) > button:nth-child(3)',
        html: '<button class="submit">登录</button>',
        css: 'color: #333; font-size: 16px',
        instruction: '把按钮改成主色',
      },
    })
    expect(prompt).toContain('元素级修改')
    expect(prompt).toContain('body:nth-child(2) > button:nth-child(3)')
    expect(prompt).toContain('<button class="submit">登录</button>')
    expect(prompt).toContain('color: #333; font-size: 16px')
    expect(prompt).toContain('把按钮改成主色')
    expect(prompt).toContain('prototype_patch')
    expect(prompt).not.toContain('prototype_draft')
  })
})

describe('原型投影', () => {
  it('旧 YAML 没有 prototype 字段仍可投影；新字段读出质量与采纳时刻', () => {
    const old = requirementTextToRow('REQ-01.yaml', YAML.split('  path:')[0] + 'state: draft\n')
    expect(old?.prototype).toBeUndefined()
    const row = requirementTextToRow('REQ-01.yaml', YAML)
    expect(row?.prototype).toMatchObject({ path: 'prototypes/REQ-01/index.html' })
    expect(row?.prototype?.quality?.keywordHitRate).toBe(1)
    expect(row?.prototype?.quality?.hits).toEqual(['登录改造'])
    expect(row?.prototype?.adoptedAt).toBe('2026-11-20T02:00:00.000Z')
  })
})
