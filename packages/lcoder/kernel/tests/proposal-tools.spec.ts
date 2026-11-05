/**
 * 方案工具 `proposal_draft` 的行为测：出方案与拍板分开，正文可迭代，人的结论不可被模型改写。
 *
 * 钉四件事：首次落盘的编号与决定态、同标题不重建、draft 可更新而 approved 不可、
 * 三条平行数组按位置对齐的长度校验。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createProposalTools } from '../src/tools/proposal-tools.js'
import { createTaskTools } from '../src/tools/task-tools.js'
import { Proposal } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeRepo(): { repo: string; spec: string } {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-proposal-'))
  dirs.push(repo)
  const spec = join(repo, '.spec')
  mkdirSync(join(spec, 'tasks'), { recursive: true })
  return { repo, spec }
}

function call(spec: string, toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = createProposalTools(spec).find(entry => entry.name === toolName)
  if (tool === undefined) throw new Error(`没有这个工具：${toolName}`)
  const exec = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }).execute
  return exec(args, {}) as Promise<Record<string, unknown>>
}

const FIRST = {
  title: '支持自营与代发两种佣金',
  problem: '现在佣金一律按 max(实付×费率, 1) 兜底，自营订单不该兜底。',
  option_names: ['加参数', '拆函数'],
  option_summaries: ['calculateCommission 增加可选第三参数', '自营与代发各一个函数'],
  option_costs: ['调用点要逐个传参', '重复逻辑两处维护'],
  recommendation: '推荐加参数：改动面小，且 DR-01 的行为不变。',
}

function read(spec: string, id: string): Proposal {
  return Proposal.parse(parseYaml(readFileSync(join(spec, 'proposals', `${id}.yaml`), 'utf8')))
}

describe('方案工具', () => {
  it('提供 proposal_draft 一个工具', () => {
    expect(createProposalTools(makeRepo().spec).map(entry => entry.name)).toEqual(['proposal_draft'])
  })

  it('首次落盘取 P-01，决定态固定 draft，三条方案按位置配对', async () => {
    const { spec } = makeRepo()

    const result = await call(spec, 'proposal_draft', FIRST)
    expect(result).toMatchObject({ proposal_id: 'P-01', created: true, decision: 'draft' })

    const proposal = read(spec, 'P-01')
    expect(proposal.options).toEqual([
      { name: '加参数', summary: 'calculateCommission 增加可选第三参数', cost: '调用点要逐个传参' },
      { name: '拆函数', summary: '自营与代发各一个函数', cost: '重复逻辑两处维护' },
    ])
    expect(proposal).toMatchObject({ decision: 'draft', decided_at: null })
    expect(String(result.note)).toContain('/proposal_approve')
  })

  it('同标题再调只回读，不重复建也不改正文', async () => {
    const { spec } = makeRepo()
    await call(spec, 'proposal_draft', FIRST)
    const before = readFileSync(join(spec, 'proposals', 'P-01.yaml'), 'utf8')

    const result = await call(spec, 'proposal_draft', { ...FIRST, problem: '换了个说法' })
    expect(result).toMatchObject({ proposal_id: 'P-01', created: false })
    expect(readFileSync(join(spec, 'proposals', 'P-01.yaml'), 'utf8')).toBe(before)
  })

  it('带编号更新 draft 的正文，决定态与开案时刻都不动', async () => {
    const { spec } = makeRepo()
    await call(spec, 'proposal_draft', FIRST)
    const openedAt = read(spec, 'P-01').opened_at

    const result = await call(spec, 'proposal_draft', { ...FIRST, proposal_id: 'P-01', recommendation: '改成推荐拆函数' })
    expect(result).toMatchObject({ proposal_id: 'P-01', created: false, decision: 'draft' })
    const after = read(spec, 'P-01')
    expect(after.recommendation).toBe('改成推荐拆函数')
    expect(after.opened_at).toBe(openedAt)
  })

  it('人已批准的方案不再被改写，正文一个字都不动', async () => {
    const { spec } = makeRepo()
    await call(spec, 'proposal_draft', FIRST)
    mkdirSync(join(spec, 'proposals'), { recursive: true })
    const approved = { ...read(spec, 'P-01'), decision: 'approved' as const, decided_at: new Date().toISOString() }
    const { saveProposal } = await import('../src/kernel/proposal-store.js')
    saveProposal(spec, approved)
    const before = readFileSync(join(spec, 'proposals', 'P-01.yaml'), 'utf8')

    const result = await call(spec, 'proposal_draft', { ...FIRST, proposal_id: 'P-01', recommendation: '模型想改口' })
    expect(result).toMatchObject({ created: false, decision: 'approved' })
    expect(String(result.note)).toContain('不改写已拍板的方案')
    expect(readFileSync(join(spec, 'proposals', 'P-01.yaml'), 'utf8')).toBe(before)
  })

  it('三条方案数组长度不一致就抛，并报到各自条数', async () => {
    const { spec } = makeRepo()

    await expect(call(spec, 'proposal_draft', { ...FIRST, option_costs: ['只有一条代价'] }))
      .rejects.toThrow(/名称 2 条、做法 2 条、代价 1 条/)
  })

  it('方案里任一字段为空就抛，不写半条方案', async () => {
    const { spec } = makeRepo()

    await expect(call(spec, 'proposal_draft', { ...FIRST, option_summaries: ['', '第二条做法'] }))
      .rejects.toThrow(/第 1 条方案有空字段/)
  })

  it('已有 P-01 时省略编号取 P-02', async () => {
    const { spec } = makeRepo()
    await call(spec, 'proposal_draft', FIRST)

    const result = await call(spec, 'proposal_draft', { ...FIRST, title: '另一件事' })
    expect(result).toMatchObject({ proposal_id: 'P-02', created: true })
  })

  it('task_draft 填了不存在的方案编号就抛，并列出已有方案', async () => {
    const { spec } = makeRepo()
    await call(spec, 'proposal_draft', FIRST)
    const tool = createTaskTools(spec).find(entry => entry.name === 'task_draft')
    if (tool === undefined) throw new Error('没有 task_draft')
    const exec = (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }).execute

    await expect(exec({ title: '按推荐实现', grade: 'B', proposal: 'P-09' }, {})).rejects.toThrow(/方案不存在：P-09/)

    const ok = await exec({ title: '按推荐实现', grade: 'B', proposal: 'P-01' }, {}) as Record<string, unknown>
    expect(ok).toMatchObject({ created: true, task_id: 'T-01' })
    expect(readFileSync(join(spec, 'tasks', 'T-01.yaml'), 'utf8')).toContain('proposal: P-01')
  })
})
