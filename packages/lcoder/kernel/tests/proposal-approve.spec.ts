/**
 * 人机命令 `proposal_approve` 的行为测：批准只改决定态与结论时刻，正文一个字都不动。
 *
 * 与 `contract_sign`、`task_contract` 同档纪律：模型不能给自己拍板，所以这条能力只在命令面，
 * 不在任何角色或状态的工具面里。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createProposalApproveCommand } from '../src/commands/proposal-approve.js'
import { saveProposal } from '../src/kernel/proposal-store.js'
import { Proposal } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-approve-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'proposals'), { recursive: true })
  return root
}

function write(root: string, decision: Proposal['decision'] = 'draft'): Proposal {
  const proposal = Proposal.parse({
    id: 'P-01',
    title: '支持自营与代发两种佣金',
    problem: '自营订单不该兜底。',
    options: [{ name: '加参数', summary: '第三参数', cost: '调用点要传' }],
    recommendation: '推荐加参数。',
    decision,
    opened_at: '2026-11-05T10:00:00+08:00',
  })
  saveProposal(root, proposal)
  return proposal
}

function run(root: string, rawInput: string, at = '2026-11-05T12:00:00+08:00') {
  return createProposalApproveCommand(root, () => at).handler({ rawInput })
}

function read(root: string): Proposal {
  return Proposal.parse(parseYaml(readFileSync(join(root, 'proposals', 'P-01.yaml'), 'utf8')))
}

describe('方案批准命令', () => {
  it('起草态批准：决定态与结论时刻写入，正文不变', () => {
    const root = makeSpec()
    const before = write(root)

    const result = run(root, 'P-01')
    expect(result).toMatchObject({ kind: 'success' })
    const after = read(root)
    expect(after).toMatchObject({ decision: 'approved', decided_at: '2026-11-05T12:00:00+08:00' })
    expect({ ...after, decision: 'draft', decided_at: null }).toEqual(before)
  })

  it('已批准的方案再批就拒，文件一个字节不动', () => {
    const root = makeSpec()
    write(root, 'approved')
    const before = readFileSync(join(root, 'proposals', 'P-01.yaml'), 'utf8')

    expect(run(root, 'P-01')).toMatchObject({ kind: 'error' })
    expect(run(root, 'P-01').text ?? '').toContain('不需要重复批准')
    expect(readFileSync(join(root, 'proposals', 'P-01.yaml'), 'utf8')).toBe(before)
  })

  it('人已驳回的方案不再批准：要改结论由人编辑文件', () => {
    const root = makeSpec()
    write(root, 'rejected')

    expect(run(root, 'P-01')).toMatchObject({ kind: 'error' })
    expect(run(root, 'P-01').text ?? '').toContain('rejected')
  })

  it('编号不合法、方案不存在、没有规格根、参数为空各回一句人话', () => {
    const root = makeSpec()
    write(root)

    expect(run(root, '方案一').text ?? '').toContain('非法的方案编号')
    expect(run(root, 'P-09').text ?? '').toContain('已有方案 P-01')
    expect(run(root, '').text ?? '').toContain('/proposal_approve P-01')
    expect(run(join(tmpdir(), 'lcoder-approve-none.spec'), 'P-01').text ?? '').toContain('还没有 .spec')
  })
})
