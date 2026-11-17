/**
 * 需求变更提案批准的回滚测：需求落盘成功而提案批准态写失败时，需求改动必须回滚，
 * 磁盘不留「需求落了但提案没批」的半截；回滚也失败时如实报未可信状态。
 *
 * 用 fs 写入口注入磁盘失败；其余读写走真实实现。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { PathLike, WriteFileOptions } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ failProposalWrite: false, failRequirementRemove: false }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    writeFileSync: (path: PathLike | number, data: string | NodeJS.ArrayBufferView, options?: WriteFileOptions) => {
      if (flags.failProposalWrite && typeof path === 'string' && path.endsWith('P-01.yaml')) {
        throw new Error('模拟磁盘写失败')
      }
      actual.writeFileSync(path, data, options)
    },
    rmSync: (path: PathLike, options?: Parameters<typeof actual.rmSync>[1]) => {
      if (flags.failRequirementRemove && typeof path === 'string' && path.includes('REQ-')) {
        throw new Error('模拟删除失败')
      }
      actual.rmSync(path, options)
    },
  }
})

import { createProposalApproveCommand } from '../src/commands/proposal-approve.js'
import { saveProposal } from '../src/kernel/proposal-store.js'
import { createRequirement, loadRequirement, requirementVersionPath } from '../src/kernel/requirement-store.js'
import { Proposal } from '../src/schema/spec.js'
import type { RequirementChange } from '../src/schema/spec.js'

const dirs: string[] = []
afterAll(() => {
  flags.failProposalWrite = false
  flags.failRequirementRemove = false
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})
afterEach(() => {
  flags.failProposalWrite = false
  flags.failRequirementRemove = false
})

function makeSpec(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lcoder-approve-rollback-'))
  dirs.push(repo)
  const root = join(repo, '.spec')
  mkdirSync(join(root, 'proposals'), { recursive: true })
  return root
}

const CONTENT = '# 佣金改造\n\n自营订单不该按下限兜底。'
const REVISED = '# 佣金改造\n\n自营免佣。'

function writeChange(root: string, change: RequirementChange): void {
  saveProposal(root, Proposal.parse({
    id: 'P-01',
    title: '佣金改造',
    problem: '影响面集中在结算。',
    options: [{ name: '登记新需求', summary: '佣金改造', cost: '需人对比确认' }],
    recommendation: '建议采纳。',
    decision: 'draft',
    opened_at: '2026-11-17T10:00:00+08:00',
    requirement_change: change,
  }))
}

function run(root: string) {
  return createProposalApproveCommand(root, () => '2026-11-17T12:00:00+08:00').handler({ rawInput: 'P-01' })
}

describe('提案批准态写失败的回滚', () => {
  it('new：需求三个文件全部撤掉，提案仍是 draft', () => {
    const root = makeSpec()
    writeChange(root, { mode: 'new', content: CONTENT, analysis: '影响面集中在结算。' })
    flags.failProposalWrite = true

    const result = run(root)
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.text ?? '').toContain('已回滚')
    expect(existsSync(join(root, 'requirements', 'REQ-01.yaml'))).toBe(false)
    expect(existsSync(join(root, 'requirements', 'REQ-01.md'))).toBe(false)
    expect(existsSync(requirementVersionPath(root, 'REQ-01', 1))).toBe(false)
    expect(readFileSync(join(root, 'proposals', 'P-01.yaml'), 'utf8')).toContain('decision: draft')
  })

  it('revise：正文还原、新快照删掉、版本表还原，提案仍是 draft', () => {
    const root = makeSpec()
    createRequirement(root, { title: '佣金改造', content: CONTENT, opened_at: '2026-11-17T09:00:00+08:00' })
    writeChange(root, { mode: 'revise', target: 'REQ-01', base_version: 1, content: REVISED, analysis: '影响面集中在结算。' })
    flags.failProposalWrite = true

    const result = run(root)
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.text ?? '').toContain('已回滚')
    expect(readFileSync(join(root, 'requirements', 'REQ-01.md'), 'utf8')).toBe(CONTENT)
    expect(existsSync(requirementVersionPath(root, 'REQ-01', 2))).toBe(false)
    expect(loadRequirement(root, 'REQ-01').versions.map(version => version.n)).toEqual([1])
    expect(readFileSync(join(root, 'proposals', 'P-01.yaml'), 'utf8')).toContain('decision: draft')
  })

  it('回滚也失败时如实报未可信状态，请人核对', () => {
    const root = makeSpec()
    writeChange(root, { mode: 'new', content: CONTENT, analysis: '影响面集中在结算。' })
    flags.failProposalWrite = true
    flags.failRequirementRemove = true

    const result = run(root)
    expect(result).toMatchObject({ kind: 'error' })
    expect(result.text ?? '').toContain('回滚失败')
    expect(result.text ?? '').toContain('人工核对')
  })
})
