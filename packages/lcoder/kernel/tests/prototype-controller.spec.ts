/** 原型宿主 Remote：预取摘要、非法 URL、无 web 服务降级、上传与清除。 */
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { createRequirement, loadRequirement } from '../src/kernel/requirement-store.js'
import { PrototypeController } from '../src/prototype/controller.js'
import { createPrototypeTools } from '../src/tools/prototype-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const DEMO = fileURLToPath(new URL('../fixtures/demo', import.meta.url))

/** 建一个带需求与会话规格根的工程；返回控制器与规格根。 */
function make(web?: { fetch: (request: { url: string }) => Promise<unknown> }) {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-proto-remote-'))
  dirs.push(repo)
  cpSync(DEMO, repo, { recursive: true })
  const spec = join(repo, '.spec')
  const draft = createRequirement(spec, {
    title: 'Remote 测试',
    content: '# Remote 测试\n',
    opened_at: '2026-11-20T00:00:00.000Z',
  })
  const ctx = new Context()
  if (web !== undefined) ctx.provide('web', web as never)
  ctx.provide('sessions', { get: () => ({ header: { cwd: repo } }) } as never)
  return { controller: new PrototypeController(ctx), spec, id: draft.requirement.id, ctx }
}

describe('prototype/prefetch', () => {
  it('复用 ctx.web.fetch，只回长度受限的结构化摘要', async () => {
    const fetch = vi.fn(async () => ({
      url: 'https://example.com',
      statusCode: 200,
      body: { kind: 'html', content: '<html><head><title>T</title><style>body{color:#abc}</style></head><body><p>Hello</p></body></html>' },
      truncated: false,
    }))
    const { controller } = make({ fetch })
    const answer = await controller.prefetch({ url: 'https://example.com' })
    expect(fetch).toHaveBeenCalledWith({ url: 'https://example.com/' })
    expect(answer).toMatchObject({ ok: true, value: { title: 'T', text: 'Hello' } })
    if (answer.ok) expect(JSON.stringify(answer.value).length).toBeLessThan(4000)
  })

  it('非法 URL 与未启用的 web 服务都显式失败，不静默', async () => {
    const { controller } = make({ fetch: async () => ({ body: { kind: 'html', content: '<html></html>' } }) })
    const bad = await controller.prefetch({ url: 'file:///etc/passwd' })
    expect(bad).toMatchObject({ ok: false, error: { code: 'PROTOTYPE/INVALID_URL' } })
    const noWeb = new PrototypeController(new Context())
    const missing = await noWeb.prefetch({ url: 'https://example.com' })
    expect(missing).toMatchObject({ ok: false, error: { code: 'PROTOTYPE/WEB_UNAVAILABLE' } })
  })

  it('非 HTML 正文按不支持的内容失败', async () => {
    const { controller } = make({ fetch: async () => ({ body: { kind: 'text', content: 'plain' } }) })
    const answer = await controller.prefetch({ url: 'https://example.com' })
    expect(answer).toMatchObject({ ok: false, error: { code: 'PROTOTYPE/UNSUPPORTED_CONTENT' } })
  })
})

describe('prototype/uploadRef 与 clear', () => {
  it('参考图写入规格库，清除时移除字段与目录', async () => {
    const { controller, spec, id } = make()
    const data = Buffer.from('png-bytes').toString('base64')
    const uploaded = await controller.uploadRef({ sessionId: SessionId('s1'), requirementId: id, name: 'logo.png', data })
    expect(uploaded).toMatchObject({ ok: true, value: { path: `prototypes/${id}/refs/logo.png` } })
    expect(existsSync(join(spec, 'prototypes', id, 'refs', 'logo.png'))).toBe(true)

    const tool = createPrototypeTools(spec).find(item => item.name === 'prototype_draft')
    if (tool === undefined) throw new Error('no tool')
    const exec = tool.execute
    const good = '<!doctype html><html><head><title>Remote 测试</title></head><body><nav>导航</nav><h1>Remote 测试</h1><section><ul><li>Remote 测试</li></ul></section><footer>页脚</footer></body></html>'
    await exec({ requirement: id, html: good }, {} as Parameters<typeof exec>[1])

    const cleared = await controller.clear({ sessionId: SessionId('s1'), requirementId: id })
    expect(cleared).toEqual({ ok: true, value: { ok: true } })
    expect(loadRequirement(spec, id).prototype).toBeUndefined()
    expect(existsSync(join(spec, 'prototypes', id))).toBe(false)
  })

  it('采纳把采纳时刻写进需求 YAML 的 prototype 登记', async () => {
    const { controller, spec, id } = make()
    const tool = createPrototypeTools(spec).find(item => item.name === 'prototype_draft')
    if (tool === undefined) throw new Error('no tool')
    const good = '<!doctype html><html><head><title>Remote 测试</title></head><body><nav>导航</nav><h1>Remote 测试</h1><section><ul><li>Remote 测试</li></ul></section><footer>页脚</footer></body></html>'
    await tool.execute({ requirement: id, html: good }, {} as Parameters<typeof tool.execute>[1])

    const adopted = await controller.adopt({ sessionId: SessionId('s1'), requirementId: id })
    expect(adopted).toEqual({ ok: true, value: { ok: true } })
    expect(typeof loadRequirement(spec, id).prototype?.adoptedAt).toBe('string')
  })

  it('cold 会话没有工作区时显式失败', async () => {
    const ctx = new Context()
    ctx.provide('sessions', { get: () => undefined } as never)
    const controller = new PrototypeController(ctx)
    const answer = await controller.uploadRef({ sessionId: SessionId('missing'), requirementId: 'REQ-01', name: 'a.png', data: 'YQ==' })
    expect(answer).toMatchObject({ ok: false, error: { code: 'PROTOTYPE/NO_WORKSPACE' } })
  })
})
