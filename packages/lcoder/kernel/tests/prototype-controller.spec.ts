/** 原型宿主 Remote：预取摘要、非法 URL、无 web 服务降级、上传与清除。 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { createRequirement, loadRequirement } from '../src/kernel/requirement-store.js'
import { PrototypeController } from '../src/prototype/controller.js'
import { createPrototypeTools } from '../src/tools/prototype-tools.js'
import { rejectsWithCode } from './prototype-remote-assert.js'

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
    const summary = await controller.prefetch({ url: 'https://example.com' })
    expect(fetch).toHaveBeenCalledWith({ url: 'https://example.com/' })
    expect(summary).toMatchObject({ title: 'T', text: 'Hello' })
    expect(JSON.stringify(summary).length).toBeLessThan(4000)
  })

  it('非法 URL 与未启用的 web 服务都显式失败，不静默', async () => {
    const { controller } = make({ fetch: async () => ({ body: { kind: 'html', content: '<html></html>' } }) })
    await rejectsWithCode(controller.prefetch({ url: 'file:///etc/passwd' }), 'PROTOTYPE/INVALID_URL')
    const noWeb = new PrototypeController(new Context())
    await rejectsWithCode(noWeb.prefetch({ url: 'https://example.com' }), 'PROTOTYPE/WEB_UNAVAILABLE')
  })

  it('非 HTML 正文按不支持的内容失败', async () => {
    const { controller } = make({ fetch: async () => ({ body: { kind: 'text', content: 'plain' } }) })
    await rejectsWithCode(controller.prefetch({ url: 'https://example.com' }), 'PROTOTYPE/UNSUPPORTED_CONTENT')
  })
})

describe('prototype/uploadRef 与 clear', () => {
  it('参考图写入规格库，清除时移除字段与目录', async () => {
    const { controller, spec, id } = make()
    const data = Buffer.from('png-bytes').toString('base64')
    const uploaded = await controller.uploadRef({ sessionId: SessionId('s1'), requirementId: id, name: 'logo.png', data })
    expect(uploaded).toMatchObject({ path: `prototypes/${id}/refs/logo.png` })
    expect(existsSync(join(spec, 'prototypes', id, 'refs', 'logo.png'))).toBe(true)

    const tool = createPrototypeTools(spec).find(item => item.name === 'prototype_draft')
    if (tool === undefined) throw new Error('no tool')
    const good = '<!doctype html><html><head><title>Remote 测试</title></head><body><nav>导航</nav><h1>Remote 测试</h1><section><ul><li>Remote 测试</li></ul></section><footer>页脚</footer></body></html>'
    await tool.execute({ requirement: id, html: good }, {} as Parameters<typeof tool.execute>[1])

    const cleared = await controller.clear({ sessionId: SessionId('s1'), requirementId: id })
    expect(cleared).toEqual({ ok: true })
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
    expect(adopted).toEqual({ ok: true })
    expect(typeof loadRequirement(spec, id).prototype?.adoptedAt).toBe('string')
  })

  it('cold 会话没有工作区时显式失败', async () => {
    const ctx = new Context()
    ctx.provide('sessions', { get: () => undefined } as never)
    const controller = new PrototypeController(ctx)
    await rejectsWithCode(
      controller.uploadRef({ sessionId: SessionId('missing'), requirementId: 'REQ-01', name: 'a.png', data: 'YQ==' }),
      'PROTOTYPE/NO_WORKSPACE',
    )
  })

  it('冷会话不在内存 sessions 时经 sessionQuery.listSessions() 正常解析工作区', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'lcoder-proto-cold-'))
    dirs.push(repo)
    cpSync(DEMO, repo, { recursive: true })
    const spec = join(repo, '.spec')
    const protoDir = join(spec, 'prototypes', '__project__')
    mkdirSync(protoDir, { recursive: true })
    writeFileSync(join(protoDir, 'index.html'), '<html><body>冷会话原型</body></html>', 'utf8')

    const ctx = new Context()
    ctx.provide('sessions', { get: () => undefined } as never)
    ctx.provide('sessionQuery', {
      listSessions: async () => [{ header: { id: SessionId('cold-s1'), cwd: repo } }],
    } as never)
    const controller = new PrototypeController(ctx)

    const view = await controller.getStaged({ sessionId: SessionId('cold-s1') })
    expect(view.staged).toBeNull()
    expect(view.committedHtml).toContain('冷会话原型')

    const snapshots = await controller.listSnapshots({ sessionId: SessionId('cold-s1') })
    expect(snapshots.snapshots).toEqual([])

    await rejectsWithCode(
      controller.getStaged({ sessionId: SessionId('unknown-s2') }),
      'PROTOTYPE/NO_WORKSPACE',
    )
  })

  it('getSnapshot 只读返回历史快照 HTML 且不修改磁盘；快照不存在时抛 PROTOTYPE/SNAPSHOT_NOT_FOUND', async () => {
    const { controller, spec, id } = make()
    const tool = createPrototypeTools(spec).find(item => item.name === 'prototype_draft')
    if (tool === undefined) throw new Error('no tool')
    const v1 = '<!doctype html><html><head><title>Remote 测试</title></head><body><nav>导航</nav><h1>Remote 测试 V1</h1><section><ul><li>Remote 测试</li></ul></section><footer>页脚</footer></body></html>'
    const v2 = v1.replace('V1', 'V2')
    await tool.execute({ requirement: id, html: v1 }, {} as Parameters<typeof tool.execute>[1])

    const stagedPath = join(spec, 'prototypes', id, 'staged.json')
    writeFileSync(stagedPath, JSON.stringify({
      requirementId: id,
      html: v2,
      changeKind: 'visual',
      summary: ['更新标题'],
      changedDomPaths: ['h1'],
      createdAt: '2026-11-23T00:00:00.000Z',
    }), 'utf8')
    const committed = await controller.commitStaged({ sessionId: SessionId('s1'), requirementId: id })
    expect(committed.snapshotId).toBeDefined()
    const snapshotId = committed.snapshotId ?? ''

    const snapshotsBefore = await controller.listSnapshots({ sessionId: SessionId('s1'), requirementId: id })
    const got = await controller.getSnapshot({ sessionId: SessionId('s1'), requirementId: id, snapshotId })
    expect(got).toEqual({ html: v1 })
    // 只读接口不覆盖当前正式版也不增删历史快照。
    expect(readFileSync(join(spec, 'prototypes', id, 'index.html'), 'utf8')).toBe(v2)
    const snapshotsAfter = await controller.listSnapshots({ sessionId: SessionId('s1'), requirementId: id })
    expect(snapshotsAfter).toEqual(snapshotsBefore)

    await rejectsWithCode(
      controller.getSnapshot({ sessionId: SessionId('s1'), requirementId: id, snapshotId: '1700000000000-0' }),
      'PROTOTYPE/SNAPSHOT_NOT_FOUND',
    )
  })

  it('需求自身尚无正式版时 getStaged 回退到项目级正式版，同时保留该需求的暂存', async () => {
    const { controller, spec, id } = make()
    expect(id).toBe('REQ-01')

    const req01Dir = join(spec, 'prototypes', 'REQ-01')
    mkdirSync(req01Dir, { recursive: true })
    const committed = '<html><body>REQ-01 正式版</body></html>'
    writeFileSync(join(req01Dir, 'index.html'), committed, 'utf8')

    const req05Dir = join(spec, 'prototypes', 'REQ-05')
    mkdirSync(req05Dir, { recursive: true })
    const stagedPayload = {
      requirementId: 'REQ-05',
      html: '<html><body>REQ-05 暂存版</body></html>',
      changeKind: 'visual',
      summary: ['新增模块'],
      changedDomPaths: ['main'],
      createdAt: '2026-11-24T00:00:00.000Z',
    }
    writeFileSync(join(req05Dir, 'staged.json'), JSON.stringify(stagedPayload), 'utf8')

    const view = await controller.getStaged({ sessionId: SessionId('s1'), requirementId: 'REQ-05' })
    expect(view.staged).toEqual(stagedPayload)
    expect(view.committedHtml).toBe(committed)
  })
})
