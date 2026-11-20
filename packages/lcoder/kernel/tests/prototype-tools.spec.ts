/** 原型工具：落盘与登记、路径越界拒绝、体积上限、旧数据兼容。 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'
import { afterAll, describe, expect, it } from 'vitest'

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createRequirement, loadRequirement } from '../src/kernel/requirement-store.js'
import { createPrototypeTools } from '../src/tools/prototype-tools.js'

/** 直接调用同步工具体；执行上下文在本工具里没有被读到。 */
function callTool(tool: ToolDefinition, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return tool.execute(args, {} as Parameters<ToolDefinition['execute']>[1]) as Promise<Record<string, unknown>>
}
import { Requirement } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const DEMO = fileURLToPath(new URL('../fixtures/demo', import.meta.url))

/** 复制 demo 规格库并起草一条需求；返回规格根与需求编号。 */
function makeSpec(): { spec: string; id: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-prototype-'))
  dirs.push(repo)
  cpSync(DEMO, repo, { recursive: true })
  const spec = join(repo, '.spec')
  const draft = createRequirement(spec, {
    title: '原型测试需求',
    content: '# 原型测试需求\n\n一段正文。\n',
    opened_at: '2026-11-20T00:00:00.000Z',
  })
  return { spec, id: draft.requirement.id }
}

function call(spec: string, args: Record<string, unknown>) {
  const tool = createPrototypeTools(spec).find(item => item.name === 'prototype_draft')
  if (tool === undefined) throw new Error('没有 prototype_draft')
  return callTool(tool, args)
}

/** 通过质量门禁的完整 HTML；命中需求关键词「原型测试需求」「一段正文」。 */
const HTML = '<!doctype html><html><head><meta charset="utf-8"><title>原型测试需求</title><style>body{color:#123456}</style></head><body><nav>导航</nav><h1>原型测试需求</h1><section class="features"><ul><li>一段正文</li></ul></section><footer>页脚</footer></body></html>'
const HTML2 = HTML.replace('页脚', '原型测试需求 一段正文 页脚')

describe('prototype_draft', () => {
  it('只注册一个工具，落盘 HTML 并登记到需求的可选 prototype 字段', async () => {
    expect(createPrototypeTools('x').map(tool => tool.name)).toEqual(['prototype_draft'])
    const { spec, id } = makeSpec()
    const result = await call(spec, {
      requirement: id,
      html: HTML,
      referenceSummary: '主色 #123456，无衬线',
      referenceImages: [],
    })

    expect(result).toMatchObject({ requirement_id: id, path: `prototypes/${id}/index.html`, bytes: Buffer.byteLength(HTML, 'utf8') })
    expect(readFileSync(join(spec, 'prototypes', id, 'index.html'), 'utf8')).toBe(HTML)
    const requirement = loadRequirement(spec, id)
    expect(requirement.prototype).toMatchObject({
      path: `prototypes/${id}/index.html`,
      referenceSummary: '主色 #123456，无衬线',
      references: [],
    })
    expect(typeof requirement.prototype?.generatedAt).toBe('string')
  })

  it('重复调用覆盖同一路径', async () => {
    const { spec, id } = makeSpec()
    const first = await call(spec, { requirement: id, html: HTML })
    const second = await call(spec, { requirement: id, html: HTML2 })
    expect(second.path).toBe(first.path)
    expect(readFileSync(join(spec, 'prototypes', id, 'index.html'), 'utf8')).toBe(HTML2)
  })

  it('空 HTML 与超过 512KB 的 HTML 都拒绝，且不写文件', async () => {
    const { spec, id } = makeSpec()
    await expect(call(spec, { requirement: id, html: '   ' })).rejects.toThrow(/非空/)
    await expect(call(spec, { requirement: id, html: 'x'.repeat(512 * 1024 + 1) })).rejects.toThrow(/524288|512/)
    expect(existsSync(join(spec, 'prototypes', id, 'index.html'))).toBe(false)
  })

  it('引用路径的绝对路径与 .. 越界都拒绝', async () => {
    const { spec, id } = makeSpec()
    await expect(call(spec, { requirement: id, html: HTML, referenceImages: ['/etc/passwd'] })).rejects.toThrow(/相对路径|越界/)
    await expect(call(spec, { requirement: id, html: HTML, referenceImages: [`prototypes/${id}/../../secret.txt`] })).rejects.toThrow(/越界/)
    await expect(call(spec, { requirement: id, html: HTML, referenceImages: ['prototypes/REQ-99/refs/a.png'] })).rejects.toThrow(/越界/)
    expect(existsSync(join(spec, 'prototypes', id, 'index.html'))).toBe(false)
  })

  it('引用路径必须位于本需求的原型目录内，合法路径原样保留', async () => {
    const { spec, id } = makeSpec()
    const ref = `prototypes/${id}/refs/logo.png`
    const result = await call(spec, { requirement: id, html: HTML, referenceImages: [ref] })
    expect(result.references).toEqual([ref])
  })

  it('质量不合格时返回结构化失败项且不落盘半成品', async () => {
    const { spec, id } = makeSpec()
    const bad = '<!doctype html><html><head></head><body><script>alert(1)</script><h1>原型测试需求</h1><p>一段正文</p></body></html>'
    const result = await call(spec, { requirement: id, html: bad })
    expect(result.ok).toBe(false)
    const failed = result.failed as readonly { code: string }[]
    expect(failed.map(item => item.code)).toContain('UNSAFE_MARKUP')
    expect(failed.map(item => item.code)).toContain('MISSING_SECTIONS')
    expect(existsSync(join(spec, 'prototypes', id, 'index.html'))).toBe(false)
    expect(loadRequirement(spec, id).prototype).toBeUndefined()
  })

  it('质量通过时回执含关键词命中情况', async () => {
    const { spec, id } = makeSpec()
    const result = await call(spec, { requirement: id, html: HTML })
    expect(result.ok).toBe(true)
    expect(result.quality).toMatchObject({ keywordHitRate: 1 })
  })

  it('需求不存在时拒绝', async () => {
    const { spec } = makeSpec()
    await expect(call(spec, { requirement: 'REQ-99', html: HTML })).rejects.toThrow(/需求|REQ/)
  })
})

describe('Requirement.prototype 的向后兼容', () => {
  it('旧 YAML 没有 prototype 字段仍可解析，且缺省不影响其它字段', () => {
    const parsed = Requirement.parse({
      id: 'REQ-01',
      title: '旧需求',
      state: 'draft',
      options: [],
      opened_at: '2026-01-01T00:00:00.000Z',
      versions: [],
      reviews: [],
    })
    expect(parsed.prototype).toBeUndefined()

    // 写盘时也不会凭空生成 prototype 字段；磁盘上的旧 YAML 原样解析。
    const { spec, id } = makeSpec()
    const requirement = loadRequirement(spec, id)
    const text = readFileSync(join(spec, 'requirements', `${id}.yaml`), 'utf8')
    expect(text).not.toContain('prototype:')
    expect(() => Requirement.parse(parseYaml(text))).not.toThrow()
    expect(requirement.prototype).toBeUndefined()
  })

  it('带 prototype 字段的新 YAML 可解析，缺失 references 时缺省为空数组', () => {
    const parsed = Requirement.parse({
      id: 'REQ-01',
      title: '新需求',
      state: 'draft',
      options: [],
      opened_at: '2026-01-01T00:00:00.000Z',
      versions: [],
      reviews: [],
      prototype: { path: 'prototypes/REQ-01/index.html', generatedAt: '2026-01-02T00:00:00.000Z' },
    })
    expect(parsed.prototype?.references).toEqual([])
  })
})
