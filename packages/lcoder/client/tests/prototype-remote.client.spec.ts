/** T-299：原型 Remote 的窄调用与提示词拼装。 */
import { describe, expect, it, vi } from 'vitest'

import { buildPrototypePrompt, buildStudioCoDesignPrompt, styleSummaryText } from '../src/prototype/prompt.ts'
import {
  adoptPrototype, clearPrototype, commitStagedPrototype, discardStagedPrototype, getStagedPrototype,
  listPrototypeSnapshots, prefetchStyle, readPrototypeHtml, restorePrototypeSnapshot, uploadPrototypeRef,
} from '../src/prototype/remote.ts'
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
    expect(prompt).toContain('自包含内联 `<script>`')
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
    const old = requirementTextToRow('REQ-01.yaml', (YAML.split('  path:')[0] ?? '') + 'state: draft\n')
    expect(old?.prototype).toBeUndefined()
    const row = requirementTextToRow('REQ-01.yaml', YAML)
    expect(row?.prototype).toMatchObject({ path: 'prototypes/REQ-01/index.html' })
    expect(row?.prototype?.quality?.keywordHitRate).toBe(1)
    expect(row?.prototype?.quality?.hits).toEqual(['登录改造'])
    expect(row?.prototype?.adoptedAt).toBe('2026-11-20T02:00:00.000Z')
  })
})

describe('原型工作室 Remote', () => {
  it('getStaged 把入参包在 input 里并解出暂存条目、正式版与需求提案', async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      value: {
        staged: {
          requirementId: 'REQ-01',
          html: '<html>暂存版</html>',
          changeKind: 'business',
          summary: ['按钮改成主色', '新增验证码入口'],
          changedDomPaths: ['body > button'],
          requirementDiff: {
            baseContent: '旧正文',
            proposedContent: '新正文',
            summary: '新增验证码入口',
          },
          createdAt: '2026-11-23T00:00:00.000Z',
        },
        committedHtml: '<html>正式版</html>',
      },
    }))
    const view = await getStagedPrototype('s1', 'REQ-01', call)
    expect(call).toHaveBeenCalledWith('prototype', 'getStaged', { input: { sessionId: 's1', requirementId: 'REQ-01' } })
    expect(view.committedHtml).toBe('<html>正式版</html>')
    expect(view.staged).toMatchObject({
      changeKind: 'business',
      summary: ['按钮改成主色', '新增验证码入口'],
      changedDomPaths: ['body > button'],
    })
    expect(view.staged?.requirementDiff).toMatchObject({ baseContent: '旧正文', proposedContent: '新正文' })
  })

  it('commitStaged 原样透传输入并解析同步回执', async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      value: { committedAt: '2026-11-23T01:00:00.000Z', snapshotId: 'snap-1', requirementSync: 'amended' },
    }))
    const result = await commitStagedPrototype({
      sessionId: 's1', requirementId: 'REQ-01', applyRequirementDiff: true, requirementAmendMode: 'amend',
    }, call)
    expect(call).toHaveBeenCalledWith('prototype', 'commitStaged', {
      input: {
        sessionId: 's1', requirementId: 'REQ-01', applyRequirementDiff: true, requirementAmendMode: 'amend',
      },
    })
    expect(result).toMatchObject({ snapshotId: 'snap-1', requirementSync: 'amended' })
  })

  it('discardStaged 只带作用域入参', async () => {
    const call = vi.fn(async () => ({ ok: true as const, value: { ok: true } }))
    await discardStagedPrototype('s1', 'REQ-01', call)
    expect(call).toHaveBeenCalledWith('prototype', 'discardStaged', { input: { sessionId: 's1', requirementId: 'REQ-01' } })
  })

  it('listSnapshots 解出快照元数据并丢掉字段不全的条目', async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      value: {
        snapshots: [
          { snapshotId: 'a', createdAt: '2026-11-23T00:00:00.000Z', bytes: 12 },
          { snapshotId: 'b', createdAt: '2026-11-22T00:00:00.000Z' },
        ],
      },
    }))
    const snapshots = await listPrototypeSnapshots('s1', 'REQ-01', call)
    expect(call).toHaveBeenCalledWith('prototype', 'listSnapshots', { input: { sessionId: 's1', requirementId: 'REQ-01' } })
    expect(snapshots).toEqual([{ snapshotId: 'a', createdAt: '2026-11-23T00:00:00.000Z', bytes: 12 }])
  })

  it('restoreSnapshot 带快照编号并返回恢复后的 HTML', async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      value: { restoredAt: '2026-11-23T02:00:00.000Z', html: '<html>旧版</html>' },
    }))
    const value = await restorePrototypeSnapshot('s1', 'REQ-01', 'snap-1', call)
    expect(call).toHaveBeenCalledWith('prototype', 'restoreSnapshot', {
      input: { sessionId: 's1', requirementId: 'REQ-01', snapshotId: 'snap-1' },
    })
    expect(value).toEqual({ restoredAt: '2026-11-23T02:00:00.000Z', html: '<html>旧版</html>' })
  })
})

describe('原型协作提示词', () => {
  it('带多个点选锚点，并要求 prototype_stage 暂存与需求正文提案', () => {
    const prompt = buildStudioCoDesignPrompt({
      requirementId: 'REQ-01',
      requirementTitle: '登录改造',
      baselineNote: '当前基准：本轮暂存版 HTML。',
      instruction: '把登录按钮改成主色并加验证码入口',
      anchors: [
        { domPath: 'body > button:nth-child(2)', html: '<button>登录</button>', css: 'color: #333', label: '登录按钮' },
        { domPath: 'form > input', html: '<input />', css: 'width: 100%', label: '邮箱' },
      ],
    })
    expect(prompt).toContain('body > button:nth-child(2)')
    expect(prompt).toContain('form > input')
    expect(prompt).toContain('把登录按钮改成主色并加验证码入口')
    expect(prompt).toContain('prototype_stage')
    expect(prompt).toContain('patches')
    expect(prompt).toContain('remove')
    expect(prompt).toContain('1 到 4 条人话要点')
    expect(prompt).toContain('changedDomPaths')
    expect(prompt).toContain('requirementProposedContent')
    expect(prompt).not.toContain('prototype_draft')
  })

  it('没有点选锚点时先分流：闲聊直接回话不调工具，要改才用 patches 局部暂存', () => {
    const prompt = buildStudioCoDesignPrompt({
      requirementId: 'REQ-01',
      requirementTitle: '登录改造',
      baselineNote: '当前基准：正式版 HTML。',
      instruction: '你好',
      anchors: [],
    })
    expect(prompt).toContain('不调用任何工具')
    expect(prompt).toContain('1 到 2 句')
    expect(prompt).toContain('patches')
    expect(prompt).toContain('只有大范围跨区块改版')
    expect(prompt).not.toContain('prototype_draft')
  })
})
