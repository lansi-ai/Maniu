import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { createTaskTools } from '../src/tools/task-tools.js'
import { contractHash, saveContract } from '../src/kernel/contract.js'
import { Contract } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/** 写一份已由人签署的契约；签名里的哈希按正文复算，与 P3 校验同源。 */
function writeHumanContract(spec: string, body: Record<string, unknown>): void {
  const contract = Contract.parse(body)
  saveContract(spec, Contract.parse({
    ...contract,
    sig: { by: 'human', at: '2026-11-02T15:00:00+08:00', hash: contractHash(contract) },
  }))
}

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

/** 只有产品文档、还没有 `.spec` 的仓库：立项流程的起点。 */
function makeUnscopedRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-unscoped-'))
  dirs.push(repo)
  mkdirSync(join(repo, 'docs'), { recursive: true })
  writeFileSync(join(repo, 'docs', 'prd.md'), '# 产品文档\n佣金下限要可配置\n', 'utf8')
  return repo
}

describe('任务工具', () => {
  it('提供 task_read、task_draft 与 task_close', () => {
    expect(createTaskTools(makeRepo().spec).map(t => t.name)).toEqual([
      'task_read',
      'task_draft',
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
    writeHumanContract(spec, { id: 'T-01', change: ['x'], acceptance: ['y'] })

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

  it('签完又改正文 → 收口被 P3 拦下，签名作废', async () => {
    const { repo, spec } = makeRepo()
    setState(repo, 'verifying')
    mkdirSync(join(spec, 'evidence', 'T-01'), { recursive: true })
    writeFileSync(join(spec, 'evidence', 'T-01', 'build.log'), 'ok', 'utf8')
    writeFileSync(join(spec, 'evidence', 'T-01', 'test.log'), 'ok', 'utf8')

    // 先按这一版正文签一次，再把正文改掉：签名里的哈希成了旧版的。
    const signed = Contract.parse({ id: 'T-01', change: ['原方案'], acceptance: ['单测'] })
    const sig = { by: 'human', at: '2026-11-02T15:00:00+08:00', hash: contractHash(signed) }
    saveContract(spec, Contract.parse({ ...signed, sig }))
    saveContract(spec, Contract.parse({ id: 'T-01', change: ['原方案', '签后又加了一条'], acceptance: ['单测'], sig }))

    const r = await call(spec, 'task_close', { task_id: 'T-01' })
    expect(r.ok).toBe(false)
    expect(r.state).toBe('verifying')
    const p3 = (r.violations as { checker: string; detail: string }[]).filter(v => v.checker === 'P3')
    expect(p3.map(v => v.detail).join(' ')).toContain('签署后正文被改过')
  })

  it('全部条件满足 → 收口成功并落盘为 closed', async () => {
    const { repo, spec } = makeRepo()
    setState(repo, 'verifying')
    mkdirSync(join(spec, 'evidence', 'T-01'), { recursive: true })
    writeFileSync(join(spec, 'evidence', 'T-01', 'build.log'), 'ok', 'utf8')
    writeFileSync(join(spec, 'evidence', 'T-01', 'test.log'), 'ok', 'utf8')
    // 触及不可逆项，必须有人签的契约
    writeHumanContract(spec, {
      id: 'T-01',
      change: ['R-02 下限改为可配置'],
      not_change: [],
      acceptance: ['费率为 0 时不生成结算记录'],
      affected_tests: [],
      fail_if: [],
    })

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
      [
        'id: T-01',
        'change: [x]',
        'acceptance: [y]',
        'sig:',
        '  by: agent',
        '  at: 2026-11-02T15:00:00+08:00',
        '  hash: sha256:x',
        '  actor: lcoder-flow',
        '  authorization:',
        '    policy: automation.yaml',
        '    hash: sha256:策略',
        '    at: 2026-11-02T14:00:00+08:00',
        '',
      ].join('\n'),
      'utf8',
    )

    const r = await call(spec, 'task_close', { task_id: 'T-01' })
    expect(r.ok).toBe(false)
    const details = (r.violations as { detail: string }[]).map(v => v.detail).join(' ')
    expect(details).toContain('agent')
  })
})

describe('task_draft 立项', () => {
  it('没有 .spec 的仓库也能建第一个任务，状态与时间戳由代码写定', async () => {
    const repo = makeUnscopedRepo()
    const spec = join(repo, '.spec')

    const r = await call(spec, 'task_draft', { title: '佣金下限可配置', grade: 'b' })
    expect(r).toMatchObject({ task_id: 'T-01', state: 'drafting', grade: 'B', created: true })

    const onDisk = readFileSync(join(spec, 'tasks', 'T-01.yaml'), 'utf8')
    expect(onDisk).toContain('state: drafting')
    expect(onDisk).toContain('opened_at:')
    expect(onDisk).toContain('closed_at: null')
  })

  it('同标题重复立项 → 返回既有任务，不覆盖已有文件', async () => {
    const repo = makeUnscopedRepo()
    const spec = join(repo, '.spec')
    await call(spec, 'task_draft', { title: '  佣金下限 可配置 ', grade: 'A' })

    const path = join(spec, 'tasks', 'T-01.yaml')
    const before = readFileSync(path, 'utf8')
    const again = await call(spec, 'task_draft', { title: '佣金下限可配置', grade: 'C' })

    expect(again).toMatchObject({ task_id: 'T-01', state: 'drafting', grade: 'A', created: false })
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('编号取现有 T- 序号的最大值之后，其它前缀不挤号', async () => {
    const { spec } = makeRepo()
    const r = await call(spec, 'task_draft', { title: '结算记录支持导出', grade: 'B' })
    expect(r.task_id).toBe('T-02')
  })

  it('显式编号已被占用 → 报出被谁占用', async () => {
    const { spec } = makeRepo()
    await expect(call(spec, 'task_draft', { task_id: 'T-01', title: '另起一桩', grade: 'C' })).rejects.toThrow(
      /T-01 已被「/,
    )
  })

  it('非法编号、空标题、越界分级一律拒绝', async () => {
    const { spec } = makeRepo()
    await expect(call(spec, 'task_draft', { task_id: 't1', title: 'x', grade: 'A' })).rejects.toThrow(/非法的任务编号/)
    await expect(call(spec, 'task_draft', { title: '   ', grade: 'A' })).rejects.toThrow(/非空的 title/)
    await expect(call(spec, 'task_draft', { title: 'x', grade: 'D' })).rejects.toThrow(/grade 只能是 A、B、C/)
  })

  it('rules 只能是规格里真实存在的编号；其余字段按声明落盘', async () => {
    const { spec } = makeRepo()
    await expect(
      call(spec, 'task_draft', { title: '结算下限调整', grade: 'B', rules: ['R-99'] }),
    ).rejects.toThrow(/不存在的编号：R-99/)

    const ok = await call(spec, 'task_draft', {
      title: '自营订单佣金为 0',
      grade: 'B',
      rules: ['R-02'],
      allowed_paths: ['src/'],
      irreversible: ['settlement_formula'],
      evidence_required: ['build'],
    })
    expect(ok).toMatchObject({ rules: ['R-02'], created: true })

    const loaded = await call(spec, 'task_read', { task_id: ok.task_id })
    expect(loaded).toMatchObject({
      grade: 'B',
      rules: ['R-02'],
      evidence_required: ['build'],
      scope: { irreversible: ['settlement_formula'], allowed_paths: ['src/'] },
    })
  })

  it('还没有规格库时 rules 只能留空', async () => {
    const repo = makeUnscopedRepo()
    await expect(
      call(join(repo, '.spec'), 'task_draft', { title: 'x', grade: 'B', rules: ['R-01'] }),
    ).rejects.toThrow(/rules 只能留空/)
  })

  it('有规格库但还没有条目时，报出可用编号为空', async () => {
    const repo = makeUnscopedRepo()
    const spec = join(repo, '.spec')
    mkdirSync(join(spec, 'tasks'), { recursive: true })
    writeFileSync(join(spec, 'tasks', 'T-01.yaml'), [
      'id: T-01', 'title: 已有任务', 'grade: C', 'state: drafting', 'rules: []',
      'scope:', '  irreversible: []', '  allowed_paths: []', 'evidence_required: []',
      'opened_at: 2026-11-02T15:00:00+08:00', 'closed_at: null', '',
    ].join('\n'), 'utf8')

    await expect(
      call(spec, 'task_draft', { title: '引用不存在的条目', grade: 'B', rules: ['R-01'] }),
    ).rejects.toThrow(/可用编号：（规格库还没有条目）/)
  })

  it('没有 .spec 时 task_read 给空表；指定编号才报错', async () => {
    const spec = join(makeUnscopedRepo(), '.spec')
    await expect(call(spec, 'task_read', {})).resolves.toMatchObject({ tasks: [] })
    await expect(call(spec, 'task_read', { task_id: 'T-01' })).rejects.toThrow(/还没有 \.spec 规格库/)
  })
})
describe('任务依赖', () => {
  it('前置任务写进 depends_on，读回时原样在', async () => {
    const { spec } = makeRepo()

    const first = await call(spec, 'task_draft', { title: '先做登录', grade: 'B' })
    const firstId = String(first.task_id)

    const second = await call(spec, 'task_draft', { title: '再做权限', grade: 'B', depends_on: [firstId] })
    expect(second.depends_on).toEqual([firstId])
    expect(readFileSync(join(spec, 'tasks', `${String(second.task_id)}.yaml`), 'utf8')).toContain(`depends_on:
  - ${firstId}`)
  })

  it('引用不存在的任务就拒，并说清先建前置', async () => {
    const { spec } = makeRepo()

    await expect(call(spec, 'task_draft', { title: '依赖空编号', grade: 'B', depends_on: ['T-99'] }))
      .rejects.toThrow(/不存在的任务：T-99/)
  })

  it('拒绝自依赖', async () => {
    const { spec } = makeRepo()

    await expect(call(spec, 'task_draft', { title: '依赖自己', grade: 'B', task_id: 'T-77', depends_on: ['T-77'] }))
      .rejects.toThrow(/不能依赖自己：T-77/)
  })
})
