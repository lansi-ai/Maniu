import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { createEditTools, safeEvidenceName } from '../src/tools/edit-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const ENV = `repo:
  url: https://example.com/r.git
  branch: main
  push_mode: branch
commands:
  - id: build
    cmd: echo build
    exec: ai-auto
  - id: test
    cmd: echo test
    exec: ai-confirm
  - id: deploy-prod
    cmd: echo deploy
    exec: human
`

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lcoder-edit-'))
  dirs.push(root)
  writeFileSync(join(root, 'env.yaml'), ENV, 'utf8')
  return root
}

type Runner = (c: unknown) => Promise<{ code: number; stdout: string; stderr: string }>

function call(
  toolName: string,
  root: string,
  args: Record<string, unknown>,
  run?: Runner,
  repoRoot?: string,
) {
  const tools = createEditTools(root, {
    ...(run === undefined ? {} : { run }),
    ...(repoRoot === undefined ? {} : { repoRoot }),
  })
  const tool = tools.find(t => t.name === toolName)
  if (!tool) throw new Error(`没有这个工具：${toolName}`)
  const exec = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> })
    .execute
  return exec(args, {}) as Promise<Record<string, unknown>>
}

describe('签约态工具集', () => {
  it('提供五个工具（列目录 + 读取 + 写入 + 命令 + 证据）', () => {
    expect(createEditTools(makeRoot()).map(t => t.name)).toEqual([
      'file_read',
      'file_list',
      'file_edit',
      'cmd_run',
      'evidence_attach',
    ])
  })

  it('file_list 默认列仓库根一层，目录在前按名称排序', async () => {
    const root = makeRoot()
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs', 'prd.md'), '# prd', 'utf8')
    mkdirSync(join(root, 'src'))

    const r = await call('file_list', root, {})

    expect(r.path).toBe('.')
    expect(r.entries).toEqual([
      { path: 'docs', name: 'docs', type: 'directory' },
      { path: 'src', name: 'src', type: 'directory' },
      { path: 'env.yaml', name: 'env.yaml', type: 'file' },
    ])
    expect(r.truncated).toBe(false)
  })

  it('file_list 的 depth 展开子目录，路径相对仓库根', async () => {
    const root = makeRoot()
    mkdirSync(join(root, 'docs', 'deep'), { recursive: true })
    writeFileSync(join(root, 'docs', 'prd.md'), '# prd', 'utf8')
    writeFileSync(join(root, 'docs', 'deep', 'api.md'), '# api', 'utf8')

    const r = await call('file_list', root, { path: 'docs', depth: 2 })

    expect(r.entries).toEqual([
      { path: 'docs/deep', name: 'deep', type: 'directory' },
      { path: 'docs/prd.md', name: 'prd.md', type: 'file' },
      { path: 'docs/deep/api.md', name: 'api.md', type: 'file' },
    ])
  })

  it('file_list 对不存在的路径给可行动错误，不抛裸 ENOENT', async () => {
    const err = await call('file_list', makeRoot(), { path: 'missing' }).then(
      () => null,
      (e: unknown) => e,
    )

    expect(String((err as Error | null)?.message)).toContain('路径不存在：missing')
    expect(String((err as Error | null)?.message)).toContain('file_list')
  })

  it('file_list 拒绝文件路径与越界路径', async () => {
    const root = makeRoot()
    await expect(call('file_list', root, { path: 'env.yaml' })).rejects.toThrow(/只接受目录/)
    await expect(call('file_list', root, { path: '../' })).rejects.toThrow(/越出仓库范围/)
    await expect(call('file_list', root, { path: 'C:/Windows' })).rejects.toThrow(/绝对路径/)
  })

  it('file_list 的 depth 只接受 1 到 3', async () => {
    const root = makeRoot()
    await expect(call('file_list', root, { depth: 0 })).rejects.toThrow(/1 到 3/)
    await expect(call('file_list', root, { depth: 4 })).rejects.toThrow(/1 到 3/)
  })

  it('file_list 超过上限截断并标记', async () => {
    const root = makeRoot()
    for (let index = 0; index < 501; index++) {
      writeFileSync(join(root, `f${String(index).padStart(3, '0')}.txt`), '', 'utf8')
    }

    const r = await call('file_list', root, {}) as { entries: unknown[]; truncated: boolean }

    expect(r.entries).toHaveLength(500)
    expect(r.truncated).toBe(true)
  })

  it('file_edit 写入文件，自动建父目录', async () => {
    const root = makeRoot()
    const r = await call('file_edit', root, { path: 'src/deep/order.ts', content: 'export {};' })

    expect(r.written).toBe(true)
    expect(readFileSync(join(root, 'src/deep/order.ts'), 'utf8')).toBe('export {};')
  })

  it('repoRoot 与规格根分离：文件落仓库根，证据落规格根', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'lcoder-repo-'))
    dirs.push(repo)
    const spec = join(repo, '.spec')
    mkdirSync(spec, { recursive: true })
    writeFileSync(join(spec, 'env.yaml'), ENV, 'utf8')

    const written = await call('file_edit', spec, { path: 'src/order.ts', content: 'export {};' }, undefined, repo)
    expect(written.written).toBe(true)
    expect(readFileSync(join(repo, 'src/order.ts'), 'utf8')).toBe('export {};')
    expect(existsSync(join(spec, 'src/order.ts'))).toBe(false)

    await call('evidence_attach', spec, { task_id: 'T-01', kind: 'test', content: 'ok' }, undefined, repo)
    expect(readFileSync(join(spec, 'evidence/T-01/test.log'), 'utf8')).toBe('ok')
  })

  it('file_edit 拒绝越界路径与绝对路径', async () => {
    const root = makeRoot()
    await expect(call('file_edit', root, { path: '../escape.ts', content: 'x' })).rejects.toThrow(
      /越出仓库范围/,
    )
    await expect(
      call('file_edit', root, { path: 'C:/Windows/evil.ts', content: 'x' }),
    ).rejects.toThrow(/绝对路径/)
    expect(existsSync(join(root, '..', 'escape.ts'))).toBe(false)
  })

  it('file_read 把 CRLF 归一化成 LF，行号在 Windows 上也稳定', async () => {
    const root = makeRoot()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src/crlf.ts'), '第一行\r\n第二行\r\n第三行', 'utf8')

    const r = await call('file_read', root, { path: 'src/crlf.ts' })

    expect(r.total_lines).toBe(3)
    expect(r.content).toBe('第一行\n第二行\n第三行')
  })

  it('cmd_run 拒绝未登记的命令，并列出可用命令', async () => {
    await expect(call('cmd_run', makeRoot(), { command_id: 'rm -rf /' })).rejects.toThrow(
      /未登记的命令.*build\(ai-auto\)/s,
    )
  })

  it('cmd_run 不让模型执行 human / ai-confirm 的命令', async () => {
    const root = makeRoot()
    await expect(call('cmd_run', root, { command_id: 'deploy-prod' })).rejects.toThrow(
      /只能由人执行/,
    )
    await expect(call('cmd_run', root, { command_id: 'test' })).rejects.toThrow(/需要人确认/)
  })

  it('cmd_run 对 ai-auto 命令执行并把结果摘要返回', async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: 'all good', stderr: '' })
    const r = await call('cmd_run', makeRoot(), { command_id: 'build' }, run)

    expect(run).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ command_id: 'build', ok: true, code: 0, stdout: 'all good' })
  })

  it('cmd_run 失败时 ok 为 false，不抛错（失败是正常结果）', async () => {
    const run = vi.fn().mockResolvedValue({ code: 2, stdout: '', stderr: 'boom' })
    const r = await call('cmd_run', makeRoot(), { command_id: 'build' }, run)
    expect(r.ok).toBe(false)
    expect(r.code).toBe(2)
  })

  it('evidence_attach 落到 evidence/<task>/<kind>.log 并清洗文件名', async () => {
    const root = makeRoot()
    const r = await call('evidence_attach', root, {
      task_id: 'T-014',
      kind: 'Build Output',
      content: 'ok',
    })

    expect(r.path).toBe('evidence/T-014/build-output.log')
    expect(readFileSync(join(root, 'evidence/T-014/build-output.log'), 'utf8')).toBe('ok')
    expect(safeEvidenceName('../../etc/passwd')).toBe('------etc-passwd')
  })

  it('evidence_attach 的 task_id 非法直接拒绝（join 会吃掉 ../，必须在原始输入上校验）', async () => {
    const err = await call('evidence_attach', makeRoot(), {
      task_id: '../x',
      kind: 'build',
      content: 'x',
    }).then(
      () => null,
      (e: unknown) => e,
    )

    expect(err).not.toBeNull()
    expect(String((err as Error | null)?.message)).toContain('任务编号')
  })

  it('evidence 目录不存在时自动创建', async () => {
    const root = makeRoot()
    mkdirSync(join(root, 'evidence'), { recursive: true })
    const r = await call('evidence_attach', root, { task_id: 'T-01', kind: 'test', content: 'x' })
    expect(r.bytes).toBe(1)
  })
})
