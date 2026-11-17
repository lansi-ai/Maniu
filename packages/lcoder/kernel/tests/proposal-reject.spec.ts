/**
 * 人机命令 `proposal_reject` 的行为测：驳回只写提案的决定态与结论时刻，
 * 带需求变更载荷的提案被驳回时需求本体一个字都不动。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createProposalRejectCommand } from '../src/commands/proposal-reject.js'
import { saveProposal } from '../src/kernel/proposal-store.js'
import { createRequirement, loadRequirement } from '../src/kernel/requirement-store.js'
import { Proposal } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-reject-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'proposals'), { recursive: true })
  return root
}

const CONTENT = '# 佣金改造\n\n自营订单不该按下限兜底。'

function write(root: string, decision: Proposal['decision'] = 'draft', withChange = false): Proposal {
  const proposal = Proposal.parse({
    id: 'P-01',
    title: '佣金改造',
    problem: '自营订单不该兜底。',
    options: [{ name: '加参数', summary: '第三参数', cost: '调用点要传' }],
    recommendation: '推荐加参数。',
    decision,
    opened_at: '2026-11-17T10:00:00+08:00',
    ...(withChange
      ? { requirement_change: { mode: 'revise', target: 'REQ-01', base_version: 1, content: '# 新正文', analysis: '影响面集中在结算。' } }
      : {}),
  })
  saveProposal(root, proposal)
  return proposal
}

function run(root: string, rawInput: string, at = '2026-11-17T12:00:00+08:00') {
  return createProposalRejectCommand(root, () => at).handler({ rawInput })
}

function read(root: string): Proposal {
  return Proposal.parse(parseYaml(readFileSync(join(root, 'proposals', 'P-01.yaml'), 'utf8')))
}

describe('方案驳回命令', () => {
  it('起草态驳回：决定态与结论时刻写入，正文不变', () => {
    const root = makeSpec()
    const before = write(root)

    const result = run(root, 'P-01')
    expect(result).toMatchObject({ kind: 'success' })
    const after = read(root)
    expect(after).toMatchObject({ decision: 'rejected', decided_at: '2026-11-17T12:00:00+08:00' })
    expect({ ...after, decision: 'draft', decided_at: null }).toEqual(before)
  })

  it('需求变更提案被驳回：需求本体一个字都不动', () => {
    const root = makeSpec()
    createRequirement(root, { title: '佣金改造', content: CONTENT, opened_at: '2026-11-17T09:00:00+08:00' })
    write(root, 'draft', true)

    expect(run(root, 'P-01')).toMatchObject({ kind: 'success' })
    expect(read(root).decision).toBe('rejected')
    expect(readFileSync(join(root, 'requirements', 'REQ-01.md'), 'utf8')).toBe(CONTENT)
    expect(loadRequirement(root, 'REQ-01').versions.map(version => version.n)).toEqual([1])
    expect(loadRequirement(root, 'REQ-01').state).toBe('draft')
  })

  it('new 提案被驳回：不建任何需求', () => {
    const root = makeSpec()
    const proposal = write(root)
    saveProposal(root, {
      ...proposal,
      requirement_change: { mode: 'new', content: CONTENT, analysis: '影响面集中在结算。' },
    })

    expect(run(root, 'P-01')).toMatchObject({ kind: 'success' })
    expect(existsSync(join(root, 'requirements'))).toBe(false)
  })

  it('已拍板的方案再驳就拒，文件一个字节不动', () => {
    const root = makeSpec()
    write(root, 'approved')
    const before = readFileSync(join(root, 'proposals', 'P-01.yaml'), 'utf8')

    expect(run(root, 'P-01')).toMatchObject({ kind: 'error' })
    expect(run(root, 'P-01').text ?? '').toContain('不需要重复驳回')
    expect(readFileSync(join(root, 'proposals', 'P-01.yaml'), 'utf8')).toBe(before)
  })

  it('编号不合法、方案不存在、没有规格根、参数为空各回一句人话', () => {
    const root = makeSpec()
    write(root)

    expect(run(root, '方案一').text ?? '').toContain('非法的方案编号')
    expect(run(root, 'P-09').text ?? '').toContain('已有方案 P-01')
    expect(run(root, '').text ?? '').toContain('/proposal_reject P-01')
    expect(run(join(tmpdir(), 'lcoder-reject-none.spec'), 'P-01').text ?? '').toContain('还没有 .spec')
  })
})
