/**
 * 交付索引工具：按任务覆盖写、保留首次创建时间，并在写盘前按仓库根复核文档。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { readDeliverable } from '../src/kernel/deliverable-store.js'
import { createDeliverableTools } from '../src/tools/deliverable-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const DEMO = fileURLToPath(new URL('../fixtures/demo', import.meta.url))

/** 复制 demo 规格库到临时仓库，并放两份真实文档。 */
function makeRepo(): { repo: string; spec: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-deliverable-'))
  dirs.push(repo)
  cpSync(DEMO, repo, { recursive: true })
  writeFileSync(join(repo, 'README.md'), '# 示例\n', 'utf8')
  mkdirSync(join(repo, 'docs'), { recursive: true })
  writeFileSync(join(repo, 'docs', 'architecture.md'), '# 架构\n', 'utf8')
  return { repo, spec: join(repo, '.spec') }
}

function call(specRoot: string, args: Record<string, unknown>) {
  const tool = createDeliverableTools(specRoot).find(item => item.name === 'deliverable_draft')
  if (tool === undefined) throw new Error('没有 deliverable_draft')
  const exec = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }).execute
  return exec(args, {}) as Promise<Record<string, unknown>>
}

describe('deliverable_draft', () => {
  it('只提供一个工具，按任务落盘并能读回', async () => {
    expect(createDeliverableTools(join(makeRepo().spec)).map(tool => tool.name)).toEqual(['deliverable_draft'])

    const { spec } = makeRepo()
    const r = await call(spec, {
      task: 'T-01',
      summary: '补齐基础框架说明',
      docs: ['README.md', 'docs/architecture.md'],
      commands: ['pnpm typecheck'],
    })

    expect(r).toMatchObject({
      task_id: 'T-01',
      summary: '补齐基础框架说明',
      docs: ['README.md', 'docs/architecture.md'],
      commands: ['pnpm typecheck'],
      replaced: false,
    })
    expect(String(r.path).replaceAll('\\', '/')).toMatch(/\/\.spec\/deliverables\/T-01\.yaml$/)
    expect(r.created_at).toBe(r.updated_at)

    const read = readDeliverable(spec, 'T-01')
    expect(read.kind).toBe('ok')
    if (read.kind === 'ok') {
      expect(read.value.summary).toBe('补齐基础框架说明')
      expect(read.value.docs).toEqual(['README.md', 'docs/architecture.md'])
    }
  })

  it('按任务覆盖写：摘要与文档更新，首次创建时间保留', async () => {
    const { spec } = makeRepo()
    const first = await call(spec, { task: 'T-01', summary: '第一版', docs: ['README.md'] })
    const second = await call(spec, {
      task: 'T-01',
      summary: '第二版',
      docs: ['docs/architecture.md'],
      commands: [],
    })

    expect(second).toMatchObject({ summary: '第二版', docs: ['docs/architecture.md'], replaced: true })
    expect(second.created_at).toBe(first.created_at)
    expect(String(second.updated_at) >= String(first.updated_at)).toBe(true)

    const read = readDeliverable(spec, 'T-01')
    expect(read.kind === 'ok' ? read.value.summary : null).toBe('第二版')
    const onDisk = readFileSync(join(spec, 'deliverables', 'T-01.yaml'), 'utf8')
    expect(onDisk).toContain('summary: 第二版')
  })

  it('任务不存在、摘要为空、docs 为空都拒绝', async () => {
    const { spec } = makeRepo()
    await expect(call(spec, { task: 'T-99', summary: 'x', docs: ['README.md'] }))
      .rejects.toThrow(/任务不存在：T-99/)
    await expect(call(spec, { task: 't1', summary: 'x', docs: ['README.md'] }))
      .rejects.toThrow(/非法的任务编号/)
    await expect(call(spec, { task: 'T-01', summary: '  ', docs: ['README.md'] }))
      .rejects.toThrow(/非空的 summary/)
    await expect(call(spec, { task: 'T-01', summary: 'x', docs: [] }))
      .rejects.toThrow(/至少登记一条/)
  })

  it('docs 的绝对路径与 .. 在 schema 层被拒，不落盘', async () => {
    const { spec } = makeRepo()
    await expect(call(spec, { task: 'T-01', summary: 'x', docs: ['C:/README.md'] }))
      .rejects.toThrow(/不能是绝对路径/)
    await expect(call(spec, { task: 'T-01', summary: 'x', docs: ['docs/../README.md'] }))
      .rejects.toThrow(/不能包含 \.\./)
    expect(readDeliverable(spec, 'T-01').kind).toBe('missing')
  })

  it('docs 指向不存在的文件或目录时拒绝，并列出路径', async () => {
    const { spec } = makeRepo()
    await expect(call(spec, { task: 'T-01', summary: 'x', docs: ['docs/missing.txt'] }))
      .rejects.toThrow(/不存在的文件：docs\/missing\.txt/)
    await expect(call(spec, { task: 'T-01', summary: 'x', docs: ['docs'] }))
      .rejects.toThrow(/不存在的文件：docs/)
    expect(readDeliverable(spec, 'T-01').kind).toBe('missing')
  })

  it('没有 .spec 时拒绝，提示先立项', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'lcoder-deliverable-empty-'))
    dirs.push(repo)
    writeFileSync(join(repo, 'README.md'), '# 空仓库\n', 'utf8')
    await expect(call(join(repo, '.spec'), { task: 'T-01', summary: 'x', docs: ['README.md'] }))
      .rejects.toThrow(/还没有 \.spec 规格库/)
  })
})

describe('readDeliverable 的三态', () => {
  it('缺失、读不懂、task 与文件名不一致都不冒充可用', () => {
    const { spec } = makeRepo()
    expect(readDeliverable(spec, 'T-01').kind).toBe('missing')

    mkdirSync(join(spec, 'deliverables'), { recursive: true })
    writeFileSync(join(spec, 'deliverables', 'T-01.yaml'), [
      'task: T-01',
      'summary: ""',
      'docs: []',
      'created_at: 2026-11-13T10:00:00.000Z',
      'updated_at: 2026-11-13T10:00:00.000Z',
      '',
    ].join('\n'), 'utf8')
    const invalid = readDeliverable(spec, 'T-01')
    expect(invalid.kind).toBe('invalid')

    writeFileSync(join(spec, 'deliverables', 'T-01.yaml'), [
      'task: T-02',
      'summary: 摘要',
      'docs: [README.md]',
      'created_at: 2026-11-13T10:00:00.000Z',
      'updated_at: 2026-11-13T10:00:00.000Z',
      '',
    ].join('\n'), 'utf8')
    const mismatched = readDeliverable(spec, 'T-01')
    expect(mismatched.kind === 'invalid' ? mismatched.problem : '').toContain('不一致')
  })
})
