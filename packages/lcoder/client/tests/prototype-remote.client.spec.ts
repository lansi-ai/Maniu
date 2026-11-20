/** T-299：原型 Remote 的窄调用与提示词拼装。 */
import { describe, expect, it, vi } from 'vitest'

import { buildPrototypePrompt, styleSummaryText } from '../src/prototype/prompt.ts'
import { prefetchStyle, uploadPrototypeRef, clearPrototype, adoptPrototype } from '../src/prototype/remote.ts'
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
    expect(call).toHaveBeenCalledWith('prototype', 'prefetch', { url: 'https://example.com' })
  })

  it('非法 URL 的失败回执抛带 code 的错误', async () => {
    const call = vi.fn(async () => ({ ok: false as const, error: { code: 'PROTOTYPE/INVALID_URL', message: '只允许 http 或 https' } }))
    await expect(prefetchStyle('file:///etc/passwd', call)).rejects.toMatchObject({ name: 'PROTOTYPE/INVALID_URL' })
  })

  it('上传、采纳与清除都走原型命名空间的窄方法', async () => {
    const call = vi.fn(async () => ({ ok: true as const, value: { path: 'prototypes/REQ-01/refs/a.png', bytes: 3 } }))
    expect(await uploadPrototypeRef('s1', 'REQ-01', 'a.png', 'YWJj', call)).toEqual({ path: 'prototypes/REQ-01/refs/a.png', bytes: 3 })
    expect(call).toHaveBeenCalledWith('prototype', 'uploadRef', expect.objectContaining({ sessionId: 's1', requirementId: 'REQ-01' }))
    await adoptPrototype('s1', 'REQ-01', call)
    expect(call).toHaveBeenCalledWith('prototype', 'adopt', { sessionId: 's1', requirementId: 'REQ-01' })
    await clearPrototype('s1', 'REQ-01', call)
    expect(call).toHaveBeenCalledWith('prototype', 'clear', { sessionId: 's1', requirementId: 'REQ-01' })
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
