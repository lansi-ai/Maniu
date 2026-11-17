/**
 * 人机命令 `proposal_approve` 的行为测：批准只改决定态与结论时刻，正文一个字都不动；
 * 带 `requirement_change` 载荷的提案在批准时应用成需求落盘（new 建新需求、revise 改稿），
 * note 记录来源，需求写成功后提案才转 approved。
 *
 * 与 `contract_sign`、`task_contract` 同档纪律：模型不能给自己拍板，所以这条能力只在命令面，
 * 不在任何角色或状态的工具面里。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { createProposalApproveCommand } from '../src/commands/proposal-approve.js'
import { saveProposal } from '../src/kernel/proposal-store.js'
import { createRequirement, loadRequirement, requirementVersionPath, saveRequirement } from '../src/kernel/requirement-store.js'
import { Proposal } from '../src/schema/spec.js'
import type { RequirementChange } from '../src/schema/spec.js'

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

const CONTENT = '# 佣金改造\n\n自营订单不该按下限兜底。'
const REVISED = '# 佣金改造\n\n自营免佣；代发保持原费率。'
const ANALYSIS = '与现有需求不冲突；影响面集中在结算。'

function writeChange(root: string, change: RequirementChange): Proposal {
  const proposal = Proposal.parse({
    id: 'P-01',
    title: '佣金改造',
    problem: ANALYSIS,
    options: [{ name: '登记新需求', summary: '佣金改造', cost: '需人对比确认后才写需求本体' }],
    recommendation: '建议采纳。',
    decision: 'draft',
    opened_at: '2026-11-17T10:00:00+08:00',
    requirement_change: change,
  })
  saveProposal(root, proposal)
  return proposal
}

function seedRequirement(root: string, state: 'draft' | 'confirmed' = 'draft'): void {
  createRequirement(root, { title: '佣金改造', content: CONTENT, opened_at: '2026-11-17T09:00:00+08:00' })
  if (state === 'confirmed') {
    saveRequirement(root, { ...loadRequirement(root, 'REQ-01'), state: 'confirmed' })
  }
}

describe('需求变更提案的批准应用', () => {
  it('new 提案批准：新需求落盘 draft v1，note 记「对话新建」，提案转 approved', () => {
    const root = makeSpec()
    writeChange(root, { mode: 'new', content: CONTENT, analysis: ANALYSIS })

    const result = run(root, 'P-01')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result.text ?? '').toContain('REQ-01')

    const requirement = loadRequirement(root, 'REQ-01')
    expect(requirement.state).toBe('draft')
    expect(requirement.title).toBe('佣金改造')
    expect(requirement.versions).toEqual([{ n: 1, at: '2026-11-05T12:00:00+08:00', note: '对话新建' }])
    expect(readFileSync(join(root, 'requirements', 'REQ-01.md'), 'utf8')).toBe(CONTENT)
    expect(readFileSync(requirementVersionPath(root, 'REQ-01', 1), 'utf8')).toBe(CONTENT)
    expect(read(root)).toMatchObject({ decision: 'approved', decided_at: '2026-11-05T12:00:00+08:00' })
  })

  it('new 提案带依据：note 记「基于 REQ-xx vN」，依据需求不动', () => {
    const root = makeSpec()
    seedRequirement(root, 'confirmed')
    writeChange(root, { mode: 'new', target: 'REQ-01', base_version: 1, content: REVISED, analysis: ANALYSIS })

    const result = run(root, 'P-01')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result.text ?? '').toContain('REQ-02')

    const created = loadRequirement(root, 'REQ-02')
    expect(created.versions[0]?.note).toBe('基于 REQ-01 v1')
    expect(readFileSync(join(root, 'requirements', 'REQ-02.md'), 'utf8')).toBe(REVISED)
    expect(loadRequirement(root, 'REQ-01').state).toBe('confirmed')
    expect(readFileSync(join(root, 'requirements', 'REQ-01.md'), 'utf8')).toBe(CONTENT)
  })

  it('revise 提案批准：目标改稿成新版本，note 记「对话改稿，基于 vN」，旧快照保留', () => {
    const root = makeSpec()
    seedRequirement(root)
    writeChange(root, { mode: 'revise', target: 'REQ-01', base_version: 1, content: REVISED, analysis: ANALYSIS })

    const result = run(root, 'P-01')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result.text ?? '').toContain('v2')

    const requirement = loadRequirement(root, 'REQ-01')
    expect(requirement.state).toBe('draft')
    expect(requirement.versions.map(version => version.n)).toEqual([1, 2])
    expect(requirement.versions[1]?.note).toBe('对话改稿，基于 v1')
    expect(readFileSync(join(root, 'requirements', 'REQ-01.md'), 'utf8')).toBe(REVISED)
    expect(readFileSync(requirementVersionPath(root, 'REQ-01', 1), 'utf8')).toBe(CONTENT)
    expect(readFileSync(requirementVersionPath(root, 'REQ-01', 2), 'utf8')).toBe(REVISED)
    expect(read(root).decision).toBe('approved')
  })

  it('revise 目标在提案后过了审：拒绝应用，提案仍是 draft，正文不动', () => {
    const root = makeSpec()
    seedRequirement(root)
    writeChange(root, { mode: 'revise', target: 'REQ-01', base_version: 1, content: REVISED, analysis: ANALYSIS })
    saveRequirement(root, { ...loadRequirement(root, 'REQ-01'), state: 'confirmed' })

    const result = run(root, 'P-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.text ?? '').toContain('只有起草态需求能应用改稿提案')
    expect(read(root).decision).toBe('draft')
    expect(readFileSync(join(root, 'requirements', 'REQ-01.md'), 'utf8')).toBe(CONTENT)
    expect(loadRequirement(root, 'REQ-01').versions.map(version => version.n)).toEqual([1])
  })

  it('revise 目标被删：拒绝应用，提案仍是 draft', () => {
    const root = makeSpec()
    writeChange(root, { mode: 'revise', target: 'REQ-01', base_version: 1, content: REVISED, analysis: ANALYSIS })

    const result = run(root, 'P-01')
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.text ?? '').toContain('读不到提案目标 REQ-01')
    expect(read(root).decision).toBe('draft')
    expect(existsSync(join(root, 'requirements'))).toBe(false)
  })

  it('已拍板的需求变更提案不再重复应用', () => {
    const root = makeSpec()
    const proposal = writeChange(root, { mode: 'new', content: CONTENT, analysis: ANALYSIS })
    saveProposal(root, { ...proposal, decision: 'approved', decided_at: '2026-11-17T11:00:00+08:00' })

    expect(run(root, 'P-01')).toMatchObject({ kind: 'error' })
    expect(existsSync(join(root, 'requirements'))).toBe(false)
  })
})
