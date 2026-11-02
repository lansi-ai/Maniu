import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { createTaskTools } from '../src/tools/task-tools.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

// 相对测试文件定位，避免依赖运行时的 cwd
const DEMO = fileURLToPath(new URL('../fixtures/demo', import.meta.url))

/** 把 fixture 复制到临时目录，避免测试改动污染仓库里的 demo。 */
function makeRepo(): { spec: string; repo: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-task-tools-'))
  dirs.push(repo)
  cpSync(DEMO, repo, { recursive: true })
  return { repo, spec: join(repo, '.spec') }
}

function call(specRoot: string, toolName: string, args: Record<string, unknown>) {
  const tool = createTaskTools(specRoot).find(t => t.name === toolName)
  if (!tool) throw new Error(`没有这个工具：${toolName}`)
  const exec = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> })
    .execute
  return exec(args, {}) as Promise<Record<string, unknown>>
}

function setState(repo: string, state: string) {
  const path = join(repo, '.spec', 'tasks', 'T-01.yaml')
  const text = readFileSync(path, 'utf8').replace(/^state: .*$/m, `state: ${state}`)
  writeFileSync(path, text, 'utf8')
}

describe('任务工具', () => {
  it('只提供 task_read 与 task_close', () => {
    expect(createTaskTools(makeRepo().spec).map(t => t.name)).toEqual([
      'task_read',
      'task_close',
    ])
  })

  it('task_read 不传 id 时列出摘要，传 id 时给详情', async () => {
    const { spec } = makeRepo()

    const all = await call(spec, 'task_read', {})
    expect((all.tasks as { id: string }[]).map(t => t.id)).toEqual(['T-01'])

    const one = await call(spec, 'task_read', { task_id: 'T-01' })
    expect(one).toMatchObject({ id: 'T-01', state: 'drafting', rules: ['R-02'] })
  })

  it('drafting 状态申请收口 → 检查器先拦（返回违规，不抛错）', async () => {
    const { spec } = makeRepo()
    const r = await call(spec, 'task_close', { task_id: 'T-01' })
    expect(r.ok).toBe(false)
    expect(r.state).toBe('drafting')
    expect((r.violations as unknown[]).length).toBeGreaterThan(0)
  })

  it('条件全过但没过 verifying → 状态图兜底拦下', async () => {
    const { repo, spec } = makeRepo()
    setState(repo, 'implementing')
    mkdirSync(join(spec, 'evidence', 'T-01'), { recursive: true })
    writeFileSync(join(spec, 'evidence', 'T-01', 'build.log'), 'ok', 'utf8')
    writeFileSync(join(spec, 'evidence', 'T-01', 'test.log'), 'ok', 'utf8')
    mkdirSync(join(spec, 'contracts'), { recursive: true })
    writeFileSync(
      join(spec, 'contracts', 'T-01.contract.yaml'),
      ['id: T-01', 'change: [x]', 'acceptance: [y]', 'sig:', '  by: human', '  at: 2026-11-02T15:00:00+08:00', '  hash: sha256:x', ''].join('\n'),
      'utf8',
    )

    // 检查器全过，但 implementing 不能直接 closed —— 这一层由状态机守
    await expect(call(spec, 'task_close', { task_id: 'T-01' })).rejects.toThrow(
      /不允许从 implementing/,
    )
  })

  it('verifying 但缺证据 → 返回违规清单，状态不变', async () => {
    const { repo, spec } = makeRepo()
    setState(repo, 'verifying')

    const r = await call(spec, 'task_close', { task_id: 'T-01' })

    expect(r.ok).toBe(false)
    expect(r.state).toBe('verifying')
    const details = (r.violations as { checker: string; detail: string }[]).map(v => v.detail)
    expect(details.join(' ')).toContain('build')
    expect(details.join(' ')).toContain('test')

    // 状态确实没被改动
    const again = await call(spec, 'task_read', { task_id: 'T-01' })
    expect(again.state).toBe('verifying')
  })

  it('落点失效也会被 P1 拦下', async () => {
    const { repo, spec } = makeRepo()
    setState(repo, 'verifying')
    writeFileSync(join(repo, 'src', 'price.ts'), 'export const nothing = 1;', 'utf8')
    mkdirSync(join(spec, 'evidence', 'T-01'), { recursive: true })
    writeFileSync(join(spec, 'evidence', 'T-01', 'build.log'), 'ok', 'utf8')
    writeFileSync(join(spec, 'evidence', 'T-01', 'test.log'), 'ok', 'utf8')

    const r = await call(spec, 'task_close', { task_id: 'T-01' })
    expect(r.ok).toBe(false)
    const checkers = (r.violations as { checker: string }[]).map(v => v.checker)
    expect(checkers).toContain('P1')
  })

  it('全部条件满足 → 收口成功并落盘为 closed', async () => {
    const { repo, spec } = makeRepo()
    setState(repo, 'verifying')
    mkdirSync(join(spec, 'evidence', 'T-01'), { recursive: true })
    writeFileSync(join(spec, 'evidence', 'T-01', 'build.log'), 'ok', 'utf8')
    writeFileSync(join(spec, 'evidence', 'T-01', 'test.log'), 'ok', 'utf8')
    // 触及不可逆项，必须有人签的契约
    mkdirSync(join(spec, 'contracts'), { recursive: true })
    writeFileSync(
      join(spec, 'contracts', 'T-01.contract.yaml'),
      [
        'id: T-01',
        'change: [R-02 下限改为可配置]',
        'not_change: []',
        'acceptance: [费率为 0 时不生成结算记录]',
        'affected_tests: []',
        'fail_if: []',
        'sig:',
        '  by: human',
        '  at: 2026-11-02T15:00:00+08:00',
        '  hash: sha256:x',
        '',
      ].join('\n'),
      'utf8',
    )

    const r = await call(spec, 'task_close', { task_id: 'T-01' })
    expect(r.ok).toBe(true)
    expect(r.state).toBe('closed')

    const back = await call(spec, 'task_read', { task_id: 'T-01' })
    expect(back.state).toBe('closed')

    const onDisk = readFileSync(join(spec, 'tasks', 'T-01.yaml'), 'utf8')
    expect(onDisk).toContain('state: closed')
  })

  it('触及不可逆项但没有契约 → P3 拦下', async () => {
    const { repo, spec } = makeRepo()
    setState(repo, 'verifying')
    mkdirSync(join(spec, 'evidence', 'T-01'), { recursive: true })
    writeFileSync(join(spec, 'evidence', 'T-01', 'build.log'), 'ok', 'utf8')
    writeFileSync(join(spec, 'evidence', 'T-01', 'test.log'), 'ok', 'utf8')

    const r = await call(spec, 'task_close', { task_id: 'T-01' })
    const checkers = (r.violations as { checker: string }[]).map(v => v.checker)
    expect(checkers).toContain('P3')
  })

  it('契约由 agent 签署也算不过', async () => {
    const { repo, spec } = makeRepo()
    setState(repo, 'verifying')
    mkdirSync(join(spec, 'evidence', 'T-01'), { recursive: true })
    writeFileSync(join(spec, 'evidence', 'T-01', 'build.log'), 'ok', 'utf8')
    writeFileSync(join(spec, 'evidence', 'T-01', 'test.log'), 'ok', 'utf8')
    mkdirSync(dirname(join(spec, 'contracts', 'T-01.contract.yaml')), { recursive: true })
    writeFileSync(
      join(spec, 'contracts', 'T-01.contract.yaml'),
      ['id: T-01', 'change: [x]', 'acceptance: [y]', 'sig:', '  by: agent', '  at: 2026-11-02T15:00:00+08:00', '  hash: sha256:x', ''].join('\n'),
      'utf8',
    )

    const r = await call(spec, 'task_close', { task_id: 'T-01' })
    expect(r.ok).toBe(false)
    const details = (r.violations as { detail: string }[]).map(v => v.detail).join(' ')
    expect(details).toContain('agent')
  })
})
