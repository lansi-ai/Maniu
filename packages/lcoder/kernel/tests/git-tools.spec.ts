/**
 * Git 工具的行为测：能力边界由 argv 钉死，不由提示词承诺。
 *
 * 假执行器记录每一次 argv，所以「没有 push」「没有 --amend」「路径先校验再跑」
 * 这三条都能直接判死。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createGitTools, type GitResult, type GitRunner } from '../src/tools/git-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-git-'))
  dirs.push(repo)
  return repo
}

/** 记录 argv 的假执行器；按首个子命令给预设结果，默认成功且无输出。 */
function fakeRunner(responses: Record<string, GitResult> = {}): { calls: string[][]; run: GitRunner } {
  const calls: string[][] = []
  const run: GitRunner = async (args) => {
    calls.push([...args])
    return responses[args[0] ?? ''] ?? { code: 0, stdout: '', stderr: '' }
  }
  return { calls, run }
}

function tool(repo: string, run: GitRunner, name: string) {
  const found = createGitTools(repo, run).find(entry => entry.name === name)
  if (found === undefined) throw new Error(`没有这个工具：${name}`)
  return (found as unknown as { execute: (args: unknown, exec: unknown) => Promise<Record<string, unknown>> }).execute
}

const WORK_TREE: GitResult = { code: 0, stdout: 'true\n', stderr: '' }

describe('Git 工具', () => {
  it('提供 git_status、git_diff、git_commit 三个工具', () => {
    expect(createGitTools(makeRepo()).map(entry => entry.name)).toEqual(['git_status', 'git_diff', 'git_commit'])
  })

  it('不是工作树时如实说不是，不把 git 的英文报错当结论', async () => {
    const repo = makeRepo()
    const { run } = fakeRunner({ 'rev-parse': { code: 128, stdout: '', stderr: 'fatal: not a git repository' } })

    await expect(tool(repo, run, 'git_status')({}, {})).rejects.toThrow('这个工作区不是 git 仓库')
  })

  it('状态干净与有改动分别给出结论，路径用 -- 分隔', async () => {
    const repo = makeRepo()
    const clean = fakeRunner({ 'rev-parse': WORK_TREE })
    expect(await tool(repo, clean.run, 'git_status')({}, {})).toMatchObject({ clean: true, count: 0 })
    expect(clean.calls).toEqual([['rev-parse', '--is-inside-work-tree'], ['status', '--porcelain=v1']])

    const dirty = fakeRunner({
      'rev-parse': WORK_TREE,
      status: { code: 0, stdout: ' M src/a.ts\n?? src/b.ts\n', stderr: '' },
    })
    const result = await tool(repo, dirty.run, 'git_status')({ paths: ['src'] }, {})
    expect(result).toMatchObject({ clean: false, count: 2 })
    expect(dirty.calls[1]).toEqual(['status', '--porcelain=v1', '--', 'src'])
  })

  it('差异按 staged 决定 argv，输出截断', async () => {
    const repo = makeRepo()
    const { calls, run } = fakeRunner({
      'rev-parse': WORK_TREE,
      diff: { code: 0, stdout: 'x'.repeat(9000), stderr: '' },
    })

    const result = await tool(repo, run, 'git_diff')({ staged: true, paths: ['src/a.ts'] }, {})
    expect(calls[1]).toEqual(['diff', '--cached', '--', 'src/a.ts'])
    expect(String(result.diff).length).toBeLessThanOrEqual(4000)
    expect(result).toMatchObject({ staged: true, has_changes: true })
  })

  it('提交按 add、查暂存、commit、读 HEAD 的顺序跑，只提交给出的路径', async () => {
    const repo = makeRepo()
    const { calls, run } = fakeRunner({
      'rev-parse': WORK_TREE,
      diff: { code: 0, stdout: 'src/a.ts\n', stderr: '' },
      commit: { code: 0, stdout: '[main 1a2b3c4] feat: 支持自营\n', stderr: '' },
      log: { code: 0, stdout: '1a2b3c4 feat: 支持自营', stderr: '' },
    })

    const result = await tool(repo, run, 'git_commit')({ paths: ['src/a.ts'], message: 'feat: 支持自营' }, {})
    expect(result).toMatchObject({ committed: true, head: '1a2b3c4 feat: 支持自营' })
    expect(calls).toEqual([
      ['rev-parse', '--is-inside-work-tree'],
      ['add', '--', 'src/a.ts'],
      ['diff', '--cached', '--name-only'],
      ['commit', '-m', 'feat: 支持自营'],
      ['log', '-1', '--pretty=format:%h %s'],
    ])
  })

  it('暂存区为空就不提交，也不谎报成功', async () => {
    const repo = makeRepo()
    const { calls, run } = fakeRunner({
      'rev-parse': WORK_TREE,
      diff: { code: 0, stdout: '', stderr: '' },
    })

    const result = await tool(repo, run, 'git_commit')({ paths: ['src/a.ts'], message: 'feat: 无改动' }, {})
    expect(result).toMatchObject({ committed: false, staged_files: [] })
    expect(calls.some(call => call[0] === 'commit')).toBe(false)
  })

  it('说明为空或路径越界时一次 git 都不跑', async () => {
    const repo = makeRepo()
    const empty = fakeRunner({ 'rev-parse': WORK_TREE })
    await expect(tool(repo, empty.run, 'git_commit')({ paths: ['src/a.ts'], message: '   ' }, {})).rejects.toThrow('非空的 message')
    expect(empty.calls).toEqual([])

    const escape = fakeRunner({ 'rev-parse': WORK_TREE })
    await expect(tool(repo, escape.run, 'git_commit')({ paths: ['../outside.ts'], message: 'feat: x' }, {})).rejects.toThrow('越出仓库范围')
    expect(escape.calls).toEqual([])
  })

  it('参数面里拼不出 push、amend 与 no-verify', async () => {
    const repo = makeRepo()
    const { calls, run } = fakeRunner({ 'rev-parse': WORK_TREE, diff: { code: 0, stdout: 'a\n', stderr: '' } })
    const commit = tool(repo, run, 'git_commit')

    await expect(commit({ paths: ['src/a.ts'], message: 'feat: x', '--no-verify': true }, {})).resolves.toMatchObject({ committed: true })
    const flattened = calls.map(call => call.join(' ')).join('\n')
    expect(flattened).not.toContain('push')
    expect(flattened).not.toContain('--amend')
    expect(flattened).not.toContain('--no-verify')
  })

  it('commit 失败时保留暂存区并把 git 原文交出来', async () => {
    const repo = makeRepo()
    const { run } = fakeRunner({
      'rev-parse': WORK_TREE,
      diff: { code: 0, stdout: 'src/a.ts\n', stderr: '' },
      commit: { code: 1, stdout: '', stderr: 'no identity configured' },
    })

    await expect(tool(repo, run, 'git_commit')({ paths: ['src/a.ts'], message: 'feat: x' }, {}))
      .rejects.toThrow(/暂存区保留，未回滚.*no identity configured/)
  })
})
